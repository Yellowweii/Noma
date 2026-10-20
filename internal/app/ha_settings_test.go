package app

import (
	"encoding/json"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"noma.local/public/internal/ha"
)

func TestConnectedHomeNameAndTimestampSurviveRestart(t *testing.T) {
	f, s, _ := settingsFixture(t)
	frontendCloudLogin(t, f)
	status, body, _ := f.request(t, "POST", "/api/local/ha/name", map[string]string{"home_name": "新家"})
	if status != 403 {
		t.Fatal("home metadata was editable before connecting HA")
	}
	status, body, _ = f.request(t, "POST", "/api/local/ha/configure", map[string]string{"ha_token": "test-ha-secret"})
	if status != 200 || !strings.Contains(body, "last_connected_at") {
		t.Fatal("connected metadata missing")
	}
	connectedAt := s.cfg.HAConnectedAt
	if connectedAt.IsZero() || time.Since(connectedAt) > time.Minute {
		t.Fatal("last connection time was not saved")
	}
	status, body, _ = f.request(t, "POST", "/api/local/ha/name", map[string]string{"home_name": "  我们的家  "})
	if status != 200 || !strings.Contains(body, "我们的家") || strings.Contains(body, "test-ha-secret") {
		t.Fatal("home name save failed or exposed a credential")
	}
	cfg, err := LoadConfig(s.cfg.path)
	if err != nil || cfg.HomeName != "我们的家" || !cfg.HAConnectedAt.Equal(connectedAt) || cfg.HAToken != "test-ha-secret" {
		t.Fatal("home name save lost household settings")
	}
	restartGateway(t, f)
	for _, path := range []string{"/api/local/status", "/api/v1/ha/connections"} {
		status, body, _ = f.request(t, "GET", path, nil)
		if status != 200 || !strings.Contains(body, "我们的家") || !strings.Contains(body, "last_connected_at") {
			t.Fatal("connected summary did not survive restart")
		}
	}
	for _, input := range []any{nil, map[string]string{"home_name": " "}, map[string]string{"home_name": strings.Repeat("家", 81)}, map[string]string{"ha_token": "test-only-rejected"}} {
		status, _, _ = f.request(t, "POST", "/api/local/ha/name", input)
		if status < 400 {
			t.Fatal("invalid home metadata accepted")
		}
	}
}

func settingsFixture(t *testing.T) (*fixture, *Server, *atomic.Int32) {
	t.Helper()
	f := newFixture(t, fixtureOptions{})
	s := f.local.Config.Handler.(*Server)
	var discoveries atomic.Int32
	home := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test-ha-secret" {
			w.WriteHeader(401)
			return
		}
		switch r.URL.Path {
		case "/api/":
			writeJSON(w, 200, map[string]string{"message": "API running."})
		case "/api/states":
			reads := discoveries.Add(1)
			states := []map[string]any{{"entity_id": "light.allowed"}, {"entity_id": "sensor.room"}}
			if reads > 1 {
				states = append(states, map[string]any{"entity_id": "light.added_later"})
			}
			writeJSON(w, 200, states)
		case "/api/states/light.allowed", "/api/states/sensor.room", "/api/states/light.added_later":
			writeJSON(w, 200, map[string]any{"entity_id": strings.TrimPrefix(r.URL.Path, "/api/states/"), "state": "on", "attributes": map[string]string{"friendly_name": "Test device"}})
		case "/api/services/light/turn_on":
			f.controls.Add(1)
			writeJSON(w, 200, []any{})
		default:
			t.Errorf("unexpected HA setup request: %s", r.URL.Path)
			w.WriteHeader(404)
		}
	}))
	t.Cleanup(home.Close)
	s.cfg.HAURL, s.cfg.HAToken, s.cfg.AllowedEntities = home.URL, "", nil
	s.cfg.path = filepath.Join(t.TempDir(), "data", "local.json")
	s.ha, _ = ha.New(home.URL, "", nil)
	return f, s, &discoveries
}

