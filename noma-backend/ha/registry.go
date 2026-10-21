package ha

import (
	"context"
	"encoding/json"
	"errors"
	"net/url"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
)

type registryEntity struct {
	EntityID   string `json:"entity_id"`
	DeviceID   string `json:"device_id"`
	AreaID     string `json:"area_id"`
	Platform   string `json:"platform"`
	Category   string `json:"entity_category"`
	HiddenBy   string `json:"hidden_by"`
	DisabledBy string `json:"disabled_by"`
}
type registryDevice struct {
	ID          string     `json:"id"`
	AreaID      string     `json:"area_id"`
	ParentID    string     `json:"parent_device_id"`
	DisabledBy  string     `json:"disabled_by"`
	Identifiers [][]string `json:"identifiers"`
}
type registryArea struct {
	ID   string `json:"area_id"`
	Name string `json:"name"`
}
type registrySnapshot struct {
	entities map[string]registryEntity
	devices  map[string]registryDevice
	areas    map[string]string
}

// DashboardStates adds local display metadata only. Executor results retain their
// existing allowlisted state schema and never carry the household registries.
func (c *Client) DashboardStates(ctx context.Context) ([]State, error) {
	states, err := c.States(ctx)
	if err != nil {
		return nil, err
	}
	registry := c.dashboardRegistry(ctx)
	for i := range states {
		state := &states[i]
		entity, ok := registry.entities[state.EntityID]
		if !ok {
			continue
		}
		state.DeviceID, state.AreaID = entity.DeviceID, entity.AreaID
		state.homeHidden = state.homeHidden || homeMetadataHidden(map[string]any{
			"platform": entity.Platform, "entity_category": entity.Category,
			"hidden_by": entity.HiddenBy, "disabled_by": entity.DisabledBy,
		})
		// An entity's explicit area overrides its device's area. Child devices
		// inherit from parents; the bound also handles malformed registry cycles.
		for id, depth := entity.DeviceID, 0; id != "" && depth < 16; depth++ {
			device, exists := registry.devices[id]
			if !exists {
				break
			}
			state.homeHidden = state.homeHidden || device.DisabledBy != ""
			for _, identifier := range device.Identifiers {
				if len(identifier) > 0 && identifier[0] == "mobile_app" {
					state.homeHidden = true
				}
			}
			if state.AreaID == "" {
				state.AreaID = device.AreaID
			}
			id = device.ParentID
		}
		state.Room = registry.areas[state.AreaID]
	}
	return states, nil
}

func (c *Client) dashboardRegistry(ctx context.Context) registrySnapshot {
	c.registryMu.Lock()
	defer c.registryMu.Unlock()
	if time.Now().Before(c.registryNextCheck) {
		return c.registry
	}
	// Failed reads keep the last successful registry and back off, while live
	// device states continue to refresh. No registry mutation is ever sent.
	c.registryNextCheck = time.Now().Add(30 * time.Second)
	registry, err := c.readDashboardRegistry(ctx)
	if err == nil {
		c.registry = registry
		c.registryNextCheck = time.Now().Add(time.Minute)
	}
	return c.registry
}

func (c *Client) readDashboardRegistry(parent context.Context) (registrySnapshot, error) {
	var registry registrySnapshot
	ctx, cancel := context.WithTimeout(parent, 5*time.Second)
	defer cancel()
	address, err := url.Parse(c.base + "/api/websocket")
	if err != nil {
		return registry, errors.New("HA 登记信息地址无效")
	}
	switch address.Scheme {
	case "http":
		address.Scheme = "ws"
	case "https":
		address.Scheme = "wss"
	default:
		return registry, errors.New("HA 登记信息地址无效")
	}
	conn, _, err := websocket.Dial(ctx, address.String(), &websocket.DialOptions{HTTPClient: c.http})
	if err != nil {
		return registry, errors.New("HA 登记信息暂不可用")
	}
	defer conn.CloseNow()
	conn.SetReadLimit(8 << 20)
	var handshake struct {
		Type string `json:"type"`
	}
	if wsjson.Read(ctx, conn, &handshake) != nil || handshake.Type != "auth_required" {
		return registry, errors.New("HA 登记信息握手失败")
	}
	if wsjson.Write(ctx, conn, map[string]string{"type": "auth", "access_token": c.token}) != nil ||
		wsjson.Read(ctx, conn, &handshake) != nil || handshake.Type != "auth_ok" {
		return registry, errors.New("HA 登记信息授权失败")
	}
	var areas []registryArea
	var devices []registryDevice
	var entities []registryEntity
	// Fixed read-only commands. Neither callers nor the cloud can supply a
	// websocket URL, command, template, service, or arbitrary payload here.
	for i, query := range []struct {
		command string
		target  any
	}{
		{"config/area_registry/list", &areas},
		{"config/device_registry/list", &devices},
		{"config/entity_registry/list", &entities},
	} {
		if wsjson.Write(ctx, conn, map[string]any{"id": i + 1, "type": query.command}) != nil {
			return registry, errors.New("HA 登记信息读取失败")
		}
		var result struct {
			ID      int             `json:"id"`
			Type    string          `json:"type"`
			Success bool            `json:"success"`
			Result  json.RawMessage `json:"result"`
		}
		if wsjson.Read(ctx, conn, &result) != nil || result.Type != "result" || result.ID != i+1 || !result.Success || json.Unmarshal(result.Result, query.target) != nil {
			return registry, errors.New("HA 登记信息读取失败")
		}
	}
	registry = registrySnapshot{entities: map[string]registryEntity{}, devices: map[string]registryDevice{}, areas: map[string]string{}}
	for _, area := range areas {
		registry.areas[area.ID] = area.Name
	}
	for _, device := range devices {
		registry.devices[device.ID] = device
	}
	for _, entity := range entities {
		if EntityPattern.MatchString(entity.EntityID) && (c.allowAll || c.allowed[entity.EntityID]) {
			registry.entities[entity.EntityID] = entity
		}
	}
	return registry, nil
}
