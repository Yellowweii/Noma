package app

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"noma.local/public/internal/protocol"
)

const testKey = "test-only-access-key-long-enough"
const requestID = "request-00000000000001"
const sessionID = "session-00000000000001"
const turnID = "turn-0000000000000001"
const callID = "tool-call-00000000001"

type fixtureOptions struct {
	unsupported, expired, wrongBinding, failResults, duplicate, shortToken bool
	entity                                                                 string
}
type fixture struct {
	local                               *httptest.Server
	client                              *http.Client
	controls, turns, results, refreshes atomic.Int32
}

func newFixture(t *testing.T, options fixtureOptions) *fixture {
	t.Helper()
	f := &fixture{}
	if options.entity == "" {
		options.entity = "light.allowed"
	}
	ha := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test-ha-secret" {
			t.Error("HA did not receive its own token")
		}
		if r.URL.Path == "/api/" {
			_, _ = w.Write([]byte(`{"message":"API running."}`))
			return
		}
		if r.URL.Path == "/api/services/light/turn_on" && r.Method == "POST" {
			f.controls.Add(1)
			_, _ = w.Write([]byte(`[]`))
			return
		}
		if r.URL.Path == "/api/states/light.allowed" {
			_, _ = w.Write([]byte(`{"entity_id":"light.allowed","state":"on","attributes":{"friendly_name":"Test lamp"}}`))
			return
		}
		t.Errorf("unexpected HA request: %s", r.URL.Path)
		http.NotFound(w, r)
	}))
	t.Cleanup(ha.Close)
	response := func() protocol.TurnResponse {
		request := requestID
		if options.wrongBinding {
			request = "request-other-00000000"
		}
		return protocol.TurnResponse{ProtocolVersion: "1", RequestID: request, SessionID: sessionID, TurnID: turnID}
	}
	tool := func() protocol.ToolCall {
		expires := time.Now().Add(time.Minute)
		if options.expired {
			expires = time.Now().Add(-time.Second)
		}
		args, _ := json.Marshal(map[string]string{"entity_id": options.entity, "action": "turn_on"})
		return protocol.ToolCall{ID: callID, Name: "control_device", Arguments: args, ExpiresAt: expires}
	}
	cloud := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		if strings.Contains(string(body), "test-ha-secret") || strings.Contains(string(body), testKey) || strings.Contains(r.Header.Get("Authorization"), "test-ha-secret") {
			t.Error("local secrets reached cloud")
		}
		if strings.HasPrefix(r.URL.Path, "/api/v1/local/") && r.Header.Get("Authorization") != "Bearer test-cloud-access" {
			t.Error("cloud bearer token missing")
		}
		switch r.URL.Path {
		case "/api/v1/auth/otp/send":
			writeJSON(w, 200, map[string]bool{"ok": true})
		case "/api/v1/auth/otp/verify":
			http.SetCookie(w, &http.Cookie{Name: "noma_refresh_token", Value: "test-refresh-token", Secure: true, HttpOnly: true})
			ttl := 3600
			if options.shortToken {
				ttl = 1
			}
			writeJSON(w, 200, map[string]any{"access_token": "test-cloud-access", "expires_in": ttl, "user_id": "test-user", "user": map[string]string{"user_id": "test-user", "name": "Test"}})
		case "/api/v1/auth/refresh":
			cookie, err := r.Cookie("noma_refresh_token")
			if err != nil || cookie.Value != "test-refresh-token" {
				t.Error("refresh token missing")
			}
			f.refreshes.Add(1)
			writeJSON(w, 200, map[string]any{"access_token": "test-cloud-access", "expires_in": 3600})
		case "/api/v1/auth/logout":
			writeJSON(w, 200, map[string]bool{"ok": true})
		case "/api/v1/me":
			if r.Header.Get("Authorization") != "Bearer test-cloud-access" {
				t.Error("account route did not use backend credential")
			}
			writeJSON(w, 200, map[string]string{"user_id": "test-user", "name": "Test"})
		case "/api/v1/memory/overview":
			writeJSON(w, 200, map[string]int{"total_memories": 3, "recorded_days": 2})
		case "/api/v1/settings":
			writeJSON(w, 200, map[string]any{"auto_memory_enabled": true, "home_assistant_configured": false, "allowed_device_ids": []string{"light.cloud_only"}})
		case "/api/v1/local/capabilities":
			if options.unsupported {
				http.NotFound(w, r)
				return
			}
			writeJSON(w, 200, map[string]any{"protocol_version": "1", "remote_tools": true})
		case "/api/v1/local/turns":
			f.turns.Add(1)
			var in protocol.TurnRequest
			if err := json.Unmarshal(body, &in); err != nil || in.RequestID != requestID || in.Message == "" {
				t.Error("invalid cloud turn request")
			}
			out := response()
			out.ToolCalls = []protocol.ToolCall{tool()}
			writeJSON(w, 200, out)
		case "/api/v1/local/turns/" + turnID + "/results":
			count := f.results.Add(1)
			if options.failResults {
				http.Error(w, "simulated interruption after control", 504)
				return
			}
			var in protocol.ResultsRequest
			if err := json.Unmarshal(body, &in); err != nil || len(in.Results) != 1 || in.Results[0].ID != callID {
				t.Error("invalid tool result")
			}
			if len(in.Results) == 1 && in.Results[0].OK != (options.entity == "light.allowed") {
				t.Error("unexpected tool result authorization")
			}
			out := response()
			if options.duplicate && count == 1 {
				out.ToolCalls = []protocol.ToolCall{tool()}
			} else {
				out.Reply = "本轮完成"
			}
			writeJSON(w, 200, out)
		default:
			t.Errorf("unexpected cloud request: %s", r.URL.Path)
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(cloud.Close)
	server, err := New(Config{AccessKey: testKey, CloudURL: cloud.URL, HAURL: ha.URL, HAToken: "test-ha-secret", AllowedEntities: []string{"light.allowed"}})
	if err != nil {
		t.Fatal(err)
	}
	f.local = httptest.NewServer(server)
	t.Cleanup(f.local.Close)
	jar, _ := cookiejar.New(nil)
	f.client = &http.Client{Jar: jar, Timeout: 5 * time.Second}
	return f
}

