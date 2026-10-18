package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httputil"
	"net/url"
	"regexp"
	"strings"
	"time"

	"noma.local/public/internal/cloud"
	"noma.local/public/internal/ha"
	"noma.local/public/internal/protocol"
)

// Keep the existing frontend API shapes; device routes are always local.
// Cloud JWTs stay in Account. The frontend receives only a session-present marker.
const localAccessMarker = "noma-local-cookie-session"

var cloudRoutes = []struct {
	method string
	path   *regexp.Regexp
}{
	{"GET", regexp.MustCompile(`^/(me|settings|chat/quota|chat/sessions|chat/sessions/latest|chat/sessions/[A-Za-z0-9_-]+|chat/sessions/[A-Za-z0-9_-]+/messages|chat/trace/[A-Za-z0-9_-]+|chat/stt/status)$`)},
	{"PATCH", regexp.MustCompile(`^/(me|chat/sessions/[A-Za-z0-9_-]+|chat/messages/[A-Za-z0-9_-]+/feedback)$`)},
	{"POST", regexp.MustCompile(`^/(chat/sessions|chat/import|chat/tts)$`)},
	{"DELETE", regexp.MustCompile(`^/chat/(sessions/[A-Za-z0-9_-]+(/messages)?|messages/[A-Za-z0-9_-]+)$`)},
	{"GET", regexp.MustCompile(`^/memory/(overview|items|topics|recent-understanding(/[A-Za-z0-9_-]+)?|home-items|turn-status/[A-Za-z0-9_-]+)$`)},
	{"DELETE", regexp.MustCompile(`^/memory/(items|home-items)/[A-Za-z0-9_-]+$`)},
	{"PUT", regexp.MustCompile(`^/settings/memory$`)},
}
var sendPath = regexp.MustCompile(`^/chat/sessions/([A-Za-z0-9_-]+)/messages$`)
var controlPath = regexp.MustCompile(`^/home/devices/([a-z_]+\.[a-z0-9_]+)/control$`)

func (s *Server) frontendAPI(ctx context.Context, w http.ResponseWriter, r *http.Request, sess *session) {
	path := strings.TrimPrefix(r.URL.Path, "/api/v1")
	if s.frontendAuth(ctx, w, r, sess, path) {
		return
	}
	if strings.HasPrefix(path, "/guest/") || path == "/community/qr-code" {
		allowed := r.Method == "GET" && (path == "/guest/chat/quota" || path == "/guest/stt/status" || path == "/community/qr-code") || r.Method == "POST" && (path == "/guest/chat" || path == "/guest/tts")
		if allowed {
			s.forwardCloud(ctx, w, r, nil)
			return
		}
		if path == "/guest/stt/stream" && r.Method == "GET" {
			s.forwardSpeech(ctx, w, r, nil)
			return
		}
		fail(w, 404, "接口不存在")
		return
	}
	if sess.account == nil {
		fail(w, 401, "请先登录 Noma 云端账号")
		return
	}
	if path == "/chat/stt/stream" && r.Method == "GET" {
		s.forwardSpeech(ctx, w, r, sess.account)
		return
	}
	if match := sendPath.FindStringSubmatch(path); match != nil && r.Method == "POST" {
		s.frontendSend(ctx, w, r, sess, match[1])
		return
	}
	if strings.HasPrefix(path, "/home/") || strings.HasPrefix(path, "/ha/") || strings.HasPrefix(path, "/settings/home-assistant") {
		s.frontendHA(ctx, w, r, path)
		return
	}
	if path == "/settings" && r.Method == "GET" {
		var settings map[string]any
		if err := s.cloud.Do(ctx, sess.account, "GET", "/api/v1/settings", nil, &settings); err != nil {
			cloudFailure(w, err)
			return
		}
		if settings == nil {
			settings = map[string]any{}
		}
		settings["home_assistant_configured"] = s.ha.Configured()
		settings["allowed_device_ids"] = s.ha.Allowed()
		settings["blocked_device_ids"] = []string{}
		writeJSON(w, 200, settings)
		return
	}
	for _, route := range cloudRoutes {
		if r.Method == route.method && route.path.MatchString(path) {
			s.forwardCloud(ctx, w, r, sess.account)
			return
		}
	}
	fail(w, 404, "本地版未开放此接口")
}

