package app

import (
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"
)

func (f *fixture) noRedirectClient() *http.Client {
	return &http.Client{Jar: f.client.Jar, CheckRedirect: func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	}}
}

func (f *fixture) raw(t *testing.T, method, path string, header http.Header) *http.Response {
	t.Helper()
	req, err := http.NewRequest(method, f.local.URL+path, nil)
	if err != nil {
		t.Fatal(err)
	}
	for key, values := range header {
		req.Header[key] = values
	}
	resp, err := f.noRedirectClient().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { resp.Body.Close() })
	return resp
}

func TestCloudLoginExchangesAuthorizationCodeWithoutClerkToken(t *testing.T) {
	f := newFixture(t, fixtureOptions{})
	start := f.raw(t, "GET", "/api/local/auth/google?next=/memory/recent", nil)
	if start.StatusCode != http.StatusFound {
		t.Fatalf("start: %d", start.StatusCode)
	}
	location, err := url.Parse(start.Header.Get("Location"))
	if err != nil || location.Scheme+"://"+location.Host != f.cloudURL || location.Path != "/local/authorize" {
		t.Fatalf("authorize location: %s", start.Header.Get("Location"))
	}
	query := location.Query()
	redirectURI := f.local.URL + "/login/cloud-callback"
	if query.Get("response_type") != "code" || query.Get("client_id") != "noma-local" || query.Get("redirect_uri") != redirectURI || query.Get("code_challenge_method") != "S256" || query.Get("code_challenge") == "" || query.Get("state") == "" {
		t.Fatalf("authorize query: %s", location.RawQuery)
	}
	if strings.Contains(location.RawQuery, "next=") || strings.Contains(location.RawQuery, "token") {
		t.Fatal("authorize URL carried local navigation or a credential")
	}
	cookie := start.Cookies()
	if len(cookie) != 1 || cookie[0].Name != oauthCookieName || cookie[0].Value != query.Get("state") || !cookie[0].HttpOnly || cookie[0].SameSite != http.SameSiteLaxMode || cookie[0].Path != "/login/cloud-callback" {
		t.Fatalf("oauth cookie: %+v", cookie)
	}
	registered, err := http.Get(start.Header.Get("Location"))
	if err != nil || registered.StatusCode != http.StatusNoContent {
		t.Fatal("cloud did not observe the authorize request")
	}
	registered.Body.Close()

	code := "local-auth-code-000001"
	callback := f.raw(t, "GET", "/login/cloud-callback?code="+code+"&state="+query.Get("state"), http.Header{"Sec-Fetch-Site": {"cross-site"}})
	if callback.StatusCode != http.StatusSeeOther || callback.Header.Get("Location") != "/memory/recent" {
		body, _ := io.ReadAll(callback.Body)
		t.Fatalf("callback: %d %s %s", callback.StatusCode, callback.Header.Get("Location"), body)
	}
	joined := strings.Join(callback.Header.Values("Set-Cookie"), ";")
	if strings.Contains(joined, "test-cloud-access") || strings.Contains(joined, "test-refresh-token") || !strings.Contains(joined, cookieName+"=") {
		t.Fatal("cloud credentials reached the browser")
	}
	var sessionCookie, intentCookie, freshCookie *http.Cookie
	for _, c := range callback.Cookies() {
		if c.Name == cookieName {
			sessionCookie = c
		}
		if c.Name == "noma.freshLogin" {
			freshCookie = c
		}
		if c.Name == "noma.newChatIntent" {
			intentCookie = c
		}
	}
	// Lax sends the session on the top-level cross-site OAuth redirect chain.
	if sessionCookie == nil || !sessionCookie.HttpOnly || sessionCookie.SameSite != http.SameSiteLaxMode {
		t.Fatal("direct OAuth landing must carry the local HttpOnly session")
	}
	if intentCookie == nil || intentCookie.Value != "1" || intentCookie.HttpOnly {
		t.Fatal("direct OAuth landing did not preserve the fresh-chat intent")
	}
	if freshCookie == nil || freshCookie.Value != "1" || freshCookie.HttpOnly {
		t.Fatal("direct OAuth landing did not mark the one-time conversation reset")
	}
	if f.oauthUses.Load() != 1 {
		t.Fatalf("token exchange count: %d", f.oauthUses.Load())
	}
	status, body, _ := f.request(t, "GET", "/api/v1/me", nil)
	if status != 200 || !strings.Contains(body, "test-user") || !strings.Contains(body, "Google Test User") || !strings.Contains(body, "https://example.invalid/test-avatar.png") {
		t.Fatalf("session after cloud login: %d %s", status, body)
	}
	status, body, _ = f.request(t, "GET", "/api/v1/auth/session", nil)
	if status != 200 || !strings.Contains(body, "Google Test User") || !strings.Contains(body, "https://example.invalid/test-avatar.png") {
		t.Fatal("local session did not preserve cloud profile fields")
	}

	replay := f.raw(t, "GET", "/login/cloud-callback?code="+code+"&state="+query.Get("state"), http.Header{"Sec-Fetch-Site": {"cross-site"}})
	if replay.StatusCode != http.StatusSeeOther || !strings.Contains(replay.Header.Get("Location"), "error=state") || f.oauthUses.Load() != 1 {
		t.Fatal("authorization code was reusable")
	}
	restartGateway(t, f)
	status, body, _ = f.request(t, "POST", "/api/v1/auth/refresh", map[string]any{})
	if status != 200 || !strings.Contains(body, localAccessMarker) || f.oauthUses.Load() != 1 {
		t.Fatal("Google login did not survive gateway restart without another authorization code exchange")
	}
}

