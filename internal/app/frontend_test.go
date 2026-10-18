package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func frontendLogin(t *testing.T, f *fixture) {
	t.Helper()
	status, body, _ := f.request(t, "POST", "/api/local/unlock", map[string]string{"key": testKey})
	if status != 200 {
		t.Fatalf("unlock: %d %s", status, body)
	}
	frontendCloudLogin(t, f)
}

func frontendCloudLogin(t *testing.T, f *fixture) {
	t.Helper()
	status, body, headers := f.request(t, "POST", "/api/v1/auth/otp/verify", map[string]string{"email": "test@example.invalid", "code": "123456"})
	if status != 200 || !strings.Contains(body, localAccessMarker) || !strings.Contains(body, "test-user") {
		t.Fatalf("frontend login: %d %s", status, body)
	}
	if strings.Contains(body, "test-cloud-access") || strings.Contains(strings.Join(headers.Values("Set-Cookie"), ";"), "test-refresh-token") {
		t.Fatal("cloud credentials reached frontend")
	}
}

func TestGuestChatNeedsNoHouseholdKeyOrAccountSession(t *testing.T) {
	f := newFixture(t, fixtureOptions{})
	for _, path := range []string{"/api/local/status", "/api/v1/guest/chat/quota"} {
		status, body, headers := f.request(t, "GET", path, nil)
		if status != 200 || strings.Contains(body, "light.allowed") || strings.Contains(body, "ha_url") || strings.Contains(strings.Join(headers.Values("Set-Cookie"), ";"), cookieName+"=") {
			t.Fatalf("public status/quota: %d %s", status, body)
		}
	}
	status, body, headers := f.request(t, "POST", "/api/v1/guest/chat", map[string]any{"content": "你好", "history": []any{}})
	if status != 200 || !strings.Contains(body, "你好") || !strings.Contains(body, `"type":"done"`) || !strings.Contains(headers.Get("Content-Type"), "text/event-stream") {
		t.Fatalf("guest chat: %d %s", status, body)
	}
	if f.haRequests.Load() != 0 {
		t.Fatal("guest browsing contacted HA")
	}
	for _, path := range []string{"/api/v1/home/devices", "/api/local/ha/states", "/api/v1/guest/not-allowed"} {
		status, _, _ := f.request(t, "GET", path, nil)
		if status != 401 && status != 404 {
			t.Fatalf("unexpected public access to %s: %d", path, status)
		}
	}
}

func TestCloudLoginDoesNotGrantHouseholdAccessAndUnlockPreservesAccount(t *testing.T) {
	f := newFixture(t, fixtureOptions{})
	frontendCloudLogin(t, f)
	for _, path := range []string{"/api/v1/me", "/api/v1/memory/overview", "/api/v1/auth/session"} {
		status, body, _ := f.request(t, "GET", path, nil)
		if status != 200 {
			t.Fatalf("cloud account without key: %s %d %s", path, status, body)
		}
	}
	for _, path := range []string{"/api/local/status", "/api/v1/home/status", "/api/v1/ha/connections", "/api/v1/settings"} {
		status, body, _ := f.request(t, "GET", path, nil)
		if status != 200 || strings.Contains(body, "light.allowed") || strings.Contains(body, "light.cloud_only") || strings.Contains(body, "ha_url") {
			t.Fatalf("household metadata leaked: %s %d %s", path, status, body)
		}
	}
	for _, req := range []struct {
		method, path string
		input        any
	}{
		{"GET", "/api/v1/home/devices", nil},
		{"GET", "/api/local/ha/states", nil},
		{"POST", "/api/v1/home/devices/light.allowed/control", map[string]string{"action": "turn_on"}},
		{"POST", "/api/local/turns", input()},
	} {
		status, body, _ := f.request(t, req.method, req.path, req.input)
		if status != 403 {
			t.Fatalf("household access without key: %s %d %s", req.path, status, body)
		}
	}
	if f.haRequests.Load() != 0 || f.turns.Load() != 0 {
		t.Fatal("locked browser contacted HA or ran a tool turn")
	}
	status, _, _ := f.request(t, "POST", "/api/local/unlock", map[string]string{"key": "wrong"})
	if status != 401 {
		t.Fatal("wrong household key accepted")
	}
	status, body, _ := f.request(t, "POST", "/api/local/unlock", map[string]string{"key": testKey})
	if status != 200 {
		t.Fatalf("unlock: %d %s", status, body)
	}
	status, body, _ = f.request(t, "GET", "/api/v1/me", nil)
	if status != 200 || !strings.Contains(body, "test-user") {
		t.Fatal("unlock lost cloud login")
	}
	status, body, _ = f.request(t, "POST", "/api/v1/home/devices/light.allowed/control", map[string]string{"action": "turn_on"})
	if status != 200 || f.controls.Load() != 1 {
		t.Fatalf("authorized control: %d %s", status, body)
	}
}