func cloudFailure(w http.ResponseWriter, err error) {
	var apiError *cloud.APIError
	if errors.As(err, &apiError) {
		fail(w, apiError.Status, err.Error())
		return
	}
	fail(w, 502, "无法连接 Noma Cloud")
}

func (s *Server) frontendAuth(ctx context.Context, w http.ResponseWriter, r *http.Request, sess *session, path string) bool {
	if !strings.HasPrefix(path, "/auth/") {
		return false
	}
	switch {
	case r.Method == "POST" && (path == "/auth/otp/send" || path == "/auth/phone/send-code"):
		s.forwardCloud(ctx, w, r, nil)
	case r.Method == "POST" && (path == "/auth/otp/verify" || path == "/auth/phone/login" || path == "/auth/clerk"):
		var input map[string]any
		if path != "/auth/clerk" && !decode(w, r, &input) {
			return true
		}
		clerkToken := ""
		if path == "/auth/clerk" {
			clerkToken = strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
			if clerkToken == "" {
				fail(w, 401, "缺少 Clerk 登录凭证")
				return true
			}
		}
		account, body, err := s.cloud.Authenticate(ctx, "/api/v1"+path, clerkToken, input)
		if err != nil {
			cloudFailure(w, err)
			return true
		}
		if sess.account != nil {
			s.cloud.Logout(ctx, sess.account)
		}
		sess.account, sess.turns = account, map[string]cachedTurn{}
		sess.userID, _ = body["user_id"].(string)
		if sess.userID == "" {
			if user, ok := body["user"].(map[string]any); ok {
				sess.userID, _ = user["user_id"].(string)
			}
		}
		body["access_token"] = localAccessMarker
		writeJSON(w, 200, body)
	case path == "/auth/refresh" && r.Method == "POST":
		if sess.account == nil {
			fail(w, 401, "请先登录")
			return true
		}
		if _, err := s.cloud.AccessToken(ctx, sess.account); err != nil {
			cloudFailure(w, err)
			return true
		}
		writeJSON(w, 200, map[string]any{"access_token": localAccessMarker, "user_id": sess.userID, "expires_in": int(time.Until(sess.expires).Seconds())})
	case path == "/auth/session" && r.Method == "GET":
		if sess.account == nil {
			fail(w, 401, "请先登录")
			return true
		}
		var user any
		if err := s.cloud.Do(ctx, sess.account, "GET", "/api/v1/me", nil, &user); err != nil {
			cloudFailure(w, err)
			return true
		}
		writeJSON(w, 200, user)
	case path == "/auth/logout" && r.Method == "POST":
		if sess.account != nil {
			s.cloud.Logout(ctx, sess.account)
		}
		sess.account, sess.userID, sess.turns = nil, "", map[string]cachedTurn{}
		// Keep the household unlock cookie, matching the original account logout flow.
		writeJSON(w, 200, map[string]bool{"ok": true})
	default:
		fail(w, 404, "认证接口不存在")
	}
	return true
}

func (s *Server) forwardCloud(ctx context.Context, w http.ResponseWriter, r *http.Request, account *cloud.Account) {
	body := http.MaxBytesReader(w, r.Body, 2<<20)
	guestID := ""
	if account == nil {
		if cookie, err := r.Cookie("noma_guest_id"); err == nil {
			guestID = cookie.Value
		}
	}
	response, err := s.cloud.Forward(ctx, account, r.Method, r.URL.RequestURI(), r.Header.Get("Content-Type"), guestID, body)
	if err != nil {
		cloudFailure(w, err)
		return
	}
	defer response.Body.Close()
	w.Header().Set("Content-Type", response.Header.Get("Content-Type"))
	// Preserve the signed anonymous quota identity, but never cloud login cookies.
	if account == nil {
		for _, cookie := range response.Cookies() {
			if cookie.Name == "noma_guest_id" {
				cookie.Domain = ""
				cookie.Path = "/"
				cookie.Secure = s.cfg.SecureCookie
				cookie.HttpOnly = true
				cookie.SameSite = http.SameSiteLaxMode
				http.SetCookie(w, cookie)
			}
		}
	}
	w.WriteHeader(response.StatusCode)
	buffer := make([]byte, 16<<10)
	for {
		n, err := response.Body.Read(buffer)
		if n > 0 {
			if _, writeErr := w.Write(buffer[:n]); writeErr != nil {
				return
			}
			if f, ok := w.(http.Flusher); ok {
				f.Flush()
			}
		}
		if err != nil {
			return
		}
	}
}