func (f *fixture) request(t *testing.T, method, path string, input any) (int, string, http.Header) {
	t.Helper()
	var raw []byte
	if input != nil {
		raw, _ = json.Marshal(input)
	}
	req, _ := http.NewRequest(method, f.local.URL+path, bytes.NewReader(raw))
	if method != "GET" {
		req.Header.Set("Origin", f.local.URL)
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := f.client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, string(b), resp.Header
}

func (f *fixture) login(t *testing.T) {
	t.Helper()
	status, body, _ := f.request(t, "POST", "/api/local/unlock", map[string]string{"key": testKey})
	if status != 200 {
		t.Fatalf("unlock: %d %s", status, body)
	}
	status, body, headers := f.request(t, "POST", "/api/local/auth/login", map[string]string{"email": "test@example.invalid", "code": "123456"})
	if status != 200 {
		t.Fatalf("login: %d %s", status, body)
	}
	if strings.Contains(body, "test-cloud-access") || strings.Contains(strings.Join(headers.Values("Set-Cookie"), ";"), "test-refresh-token") {
		t.Fatal("cloud credentials disclosed to browser")
	}
}

func input() turnInput { return turnInput{RequestID: requestID, Message: "打开测试灯"} }

func TestRemoteToolRoundTripAndRequestReplay(t *testing.T) {
	f := newFixture(t, fixtureOptions{duplicate: true})
	f.login(t)
	for i := 0; i < 2; i++ {
		status, body, _ := f.request(t, "POST", "/api/local/turns", input())
		if status != 200 || !strings.Contains(body, "本轮完成") {
			t.Fatalf("turn: %d %s", status, body)
		}
	}
	if f.controls.Load() != 1 || f.turns.Load() != 1 || f.results.Load() != 2 {
		t.Fatalf("repeated physical operation: HA=%d turns=%d results=%d", f.controls.Load(), f.turns.Load(), f.results.Load())
	}
	changed := input()
	changed.Message = "不同消息"
	status, _, _ := f.request(t, "POST", "/api/local/turns", changed)
	if status != 409 || f.controls.Load() != 1 {
		t.Fatal("conflicting request replay accepted")
	}
}

func TestConcurrentRequestReplay(t *testing.T) {
	f := newFixture(t, fixtureOptions{})
	f.login(t)
	var wg sync.WaitGroup
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			status, body, _ := f.request(t, "POST", "/api/local/turns", input())
			if status != 200 {
				t.Errorf("request: %d %s", status, body)
			}
		}()
	}
	wg.Wait()
	if f.controls.Load() != 1 || f.turns.Load() != 1 {
		t.Fatal("concurrent replay caused duplicate execution")
	}
}