func TestTokenOnlySetupPersistsAllEntitiesAndIncludesNewDevices(t *testing.T) {
	f, s, discoveries := settingsFixture(t)
	frontendCloudLogin(t, f)
	status, body, _ := f.request(t, "POST", "/api/local/ha/configure", map[string]any{"ha_token": "test-ha-secret"})
	if status != 200 || strings.Contains(body, "test-ha-secret") || !strings.Contains(body, `"allowed_entities":["*"]`) || !strings.Contains(body, `"ha_authorized":true`) {
		t.Fatalf("token-only setup: %d %s", status, body)
	}
	cfg, err := LoadConfig(s.cfg.path)
	if err != nil || cfg.HAToken != "test-ha-secret" || strings.Join(cfg.AllowedEntities, ",") != "*" {
		t.Fatal("saved config did not survive reload")
	}
	for _, path := range []string{"/api/local/status", "/api/v1/ha/connections", "/api/v1/home/devices"} {
		status, body, headers := f.request(t, "GET", path, nil)
		if status != 200 || strings.Contains(body, "test-ha-secret") || strings.Contains(strings.Join(headers.Values("Set-Cookie"), ";"), "test-ha-secret") {
			t.Fatalf("secret leaked or config not live: %s %d", path, status)
		}
	}
	status, body, _ = f.request(t, "GET", "/api/v1/home/devices", nil)
	if status != 200 || !strings.Contains(body, "light.added_later") {
		t.Fatal("new entity was not included automatically")
	}
	status, _, _ = f.request(t, "POST", "/api/v1/home/devices/light.added_later/control", map[string]string{"action": "turn_on"})
	if status != 200 || f.controls.Load() != 1 {
		t.Fatal("new entity was not controllable")
	}
	frontendCloudLogin(t, f)
	status, body, _ = f.request(t, "GET", "/api/local/status", nil)
	if status != 200 || strings.Contains(body, "sensor.room") || strings.Contains(body, "ha_url") {
		t.Fatal("new login inherited household permissions")
	}
	status, body, _ = f.request(t, "POST", "/api/local/ha/configure", map[string]any{})
	if status != 200 || discoveries.Load() != 2 || strings.Contains(body, "test-ha-secret") {
		t.Fatal("reconnect did not reuse token and all-entity access")
	}
}

func TestHASetupPreservesOldConfigOnFailureAndAllowsExplicitEmptyWhitelist(t *testing.T) {
	f, s, discoveries := settingsFixture(t)
	frontendCloudLogin(t, f)
	status, _, _ := f.request(t, "POST", "/api/local/ha/configure", map[string]any{"ha_token": "test-ha-secret", "allowed_entities": []string{"light.allowed"}})
	if status != 200 || discoveries.Load() != 0 {
		t.Fatal("explicit whitelist caused household discovery")
	}
	before, _ := os.ReadFile(s.cfg.path)
	for _, input := range []any{
		map[string]any{"ha_token": "wrong-test-token"},
		map[string]any{"ha_token": "bad\r\nheader"},
		map[string]any{"ha_url": "http://user:secret@localhost:8123"},
		map[string]any{"ha_url": "http://localhost:8123/api/template"},
		map[string]any{"allowed_entities": []string{"../private"}},
		map[string]any{"allowed_entities": []string{"*", "light.allowed"}},
		map[string]any{"cloud_url": "http://localhost"},
	} {
		status, body, _ := f.request(t, "POST", "/api/local/ha/configure", input)
		after, _ := os.ReadFile(s.cfg.path)
		if status < 400 || strings.Contains(body, "test-ha-secret") || string(before) != string(after) || s.cfg.HAToken != "test-ha-secret" {
			t.Fatal("invalid config replaced previous settings or exposed token")
		}
	}
	status, body, _ := f.request(t, "POST", "/api/local/ha/configure", map[string]any{"allowed_entities": []string{}})
	if status != 200 || len(s.ha.Allowed()) != 0 || !strings.Contains(body, `"allowed_entities":[]`) {
		t.Fatal("explicit empty whitelist was replaced with discovered devices")
	}
	// A persistence failure must leave the currently usable connection untouched.
	s.cfg.path = t.TempDir()
	status, _, _ = f.request(t, "POST", "/api/local/ha/configure", map[string]any{"allowed_entities": []string{"sensor.room"}})
	if status != 500 || len(s.ha.Allowed()) != 0 {
		t.Fatal("failed save changed active configuration")
	}
}

