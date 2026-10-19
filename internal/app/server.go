package app

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"

	"noma.local/public/internal/cloud"
	"noma.local/public/internal/ha"
)

const cookieName = "noma_local_session"
const sessionLifetime = 8 * time.Hour

var idPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{16,80}$`)

type cachedTurn struct {
	digest   [32]byte
	response any
	status   int
}
type session struct {
	mu           sync.Mutex
	expires      time.Time
	account      *cloud.Account
	turns        map[string]cachedTurn
	userID       string
	haAuthorized bool
}
type Server struct {
	cfg      Config
	ha       *ha.Client
	cloud    *cloud.Client
	mu       sync.Mutex
	sessions map[string]*session
	pending  map[string]pendingOAuth
	web      http.Handler
}

func New(cfg Config) (*Server, error) {
	if cfg.WebURL == "" {
		cfg.WebURL = "http://127.0.0.1:3001"
	}
	if err := cfg.validate(); err != nil {
		return nil, err
	}
	haClient, err := ha.New(cfg.HAURL, cfg.HAToken, cfg.AllowedEntities)
	if err != nil {
		return nil, err
	}
	target, _ := url.Parse(cfg.WebURL)
	proxy := httputil.NewSingleHostReverseProxy(target)
	proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		fail(w, 502, "Noma 前端尚未启动，请启动 noma-web 服务")
	}
	return &Server{cfg: cfg, ha: haClient, cloud: cloud.New(cfg.CloudURL), web: proxy, sessions: map[string]*session{}, pending: map[string]pendingOAuth{}}, nil
}

func randomID() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
func fail(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}
func decode(w http.ResponseWriter, r *http.Request, target any) bool {
	if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		fail(w, 415, "请使用 application/json")
		return false
	}
	d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 32<<10))
	d.DisallowUnknownFields()
	if err := d.Decode(target); err != nil {
		fail(w, 400, "请求 JSON 格式或字段无效")
		return false
	}
	if d.Decode(new(any)) != io.EOF {
		fail(w, 400, "请求只能包含一个 JSON 对象")
		return false
	}
	return true
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("X-Frame-Options", "DENY")
	w.Header().Set("Referrer-Policy", "no-referrer")
	// Next.js uses inline hydration payloads and styles; preserve its original policy.
	// Explicit Host check prevents DNS rebinding to a loopback/LAN service.
	host := r.Host
	if h, _, err := net.SplitHostPort(host); err == nil {
		host = h
	}
	if net.ParseIP(host) == nil && host != "localhost" {
		fail(w, 403, "请使用 localhost 或服务器 IP 地址访问本地实例")
		return
	}
	if r.URL.Path == "/login/cloud-callback" {
		s.finishCloudLogin(w, r)
		return
	}
	if strings.HasPrefix(r.URL.Path, "/api/") {
		if r.Header.Get("Sec-Fetch-Site") == "cross-site" {
			fail(w, 403, "不接受跨站请求")
			return
		}
		if origin := r.Header.Get("Origin"); origin != "" {
			u, err := url.Parse(origin)
			scheme := "http"
			if s.cfg.SecureCookie || r.TLS != nil {
				scheme = "https"
			}
			if err != nil || u.Host != r.Host || u.Scheme != scheme {
				fail(w, 403, "请求来源与本地实例不一致")
				return
			}
		}
		if r.Method != "GET" && r.Header.Get("Origin") == "" {
			fail(w, 403, "写请求必须携带同源 Origin")
			return
		}
		s.api(w, r)
		return
	}
	if r.Method != "GET" && r.Method != "HEAD" {
		fail(w, 405, "method not allowed")
		return
	}
	if !publicWebPath(r.URL.Path) {
		sess := s.getSession(r)
		loggedIn := false
		if sess != nil {
			sess.mu.Lock()
			loggedIn = sess.account != nil
			sess.mu.Unlock()
		}
		if !loggedIn {
			http.Redirect(w, r, "/login?next="+url.QueryEscape(r.URL.RequestURI()), http.StatusSeeOther)
			return
		}
	}
	s.web.ServeHTTP(w, r)
}

func publicWebPath(path string) bool {
	switch strings.TrimSuffix(path, "/") {
	case "/login", "/login/", "/login/complete", "/privacy", "/terms", "/icon.svg", "/favicon.svg", "/noma-logo.svg", "/default-user-avatar.svg":
		return true
	}
	return strings.HasPrefix(path, "/_next/static/") || path == "/_next/image" || path == "/_next/webpack-hmr" || strings.HasPrefix(path, "/images/") || strings.HasPrefix(path, "/videos/")
}

func (s *Server) getSession(r *http.Request) *session {
	cookie, err := r.Cookie(cookieName)
	if err != nil {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	sess := s.sessions[cookie.Value]
	if sess != nil && time.Now().Before(sess.expires) {
		return sess
	}
	delete(s.sessions, cookie.Value)
	return nil
}

func (s *Server) authorizeHA(w http.ResponseWriter, r *http.Request) {
	sess := s.getSession(r)
	if sess == nil {
		fail(w, 401, "请先登录 Noma 云端账号")
		return
	}
	sess.mu.Lock()
	defer sess.mu.Unlock()
	if sess.account == nil {
		fail(w, 401, "请先登录 Noma 云端账号")
		return
	}
	var input struct{}
	if !decode(w, r, &input) {
		return
	}
	sess.haAuthorized = true
	writeJSON(w, 200, map[string]bool{"ok": true})
}

// Cloud login creates a browser session; device access is enabled separately by the signed-in browser.
func (s *Server) saveSession(w http.ResponseWriter, sess *session, sameSite http.SameSite) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	for key, sess := range s.sessions {
		if now.After(sess.expires) {
			delete(s.sessions, key)
		}
	}
	if len(s.sessions) >= 64 {
		fail(w, 429, "本地会话过多，请稍后重试")
		return false
	}
	id := randomID()
	sess.expires = now.Add(sessionLifetime)
	s.sessions[id] = sess
	http.SetCookie(w, &http.Cookie{Name: cookieName, Value: id, Path: "/", HttpOnly: true, Secure: s.cfg.SecureCookie,
		SameSite: sameSite, MaxAge: int(sessionLifetime.Seconds())})
	return true
}

func (s *Server) api(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path
	if path == "/api/local/health" && r.Method == "GET" {
		writeJSON(w, 200, map[string]string{"status": "ok", "service": "noma-local"})
		return
	}
	if path == "/api/local/auth/google" && r.Method == "GET" {
		s.beginCloudLogin(w, r)
		return
	}
	if path == "/api/local/ha/authorize" && r.Method == "POST" {
		s.authorizeHA(w, r)
		return
	}
	sess := s.getSession(r)
	if sess == nil && strings.HasPrefix(path, "/api/v1/auth/") {
		// Only successful cloud login persists this temporary session.
		sess = &session{turns: map[string]cachedTurn{}}
	}
	if sess == nil {
		fail(w, 401, "请先登录 Noma 云端账号")
		return
	}
	// Serialize one browser's login/turn/logout operations and protect replay state.
	sess.mu.Lock()
	defer sess.mu.Unlock()
	ctx, cancel := context.WithTimeout(r.Context(), 150*time.Second)
	defer cancel()
	if strings.HasPrefix(path, "/api/v1/") {
		s.frontendAPI(ctx, w, r, sess)
		return
	}
	if sess.account == nil {
		fail(w, 401, "请先登录 Noma 云端账号")
		return
	}
	if !sess.haAuthorized {
		if path == "/api/local/status" && r.Method == "GET" {
			writeJSON(w, 200, map[string]bool{"ha_authorized": false, "logged_in": sess.account != nil})
			return
		}
		fail(w, 403, "请在 Home Assistant 设置中授权本地设备访问")
		return
	}
	switch {
	case path == "/api/local/status" && r.Method == "GET":
		writeJSON(w, 200, map[string]any{"ha_authorized": true, "cloud_url": s.cfg.CloudURL, "logged_in": sess.account != nil,
			"ha_configured": s.ha.Configured(), "ha_url": s.cfg.HAURL, "allowed_entities": s.ha.Allowed(), "protocol_version": "1"})
	case path == "/api/local/auth/send-code" && r.Method == "POST":
		var req struct {
			Email string `json:"email"`
		}
		if !decode(w, r, &req) {
			return
		}
		if len(req.Email) > 254 || !strings.Contains(req.Email, "@") {
			fail(w, 400, "请输入有效邮箱")
			return
		}
		if err := s.cloud.SendOTP(ctx, req.Email); err != nil {
			fail(w, 502, err.Error())
			return
		}
		writeJSON(w, 200, map[string]bool{"ok": true})
	case path == "/api/local/auth/login" && r.Method == "POST":
		var req struct {
			Email string `json:"email"`
			Code  string `json:"code"`
		}
		if !decode(w, r, &req) {
			return
		}
		if len(req.Code) != 6 || len(req.Email) > 254 {
			fail(w, 400, "请输入邮箱及六位验证码")
			return
		}
		account, err := s.cloud.Login(ctx, req.Email, req.Code)
		if err != nil {
			fail(w, 502, err.Error())
			return
		}
		if sess.account != nil {
			s.cloud.Logout(ctx, sess.account)
		}
		sess.account = account
		sess.haAuthorized = false
		// Replay responses belong to the previous cloud identity, if any.
		sess.turns = map[string]cachedTurn{}
		writeJSON(w, 200, map[string]bool{"ok": true})
	case path == "/api/local/auth/logout" && r.Method == "POST":
		if sess.account != nil {
			s.cloud.Logout(ctx, sess.account)
			sess.account = nil
		}
		s.mu.Lock()
		if cookie, err := r.Cookie(cookieName); err == nil {
			delete(s.sessions, cookie.Value)
		}
		s.mu.Unlock()
		http.SetCookie(w, &http.Cookie{Name: cookieName, Value: "", Path: "/", MaxAge: -1, HttpOnly: true,
			Secure: s.cfg.SecureCookie, SameSite: http.SameSiteStrictMode})
		writeJSON(w, 200, map[string]bool{"ok": true})
	case path == "/api/local/ha/check" && r.Method == "POST":
		if err := s.ha.Check(ctx); err != nil {
			fail(w, 502, err.Error())
			return
		}
		writeJSON(w, 200, map[string]bool{"ok": true})
	case path == "/api/local/ha/states" && r.Method == "GET":
		states, err := s.ha.States(ctx)
		if err != nil {
			fail(w, 502, err.Error())
			return
		}
		writeJSON(w, 200, states)
	case path == "/api/local/cloud/capabilities" && r.Method == "GET":
		if sess.account == nil {
			fail(w, 401, "请先登录 Noma 云端账号")
			return
		}
		if err := s.capabilities(ctx, sess.account); err != nil {
			fail(w, 502, err.Error())
			return
		}
		writeJSON(w, 200, map[string]bool{"remote_tools": true})
	case path == "/api/local/turns" && r.Method == "POST":
		if sess.account == nil {
			fail(w, 401, "请先登录 Noma 云端账号")
			return
		}
		s.turn(ctx, w, r, sess)
	default:
		fail(w, 404, "接口不存在或请求方法不支持")
	}
}

func (s *Server) capabilities(ctx context.Context, account *cloud.Account) error {
	var caps struct {
		ProtocolVersion string `json:"protocol_version"`
		RemoteTools     bool   `json:"remote_tools"`
	}
	if err := s.cloud.Do(ctx, account, "GET", "/api/v1/local/capabilities", nil, &caps); err != nil {
		return err
	}
	if caps.ProtocolVersion != "1" || !caps.RemoteTools {
		return fmt.Errorf("云端尚未启用兼容的本地工具协议")
	}
	return nil
}
