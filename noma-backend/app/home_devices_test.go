package app

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"

	"noma.local/public/noma-backend/ha"
)

func TestHomeDirectoryFiltersNoiseAndKeepsReadScopeSeparate(t *testing.T) {
	f := newFixture(t, fixtureOptions{})
	home := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/websocket" {
			conn, err := websocket.Accept(w, r, nil)
			if err != nil {
				t.Error(err)
				return
			}
			defer conn.CloseNow()
			ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
			defer cancel()
			_ = wsjson.Write(ctx, conn, map[string]string{"type": "auth_required"})
			var auth map[string]string
			if wsjson.Read(ctx, conn, &auth) != nil || auth["access_token"] != "test-ha-secret" {
				t.Error("registry authorization missing")
				return
			}
			_ = wsjson.Write(ctx, conn, map[string]string{"type": "auth_ok"})
			for i, query := range []struct{ command, result string }{
				{"config/area_registry/list", `[{"area_id":"living","name":"客厅"},{"area_id":"bedroom","name":"卧室"}]`},
				{"config/device_registry/list", `[{"id":"living-lamp","area_id":"living"}]`},
				{"config/entity_registry/list", `[{"entity_id":"light.living_room","device_id":"living-lamp"},{"entity_id":"input_boolean.bedside","area_id":"bedroom"}]`},
			} {
				var command struct {
					ID   int    `json:"id"`
					Type string `json:"type"`
				}
				if wsjson.Read(ctx, conn, &command) != nil || command.ID != i+1 || command.Type != query.command {
					t.Error("unexpected registry command")
					return
				}
				_ = wsjson.Write(ctx, conn, map[string]any{"id": command.ID, "type": "result", "success": true, "result": json.RawMessage(query.result)})
			}
			return
		}
		if r.Method != "GET" || r.Header.Get("Authorization") != "Bearer test-ha-secret" {
			t.Error("display refresh made an unauthorized request or a write")
			w.WriteHeader(403)
			return
		}
		switch r.URL.Path {
		case "/api/":
			fmt.Fprint(w, `{}`)
		case "/api/states":
			fmt.Fprint(w, `[
			{"entity_id":"light.living_room","state":"off","attributes":{"friendly_name":"客厅主灯"}},
			{"entity_id":"switch.tv","state":"on","attributes":{"friendly_name":"客厅电视"}},
			{"entity_id":"input_boolean.bedside","state":"off","attributes":{"friendly_name":"床头灯"}},
			{"entity_id":"climate.bedroom","state":"unavailable","attributes":{}},
			{"entity_id":"sensor.room_temperature","state":"0","attributes":{"device_class":"temperature"}},
			{"entity_id":"sensor.room_humidity","state":"50","attributes":{"device_class":"humidity"}},
			{"entity_id":"binary_sensor.front_door","state":"off","attributes":{"device_class":"door"}},
			{"entity_id":"sensor.backup_manager_state","state":"idle","attributes":{}},
			{"entity_id":"sensor.backup_last_success","state":"unknown","attributes":{"device_class":"timestamp"}},
			{"entity_id":"sensor.sun_next_dawn","state":"2026-10-20T22:00:00Z","attributes":{"device_class":"timestamp"}},
			{"entity_id":"sensor.iphone_steps","state":"68","attributes":{}},
			{"entity_id":"sensor.iphone_temperature","state":"30","attributes":{"device_class":"temperature"}},
			{"entity_id":"sensor.telemetry","state":"30","attributes":{"device_class":"temperature","entity_category":"diagnostic"}},
			{"entity_id":"switch.child_lock","state":"off","attributes":{"entity_category":"config"}},
			{"entity_id":"sun.sun","state":"above_horizon","attributes":{}},
			{"entity_id":"update.core","state":"on","attributes":{}}
			]`)
		default:
			t.Errorf("unexpected home read: %s", r.URL.Path)
			w.WriteHeader(404)
		}
	}))
	defer home.Close()
	s := f.local.Config.Handler.(*Server)
	s.ha, _ = ha.New(home.URL, "test-ha-secret", []string{"*"})
	frontendLogin(t, f)
	type device struct {
		EntityID string         `json:"entity_id"`
		State    string         `json:"state"`
		Visible  bool           `json:"home_visible"`
		Actions  []string       `json:"supported_actions"`
		Attrs    map[string]any `json:"attributes"`
		Room     string         `json:"room"`
		AreaID   string         `json:"area_id"`
		DeviceID string         `json:"device_id"`
	}
	status, body, _ := f.request(t, "GET", "/api/v1/home/devices", nil)
	var devices []device
	if status != 200 || json.Unmarshal([]byte(body), &devices) != nil {
		t.Fatal("home directory request failed")
	}
	expected := []string{"light.living_room", "switch.tv", "input_boolean.bedside", "climate.bedroom", "sensor.room_temperature", "sensor.room_humidity", "binary_sensor.front_door"}
	ids := []string{}
	for _, item := range devices {
		ids = append(ids, item.EntityID)
		if !item.Visible || strings.HasPrefix(item.EntityID, "sensor.") && len(item.Actions) != 0 {
			t.Fatal("household sensor visibility or read-only behavior changed")
		}
		if item.EntityID == "sensor.room_temperature" && item.State != "0" {
			t.Fatal("zero-valued sensor was lost")
		}
		if item.EntityID == "light.living_room" && (item.Room != "客厅" || item.AreaID != "living" || item.DeviceID != "living-lamp") {
			t.Fatal("home API lost device area/group metadata")
		}
		if item.EntityID == "input_boolean.bedside" && item.Room != "卧室" {
			t.Fatal("home API lost entity area metadata")
		}
	}
	if !slices.Equal(ids, expected) {
		t.Fatalf("unexpected dashboard entities: %v", ids)
	}
	status, body, _ = f.request(t, "GET", "/api/v1/home/devices?include_sensors=true", nil)
	if status != 200 || json.Unmarshal([]byte(body), &devices) != nil || len(devices) != 14 {
		t.Fatal("candidate directory is unavailable")
	}
	for _, item := range devices {
		if item.Visible != slices.Contains(expected, item.EntityID) {
			t.Fatalf("candidate visibility mismatch: %s", item.EntityID)
		}
	}
	status, body, _ = f.request(t, "GET", "/api/v1/home/status", nil)
	if status != 200 || strings.Contains(body, "backup") || strings.Contains(body, "sun_next") || strings.Contains(body, "iphone") || strings.Contains(body, "telemetry") || !strings.Contains(body, "客厅主灯") {
		t.Fatal("home summary included housekeeping entities or lost a real device")
	}
	if !strings.Contains(body, `"room":"客厅"`) || !strings.Contains(body, `"room":"卧室"`) {
		t.Fatal("home summary lost room grouping")
	}
	status, body, _ = f.request(t, "GET", "/api/local/ha/states", nil)
	if status != 200 || !strings.Contains(body, "sensor.backup_manager_state") {
		t.Fatal("dashboard filtering changed the executor's authorized read scope")
	}
}