func TestAllEntitiesRemoteToolRoundTripStillDeduplicatesWrites(t *testing.T) {
	f := newFixture(t, fixtureOptions{duplicate: true})
	s := f.local.Config.Handler.(*Server)
	s.cfg.path = filepath.Join(t.TempDir(), "local.json")
	f.login(t)
	status, body, _ := f.request(t, "POST", "/api/local/ha/configure", map[string]any{})
	if status != 200 || !strings.Contains(body, `"allowed_entities":["*"]`) {
		t.Fatalf("default all-entity connection: %d %s", status, body)
	}
	for i := 0; i < 2; i++ {
		status, body, _ = f.request(t, "POST", "/api/local/turns", input())
		if status != 200 || !strings.Contains(body, "本轮完成") {
			t.Fatalf("all-entity tool round trip: %d %s", status, body)
		}
	}
	if f.controls.Load() != 1 || f.turns.Load() != 1 || f.results.Load() != 2 {
		t.Fatal("all-entity mode repeated a physical operation")
	}
}

func TestHADefaultsUseLocalhostAddress(t *testing.T) {
	t.Setenv("NOMA_HA_URL", "")
	f, _, _ := settingsFixture(t)
	frontendCloudLogin(t, f)
	status, body, _ := f.request(t, "GET", "/api/local/ha/defaults", nil)
	if status != 200 || !strings.Contains(body, "http://localhost:8123") {
		t.Fatalf("localhost default address: %d %s", status, body)
	}
}

func TestHASetupRequiresLoginSameOriginAndValidJSON(t *testing.T) {
	f, _, _ := settingsFixture(t)
	for _, path := range []string{"/api/local/ha/configure", "/api/local/ha/defaults"} {
		method := "POST"
		if strings.HasSuffix(path, "defaults") {
			method = "GET"
		}
		status, _, _ := f.request(t, method, path, map[string]any{})
		if status != 401 {
			t.Fatal("anonymous setup was allowed")
		}
	}
	frontendCloudLogin(t, f)
	for _, tc := range []struct {
		origin, body, query string
		want                int
	}{
		{"", `{}`, "", 403}, {"http://evil.invalid", `{}`, "", 403},
		{f.local.URL, `null`, "", 400}, {f.local.URL, `[]`, "", 400},
		{f.local.URL, `{} {}`, "", 400}, {f.local.URL, `{}`, "?ha_token=not-accepted", 400},
	} {
		req, _ := http.NewRequest("POST", f.local.URL+"/api/local/ha/configure"+tc.query, strings.NewReader(tc.body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Origin", tc.origin)
		resp, err := f.client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != tc.want {
			t.Fatalf("invalid setup accepted: %d", resp.StatusCode)
		}
	}
}

func TestHAConfigChangeRequiresOtherBrowsersToAuthorizeAgain(t *testing.T) {
	f, _, _ := settingsFixture(t)
	frontendCloudLogin(t, f)
	status, _, _ := f.request(t, "POST", "/api/local/ha/configure", map[string]any{"ha_token": "test-ha-secret"})
	if status != 200 {
		t.Fatal("initial setup failed")
	}
	firstClient := f.client
	jar, _ := cookiejar.New(nil)
	f.client = &http.Client{Jar: jar}
	frontendLogin(t, f)
	secondClient := f.client
	f.client = firstClient
	status, _, _ = f.request(t, "POST", "/api/local/ha/configure", map[string]any{"allowed_entities": []string{"light.allowed"}})
	if status != 200 {
		t.Fatal("whitelist update failed")
	}
	f.client = secondClient
	status, body, _ := f.request(t, "GET", "/api/local/status", nil)
	if status != 200 || !strings.Contains(body, `"ha_authorized":false`) {
		t.Fatal("other browser inherited revised permissions")
	}
}

func TestHAConfigSavePreservesDeploymentOverrides(t *testing.T) {
	path := filepath.Join(t.TempDir(), "local.json")
	os.WriteFile(path, []byte(`{"listen":"127.0.0.1:3200","secure_cookie":true}`), 0600)
	if err := saveHAConfig(path, "http://localhost:8123", "test-ha-secret", []string{}); err != nil {
		t.Fatal(err)
	}
	data, _ := os.ReadFile(path)
	var fields map[string]any
	json.Unmarshal(data, &fields)
	if fields["listen"] != "127.0.0.1:3200" || fields["secure_cookie"] != true {
		t.Fatal("deployment overrides lost")
	}
	if entries, _ := os.ReadDir(filepath.Dir(path)); len(entries) != 1 {
		t.Fatal("temporary credential file left behind")
	}
}
