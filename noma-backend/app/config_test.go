package app

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDefaultsStartWithoutEnvironmentOrConfigFile(t *testing.T) {
	t.Setenv("NOMA_LOCAL_ADDR", "")
	t.Setenv("NOMA_WEB_URL", "")
	t.Setenv("NOMA_HA_URL", "")
	cfg, err := LoadConfig(filepath.Join(t.TempDir(), "missing.json"))
	if err != nil || cfg.Addr != "127.0.0.1:3100" || cfg.CloudURL != "https://noma-ai.cloud" || cfg.WebURL != "http://127.0.0.1:3001" || cfg.HAURL != "http://localhost:8123" || cfg.SecureCookie {
		t.Fatalf("default configuration failed: %v", err)
	}
	server, err := New(cfg)
	if err != nil || server.ha.Configured() || strings.Join(server.ha.Allowed(), ",") != "*" {
		t.Fatal("missing local configuration must grant no HA access")
	}
}

func TestDockerHADefaultDoesNotOverrideSavedAddress(t *testing.T) {
	t.Setenv("NOMA_HA_URL", "http://host.docker.internal:8123")
	path := filepath.Join(t.TempDir(), "local.json")
	cfg, err := LoadConfig(path)
	if err != nil || cfg.HAURL != "http://host.docker.internal:8123" {
		t.Fatal("Docker HA default was not applied")
	}
	if err := os.WriteFile(path, []byte(`{"ha_url":"http://localhost:8123"}`), 0600); err != nil {
		t.Fatal(err)
	}
	cfg, err = LoadConfig(path)
	if err != nil || cfg.HAURL != "http://localhost:8123" {
		t.Fatal("Docker default overrode saved household address")
	}
}

func TestLocalBackendConfigurationAndContainerRouting(t *testing.T) {
	t.Setenv("NOMA_LOCAL_ADDR", "0.0.0.0:3000")
	t.Setenv("NOMA_WEB_URL", "http://noma-web:3000")
	path := filepath.Join(t.TempDir(), "local.json")
	if err := os.WriteFile(path, []byte(`{"ha_url":"http://127.0.0.1:8123","ha_token":"test-only-private-ha-token","allowed_entities":["light.allowed"],"secure_cookie":true}`), 0600); err != nil {
		t.Fatal(err)
	}
	cfg, err := LoadConfig(path)
	if err != nil || cfg.Addr != "0.0.0.0:3000" || cfg.WebURL != "http://noma-web:3000" || !cfg.SecureCookie {
		t.Fatalf("container configuration failed: %v", err)
	}
	server, err := New(cfg)
	if err != nil || !server.ha.Configured() || len(server.ha.Allowed()) != 1 {
		t.Fatal("HA configuration was not loaded")
	}
}

func TestInvalidConfigurationDoesNotDiscloseCredentials(t *testing.T) {
	t.Setenv("NOMA_LOCAL_ADDR", "")
	t.Setenv("NOMA_WEB_URL", "")
	for _, body := range []string{
		`{"ha_token":"test-only-private-ha-token","unknown":true}`,
		`{"ha_token":"test-only-private-ha-token"} {}`,
		`{"ha_token":"test-only-private-ha-token",`,
		`{"cloud_url":"http://cloud.example.invalid"}`,
		`{"ha_url":"http://user:test-only-private-ha-token@localhost:8123"}`,
		`{"ha_token":"` + strings.Repeat("x", 64<<10) + `"}`,
	} {
		path := filepath.Join(t.TempDir(), "local.json")
		if err := os.WriteFile(path, []byte(body), 0600); err != nil {
			t.Fatal(err)
		}
		_, err := LoadConfig(path)
		if err == nil || strings.Contains(err.Error(), "test-only-private-ha-token") {
			t.Fatal("invalid configuration accepted or disclosed a credential")
		}
	}
}
