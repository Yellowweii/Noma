package app

import (
	"bytes"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

// Exercise the executable and its data directory, not only rebuilding a handler
// in the test process. The browser cookie jar must work across process deaths.
func TestGatewayProcessRestartsKeepLoginAndConnectedSummary(t *testing.T) {
	if testing.Short() {
		t.Skip("process restart integration")
	}
	f := newFixture(t, fixtureOptions{})
	frontend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { io.WriteString(w, "protected app") }))
	defer frontend.Close()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := listener.Addr().String()
	listener.Close()
	dir := t.TempDir()
	binary := filepath.Join(dir, "noma-local")
	if runtime.GOOS == "windows" {
		binary += ".exe"
	}
	if output, err := exec.Command("go", "build", "-o", binary, "../../cmd/noma-local").CombinedOutput(); err != nil {
		t.Fatalf("build gateway: %v %s", err, output)
	}
	cfg := f.local.Config.Handler.(*Server).cfg
	cfg.Addr, cfg.WebURL = addr, frontend.URL
	cfg.path = filepath.Join(dir, "data", "local.json")
	data, _ := json.Marshal(cfg)
	if err := os.MkdirAll(filepath.Dir(cfg.path), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(cfg.path, data, 0600); err != nil {
		t.Fatal(err)
	}
	base := "http://" + addr
	jar, _ := cookiejar.New(nil)
	client := &http.Client{Jar: jar, Timeout: 3 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	var process *exec.Cmd
	stop := func() {
		if process != nil {
			_ = process.Process.Kill()
			_ = process.Wait()
			process = nil
		}
	}
	t.Cleanup(stop)
	start := func() {
		t.Helper()
		process = exec.Command(binary, "--config", cfg.path)
		process.Env = append(os.Environ(), "NOMA_LOCAL_ADDR="+addr, "NOMA_WEB_URL="+frontend.URL)
		if err := process.Start(); err != nil {
			t.Fatal(err)
		}
		deadline := time.Now().Add(8 * time.Second)
		for time.Now().Before(deadline) {
			response, err := client.Get(base + "/api/local/health")
			if err == nil {
				response.Body.Close()
				if response.StatusCode == 200 {
					return
				}
			}
			time.Sleep(50 * time.Millisecond)
		}
		t.Fatal("gateway did not become healthy")
	}
	request := func(method, path string, input any) (int, string) {
		t.Helper()
		var data []byte
		if input != nil {
			data, _ = json.Marshal(input)
		}
		req, _ := http.NewRequest(method, base+path, bytes.NewReader(data))
		if method != "GET" {
			req.Header.Set("Origin", base)
			req.Header.Set("Content-Type", "application/json")
		}
		response, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		body, _ := io.ReadAll(response.Body)
		return response.StatusCode, string(body)
	}
	start()
	if status, _ := request("POST", "/api/v1/auth/otp/verify", map[string]string{"email": "test@example.invalid", "code": "123456"}); status != 200 {
		t.Fatal("process login failed")
	}
	if status, _ := request("POST", "/api/local/ha/configure", map[string]any{}); status != 200 {
		t.Fatal("process HA connection failed")
	}
	if status, _ := request("POST", "/api/local/ha/name", map[string]string{"home_name": "我们的家"}); status != 200 {
		t.Fatal("process home name save failed")
	}
	for range 3 {
		stop()
		start()
		for _, path := range []string{"/api/v1/auth/refresh", "/api/v1/me", "/home", "/api/local/status", "/api/v1/ha/connections"} {
			method := "GET"
			if path == "/api/v1/auth/refresh" {
				method = "POST"
			}
			status, body := request(method, path, nil)
			if status != 200 || strings.Contains(body, "test-cloud-access") || strings.Contains(body, "test-refresh-token") || strings.Contains(body, "test-ha-secret") {
				t.Fatalf("process recovery failed for %s: %d", path, status)
			}
			if path == "/api/local/status" && (!strings.Contains(body, `"ha_authorized":true`) || !strings.Contains(body, "我们的家")) {
				t.Fatal("connected summary was lost on process restart")
			}
		}
	}
	if f.refreshes.Load() != 0 {
		t.Fatal("process restarts unnecessarily refreshed a still-valid access token")
	}
	stop()
	entries, err := os.ReadDir(filepath.Join(filepath.Dir(cfg.path), "sessions"))
	if err != nil || len(entries) != 1 {
		t.Fatal("durable browser session missing")
	}
	path := filepath.Join(filepath.Dir(cfg.path), "sessions", entries[0].Name())
	data, _ = os.ReadFile(path)
	var saved storedSession
	if err := json.Unmarshal(data, &saved); err != nil {
		t.Fatal(err)
	}
	saved.AccessExpiresAt = time.Now().Add(-time.Minute)
	data, _ = json.Marshal(saved)
	if err := writeSessionFile(path, data); err != nil {
		t.Fatal(err)
	}
	start()
	if status, _ := request("POST", "/api/v1/auth/refresh", nil); status != 200 || f.refreshes.Load() != 1 {
		t.Fatal("expired access token did not renew after process restart")
	}
	if status, _ := request("POST", "/api/v1/auth/logout", nil); status != 200 {
		t.Fatal("process logout failed")
	}
	stop()
	start()
	if status, _ := request("GET", "/home", nil); status != http.StatusSeeOther {
		t.Fatal("logout was reversed by process restart")
	}
}
