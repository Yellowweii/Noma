package app

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"noma.local/public/noma-backend/cloud"
)

const sessionLifetime = 30 * 24 * time.Hour
const sessionRenewInterval = 24 * time.Hour
const maxSessionBytes = 64 << 10

// Backend credentials and a configuration-bound grant survive restarts. The
// replay ledger stores request digests, never messages, profiles or tool results.
type storedSession struct {
	CloudURL        string              `json:"cloud_url"`
	Expires         time.Time           `json:"expires"`
	UserID          string              `json:"user_id"`
	RefreshToken    string              `json:"refresh_token"`
	AccessToken     string              `json:"access_token,omitempty"`
	AccessExpiresAt time.Time           `json:"access_expires_at,omitzero"`
	HAGrant         string              `json:"ha_grant,omitempty"`
	Requests        map[string][32]byte `json:"requests,omitempty"`
}

func sessionKey(id string) string {
	hash := sha256.Sum256([]byte(id))
	return hex.EncodeToString(hash[:])
}

func (s *Server) sessionDirectory() string {
	return filepath.Join(filepath.Dir(s.cfg.path), "sessions")
}

func (s *Server) sessionPath(key string) string {
	return filepath.Join(s.sessionDirectory(), key+".json")
}

func (s *Server) loadSessions() error {
	entries, err := os.ReadDir(s.sessionDirectory())
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("无法读取本地登录状态，请检查后端数据目录权限")
	}
	for _, entry := range entries {
		key := strings.TrimSuffix(entry.Name(), ".json")
		decoded, err := hex.DecodeString(key)
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") || err != nil || len(decoded) != 32 {
			continue
		}
		info, err := entry.Info()
		if err != nil || !info.Mode().IsRegular() || info.Size() > maxSessionBytes {
			return fmt.Errorf("本地登录状态文件无效")
		}
		data, err := os.ReadFile(s.sessionPath(key))
		var saved storedSession
		if err != nil || json.Unmarshal(data, &saved) != nil {
			return fmt.Errorf("无法读取本地登录状态")
		}
		if saved.CloudURL != s.cfg.CloudURL || !time.Now().Before(saved.Expires) {
			if err := os.Remove(s.sessionPath(key)); err != nil {
				return fmt.Errorf("无法清理过期的本地登录状态")
			}
			continue
		}
		if saved.RefreshToken == "" || len(saved.RefreshToken) > 8192 || strings.ContainsAny(saved.RefreshToken, "\r\n") {
			// An unusable credential invalidates only its browser session, not
			// the whole local gateway. Leave the file untouched for diagnosis.
			continue
		}
		if len(s.sessions) >= 64 {
			return fmt.Errorf("本地会话数量超出限制")
		}
		if len(saved.AccessToken) > 16<<10 || len(saved.Requests) > 128 {
			continue
		}
		validRequests := true
		for id := range saved.Requests {
			if !idPattern.MatchString(id) {
				validRequests = false
				break
			}
		}
		if !validRequests {
			continue
		}
		sess := &session{key: key, expires: saved.Expires, userID: saved.UserID,
			account: &cloud.Account{AccessToken: saved.AccessToken, ExpiresAt: saved.AccessExpiresAt, RefreshToken: saved.RefreshToken}, turns: map[string]cachedTurn{}, requests: saved.Requests}
		if saved.HAGrant != "" && saved.HAGrant == s.haGrantFingerprint() && s.ha.Configured() {
			sess.haAuthorized, sess.haGrant, sess.haRevision = true, saved.HAGrant, s.haRevision
		}
		if err := s.bindSessionPersistence(sess); err != nil {
			return err
		}
		s.sessions[key] = sess
	}
	return nil
}

// The caller holds sess.mu (or has not published this session yet). Cloud
// requests for one session are serialized by that same lock.
func (s *Server) bindSessionPersistence(sess *session) error {
	return sess.account.PersistCredentials(func(credentials cloud.Credentials) error {
		data, err := json.Marshal(storedSession{CloudURL: s.cfg.CloudURL, Expires: sess.expires,
			UserID: sess.userID, RefreshToken: credentials.RefreshToken, AccessToken: credentials.AccessToken, AccessExpiresAt: credentials.ExpiresAt,
			HAGrant: sess.haGrant, Requests: sess.requests})
		if err != nil || len(data) > maxSessionBytes {
			return fmt.Errorf("无法保存本地登录状态")
		}
		if err := writeSessionFile(s.sessionPath(sess.key), data); err != nil {
			return fmt.Errorf("无法保存本地登录状态，请检查后端数据目录权限")
		}
		return nil
	})
}

