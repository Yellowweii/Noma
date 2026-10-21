package app

import (
	"encoding/json"
	"fmt"
	"io"
	"net/url"
	"os"
	"strings"
	"time"
)

type Config struct {
	Addr            string    `json:"listen"`
	CloudURL        string    `json:"cloud_url"`
	HAURL           string    `json:"ha_url"`
	HAToken         string    `json:"ha_token"`
	WebURL          string    `json:"web_url"`
	AllowedEntities []string  `json:"allowed_entities"`
	SecureCookie    bool      `json:"secure_cookie"`
	HomeName        string    `json:"home_name,omitempty"`
	HAConnectedAt   time.Time `json:"ha_connected_at,omitzero"`
	path            string
}

const DefaultAddr = "127.0.0.1:3100"
const DefaultHAURL = "http://localhost:8123"

// Missing configuration is valid: account login and chat need no household secrets.
// HA credentials are persisted only by this backend and are never returned to clients.
func LoadConfig(paths ...string) (Config, error) {
	c := Config{Addr: DefaultAddr, CloudURL: "https://noma-ai.cloud", WebURL: "http://127.0.0.1:3001", HAURL: env("NOMA_HA_URL", DefaultHAURL)}
	path := "data/local.json"
	if len(paths) > 0 {
		path = paths[0]
	}
	c.path = path
	f, err := os.Open(path)
	if err == nil {
		defer f.Close()
		info, statErr := f.Stat()
		if statErr != nil || info.Size() > 64<<10 {
			return Config{}, fmt.Errorf("本地配置文件无法读取或超出大小限制")
		}
		decoder := json.NewDecoder(io.LimitReader(f, 64<<10))
		decoder.DisallowUnknownFields()
		if decoder.Decode(&c) != nil || decoder.Decode(new(any)) != io.EOF {
			return Config{}, fmt.Errorf("本地配置文件格式或字段无效")
		}
	} else if !os.IsNotExist(err) {
		return Config{}, fmt.Errorf("无法读取本地配置文件")
	}
	// Container-to-container routing is supplied by Compose, not household .env.
	c.Addr = env("NOMA_LOCAL_ADDR", c.Addr)
	c.WebURL = env("NOMA_WEB_URL", c.WebURL)
	if c.HAURL == "" {
		c.HAURL = env("NOMA_HA_URL", DefaultHAURL)
	}
	return c, c.validate()
}

func (c Config) validate() error {
	if c.WebURL != "" {
		if err := validateURL(c.WebURL, true); err != nil {
			return fmt.Errorf("NOMA_WEB_URL: %w", err)
		}
	}
	if err := validateURL(c.CloudURL, false); err != nil {
		return fmt.Errorf("cloud_url: %w", err)
	}
	if c.HAURL != "" {
		if err := validateURL(c.HAURL, true); err != nil {
			return fmt.Errorf("ha_url: %w", err)
		}
	}
	return nil
}

func validateURL(raw string, allowLAN bool) error {
	u, err := url.Parse(raw)
	if err != nil || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") {
		return fmt.Errorf("expected an origin URL without credentials, path, query or fragment")
	}
	if u.Scheme != "https" && !(u.Scheme == "http" && (allowLAN || u.Hostname() == "127.0.0.1" || u.Hostname() == "localhost" || u.Hostname() == "::1")) {
		return fmt.Errorf("HTTPS required (HTTP is permitted for HA and loopback development only)")
	}
	return nil
}

func env(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}
