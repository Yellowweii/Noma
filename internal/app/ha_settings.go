package app

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"

	"noma.local/public/internal/ha"
)

// A token is accepted once over the same-origin authenticated setup route. It is
// never put in a response, a cloud request, or an error/log message.
func (s *Server) configureHA(ctx context.Context, w http.ResponseWriter, r *http.Request, sess *session) {
	if r.URL.RawQuery != "" {
		fail(w, 400, "HA 配置仅接受 JSON 请求体")
		return
	}
	var input *struct {
		URL      *string   `json:"ha_url"`
		Token    string    `json:"ha_token"`
		Entities *[]string `json:"allowed_entities"`
	}
	if !decode(w, r, &input) {
		return
	}
	if input == nil {
		fail(w, 400, "请提交 HA 配置对象")
		return
	}
	s.haMu.Lock()
	defer s.haMu.Unlock()
	base, token, entities := s.cfg.HAURL, s.cfg.HAToken, []string{"*"}
	if input.URL != nil {
		base = strings.TrimRight(strings.TrimSpace(*input.URL), "/")
	}
	if base == "" {
		base = env("NOMA_HA_URL", DefaultHAURL)
	}
	if err := validateURL(base, true); err != nil {
		fail(w, 400, "请输入有效的 HA 地址，不要包含用户名、密码、路径或查询参数")
		return
	}
	if input.Token != "" {
		token = strings.TrimSpace(input.Token)
	}
	if token == "" || len(token) > 8192 || strings.ContainsAny(token, "\r\n\t ") {
		fail(w, 400, "请填写有效的 HA 长期访问令牌")
		return
	}
	if input.Entities != nil {
		entities = *input.Entities
	}
	if len(entities) > 2048 {
		fail(w, 400, "授权设备数量超出限制")
		return
	}
	client, err := ha.New(base, token, entities)
	if err != nil {
		fail(w, 400, "HA 实体白名单格式无效")
		return
	}
	if err = client.Check(ctx); err != nil {
		fail(w, 502, err.Error())
		return
	}
	changed := base != s.cfg.HAURL || token != s.cfg.HAToken || strings.Join(client.Allowed(), "\n") != strings.Join(s.ha.Allowed(), "\n")
	connectedAt := time.Now().UTC()
	if err := updateLocalConfig(s.cfg.path, map[string]any{"ha_url": base, "ha_token": token, "allowed_entities": client.Allowed(), "home_name": s.homeName(), "ha_connected_at": connectedAt}); err != nil {
		fail(w, 500, "无法保存本地 HA 配置，请检查后端数据目录权限")
		return
	}
	if changed {
		s.cfg.HAURL, s.cfg.HAToken, s.cfg.AllowedEntities = base, token, client.Allowed()
		s.ha = client
		s.haRevision++
	}
	s.cfg.HAConnectedAt = connectedAt
	previousAuthorized, previousGrant, previousRevision := sess.haAuthorized, sess.haGrant, sess.haRevision
	sess.haAuthorized, sess.haRevision = true, s.haRevision
	sess.haGrant = s.haGrantFingerprint()
	if err := s.bindSessionPersistence(sess); err != nil {
		sess.haAuthorized, sess.haGrant, sess.haRevision = previousAuthorized, previousGrant, previousRevision
		fail(w, 500, "HA 配置已保存，但无法保存本地设备授权，请检查后端数据目录权限")
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true, "ha_authorized": true, "ha_configured": true, "ha_url": base, "allowed_entities": client.Allowed(), "home_name": s.homeName(), "last_connected_at": connectedAt})
}

func (s *Server) homeName() string {
	if name := strings.TrimSpace(s.cfg.HomeName); name != "" {
		return name
	}
	return "我的家"
}

func (s *Server) saveHomeName(w http.ResponseWriter, r *http.Request, sess *session) {
	s.haMu.Lock()
	defer s.haMu.Unlock()
	if !sess.haAuthorized || sess.haRevision != s.haRevision || sess.haGrant != s.haGrantFingerprint() {
		fail(w, 403, "请先连接 Home Assistant")
		return
	}
	var input *struct {
		HomeName string `json:"home_name"`
	}
	if r.URL.RawQuery != "" {
		fail(w, 400, "家庭名称仅接受 JSON 请求体")
		return
	}
	if !decode(w, r, &input) {
		return
	}
	if input == nil {
		fail(w, 400, "请填写家庭名称")
		return
	}
	name := strings.TrimSpace(input.HomeName)
	if name == "" || !utf8.ValidString(name) || utf8.RuneCountInString(name) > 80 {
		fail(w, 400, "家庭名称需为 1–80 个字符")
		return
	}
	if err := updateLocalConfig(s.cfg.path, map[string]any{"home_name": name}); err != nil {
		fail(w, 500, "无法保存家庭名称，请检查后端数据目录权限")
		return
	}
	s.cfg.HomeName = name
	writeJSON(w, 200, map[string]any{"ok": true, "home_name": name})
}

// Update only household settings, preserving existing deployment overrides.
// Rename a closed, private temporary file so a failed save keeps the old config.
func saveHAConfig(path, base, token string, entities []string) error {
	return updateLocalConfig(path, map[string]any{"ha_url": base, "ha_token": token, "allowed_entities": entities})
}

func updateLocalConfig(path string, updates map[string]any) error {
	fields := map[string]json.RawMessage{}
	if data, err := os.ReadFile(path); err == nil {
		if len(data) > 64<<10 || json.Unmarshal(data, &fields) != nil || fields == nil {
			return fmt.Errorf("invalid config")
		}
	} else if !os.IsNotExist(err) {
		return err
	}
	for key, value := range updates {
		fields[key], _ = json.Marshal(value)
	}
	data, err := json.MarshalIndent(fields, "", "  ")
	if err != nil || len(data) > 64<<10 {
		return fmt.Errorf("config too large")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(path), ".local-*.tmp")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if _, err = f.Write(append(data, '\n')); err != nil {
		f.Close()
		return err
	}
	if err = f.Sync(); err != nil {
		f.Close()
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}
	return os.Rename(f.Name(), path)
}
