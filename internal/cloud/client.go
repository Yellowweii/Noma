package cloud

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"
)

const refreshCookie = "noma_refresh_token"

type Client struct {
	base string
	http *http.Client
}

// Account belongs to one local browser session. Cloud credentials never leave the backend.
type Account struct {
	mu             sync.Mutex
	AccessToken    string
	RefreshToken   string
	ExpiresAt      time.Time
	persistRefresh func(Credentials) error
	persistPending bool
}

// Credentials are checkpointed only by the local backend, never returned to a
// browser. Keeping the access expiry avoids a forced refresh on every restart.
type Credentials struct {
	AccessToken  string
	RefreshToken string
	ExpiresAt    time.Time
}

// PersistRefreshToken binds backend-only storage to this account. Refreshed
// credentials are checkpointed before they can be used by another request.
func (a *Account) PersistRefreshToken(save func(string) error) error {
	return a.PersistCredentials(func(credentials Credentials) error { return save(credentials.RefreshToken) })
}

func (a *Account) PersistCredentials(save func(Credentials) error) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.RefreshToken == "" {
		return fmt.Errorf("云端未提供可续期的登录凭证")
	}
	if err := save(a.credentials()); err != nil {
		return err
	}
	a.persistRefresh, a.persistPending = save, false
	return nil
}

func (a *Account) credentials() Credentials {
	return Credentials{AccessToken: a.AccessToken, RefreshToken: a.RefreshToken, ExpiresAt: a.ExpiresAt}
}

type APIError struct{ Status int }

func (e *APIError) Error() string {
	if e.Status == 404 || e.Status == 405 || e.Status == 501 {
		return "云端尚未提供所需接口，请先完成云端对接"
	}
	if e.Status == 401 {
		return "云端登录已失效，请重新登录"
	}
	if e.Status == 429 {
		return "云端请求过于频繁或额度不足，请稍后重试"
	}
	return fmt.Sprintf("云端请求失败（HTTP %d）", e.Status)
}

