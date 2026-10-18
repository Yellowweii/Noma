package ha

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"noma.local/public/internal/protocol"
)

func TestEntityAndParameterBoundaries(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.Header.Get("Authorization") != "Bearer test-ha-secret" {
			t.Error("missing HA authorization")
		}
		if r.Method == "POST" {
			var body map[string]any
			_ = json.NewDecoder(r.Body).Decode(&body)
			if body["entity_id"] != "light.allowed" {
				t.Error("unexpected target")
			}
			_, _ = w.Write([]byte(`[]`))
			return
		}
		_, _ = w.Write([]byte(`{"entity_id":"light.allowed","state":"on","attributes":{"friendly_name":"Lamp","brightness":180,"entity_picture":"secret-url"}}`))
	}))
	defer server.Close()
	client, err := New(server.URL, "test-ha-secret", []string{"light.allowed"})
	if err != nil {
		t.Fatal(err)
	}
	for name, args := range map[string]Control{
		"unauthorized":                {EntityID: "light.other", Action: "turn_on"},
		"traversal":                   {EntityID: "light.allowed/../../config", Action: "turn_on"},
		"service":                     {EntityID: "light.allowed", Action: "toggle"},
		"target override":             {EntityID: "light.allowed", Action: "turn_on", Params: map[string]any{"entity_id": "light.other"}},
		"area override":               {EntityID: "light.allowed", Action: "turn_on", Params: map[string]any{"area_id": "all"}},
		"brightness range":            {EntityID: "light.allowed", Action: "turn_on", Params: map[string]any{"brightness": float64(999)}},
		"brightness fractional":       {EntityID: "light.allowed", Action: "turn_on", Params: map[string]any{"brightness": 1.5}},
		"brightness percentage range": {EntityID: "light.allowed", Action: "turn_on", Params: map[string]any{"brightness_pct": float64(101)}},
		"color channel range":         {EntityID: "light.allowed", Action: "turn_on", Params: map[string]any{"rgb_color": []any{float64(0), float64(0), float64(999)}}},
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := client.Control(context.Background(), args); err == nil {
				t.Fatal("expected rejection")
			}
		})
	}
	if calls.Load() != 0 {
		t.Fatal("rejected operations reached HA")
	}
	data, err := client.Control(context.Background(), Control{EntityID: "light.allowed", Action: "turn_on", Params: map[string]any{"brightness": float64(180)}})
	if err != nil {
		t.Fatal(err)
	}
	b, _ := json.Marshal(data)
	if calls.Load() != 2 || strings.Contains(string(b), "secret-url") || !strings.Contains(string(b), `"accepted":true`) {
		t.Fatalf("unexpected result: %s", b)
	}
}

func TestReusedLightParameterShapes(t *testing.T) {
	for key, value := range map[string]any{"brightness_pct": float64(40), "rgb_color": []any{float64(255), float64(0), float64(0)}, "rgbw_color": []any{float64(0), float64(0), float64(0), float64(255)}, "white": float64(180), "color_temp_kelvin": float64(6500)} {
		if !validLightParam(key, value) {
			t.Errorf("reused frontend parameter rejected: %s", key)
		}
	}
}

func TestReadScopeAndEmptyAllowlist(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.URL.Path != "/api/states/sensor.allowed" {
			t.Errorf("unexpected path %s", r.URL.Path)
		}
		_, _ = w.Write([]byte(`{"entity_id":"sensor.allowed","state":"22","attributes":{"unit_of_measurement":"C","private_value":"hidden"}}`))
	}))
	defer server.Close()
	client, _ := New(server.URL, "test-token", nil)
	states, err := client.States(context.Background())
	if err != nil || len(states) != 0 || calls.Load() != 0 {
		t.Fatal("empty allowlist performed reads")
	}
	client, _ = New(server.URL, "test-token", []string{"sensor.allowed"})
	states, err = client.States(context.Background())
	if err != nil || len(states) != 1 {
		t.Fatalf("read failed: %v", err)
	}
	if _, ok := states[0].Attributes["private_value"]; ok {
		t.Fatal("unexpected attribute disclosed")
	}
	result := client.Execute(context.Background(), protocol.ToolCall{ID: "test-call", Name: "list_devices", Arguments: json.RawMessage(`{"url":"http://elsewhere"}`)})
	if result.OK || calls.Load() != 1 {
		t.Fatal("unexpected arguments were accepted")
	}
}

func TestRedirectCannotLeakHAToken(t *testing.T) {
	var received atomic.Int32
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { received.Add(1) }))
	defer target.Close()
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, target.URL, 307) }))
	defer source.Close()
	client, _ := New(source.URL, "test-ha-secret", nil)
	if err := client.Check(context.Background()); err == nil {
		t.Fatal("expected redirect rejection")
	}
	if received.Load() != 0 {
		t.Fatal("HA request followed a redirect")
	}
}

func TestServiceAcknowledgementDoesNotInventObservedState(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "POST" {
			_, _ = w.Write([]byte(`[]`))
			return
		}
		http.Error(w, "missing", 503)
	}))
	defer server.Close()
	client, _ := New(server.URL, "test-token", []string{"light.allowed"})
	out, err := client.Control(context.Background(), Control{EntityID: "light.allowed", Action: "turn_on"})
	if err != nil {
		t.Fatal(err)
	}
	b, _ := json.Marshal(out)
	if !strings.Contains(string(b), `"state_verified":false`) || strings.Contains(string(b), "observed_state") {
		t.Fatalf("invented state: %s", b)
	}
}
