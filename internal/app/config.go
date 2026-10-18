package app

import (
	"fmt"
	"net/url"
	"os"
	"strings"
)

type Config struct {
	Addr, AccessKey, CloudURL, HAURL, HAToken, WebURL string
	AllowedEntities                                   []string
	SecureCookie                                      bool
}

func LoadConfig() (Config, error) {
	c := Config{Addr: env("NOMA_LOCAL_ADDR", "127.0.0.1:3000"),
		AccessKey: os.Getenv("NOMA_LOCAL_ACCESS_KEY"), CloudURL: env("NOMA_CLOUD_URL", "https://noma-ai.cloud"),
		HAURL: os.Getenv("NOMA_HA_URL"), HAToken: os.Getenv("NOMA_HA_TOKEN"),
		WebURL:       env("NOMA_WEB_URL", "http://127.0.0.1:3001"),
		SecureCookie: os.Getenv("NOMA_LOCAL_SECURE_COOKIE") == "true"}
	for _, id := range strings.Split(os.Getenv("NOMA_HA_ALLOWED_ENTITIES"), ",") {
		if id = strings.TrimSpace(id); id != "" {
			c.AllowedEntities = append(c.AllowedEntities, id)
		}
	}
	return c, c.validate()
}

func (c Config) validate() error {
	if c.WebURL != "" {
		if err := validateURL(c.WebURL, true); err != nil {
			return fmt.Errorf("NOMA_WEB_URL: %w", err)
		}
	}
	if len(c.AccessKey) < 24 || strings.HasPrefix(c.AccessKey, "replace-") {
		return fmt.Errorf("NOMA_LOCAL_ACCESS_KEY must be a random key of at least 24 characters")
	}
	if err := validateURL(c.CloudURL, false); err != nil {
		return fmt.Errorf("NOMA_CLOUD_URL: %w", err)
	}
	if c.HAURL != "" {
		if err := validateURL(c.HAURL, true); err != nil {
			return fmt.Errorf("NOMA_HA_URL: %w", err)
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