func New(base string) *Client {
	return &Client{strings.TrimRight(base, "/"), &http.Client{Timeout: 90 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}
}

func (c *Client) request(ctx context.Context, method, path, token, refresh string, input any, output any) ([]*http.Cookie, error) {
	var body io.Reader
	if input != nil {
		b, err := json.Marshal(input)
		if err != nil {
			return nil, err
		}
		body = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.base+path, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	if refresh != "" {
		req.AddCookie(&http.Cookie{Name: refreshCookie, Value: refresh})
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("无法连接 Noma Cloud，请检查网络")
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, &APIError{resp.StatusCode}
	}
	if output != nil {
		b, err := io.ReadAll(io.LimitReader(resp.Body, (1<<20)+1))
		if err != nil || len(b) > 1<<20 {
			return nil, fmt.Errorf("云端响应超出限制或读取失败")
		}
		if err := json.Unmarshal(b, output); err != nil {
			return nil, fmt.Errorf("云端未返回有效 JSON 协议响应")
		}
	}
	return resp.Cookies(), nil
}

func (c *Client) SendOTP(ctx context.Context, email string) error {
	_, err := c.request(ctx, "POST", "/api/v1/auth/otp/send", "", "", map[string]string{"email": email}, nil)
	return err
}

type tokenResponse struct {
	AccessToken string `json:"access_token"`
	ExpiresIn   int    `json:"expires_in"`
}

func (a *Account) update(out tokenResponse, cookies []*http.Cookie) error {
	if out.AccessToken == "" || out.ExpiresIn <= 0 {
		return fmt.Errorf("云端登录响应不完整")
	}
	a.AccessToken = out.AccessToken
	a.ExpiresAt = time.Now().Add(time.Duration(out.ExpiresIn) * time.Second)
	for _, cookie := range cookies {
		// A response may clear an obsolete cookie path as well as setting the
		// replacement. Such a clearing cookie is not a new refresh credential.
		if cookie.Name == refreshCookie && cookie.Value != "" && cookie.MaxAge >= 0 {
			a.RefreshToken = cookie.Value
		}
	}
	a.persistPending = a.persistRefresh != nil
	return nil
}

func (c *Client) Login(ctx context.Context, email, code string) (*Account, error) {
	var out tokenResponse
	cookies, err := c.request(ctx, "POST", "/api/v1/auth/otp/verify", "", "", map[string]string{"email": email, "code": code}, &out)
	if err != nil {
		return nil, err
	}
	a := &Account{}
	if err := a.update(out, cookies); err != nil {
		return nil, err
	}
	return a, nil
}

func (c *Client) Do(ctx context.Context, a *Account, method, path string, input, output any) error {
	token, err := c.AccessToken(ctx, a)
	if err != nil {
		return err
	}
	// No automatic retries: a failed turn may already have caused a physical action.
	_, err = c.request(ctx, method, path, token, "", input, output)
	return err
}

func (c *Client) AccessToken(ctx context.Context, a *Account) (string, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.persistPending {
		if err := a.persistRefresh(a.credentials()); err != nil {
			return "", err
		}
		a.persistPending = false
	}
	if time.Until(a.ExpiresAt) < 30*time.Second {
		var out tokenResponse
		cookies, err := c.request(ctx, "POST", "/api/v1/auth/refresh", "", a.RefreshToken, nil, &out)
		if err == nil {
			err = a.update(out, cookies)
		}
		if err != nil {
			return "", err
		}
	}
	if a.persistPending {
		if err := a.persistRefresh(a.credentials()); err != nil {
			// Keep a rotated refresh token in memory so a storage error can be
			// repaired without replaying the refresh request with its old token.
			return "", err
		}
		a.persistPending = false
	}
	return a.AccessToken, nil
}

// ExchangeLocalLogin trades a one-time authorization code for Noma credentials.
// The browser never supplies a Clerk session token or a client secret.
func (c *Client) ExchangeLocalLogin(ctx context.Context, code, redirectURI, verifier string) (*Account, map[string]any, error) {
	return c.Authenticate(ctx, "/api/v1/local/oauth/token", "", map[string]string{
		"grant_type":    "authorization_code",
		"code":          code,
		"redirect_uri":  redirectURI,
		"client_id":     "noma-local",
		"code_verifier": verifier,
	})
}

// Authenticate preserves the public account fields while withholding cloud credentials.
func (c *Client) Authenticate(ctx context.Context, path, authorization string, input any) (*Account, map[string]any, error) {
	var body map[string]any
	cookies, err := c.request(ctx, "POST", path, authorization, "", input, &body)
	if err != nil {
		return nil, nil, err
	}
	token, _ := body["access_token"].(string)
	ttl, _ := body["expires_in"].(float64)
	a := &Account{}
	if err := a.update(tokenResponse{AccessToken: token, ExpiresIn: int(ttl)}, cookies); err != nil {
		return nil, nil, err
	}
	delete(body, "access_token")
	delete(body, "refresh_token")
	return a, body, nil
}

// Forward is called only after the local gateway has matched a method/path allowlist.
// Caller-supplied Cookie, Authorization, Host and forwarding headers never reach cloud.
func (c *Client) Forward(ctx context.Context, a *Account, method, path, contentType string, body io.Reader) (*http.Response, error) {
	token := ""
	var err error
	if a != nil {
		token, err = c.AccessToken(ctx, a)
		if err != nil {
			return nil, err
		}
	}
	req, err := http.NewRequestWithContext(ctx, method, c.base+path, body)
	if err != nil {
		return nil, fmt.Errorf("云端请求无效")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	return c.http.Do(req)
}

func (c *Client) Logout(ctx context.Context, a *Account) {
	a.mu.Lock()
	defer a.mu.Unlock()
	_, _ = c.request(ctx, "POST", "/api/v1/auth/logout", "", a.RefreshToken, nil, nil)
	a.AccessToken, a.RefreshToken = "", ""
	a.ExpiresAt = time.Time{}
}