func (s *Server) forwardSpeech(ctx context.Context, w http.ResponseWriter, r *http.Request, account *cloud.Account) {
	token := ""
	if account != nil {
		var err error
		token, err = s.cloud.AccessToken(ctx, account)
		if err != nil {
			cloudFailure(w, err)
			return
		}
	}
	target, _ := url.Parse(s.cfg.CloudURL)
	guestID := ""
	if account == nil {
		if cookie, err := r.Cookie("noma_guest_id"); err == nil {
			guestID = cookie.Value
		}
	}
	proxy := httputil.NewSingleHostReverseProxy(target)
	director := proxy.Director
	proxy.Director = func(req *http.Request) {
		director(req)
		req.Host = target.Host
		req.Header.Del("Cookie")
		if guestID != "" {
			req.AddCookie(&http.Cookie{Name: "noma_guest_id", Value: guestID})
		}
		req.Header.Del("Authorization")
		req.Header.Del("Forwarded")
		req.Header.Del("X-Forwarded-For")
		req.Header.Del("X-Forwarded-Host")
		req.Header.Del("X-Forwarded-Proto")
		// No local marker, Cookie or arbitrary query values are sent upstream.
		query := url.Values{}
		if token != "" {
			query.Set("token", token)
		}
		req.URL.RawQuery = query.Encode()
		req.Header.Set("Origin", strings.TrimRight(s.cfg.CloudURL, "/"))
	}
	proxy.ModifyResponse = func(response *http.Response) error { response.Header.Del("Set-Cookie"); return nil }
	proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		fail(w, 502, "无法连接云端语音服务")
	}
	proxy.ServeHTTP(w, r.WithContext(ctx))
}

func (s *Server) frontendSend(ctx context.Context, w http.ResponseWriter, r *http.Request, sess *session, sessionID string) {
	var input struct {
		Content            string `json:"content"`
		RequestID          string `json:"request_id"`
		Regenerate         bool   `json:"regenerate"`
		ReplaceAssistantID string `json:"replace_assistant_id"`
	}
	if !decode(w, r, &input) {
		return
	}
	result := s.processTurn(ctx, sess, turnInput{RequestID: input.RequestID, SessionID: sessionID, Message: input.Content, Regenerate: input.Regenerate, ReplaceAssistantID: input.ReplaceAssistantID})
	if result.status != 200 {
		writeJSON(w, result.status, result.response)
		return
	}
	out := result.response.(*protocol.TurnResponse)
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("X-Accel-Buffering", "no")
	emit := func(body any) {
		b, _ := json.Marshal(body)
		_, _ = fmt.Fprintf(w, "event: message\ndata: %s\n\n", b)
		if f, ok := w.(http.Flusher); ok {
			f.Flush()
		}
	}
	meta := map[string]string{}
	if out.MessageID != "" {
		meta["message_id"] = out.MessageID
	}
	if out.AssistantMessageID != "" {
		meta["assistant_message_id"] = out.AssistantMessageID
	}
	if len(meta) > 0 {
		emit(map[string]any{"type": "meta", "data": meta})
	}
	emit(map[string]string{"type": "token", "content": out.Reply})
	emit(map[string]string{"type": "done"})
}