func TestSignedInPlainChatUsesDedicatedCloudRouteWithoutHAAccess(t *testing.T) {
	for _, unavailable := range []bool{false, true} {
		t.Run(map[bool]string{false: "plain chat SSE", true: "no legacy fallback"}[unavailable], func(t *testing.T) {
			f := newFixture(t, fixtureOptions{plainChatUnavailable: unavailable})
			frontendCloudLogin(t, f)
			status, body, headers := f.request(t, "POST", "/api/v1/chat/sessions/"+sessionID+"/messages?tools=true", map[string]any{"content": "你好", "request_id": requestID, "regenerate": true, "replace_assistant_id": "assistant-test"})
			if unavailable {
				if status != 503 || !strings.Contains(body, "游客聊天") {
					t.Fatalf("unavailable plain chat: %d %s", status, body)
				}
			} else if status != 200 || !strings.Contains(body, "你好") || !strings.Contains(body, `"type":"done"`) || !strings.Contains(headers.Get("Content-Type"), "text/event-stream") {
				t.Fatalf("plain chat SSE: %d %s", status, body)
			}
			if strings.Contains(strings.Join(headers.Values("Set-Cookie"), ";"), "test-refresh-token") {
				t.Fatal("cloud cookie leaked")
			}
			if f.haRequests.Load() != 0 || f.turns.Load() != 0 {
				t.Fatal("plain chat accessed HA or tool turns")
			}
		})
	}
}

func TestReusedFrontendLoginRefreshAndCloudReadRoutes(t *testing.T) {
	f := newFixture(t, fixtureOptions{shortToken: true})
	frontendLogin(t, f)
	status, body, _ := f.request(t, "POST", "/api/v1/auth/refresh", map[string]any{})
	if status != 200 || !strings.Contains(body, localAccessMarker) || f.refreshes.Load() != 1 {
		t.Fatalf("local refresh: %d %s", status, body)
	}
	for _, path := range []string{"/api/v1/me", "/api/v1/auth/session", "/api/v1/memory/overview?history=true"} {
		status, body, _ = f.request(t, "GET", path, nil)
		if status != 200 || strings.Contains(body, "test-cloud-access") {
			t.Fatalf("cloud read %s: %d %s", path, status, body)
		}
	}
	status, body, _ = f.request(t, "GET", "/api/v1/settings", nil)
	if status != 200 || strings.Contains(body, "light.cloud_only") || !strings.Contains(body, "light.allowed") {
		t.Fatalf("settings mixed cloud HA configuration: %d %s", status, body)
	}
	status, _, _ = f.request(t, "POST", "/api/v1/auth/logout", map[string]any{})
	if status != 200 {
		t.Fatal("account logout failed")
	}
	status, _, _ = f.request(t, "GET", "/api/v1/me", nil)
	if status != 401 {
		t.Fatal("account survived logout")
	}
	status, _, _ = f.request(t, "GET", "/api/local/status", nil)
	if status != 200 {
		t.Fatal("normal account logout unexpectedly locked the household instance")
	}
}

func TestReusedChatSSEUsesLocalToolLoopAndReplayCache(t *testing.T) {
	f := newFixture(t, fixtureOptions{})
	frontendLogin(t, f)
	for i := 0; i < 2; i++ {
		status, body, headers := f.request(t, "POST", "/api/v1/chat/sessions/"+sessionID+"/messages", map[string]any{"content": "打开测试灯", "request_id": requestID, "regenerate": false})
		if status != 200 || !strings.Contains(headers.Get("Content-Type"), "text/event-stream") || !strings.Contains(body, `"type":"token"`) || !strings.Contains(body, `"type":"done"`) {
			t.Fatalf("SSE adapter: %d %s", status, body)
		}
	}
	if f.controls.Load() != 1 || f.turns.Load() != 1 {
		t.Fatal("frontend chat bypassed replay protection")
	}
}

func TestReusedHomeRoutesOnlyAccessLocalHA(t *testing.T) {
	f := newFixture(t, fixtureOptions{})
	frontendLogin(t, f)
	for _, path := range []string{"/api/v1/ha/connections", "/api/v1/home/status", "/api/v1/home/devices?include_sensors=true"} {
		status, body, _ := f.request(t, "GET", path, nil)
		if status != 200 || strings.Contains(body, "test-ha-secret") {
			t.Fatalf("local route %s: %d %s", path, status, body)
		}
	}
	status, body, _ := f.request(t, "POST", "/api/v1/home/devices/light.allowed/control", map[string]any{"action": "turn_on"})
	if status != 200 || f.controls.Load() != 1 {
		t.Fatalf("local control: %d %s", status, body)
	}
	status, _, _ = f.request(t, "POST", "/api/v1/home/devices/light.private/control", map[string]any{"action": "turn_on"})
	if status != 400 || f.controls.Load() != 1 {
		t.Fatal("unauthorized frontend target reached HA")
	}
	status, _, _ = f.request(t, "PUT", "/api/v1/ha/connections/authorize", map[string]string{"token": "test-only-never-forward"})
	if status != 400 {
		t.Fatal("FRP authorization route was not blocked")
	}
}

func TestGatewayServesReusedNextFrontendWithoutInterceptingItsAssets(t *testing.T) {
	frontend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/agent" && r.URL.Path != "/_next/static/chunk.js" {
			t.Errorf("unexpected frontend path: %s", r.URL.Path)
		}
		_ = json.NewEncoder(w).Encode(map[string]string{"route": r.URL.Path})
	}))
	defer frontend.Close()
	server, err := New(Config{AccessKey: testKey, CloudURL: "http://127.0.0.1:9", WebURL: frontend.URL})
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"/agent", "/_next/static/chunk.js"} {
		r := httptest.NewRequest("GET", "http://127.0.0.1:3000"+path, nil)
		w := httptest.NewRecorder()
		server.ServeHTTP(w, r)
		if w.Code != 200 || !strings.Contains(w.Body.String(), path) {
			t.Fatalf("frontend proxy: %d %s", w.Code, w.Body.String())
		}
	}
}
