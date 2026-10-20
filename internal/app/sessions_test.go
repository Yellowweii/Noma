package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"noma.local/public/internal/cloud"
)

func browserSession(t *testing.T, f *fixture) (*Server, *session, *http.Cookie) {
	t.Helper()
	base, _ := url.Parse(f.local.URL)
	for _, cookie := range f.client.Jar.Cookies(base) {
		if cookie.Name == cookieName {
			s := f.local.Config.Handler.(*Server)
			return s, s.sessions[sessionKey(cookie.Value)], cookie
		}
	}
	t.Fatal("browser session cookie missing")
	return nil, nil, nil
}

func restartGateway(t *testing.T, f *fixture) *Server {
	t.Helper()
	cfg := f.local.Config.Handler.(*Server).cfg
	f.local.Close()
	s, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	f.local = httptest.NewServer(s)
	t.Cleanup(f.local.Close)
	return s
}

func TestLoginAndDeviceGrantSurviveGatewayRestartWithBackendOnlyCredentials(t *testing.T) {
	f := newFixture(t, fixtureOptions{})
	frontendLogin(t, f)
	s, sess, cookie := browserSession(t, f)
	data, err := os.ReadFile(s.sessionPath(sess.key))
	if err != nil || !strings.Contains(string(data), "test-refresh-token") {
		t.Fatal("renewable credential was not saved")
	}
	for _, excluded := range []string{cookie.Value, "test-ha-secret", "Google Test User", "test@example.invalid", "ha_authorized", "turns"} {
		if strings.Contains(string(data), excluded) {
			t.Fatalf("unnecessary field persisted: %s", excluded)
		}
	}
	if !strings.Contains(string(data), "test-cloud-access") || !strings.Contains(string(data), "access_expires_at") {
		t.Fatal("valid access credential and expiry were not checkpointed")
	}
	if runtime.GOOS != "windows" {
		info, err := os.Stat(s.sessionPath(sess.key))
		if err != nil || info.Mode().Perm() != 0600 {
			t.Fatal("session credential file must be private")
		}
	}
	restartGateway(t, f)
	status, body, _ := f.request(t, "POST", "/api/v1/auth/refresh", map[string]any{})
	if status != 200 || !strings.Contains(body, localAccessMarker) || f.refreshes.Load() != 0 || strings.Contains(body, "test-refresh-token") {
		t.Fatalf("session recovery after restart: %d", status)
	}
	status, body, _ = f.request(t, "GET", "/api/v1/auth/session", nil)
	if status != 200 || !strings.Contains(body, "Google Test User") {
		t.Fatal("restored session did not load its cloud account")
	}
	status, body, _ = f.request(t, "GET", "/api/local/status", nil)
	if status != 200 || !strings.Contains(body, `"ha_authorized":true`) {
		t.Fatal("restart lost the device grant for unchanged HA configuration")
	}
}

func expireCloudAccess(t *testing.T, f *fixture) {
	t.Helper()
	s, sess, _ := browserSession(t, f)
	sess.mu.Lock()
	defer sess.mu.Unlock()
	sess.account.ExpiresAt = time.Now().Add(-time.Minute)
	if err := s.bindSessionPersistence(sess); err != nil {
		t.Fatal(err)
	}
}

func TestActiveSessionRenewsCookieAndDurableExpiryAtMostDaily(t *testing.T) {
	f := newFixture(t, fixtureOptions{})
	frontendCloudLogin(t, f)
	s, sess, originalCookie := browserSession(t, f)
	sess.mu.Lock()
	sess.expires = time.Now().Add(time.Hour)
	if err := s.bindSessionPersistence(sess); err != nil {
		t.Fatal(err)
	}
	sess.mu.Unlock()
	status, _, headers := f.request(t, "GET", "/api/v1/me", nil)
	if status != 200 || time.Until(sess.expires) < 29*24*time.Hour {
		t.Fatal("active login did not renew")
	}
	cookies := (&http.Response{Header: headers}).Cookies()
	if len(cookies) != 1 || cookies[0].Name != cookieName || cookies[0].Value != originalCookie.Value || cookies[0].MaxAge != int(sessionLifetime.Seconds()) || !cookies[0].HttpOnly {
		t.Fatal("browser cookie was not renewed with the server session")
	}
	status, _, headers = f.request(t, "POST", "/api/v1/auth/refresh", map[string]any{})
	if status != 200 || len(headers.Values("Set-Cookie")) != 0 {
		t.Fatal("fresh session should not rewrite its cookie on every request")
	}
	restored := restartGateway(t, f).sessions[sess.key]
	if restored == nil || !restored.expires.Equal(sess.expires) {
		t.Fatal("renewed expiry was not durable")
	}
}

