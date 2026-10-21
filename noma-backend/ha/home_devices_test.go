package ha

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestHomeVisibilityKeepsHouseholdControlsAndSensorsWithoutHousekeeping(t *testing.T) {
	for _, tc := range []struct {
		id, class, state string
		metadata         map[string]any
		visible          bool
	}{
		{id: "light.living_room", state: "off", visible: true},
		{id: "switch.tv", state: "unavailable", visible: true},
		{id: "input_boolean.room_light", state: "off", visible: true},
		{id: "climate.bedroom", state: "unknown", visible: true},
		{id: "cover.window", state: "closed", visible: true},
		{id: "media_player.speaker", state: "idle", visible: true},
		{id: "fan.bedroom", state: "on", visible: true},
		{id: "humidifier.bedroom", state: "off", visible: true},
		{id: "vacuum.robot", state: "docked", visible: true},
		{id: "sensor.room_temperature", class: "temperature", state: "0", visible: true},
		{id: "sensor.room_humidity", class: "humidity", state: "unavailable", visible: true},
		{id: "binary_sensor.front_door", class: "door", state: "off", visible: true},
		{id: "binary_sensor.leak", class: "moisture", state: "on", visible: true},
		{id: "sensor.backup_state", state: "idle"},
		{id: "sensor.sun_next_dawn", class: "timestamp", state: "2026-10-20T10:00:00Z"},
		{id: "sensor.last_backup", class: "timestamp", state: "unknown"},
		{id: "sensor.iphone_steps", state: "68"},
		{id: "sensor.iphone_temperature", class: "temperature", state: "30"},
		{id: "sensor.wei_huang_s_iphone_pressure", class: "pressure", state: "1003.75"},
		{id: "binary_sensor.wei_huang_s_iphone_camera_motion", class: "motion", state: "off"},
		{id: "sensor.bulb_power", class: "power", state: "0.0"},
		{id: "sensor.bulb_energy", class: "energy", state: "10"},
		{id: "sensor.phone_temperature", class: "temperature", state: "30", metadata: map[string]any{"integration": "mobile_app"}},
		{id: "sensor.cpu_temperature", class: "temperature", state: "30", metadata: map[string]any{"entity_category": "diagnostic"}},
		{id: "switch.child_lock", state: "off", metadata: map[string]any{"entity_category": "config"}},
		{id: "light.hidden", state: "on", metadata: map[string]any{"hidden_by": "user"}},
		{id: "sensor.hidden_temperature", class: "temperature", metadata: map[string]any{"disabled_by": "integration"}},
		{id: "binary_sensor.battery", class: "battery", state: "on"},
		{id: "binary_sensor.connection", class: "connectivity", state: "on"},
		{id: "sun.sun", state: "above_horizon"},
		{id: "update.core", state: "on"},
		{id: "button.restart", state: "unknown"},
	} {
		t.Run(tc.id, func(t *testing.T) {
			attributes := map[string]any{"friendly_name": "Test entity", "device_class": tc.class}
			for key, value := range tc.metadata {
				attributes[key] = value
			}
			state := sanitize(State{EntityID: tc.id, State: tc.state, Attributes: attributes})
			if state.HomeVisible() != tc.visible {
				t.Fatalf("visibility = %v, expected %v", state.HomeVisible(), tc.visible)
			}
			data, _ := json.Marshal(state)
			if strings.Contains(string(data), "homeHidden") || strings.Contains(string(data), "entity_category") || strings.Contains(string(data), "mobile_app") {
				t.Fatal("internal display metadata leaked into executor state")
			}
		})
	}
}
