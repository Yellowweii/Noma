package cloud

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"noma.local/public/internal/protocol"
)

// ExchangeTurn negotiates incremental chat events without changing tool replies.
// Each exchange still ends with one validated turn response; writes are never retried.
func (c *Client) ExchangeTurn(ctx context.Context, account *Account, path string, input any, output *protocol.TurnResponse, onEvent func(protocol.StreamEvent)) error {
	if onEvent == nil {
		return c.Do(ctx, account, "POST", path, input, output)
	}
	token, err := c.AccessToken(ctx, account)
	if err != nil {
		return err
	}
	body, err := json.Marshal(input)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, "POST", c.base+path, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "text/event-stream")
	response, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("无法连接 Noma Cloud，请检查网络")
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return &APIError{response.StatusCode}
	}
	if !strings.HasPrefix(response.Header.Get("Content-Type"), "text/event-stream") {
		data, err := io.ReadAll(io.LimitReader(response.Body, (1<<20)+1))
		if err != nil || len(data) > 1<<20 {
			return fmt.Errorf("云端响应超出限制或读取失败")
		}
		return json.Unmarshal(data, output)
	}
	scanner := bufio.NewScanner(response.Body)
	scanner.Buffer(make([]byte, 4096), 1<<20)
	name, data, completed := "message", "", false
	dispatch := func() error {
		if data == "" {
			return nil
		}
		switch name {
		case "message":
			var event protocol.StreamEvent
			if err := json.Unmarshal([]byte(data), &event); err != nil {
				return fmt.Errorf("云端流式事件无效")
			}
			if completed {
				return fmt.Errorf("云端在轮次结束后继续发送事件")
			}
			if event.Type != "done" {
				onEvent(event)
			}
		case "turn":
			if completed || json.Unmarshal([]byte(data), output) != nil {
				return fmt.Errorf("云端轮次响应无效")
			}
			completed = true
		case "error":
			var failure struct {
				Error string `json:"error"`
			}
			_ = json.Unmarshal([]byte(data), &failure)
			if failure.Error == "" {
				failure.Error = "云端流式回复中断"
			}
			return fmt.Errorf("%s", failure.Error)
		}
		return nil
	}
	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			if err := dispatch(); err != nil {
				return err
			}
			name, data = "message", ""
		} else if strings.HasPrefix(line, "event:") {
			name = strings.TrimSpace(strings.TrimPrefix(line, "event:"))
		} else if strings.HasPrefix(line, "data:") {
			if data != "" {
				data += "\n"
			}
			data += strings.TrimPrefix(strings.TrimPrefix(line, "data:"), " ")
		}
	}
	if err := scanner.Err(); err != nil {
		return fmt.Errorf("云端流式连接中断，结果未知")
	}
	if err := dispatch(); err != nil {
		return err
	}
	if !completed {
		return fmt.Errorf("云端流式回复未完成，结果未知")
	}
	return nil
}
