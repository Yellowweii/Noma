package app

import (
	"strings"
	"testing"
)

func TestRestoredHARequestsCannotExecuteAgainAfterRestart(t *testing.T) {
	f := newFixture(t, fixtureOptions{})
	frontendLogin(t, f)
	status, _, _ := f.request(t, "POST", "/api/local/turns", input())
	if status != 200 || f.controls.Load() != 1 {
		t.Fatal("initial operation failed")
	}
	restartGateway(t, f)
	status, body, _ := f.request(t, "POST", "/api/local/turns", input())
	if status != 409 || !strings.Contains(body, "不会重复执行") || f.controls.Load() != 1 || f.turns.Load() != 1 {
		t.Fatal("restored request repeated a physical operation")
	}
}

func TestRestoredDeviceGrantDoesNotApplyToChangedHAConfiguration(t *testing.T) {
	f := newFixture(t, fixtureOptions{})
	frontendLogin(t, f)
	s := f.local.Config.Handler.(*Server)
	s.cfg.AllowedEntities = []string{}
	restartGateway(t, f)
	status, body, _ := f.request(t, "GET", "/api/local/status", nil)
	if status != 200 || !strings.Contains(body, `"ha_authorized":false`) {
		t.Fatal("restored grant expanded to changed HA permissions")
	}
	status, _, _ = f.request(t, "GET", "/api/v1/me", nil)
	if status != 200 {
		t.Fatal("household configuration change discarded account login")
	}
}