// Bind a browser's grant to this exact local HA origin, credential and entity
// scope, without writing the HA credential into the browser session file.
// The caller holds haMu, or the server has not been published yet.
func (s *Server) haGrantFingerprint() string {
	data, _ := json.Marshal([]any{s.cfg.HAURL, s.cfg.HAToken, s.ha.Allowed()})
	digest := sha256.Sum256(data)
	return hex.EncodeToString(digest[:])
}

func writeSessionFile(path string, data []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(path), ".session-*.tmp")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if _, err = f.Write(data); err != nil {
		f.Close()
		return err
	}
	if err = f.Sync(); err != nil {
		f.Close()
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}
	return os.Rename(f.Name(), path)
}

func (s *Server) deleteSession(sess *session) error {
	if sess.key == "" {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := os.Remove(s.sessionPath(sess.key)); err != nil && !os.IsNotExist(err) {
		return err
	}
	delete(s.sessions, sess.key)
	return nil
}

func (s *Server) pruneSessions() {
	s.mu.Lock()
	sessions := make([]*session, 0, len(s.sessions))
	for _, sess := range s.sessions {
		sessions = append(sessions, sess)
	}
	s.mu.Unlock()
	for _, sess := range sessions {
		// A concurrent request may still be using its session. It can be
		// cleaned up on the next login without blocking other browsers.
		if sess.mu.TryLock() {
			if time.Now().After(sess.expires) {
				_ = s.deleteSession(sess)
			}
			sess.mu.Unlock()
		}
	}
}

func (s *Server) setSessionCookie(w http.ResponseWriter, id string, sameSite http.SameSite) {
	http.SetCookie(w, &http.Cookie{Name: cookieName, Value: id, Path: "/", HttpOnly: true, Secure: s.cfg.SecureCookie,
		SameSite: sameSite, MaxAge: int(sessionLifetime.Seconds())})
}

func (s *Server) clearSessionCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{Name: cookieName, Value: "", Path: "/", HttpOnly: true, Secure: s.cfg.SecureCookie,
		SameSite: http.SameSiteLaxMode, MaxAge: -1})
}

func (s *Server) renewSession(ctx context.Context, w http.ResponseWriter, r *http.Request, sess *session) error {
	if _, err := s.cloud.AccessToken(ctx, sess.account); err != nil {
		return s.revokeRejectedSession(w, sess, err)
	}
	previous := sess.expires
	sess.expires = time.Now().Add(sessionLifetime)
	if err := s.bindSessionPersistence(sess); err != nil {
		sess.expires = previous
		return err
	}
	if cookie, err := r.Cookie(cookieName); err == nil {
		s.setSessionCookie(w, cookie.Value, http.SameSiteLaxMode)
	}
	return nil
}

func (s *Server) revokeRejectedSession(w http.ResponseWriter, sess *session, err error) error {
	var rejected *cloud.APIError
	if errors.As(err, &rejected) && rejected.Status == http.StatusUnauthorized {
		if removeErr := s.deleteSession(sess); removeErr != nil {
			return fmt.Errorf("无法撤销失效的本地登录状态")
		}
		sess.account, sess.haAuthorized = nil, false
		s.clearSessionCookie(w)
	}
	return err
}

func (s *Server) replaceLogin(ctx context.Context, w http.ResponseWriter, previous *session, account *cloud.Account, userID string, sameSite http.SameSite) bool {
	if err := s.deleteSession(previous); err != nil {
		s.cloud.Logout(ctx, account)
		fail(w, 500, "无法更新本地登录状态，请检查后端数据目录权限")
		return false
	}
	if previous.account != nil {
		s.cloud.Logout(ctx, previous.account)
	}
	previous.account, previous.haAuthorized = nil, false
	next := &session{account: account, userID: userID, turns: map[string]cachedTurn{}}
	if !s.saveSession(w, next, sameSite) {
		s.cloud.Logout(ctx, account)
		return false
	}
	return true
}