func TestLogoutRevokesPersistedSessionAndOldCookieAfterRestart(t *testing.T) {
	for _, path := range []string{"/api/v1/auth/logout", "/api/local/auth/logout"} {
		t.Run(path, func(t *testing.T) {
			f := newFixture(t, fixtureOptions{})
			frontendLogin(t, f)
			s, sess, oldCookie := browserSession(t, f)
			status, _, headers := f.request(t, "POST", path, map[string]any{})
			if status != 200 || !strings.Contains(headers.Get("Set-Cookie"), "Max-Age=0") {
				t.Fatal("logout did not clear the browser cookie")
			}
			if _, err := os.Stat(s.sessionPath(sess.key)); !os.IsNotExist(err) {
				t.Fatal("logout did not delete its persisted credential")
			}
			restartGateway(t, f)
			base, _ := url.Parse(f.local.URL)
			f.client.Jar.SetCookies(base, []*http.Cookie{oldCookie})
			status, _, _ = f.request(t, "POST", "/api/v1/auth/refresh", map[string]any{})
			if status != 401 {
				t.Fatal("old cookie recovered a logged-out session")
			}
		})
	}
}

func TestAnotherLoginRotatesCookieAndRevokesPreviousDeviceGrant(t *testing.T) {
	f := newFixture(t, fixtureOptions{})
	frontendLogin(t, f)
	s, previous, oldCookie := browserSession(t, f)
	frontendCloudLogin(t, f)
	_, current, currentCookie := browserSession(t, f)
	if currentCookie.Value == oldCookie.Value || current.haAuthorized || previous.account != nil {
		t.Fatal("another login reused the previous identity or device grant")
	}
	if _, err := os.Stat(s.sessionPath(previous.key)); !os.IsNotExist(err) {
		t.Fatal("previous login remained durable")
	}
	restartGateway(t, f)
	base, _ := url.Parse(f.local.URL)
	f.client.Jar.SetCookies(base, []*http.Cookie{oldCookie})
	status, _, _ := f.request(t, "POST", "/api/v1/auth/refresh", map[string]any{})
	if status != 401 {
		t.Fatal("rotated cookie restored the old login")
	}
	f.client.Jar.SetCookies(base, []*http.Cookie{currentCookie})
	status, _, _ = f.request(t, "POST", "/api/v1/auth/refresh", map[string]any{})
	if status != 200 {
		t.Fatal("replacement login did not survive restart")
	}
}

func TestExpiredOrDifferentCloudSessionIsNotRestored(t *testing.T) {
	for _, changedCloud := range []bool{false, true} {
		f := newFixture(t, fixtureOptions{})
		frontendCloudLogin(t, f)
		s, sess, _ := browserSession(t, f)
		data, _ := os.ReadFile(s.sessionPath(sess.key))
		var saved storedSession
		if err := json.Unmarshal(data, &saved); err != nil {
			t.Fatal(err)
		}
		if changedCloud {
			saved.CloudURL = "https://another-cloud.example.invalid"
		} else {
			saved.Expires = time.Now().Add(-time.Second)
		}
		data, _ = json.Marshal(saved)
		if err := writeSessionFile(s.sessionPath(sess.key), data); err != nil {
			t.Fatal(err)
		}
		restored := restartGateway(t, f)
		if len(restored.sessions) != 0 {
			t.Fatal("expired or foreign-cloud credential restored")
		}
		if _, err := os.Stat(s.sessionPath(sess.key)); !os.IsNotExist(err) {
			t.Fatal("invalid session was not removed")
		}
	}
}

