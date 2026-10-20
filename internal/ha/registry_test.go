package ha

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
)

func TestDashboardRegistryAreasVisibilityCacheAndExecutorIsolation(t *testing.T) {
	var registryReads, stateReads atomic.Int32
	var failRegistry atomic.Bool
	home := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/states" {
			if r.Header.Get("Authorization") != "Bearer test-only-secret" {
				t.Error("missing local HA credential")
			}
			stateReads.Add(1)
			fmt.Fprint(w, `[
			{"entity_id":"light.main","state":"off","attributes":{}},
			{"entity_id":"light.override","state":"unavailable","attributes":{}},
			{"entity_id":"light.child","state":"on","attributes":{}},
			{"entity_id":"sensor.owner_pressure","state":"1003.75","attributes":{"device_class":"pressure"}},
			{"entity_id":"binary_sensor.owner_camera","state":"off","attributes":{"device_class":"motion"}},
			{"entity_id":"sensor.bulb_power","state":"0.0","attributes":{"device_class":"power"}},
			{"entity_id":"sensor.room_temperature","state":"0","attributes":{"device_class":"temperature"}},
			{"entity_id":"switch.configuration","state":"off","attributes":{}},
			{"entity_id":"light.hidden","state":"off","attributes":{}},
			{"entity_id":"light.unregistered","state":"off","attributes":{}}
			]`)
			return
		}
		if r.URL.Path != "/api/websocket" || r.Method != "GET" {
			t.Error("unexpected registry request")
			http.NotFound(w, r)
			return
		}
		registryReads.Add(1)
		if failRegistry.Load() {
			http.Error(w, "unavailable", 503)
			return
		}
		conn, err := websocket.Accept(w, r, nil)
		if err != nil {
			t.Error(err)
			return
		}
		defer conn.CloseNow()
		ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
		defer cancel()
		if wsjson.Write(ctx, conn, map[string]string{"type": "auth_required"}) != nil {
			return
		}
		var auth map[string]string
		if wsjson.Read(ctx, conn, &auth) != nil || auth["type"] != "auth" || auth["access_token"] != "test-only-secret" {
			t.Error("invalid local websocket authentication")
			return
		}
		if wsjson.Write(ctx, conn, map[string]string{"type": "auth_ok"}) != nil {
			return
		}
		for i, result := range []struct{ command, payload string }{
			{"config/area_registry/list", `[{"area_id":"living","name":"客厅"},{"area_id":"bedroom","name":"卧室"}]`},
			{"config/device_registry/list", `[{"id":"lamp","area_id":"living"},{"id":"child","parent_device_id":"lamp"},{"id":"phone","area_id":"living","identifiers":[["mobile_app","private-device-id"]]}]`},
			{"config/entity_registry/list", `[
			{"entity_id":"light.main","device_id":"lamp"},
			{"entity_id":"light.override","device_id":"lamp","area_id":"bedroom"},
			{"entity_id":"light.child","device_id":"child"},
			{"entity_id":"sensor.owner_pressure","device_id":"phone","platform":"mobile_app"},
			{"entity_id":"binary_sensor.owner_camera","device_id":"phone","platform":"mobile_app"},
			{"entity_id":"sensor.bulb_power","device_id":"lamp"},
			{"entity_id":"sensor.room_temperature","area_id":"bedroom"},
			{"entity_id":"switch.configuration","device_id":"lamp","entity_category":"config"},
			{"entity_id":"light.hidden","device_id":"lamp","hidden_by":"user"}
			]`},
		} {
			var command struct {
				ID   int    `json:"id"`
				Type string `json:"type"`
			}
			if wsjson.Read(ctx, conn, &command) != nil || command.ID != i+1 || command.Type != result.command {
				t.Error("unexpected or non-read-only registry command")
				return
			}
			if wsjson.Write(ctx, conn, map[string]any{"id": command.ID, "type": "result", "success": true, "result": json.RawMessage(result.payload)}) != nil {
				return
			}
		}
	}))
	defer home.Close()
	c, _ := New(home.URL, "test-only-secret", []string{"*"})
	check := func() {
		t.Helper()
		states, err := c.DashboardStates(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		for _, state := range states {
			switch state.EntityID {
			case "light.main", "light.child":
				if state.Room != "客厅" || state.AreaID != "living" || state.DeviceID == "" || !state.HomeVisible() {
					t.Fatal("device/parent area did not reach dashboard")
				}
			case "light.override", "sensor.room_temperature":
				if state.Room != "卧室" || !state.HomeVisible() {
					t.Fatal("entity area did not override device area or zero/offline device disappeared")
				}
			case "light.unregistered":
				if state.Room != "" || !state.HomeVisible() {
					t.Fatal("invented an area for unassigned device")
				}
			default:
				if state.HomeVisible() {
					t.Fatalf("auxiliary entity visible: %s", state.EntityID)
				}
			}
		}
		encoded, _ := json.Marshal(states)
		for _, secret := range []string{"test-only-secret", "private-device-id", "客厅", "device_id", "platform", "entity_category"} {
			if strings.Contains(string(encoded), secret) {
				t.Fatal("registry or credentials leaked into executor state schema")
			}
		}
	}
	check()
	check()
	if registryReads.Load() != 1 || stateReads.Load() != 2 {
		t.Fatal("registry was not cached, or states were cached instead of refreshed")
	}
	c.registryNextCheck = time.Now().Add(-time.Second)
	failRegistry.Store(true)
	check()
	check()
	if registryReads.Load() != 2 {
		t.Fatal("temporary registry failures did not back off")
	}
	raw, err := c.States(context.Background())
	if err != nil || !raw[3].HomeVisible() {
		t.Fatal("dashboard registry filters changed executor read scope")
	}
}

func TestRegistryRedirectNeverSendsCredentialElsewhere(t *testing.T) {
	var requests atomic.Int32
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { requests.Add(1); t.Error("followed registry redirect") }))
	defer target.Close()
	home := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL, http.StatusTemporaryRedirect)
	}))
	defer home.Close()
	c, _ := New(home.URL, "must-remain-local", []string{"*"})
	_, err := c.readDashboardRegistry(context.Background())
	if err == nil || strings.Contains(err.Error(), "must-remain-local") || requests.Load() != 0 {
		t.Fatal("registry redirect or error leaked credentials")
	}
}