func (s *Server) frontendHA(ctx context.Context, w http.ResponseWriter, r *http.Request, path string) {
	if path == "/ha/connections" && r.Method == "GET" {
		err := s.ha.Check(ctx)
		diagnostic := "局域网直连，无需安装 Connector"
		if err != nil {
			diagnostic = err.Error()
		}
		writeJSON(w, 200, map[string]any{"available": true, "prepared": s.ha.Configured(), "authorized": s.ha.Configured(), "connection_id": "noma-local-instance", "local_url": s.cfg.HAURL,
			"ha_reachable": err == nil, "can_authorize": false, "home_name": "我的家", "diagnostic": diagnostic})
		return
	}
	if path == "/home/status" && r.Method == "GET" {
		status := map[string]any{"configured": s.ha.Configured(), "ha_reachable": false}
		if !s.ha.Configured() {
			writeJSON(w, 200, status)
			return
		}
		if err := s.ha.Check(ctx); err != nil {
			status["message"] = err.Error()
			writeJSON(w, 200, status)
			return
		}
		states, err := s.ha.States(ctx)
		if err != nil {
			status["message"] = err.Error()
			writeJSON(w, 200, status)
			return
		}
		status["ha_reachable"], status["updated_at"] = true, time.Now().UTC().Format(time.RFC3339)
		summary := []map[string]any{}
		for _, state := range states {
			summary = append(summary, map[string]any{"name": stateName(state), "domain": strings.SplitN(state.EntityID, ".", 2)[0], "state": state.State})
		}
		status["device_summary"] = summary
		writeJSON(w, 200, status)
		return
	}
	if path == "/home/devices" && r.Method == "GET" {
		states, err := s.ha.States(ctx)
		if err != nil {
			fail(w, 502, err.Error())
			return
		}
		devices := []map[string]any{}
		for _, state := range states {
			domain := strings.SplitN(state.EntityID, ".", 2)[0]
			actions := []string{}
			params := map[string][]string{}
			if domain == "light" || domain == "switch" || domain == "input_boolean" {
				actions = []string{"turn_on", "turn_off"}
			}
			if domain == "light" {
				turnOn := []string{}
				if _, exists := state.Attributes["brightness"]; exists {
					turnOn = append(turnOn, "brightness_pct")
				}
				if modes, ok := state.Attributes["supported_color_modes"].([]any); ok {
					for _, mode := range modes {
						switch mode {
						case "rgb", "hs", "xy":
							turnOn = append(turnOn, "rgb_color")
						case "rgbw":
							turnOn = append(turnOn, "rgbw_color")
						case "rgbww":
							turnOn = append(turnOn, "rgbww_color")
						case "white":
							turnOn = append(turnOn, "white")
						case "color_temp":
							turnOn = append(turnOn, "color_temp_kelvin")
						}
					}
				}
				params["turn_on"] = turnOn
			}
			devices = append(devices, map[string]any{"id": state.EntityID, "entity_id": state.EntityID, "name": stateName(state), "domain": domain,
				"state": state.State, "attributes": state.Attributes, "supported_actions": actions, "action_params": params, "home_visible": true, "last_updated": time.Now().UTC().Format(time.RFC3339)})
		}
		writeJSON(w, 200, devices)
		return
	}
	if match := controlPath.FindStringSubmatch(path); match != nil && r.Method == "POST" {
		var input struct {
			Action string         `json:"action"`
			Params map[string]any `json:"params"`
		}
		if !decode(w, r, &input) {
			return
		}
		result, err := s.ha.Control(ctx, ha.Control{EntityID: match[1], Action: input.Action, Params: input.Params})
		if err != nil {
			fail(w, 400, err.Error())
			return
		}
		writeJSON(w, 200, map[string]any{"ok": true, "result": result})
		return
	}
	// Never forward FRP authorization or HA credentials to cloud.
	fail(w, 400, "Noma Local 使用部署配置中的局域网 HA 连接，无需建立远程连接")
}

func stateName(state ha.State) string {
	if name, ok := state.Attributes["friendly_name"].(string); ok && name != "" {
		return name
	}
	return state.EntityID
}