func TestCloudLoginRejectsCrossSiteStartMismatchedStateAndOpenRedirect(t *testing.T) {
	f := newFixture(t, fixtureOptions{})
	cross := f.raw(t, "GET", "/api/local/auth/google", http.Header{"Sec-Fetch-Site": {"cross-site"}})
	if cross.StatusCode != 403 || f.oauthUses.Load() != 0 {
		t.Fatal("cross-site login start was accepted")
	}
	start := f.raw(t, "GET", "/api/local/auth/google?next=https://evil.example/phish", nil)
	location, _ := url.Parse(start.Header.Get("Location"))
	state := location.Query().Get("state")
	registered, err := http.Get(start.Header.Get("Location"))
	if err != nil {
		t.Fatal(err)
	}
	registered.Body.Close()
	stolen := f.raw(t, "GET", "/login/cloud-callback?code=local-auth-code-000001&state=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", nil)
	if stolen.StatusCode != http.StatusSeeOther || !strings.Contains(stolen.Header.Get("Location"), "error=state") || f.oauthUses.Load() != 0 {
		t.Fatal("mismatched state reached the token endpoint")
	}
	callback := f.raw(t, "GET", "/login/cloud-callback?code=local-auth-code-000001&state="+state, nil)
	if callback.Header.Get("Location") != "/agent" {
		t.Fatalf("open redirect: %s", callback.Header.Get("Location"))
	}
	deniedFixture := newFixture(t, fixtureOptions{})
	deniedStart := deniedFixture.raw(t, "GET", "/api/local/auth/google?next=/agent", nil)
	deniedLocation, _ := url.Parse(deniedStart.Header.Get("Location"))
	denied := deniedFixture.raw(t, "GET", "/login/cloud-callback?error=access_denied&state="+deniedLocation.Query().Get("state"), nil)
	if denied.StatusCode != http.StatusSeeOther || !strings.Contains(denied.Header.Get("Location"), "error=denied") || deniedFixture.oauthUses.Load() != 0 {
		t.Fatalf("denied login exchanged a code: %s", denied.Header.Get("Location"))
	}
}