func TestRotatedRefreshCredentialIsCheckpointedBeforeNextRestart(t *testing.T) {
	f := newFixture(t, fixtureOptions{})
	frontendCloudLogin(t, f)
	s, sess, _ := browserSession(t, f)
	var refreshed atomic.Int32
	var refreshStatus atomic.Int32
	rotating := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/auth/refresh" {
			t.Error("unexpected rotating cloud route")
			w.WriteHeader(404)
			return
		}
		if status := refreshStatus.Load(); status != 0 {
			w.WriteHeader(int(status))
			return
		}
		cookie, err := r.Cookie("noma_refresh_token")
		expected := "test-refresh-token"
		if refreshed.Load() > 0 {
			expected = "rotated-test-refresh"
		}
		if err != nil || cookie.Value != expected {
			t.Error("stale refresh credential replayed")
			w.WriteHeader(401)
			return
		}
		refreshed.Add(1)
		http.SetCookie(w, &http.Cookie{Name: "noma_refresh_token", Value: "rotated-test-refresh", HttpOnly: true})
		writeJSON(w, 200, map[string]any{"access_token": "rotated-test-access", "expires_in": 3600})
	}))
	t.Cleanup(rotating.Close)
	s.cfg.CloudURL = rotating.URL
	s.cloud = cloud.New(rotating.URL)
	if err := s.bindSessionPersistence(sess); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		expireCloudAccess(t, f)
		restartGateway(t, f)
		status, body, headers := f.request(t, "POST", "/api/v1/auth/refresh", map[string]any{})
		if status != 200 || strings.Contains(body, "rotated-test") || strings.Contains(headers.Get("Set-Cookie"), "rotated-test") {
			t.Fatal("rotation failed or exposed backend credentials")
		}
	}
	if refreshed.Load() != 2 {
		t.Fatal("restored sessions did not refresh")
	}
	// Temporary cloud failure preserves the credential; a definitive rejection
	// revokes it so it cannot be resurrected on another restart.
	refreshStatus.Store(503)
	expireCloudAccess(t, f)
	restartGateway(t, f)
	status, _, _ := f.request(t, "POST", "/api/v1/auth/refresh", map[string]any{})
	if status != 503 {
		t.Fatal("cloud outage was misclassified as a login rejection")
	}
	s, sess, _ = browserSession(t, f)
	if _, err := os.Stat(s.sessionPath(sess.key)); err != nil {
		t.Fatal("temporary cloud outage removed the session")
	}
	refreshStatus.Store(401)
	status, _, _ = f.request(t, "POST", "/api/v1/auth/refresh", map[string]any{})
	if status != 401 || len(s.sessions) != 0 {
		t.Fatal("revoked cloud login remained active locally")
	}
	if _, err := os.Stat(s.sessionPath(sess.key)); !os.IsNotExist(err) {
		t.Fatal("revoked refresh credential remained on disk")
	}
}

func TestLoginDoesNotSucceedWhenCredentialStorageFails(t *testing.T) {
	f := newFixture(t, fixtureOptions{})
	s := f.local.Config.Handler.(*Server)
	if err := os.WriteFile(s.sessionDirectory(), []byte("blocked"), 0600); err != nil {
		t.Fatal(err)
	}
	status, body, headers := f.request(t, "POST", "/api/v1/auth/otp/verify", map[string]string{"email": "test@example.invalid", "code": "123456"})
	if status != 500 || strings.Contains(body, "test-refresh-token") || len(headers.Values("Set-Cookie")) != 0 || len(s.sessions) != 0 {
		t.Fatal("failed durable login produced an authenticated browser")
	}
}

func TestCorruptStoredSessionFailsClosedWithoutCredentialInError(t *testing.T) {
	f := newFixture(t, fixtureOptions{})
	s := f.local.Config.Handler.(*Server)
	path := filepath.Join(s.sessionDirectory(), sessionKey("invalid-cookie")+".json")
	if err := writeSessionFile(path, []byte(`{"refresh_token":"test-only-secret",`)); err != nil {
		t.Fatal(err)
	}
	if _, err := New(s.cfg); err == nil || strings.Contains(err.Error(), "test-only-secret") {
		t.Fatal("corrupt session did not fail closed")
	}
}

func TestEmptyStoredRefreshCredentialDoesNotPreventGatewayStartup(t *testing.T) {
	f := newFixture(t, fixtureOptions{})
	s := f.local.Config.Handler.(*Server)
	saved := storedSession{CloudURL: s.cfg.CloudURL, Expires: time.Now().Add(time.Hour), UserID: "test-user"}
	data, _ := json.Marshal(saved)
	path := s.sessionPath(sessionKey("empty-test-refresh"))
	if err := writeSessionFile(path, data); err != nil {
		t.Fatal(err)
	}
	restored, err := New(s.cfg)
	if err != nil || len(restored.sessions) != 0 {
		t.Fatal("an empty credential stopped the gateway or restored a login")
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatal("unusable record should remain untouched")
	}
}
