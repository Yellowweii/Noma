package app

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"time"

	"noma.local/public/internal/cloud"
	"noma.local/public/internal/protocol"
)

type turnInput struct {
	RequestID          string `json:"request_id"`
	SessionID          string `json:"session_id,omitempty"`
	Message            string `json:"message"`
	Regenerate         bool   `json:"regenerate,omitempty"`
	ReplaceAssistantID string `json:"replace_assistant_id,omitempty"`
}

func (s *Server) turn(ctx context.Context, w http.ResponseWriter, r *http.Request, sess *session) {
	var req turnInput
	if !decode(w, r, &req) {
		return
	}
	result := s.processTurn(ctx, sess, req)
	writeJSON(w, result.status, result.response)
}

func (s *Server) processTurn(ctx context.Context, sess *session, req turnInput) cachedTurn {
	return s.processTurnStream(ctx, sess, req, nil)
}

func (s *Server) processTurnStream(ctx context.Context, sess *session, req turnInput, onEvent func(protocol.StreamEvent)) cachedTurn {
	failure := func(status int, message string) cachedTurn {
		return cachedTurn{status: status, response: map[string]string{"error": message}}
	}
	if !idPattern.MatchString(req.RequestID) || len(req.Message) == 0 || len(req.Message) > 16000 || (req.SessionID != "" && !idPattern.MatchString(req.SessionID)) {
		return failure(400, "请求 ID、会话 ID 或消息长度无效")
	}
	b, _ := json.Marshal(req)
	digest := sha256.Sum256(b)
	if cached, exists := sess.turns[req.RequestID]; exists {
		if cached.digest != digest {
			return failure(409, "同一请求 ID 不可更改内容")
		}
		return cached
	}
	if previous, exists := sess.requests[req.RequestID]; exists {
		if previous != digest {
			return failure(409, "同一请求 ID 不可更改内容")
		}
		return failure(409, "此请求在服务重启前已开始，结果无法恢复；请先检查设备状态，不会重复执行")
	}
	// Never evict a replay entry during the local login session.
	if len(sess.requests) >= 128 {
		return failure(429, "本地会话已达 128 轮，请退出并重新登录")
	}
	if sess.requests == nil {
		sess.requests = map[string][32]byte{}
	}
	sess.requests[req.RequestID] = digest
	if err := s.bindSessionPersistence(sess); err != nil {
		delete(sess.requests, req.RequestID)
		return failure(500, "无法保存本地操作记录，未发起新的操作")
	}
	out, err := s.runTurnStream(ctx, sess.account, req, onEvent)
	status := 200
	var body any = out
	if err != nil {
		status = 502
		body = map[string]string{"error": err.Error() + "；如已操作设备，请先确认状态再发起新请求"}
	}
	sess.turns[req.RequestID] = cachedTurn{digest, body, status}
	return sess.turns[req.RequestID]
}

func (s *Server) runTurn(ctx context.Context, account *cloud.Account, req turnInput) (*protocol.TurnResponse, error) {
	return s.runTurnStream(ctx, account, req, nil)
}

func (s *Server) runTurnStream(ctx context.Context, account *cloud.Account, req turnInput, onEvent func(protocol.StreamEvent)) (*protocol.TurnResponse, error) {
	if err := s.capabilities(ctx, account); err != nil {
		return nil, err
	}
	var response protocol.TurnResponse
	input := protocol.TurnRequest{ProtocolVersion: protocol.Version, RequestID: req.RequestID, SessionID: req.SessionID, Message: req.Message, Regenerate: req.Regenerate, ReplaceAssistantID: req.ReplaceAssistantID}
	if err := s.cloud.ExchangeTurn(ctx, account, "/api/v1/local/turns", input, &response, onEvent); err != nil {
		return nil, err
	}
	sessionID, turnID := req.SessionID, ""
	type previous struct {
		fingerprint [32]byte
		result      protocol.ToolResult
	}
	seen := map[string]previous{}
	for round := 0; round < 8; round++ {
		if response.ProtocolVersion != protocol.Version || response.RequestID != req.RequestID || !idPattern.MatchString(response.SessionID) || !idPattern.MatchString(response.TurnID) {
			return nil, fmt.Errorf("云端响应协议、请求 ID 或会话信息无效")
		}
		if sessionID == "" {
			sessionID = response.SessionID
		}
		if turnID == "" {
			turnID = response.TurnID
		}
		if response.SessionID != sessionID || response.TurnID != turnID {
			return nil, fmt.Errorf("云端响应改变了会话或轮次，已停止执行")
		}
		if len(response.ToolCalls) == 0 {
			if response.Reply == "" {
				return nil, fmt.Errorf("云端未返回最终回复")
			}
			return &response, nil
		}
		if response.Reply != "" || len(response.ToolCalls) > 16 {
			return nil, fmt.Errorf("云端工具批次格式无效")
		}
		// Validate the whole batch before executing any physical operation.
		batch := map[string]bool{}
		newCalls := 0
		for _, call := range response.ToolCalls {
			if !idPattern.MatchString(call.ID) || batch[call.ID] || call.ExpiresAt.IsZero() || !call.ExpiresAt.After(time.Now()) || time.Until(call.ExpiresAt) > 2*time.Minute {
				return nil, fmt.Errorf("工具调用 ID 或有效期无效，已停止执行")
			}
			batch[call.ID] = true
			if _, exists := seen[call.ID]; !exists {
				newCalls++
			}
			fp, _ := json.Marshal(struct {
				Name string
				Args json.RawMessage
			}{call.Name, call.Arguments})
			if old, ok := seen[call.ID]; ok && old.fingerprint != sha256.Sum256(fp) {
				return nil, fmt.Errorf("工具调用 ID 被用于不同参数，已停止执行")
			}
		}
		if len(seen)+newCalls > 16 {
			return nil, fmt.Errorf("单轮工具调用数量超过 16 次")
		}
		results := []protocol.ToolResult{}
		for _, call := range response.ToolCalls {
			if old, ok := seen[call.ID]; ok {
				results = append(results, old.result)
				continue
			}
			if len(seen) >= 16 {
				return nil, fmt.Errorf("单轮工具调用数量超过 16 次")
			}
			if !call.ExpiresAt.After(time.Now()) {
				return nil, fmt.Errorf("工具调用已过期")
			}
			fp, _ := json.Marshal(struct {
				Name string
				Args json.RawMessage
			}{call.Name, call.Arguments})
			toolCtx, cancel := context.WithDeadline(ctx, call.ExpiresAt)
			result := s.ha.Execute(toolCtx, call)
			cancel()
			seen[call.ID] = previous{sha256.Sum256(fp), result}
			results = append(results, result)
		}
		next := protocol.ResultsRequest{ProtocolVersion: protocol.Version, RequestID: req.RequestID, SessionID: sessionID, Results: results}
		response = protocol.TurnResponse{}
		if err := s.cloud.ExchangeTurn(ctx, account, "/api/v1/local/turns/"+url.PathEscape(turnID)+"/results", next, &response, onEvent); err != nil {
			return nil, err
		}
	}
	return nil, fmt.Errorf("云端工具往返次数超过限制")
}
