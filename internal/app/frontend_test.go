package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"noma.local/public/internal/cloud"
)

func frontendLogin(t *testing.T, f *fixture) {
	t.Helper()
	frontendCloudLogin(t, f)
	status, body, _ := f.request(t, "POST", "/api/local/ha/authorize", map[string]any{})
	if status != 200 {
		t.Fatalf("enable: %d %s", status, body)
	}
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

func TestAnonymousAPIsCannotBypassCloudLogin(t *testing.T) {
	f := newFixture(t, fixtureOptions{})
	status, body, _ := f.request(t, "POST", "/api/local/ha/authorize", map[string]any{})
	if status != 401 {
		t.Fatalf("device enablement replaced account login: %d %s", status, body)
	}
	for _, loggedIn := range []bool{false, true} {
		if loggedIn {
			frontendCloudLogin(t, f)
		}
		for _, req := range []struct{ method, path string }{
			{"GET", "/api/v1/guest/chat/quota"}, {"POST", "/api/v1/guest/chat"},
			{"GET", "/api/v1/guest/stt/status"}, {"GET", "/api/v1/guest/stt/stream"}, {"POST", "/api/v1/guest/tts"},
			{"POST", "/api/v1/chat/import"},
		} {
			status, body, _ := f.request(t, req.method, req.path, map[string]any{})
			want := 401
			if loggedIn {
				want = 404
			}
			if status != want {
				t.Fatalf("disabled guest route %s: %d %s", req.path, status, body)
			}
		}
	}
	if f.haRequests.Load() != 0 {
		t.Fatal("disabled guest routes contacted HA")
	}
}

func TestCloudLoginDoesNotGrantHouseholdAccessAndEnablingPreservesAccount(t *testing.T) {
	f := newFixture(t, fixtureOptions{})
	frontendCloudLogin(t, f)
	status, _, _ := f.request(t, "POST", "/api/local/ha/authorize", map[string]string{"token": "test-only-not-accepted"})
	if status != 400 {
		t.Fatal("device enablement accepted arbitrary configuration fields")
	}
	status, _, _ = f.request(t, "POST", "/api/local/unlock", map[string]any{})
	if status != 403 {
		t.Fatal("removed unlock route unexpectedly enabled device access")
	}
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
	status, body, _ := f.request(t, "POST", "/api/local/ha/authorize", map[string]any{})
	if status != 200 {
		t.Fatalf("enable: %d %s", status, body)
	}
	status, body, _ = f.request(t, "GET", "/api/v1/me", nil)
	if status != 200 || !strings.Contains(body, "test-user") {
		t.Fatal("unlock lost cloud login")
	}
	status, body, _ = f.request(t, "POST", "/api/v1/home/devices/light.allowed/control", map[string]string{"action": "turn_on"})
	if status != 200 || f.controls.Load() != 1 {
		t.Fatalf("authorized control: %d %s", status, body)
	}
	frontendCloudLogin(t, f)
	status, _, _ = f.request(t, "POST", "/api/v1/home/devices/light.allowed/control", map[string]string{"action": "turn_on"})
	if status != 403 || f.controls.Load() != 1 {
		t.Fatal("signing in again inherited previous HA authorization")
	}
}

func TestSignedInPlainChatUsesDedicatedCloudRouteWithoutHAAccess(t *testing.T) {
	for _, unavailable := range []bool{false, true} {
		t.Run(map[bool]string{false: "plain chat SSE", true: "no legacy fallback"}[unavailable], func(t *testing.T) {
			f := newFixture(t, fixtureOptions{plainChatUnavailable: unavailable})
			frontendCloudLogin(t, f)
			status, body, headers := f.request(t, "POST", "/api/v1/chat/sessions/"+sessionID+"/messages?tools=true", map[string]any{"content": "你好", "request_id": requestID, "regenerate": true, "replace_assistant_id": "assistant-test"})
			if unavailable {
				if status != 503 || !strings.Contains(body, "云端对接") {
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
	if status != 401 {
		t.Fatal("household access survived account logout")
	}
	frontendCloudLogin(t, f)
	status, body, _ = f.request(t, "GET", "/api/local/status", nil)
	if status != 200 || !strings.Contains(body, `"ha_authorized":false`) {
		t.Fatal("new login inherited the previous account's HA authorization")
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
		if r.URL.Path != "/agent" && r.URL.Path != "/_next/static/chunk.js" && r.URL.Path != "/login" && r.URL.Path != "/privacy" && r.URL.Path != "/terms" {
			t.Errorf("unexpected frontend path: %s", r.URL.Path)
		}
		_ = json.NewEncoder(w).Encode(map[string]string{"route": r.URL.Path})
	}))
	defer frontend.Close()
	server, err := New(Config{CloudURL: "http://127.0.0.1:9", WebURL: frontend.URL})
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"/_next/static/chunk.js", "/login", "/privacy", "/terms"} {
		r := httptest.NewRequest("GET", "http://127.0.0.1:3000"+path, nil)
		w := httptest.NewRecorder()
		server.ServeHTTP(w, r)
		if w.Code != 200 || !strings.Contains(w.Body.String(), path) {
			t.Fatalf("frontend proxy: %d %s", w.Code, w.Body.String())
		}
	}
	for _, path := range []string{"/", "/agent", "/home", "/memory/profile", "/settings/ha?from=home"} {
		r := httptest.NewRequest("GET", "http://127.0.0.1:3000"+path, nil)
		r.AddCookie(&http.Cookie{Name: cookieName, Value: "forged-cookie"})
		r.Header.Set("RSC", "1")
		w := httptest.NewRecorder()
		server.ServeHTTP(w, r)
		if w.Code != 303 || !strings.HasPrefix(w.Header().Get("Location"), "/login?next=") {
			t.Fatalf("page bypassed login: %s %d", path, w.Code)
		}
		location, _ := url.Parse(w.Header().Get("Location"))
		if location.Query().Get("next") != path {
			t.Fatal("login redirect lost original path")
		}
	}
	server.sessions["test-browser"] = &session{account: &cloud.Account{}, expires: time.Now().Add(time.Hour)}
	r := httptest.NewRequest("GET", "http://127.0.0.1:3000/agent", nil)
	r.AddCookie(&http.Cookie{Name: cookieName, Value: "test-browser"})
	w := httptest.NewRecorder()
	server.ServeHTTP(w, r)
	if w.Code != 200 {
		t.Fatalf("signed-in page: %d %s", w.Code, w.Body.String())
	}
	server.sessions["test-browser"].expires = time.Now().Add(-time.Second)
	w = httptest.NewRecorder()
	server.ServeHTTP(w, r)
	if w.Code != 303 {
		t.Fatal("expired session bypassed page login")
	}
}
