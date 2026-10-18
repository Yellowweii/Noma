package ha

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"time"

	"noma.local/public/internal/protocol"
)

var EntityPattern = regexp.MustCompile(`^[a-z_]+\.[a-z0-9_]+$`)

type Client struct {
	base, token string
	allowed     map[string]bool
	http        *http.Client
}

func New(base, token string, entities []string) (*Client, error) {
	c := &Client{base: strings.TrimRight(base, "/"), token: token, allowed: map[string]bool{},
		http: &http.Client{Timeout: 10 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}
	for _, id := range entities {
		if !EntityPattern.MatchString(id) {
			return nil, fmt.Errorf("invalid entity in NOMA_HA_ALLOWED_ENTITIES")
		}
		c.allowed[id] = true
	}
	return c, nil
}

func (c *Client) Configured() bool { return c.base != "" && c.token != "" }
func (c *Client) Allowed() []string {
	ids := []string{}
	for id := range c.allowed {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}

func (c *Client) request(ctx context.Context, method, path string, input any, output any) error {
	if !c.Configured() {
		return fmt.Errorf("请先在本地环境变量中配置 HA 地址及 Token")
	}
	if err := ctx.Err(); err != nil {
		return fmt.Errorf("请求已取消，未发起新的 HA 操作")
	}
	var body io.Reader
	if input != nil {
		b, err := json.Marshal(input)
		if err != nil {
			return err
		}
		body = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.base+path, body)
	if err != nil {
		return fmt.Errorf("HA 请求无效")
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		if method == "POST" {
			return fmt.Errorf("HA 操作结果未知：连接中断或超时，请检查设备状态，勿自动重试")
		}
		return fmt.Errorf("无法连接 HA，请检查本地网络及地址")
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("HA 返回 HTTP %d，请检查授权或设备状态", resp.StatusCode)
	}
	if output != nil {
		b, err := io.ReadAll(io.LimitReader(resp.Body, (2<<20)+1))
		if err != nil || len(b) > 2<<20 {
			return fmt.Errorf("HA 响应读取失败或超出限制")
		}
		if err := json.Unmarshal(b, output); err != nil {
			return fmt.Errorf("HA 响应格式无效")
		}
	}
	return nil
}

type State struct {
	EntityID   string         `json:"entity_id"`
	State      string         `json:"state"`
	Attributes map[string]any `json:"attributes"`
}

func sanitize(state State) State {
	attrs := map[string]any{}
	for _, key := range []string{"friendly_name", "unit_of_measurement", "device_class", "icon", "supported_features", "supported_color_modes", "brightness", "rgb_color", "rgbw_color", "rgbww_color", "color_mode", "color_temp_kelvin", "min_color_temp_kelvin", "max_color_temp_kelvin", "temperature", "current_temperature", "hvac_action"} {
		if value, ok := state.Attributes[key]; ok {
			attrs[key] = value
		}
	}
	state.Attributes = attrs
	return state
}

func (c *Client) States(ctx context.Context) ([]State, error) {
	states := []State{}
	// Fetch only explicitly authorized entities. Do not read the entire household.
	for _, id := range c.Allowed() {
		var state State
		if err := c.request(ctx, "GET", "/api/states/"+id, nil, &state); err != nil {
			return nil, err
		}
		if state.EntityID != id {
			return nil, fmt.Errorf("HA 返回了不匹配的设备标识")
		}
		states = append(states, sanitize(state))
	}
	return states, nil
}

func (c *Client) Check(ctx context.Context) error { return c.request(ctx, "GET", "/api/", nil, nil) }

type Control struct {
	EntityID string         `json:"entity_id"`
	Action   string         `json:"action"`
	Params   map[string]any `json:"params,omitempty"`
}

func (c *Client) Control(ctx context.Context, args Control) (any, error) {
	if !EntityPattern.MatchString(args.EntityID) || !c.allowed[args.EntityID] {
		return nil, fmt.Errorf("设备未在本地实体白名单中授权")
	}
	domain := strings.SplitN(args.EntityID, ".", 2)[0]
	if (domain != "light" && domain != "switch" && domain != "input_boolean") || (args.Action != "turn_on" && args.Action != "turn_off") {
		return nil, fmt.Errorf("初版仅支持 light、switch、input_boolean 的 turn_on / turn_off")
	}
	payload := map[string]any{"entity_id": args.EntityID}
	for key, value := range args.Params {
		if domain != "light" || args.Action != "turn_on" || !validLightParam(key, value) {
			return nil, fmt.Errorf("参数未授权或超出允许的灯光参数范围")
		}
		payload[key] = value
	}
	if err := c.request(ctx, "POST", "/api/services/"+domain+"/"+args.Action, payload, nil); err != nil {
		return nil, err
	}
	// A service acknowledgement is not evidence of the physical state.
	var state State
	if err := c.request(ctx, "GET", "/api/states/"+args.EntityID, nil, &state); err != nil {
		return map[string]any{"accepted": true, "state_verified": false, "warning": "HA 已接受操作，状态回读失败"}, nil
	}
	if state.EntityID != args.EntityID {
		return map[string]any{"accepted": true, "state_verified": false}, nil
	}
	return map[string]any{"accepted": true, "state_verified": true, "observed_state": sanitize(state)}, nil
}

// Match the reused UI's light controls without permitting arbitrary HA parameters.
func validLightParam(key string, value any) bool {
	integer := func(value any, min, max float64) bool {
		n, ok := value.(float64)
		return ok && n >= min && n <= max && n == float64(int(n))
	}
	switch key {
	case "brightness", "white":
		return integer(value, 0, 255)
	case "brightness_pct":
		return integer(value, 0, 100)
	case "color_temp_kelvin":
		return integer(value, 1000, 40000)
	case "rgb_color", "rgbw_color", "rgbww_color":
		channels, ok := value.([]any)
		length := map[string]int{"rgb_color": 3, "rgbw_color": 4, "rgbww_color": 5}[key]
		if !ok || len(channels) != length {
			return false
		}
		for _, channel := range channels {
			if !integer(channel, 0, 255) {
				return false
			}
		}
		return true
	}
	return false
}

func decodeStrict(raw []byte, target any) error {
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if err := d.Decode(target); err != nil {
		return err
	}
	if d.Decode(new(any)) != io.EOF {
		return fmt.Errorf("trailing JSON")
	}
	return nil
}

func (c *Client) Execute(ctx context.Context, call protocol.ToolCall) protocol.ToolResult {
	out := protocol.ToolResult{ID: call.ID}
	var data any
	var err error
	switch call.Name {
	case "list_devices", "get_home_status":
		var args struct{}
		if err = decodeStrict(call.Arguments, &args); err == nil {
			data, err = c.States(ctx)
		}
	case "control_device":
		var args Control
		if err = decodeStrict(call.Arguments, &args); err == nil {
			data, err = c.Control(ctx, args)
		}
	default:
		err = fmt.Errorf("本地不支持该工具")
	}
	if err != nil {
		out.Error = err.Error()
		return out
	}
	out.Data, err = json.Marshal(data)
	if err != nil {
		out.Error = "工具结果编码失败"
		return out
	}
	out.OK = true
	return out
}
