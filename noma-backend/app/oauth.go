package app

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const oauthCookieName = "noma_local_oauth"
const oauthLifetime = 10 * time.Minute

// pendingOAuth keeps the PKCE verifier on the backend. The browser only carries the state cookie.
type pendingOAuth struct {
	verifier string
	next     string
	expires  time.Time
}

func (s *Server) beginCloudLogin(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	if len(query) > 1 || (len(query) == 1 && !query.Has("next")) {
		fail(w, 400, "登录跳转参数无效")
		return
	}
	state, verifier := randomID(), randomVerifier()
	if !s.savePending(state, verifier, safeNext(query.Get("next"))) {
		fail(w, 429, "登录请求过多，请稍后重试")
		return
	}
	authorize := url.Values{}
	authorize.Set("response_type", "code")
	authorize.Set("client_id", "noma-local")
	authorize.Set("redirect_uri", s.redirectURI(r))
	authorize.Set("state", state)
	authorize.Set("code_challenge", codeChallenge(verifier))
	authorize.Set("code_challenge_method", "S256")
	http.SetCookie(w, &http.Cookie{
		Name: oauthCookieName, Value: state, Path: "/login/cloud-callback", HttpOnly: true,
		Secure: s.cfg.SecureCookie, SameSite: http.SameSiteLaxMode, MaxAge: int(oauthLifetime.Seconds()),
	})
	http.Redirect(w, r, strings.TrimRight(s.cfg.CloudURL, "/")+"/local/authorize?"+authorize.Encode(), http.StatusFound)
}

func (s *Server) finishCloudLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		fail(w, 405, "method not allowed")
		return
	}
	state := r.URL.Query().Get("state")
	cookie, err := r.Cookie(oauthCookieName)
	if err != nil || !sameState(cookie.Value, state) {
		http.Redirect(w, r, "/login?error=state", http.StatusSeeOther)
		return
	}
	s.clearOAuthCookie(w)
	pending, ok := s.takePending(state)
	if !ok {
		http.Redirect(w, r, "/login?error=state", http.StatusSeeOther)
		return
	}
	if errCode := r.URL.Query().Get("error"); errCode != "" {
		kind := "cloud"
		if errCode == "access_denied" {
			kind = "denied"
		}
		http.Redirect(w, r, "/login?error="+kind+"&next="+url.QueryEscape(pending.next), http.StatusSeeOther)
		return
	}
	code := r.URL.Query().Get("code")
	if !validAuthCode(code) {
		http.Redirect(w, r, "/login?error=cloud&next="+url.QueryEscape(pending.next), http.StatusSeeOther)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	account, body, err := s.cloud.ExchangeLocalLogin(ctx, code, s.redirectURI(r), pending.verifier)
	if err != nil {
		http.Redirect(w, r, "/login?error=cloud&next="+url.QueryEscape(pending.next), http.StatusSeeOther)
		return
	}
	previous := s.getSession(r)
	if previous == nil {
		previous = &session{}
	}
	previous.mu.Lock()
	defer previous.mu.Unlock()
	if !s.replaceLogin(ctx, w, previous, account, accountUserID(body), http.SameSiteLaxMode) {
		return
	}
	// The cloud synchronization screen stays visible during this exchange. Enter the
	// protected destination directly instead of starting a second synchronization page.
	http.SetCookie(w, &http.Cookie{Name: "noma.newChatIntent", Value: "1", Path: "/", MaxAge: 86400,
		Secure: s.cfg.SecureCookie, SameSite: http.SameSiteLaxMode})
	http.SetCookie(w, &http.Cookie{Name: "noma.freshLogin", Value: "1", Path: "/", MaxAge: 600,
		Secure: s.cfg.SecureCookie, SameSite: http.SameSiteLaxMode})
	http.Redirect(w, r, pending.next, http.StatusSeeOther)
}

func (s *Server) redirectURI(r *http.Request) string {
	scheme := "http"
	if s.cfg.SecureCookie || r.TLS != nil {
		scheme = "https"
	}
	return scheme + "://" + r.Host + "/login/cloud-callback"
}

func (s *Server) clearOAuthCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name: oauthCookieName, Value: "", Path: "/login/cloud-callback", MaxAge: -1, HttpOnly: true,
		Secure: s.cfg.SecureCookie, SameSite: http.SameSiteLaxMode,
	})
}

func (s *Server) savePending(state, verifier, next string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	for key, item := range s.pending {
		if now.After(item.expires) {
			delete(s.pending, key)
		}
	}
	if len(s.pending) >= 64 {
		return false
	}
	s.pending[state] = pendingOAuth{verifier: verifier, next: next, expires: now.Add(oauthLifetime)}
	return true
}

func (s *Server) takePending(state string) (pendingOAuth, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	item, ok := s.pending[state]
	delete(s.pending, state)
	if !ok || time.Now().After(item.expires) {
		return pendingOAuth{}, false
	}
	return item, true
}

func accountUserID(body map[string]any) string {
	if id, _ := body["user_id"].(string); id != "" {
		return id
	}
	if user, ok := body["user"].(map[string]any); ok {
		id, _ := user["user_id"].(string)
		return id
	}
	return ""
}

func safeNext(value string) string {
	if value == "" {
		return "/agent"
	}
	if len(value) > 512 || !strings.HasPrefix(value, "/") || strings.HasPrefix(value, "//") || strings.Contains(value, "://") || strings.ContainsAny(value, "\\\r\n") {
		return "/agent"
	}
	parsed, err := url.Parse(value)
	if err != nil || parsed.IsAbs() || parsed.Host != "" || strings.HasPrefix(parsed.Path, "/api/") || parsed.Path == "/login/cloud-callback" {
		return "/agent"
	}
	return value
}

func randomVerifier() string {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(raw)
}

func sameState(cookie, state string) bool {
	if !validState(cookie) || !validState(state) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(cookie), []byte(state)) == 1
}

func validState(state string) bool {
	if len(state) != 64 {
		return false
	}
	for _, r := range state {
		if (r < '0' || r > '9') && (r < 'a' || r > 'f') {
			return false
		}
	}
	return true
}

func codeChallenge(verifier string) string {
	sum := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

func validAuthCode(code string) bool {
	if len(code) < 20 || len(code) > 128 {
		return false
	}
	for _, r := range code {
		if (r < 'a' || r > 'z') && (r < 'A' || r > 'Z') && (r < '0' || r > '9') && r != '_' && r != '-' {
			return false
		}
	}
	return true
}