func TestCloudAndToolFailuresNeverFallBackToCloudHA(t *testing.T) {
	for name, options := range map[string]fixtureOptions{
		"missing cloud capability": {unsupported: true},
		"expired call":             {expired: true},
		"wrong request binding":    {wrongBinding: true},
		"unauthorized entity":      {entity: "light.private"},
	} {
		t.Run(name, func(t *testing.T) {
			f := newFixture(t, options)
			f.login(t)
			status, body, _ := f.request(t, "POST", "/api/local/turns", input())
			if status != 502 && options.entity == "" {
				t.Fatalf("expected failure: %d %s", status, body)
			}
			if f.controls.Load() != 0 {
				t.Fatal("invalid request reached HA")
			}
		})
	}
}

func TestResultSubmissionFailureCannotReplayDeviceAction(t *testing.T) {
	f := newFixture(t, fixtureOptions{failResults: true})
	f.login(t)
	for i := 0; i < 2; i++ {
		status, _, _ := f.request(t, "POST", "/api/local/turns", input())
		if status != 502 {
			t.Fatal("expected cloud results failure")
		}
	}
	if f.controls.Load() != 1 || f.turns.Load() != 1 {
		t.Fatal("failed result submission caused repeated operation")
	}
}

func TestRefreshCredentialsStayOnBackendAndLogoutRevokesLocalSession(t *testing.T) {
	f := newFixture(t, fixtureOptions{shortToken: true})
	f.login(t)
	status, body, _ := f.request(t, "GET", "/api/local/cloud/capabilities", nil)
	if status != 200 || f.refreshes.Load() != 1 {
		t.Fatalf("refresh failed: %d %s", status, body)
	}
	status, body, _ = f.request(t, "GET", "/api/local/status", nil)
	if status != 200 || strings.Contains(body, "test-ha-secret") || strings.Contains(body, "test-cloud-access") {
		t.Fatal("status leaked credentials")
	}
	status, _, _ = f.request(t, "POST", "/api/local/auth/logout", map[string]any{})
	if status != 200 {
		t.Fatal("logout failed")
	}
	status, _, _ = f.request(t, "GET", "/api/local/status", nil)
	if status != 401 {
		t.Fatal("local session survived logout")
	}
}

func TestLocalAuthenticationOriginAndHostChecks(t *testing.T) {
	f := newFixture(t, fixtureOptions{})
	status, _, _ := f.request(t, "GET", "/api/local/ha/states", nil)
	if status != 401 {
		t.Fatal("HA readable without local authorization")
	}
	f.login(t)
	for _, variant := range []string{"foreign origin", "no origin", "DNS rebinding"} {
		req, _ := http.NewRequest("POST", f.local.URL+"/api/local/ha/check", strings.NewReader(`{}`))
		req.Header.Set("Content-Type", "application/json")
		if variant == "foreign origin" {
			req.Header.Set("Origin", "https://attacker.invalid")
		}
		if variant == "DNS rebinding" {
			req.Host = "attacker.invalid"
			req.Header.Set("Origin", "http://attacker.invalid")
		}
		resp, err := f.client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		_ = resp.Body.Close()
		if resp.StatusCode != 403 {
			t.Errorf("%s was not blocked", variant)
		}
	}
}

func TestConfigRejectsInsecureCloudAndExampleKey(t *testing.T) {
	for _, cfg := range []Config{
		{AccessKey: "short", CloudURL: "https://example.invalid"},
		{AccessKey: "replace-with-a-random-key-at-least-24-characters", CloudURL: "https://example.invalid"},
		{AccessKey: testKey, CloudURL: "http://cloud.example.invalid"},
		{AccessKey: testKey, CloudURL: "https://user:password@example.invalid"},
		{AccessKey: testKey, CloudURL: "https://example.invalid/api/v1"},
	} {
		if _, err := New(cfg); err == nil {
			t.Fatal("invalid config accepted")
		}
	}
}
