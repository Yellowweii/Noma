# Noma Local 远程工具协议 v1（提案）

**状态：Public 本地侧已实现；当前 Noma Private 尚未实现这些 Local 端点。**

所有云端请求都由本地后端发起，经 HTTPS 连接固定配置的 cloud origin。不向云端发送 HA URL、HA Token 或本地访问密钥。不接受云端指示的新工具地址。浏览器只访问本地同源服务。

## 已有认证接口

- `POST /api/v1/auth/otp/send`，body `{ "email": "..." }`。
- `POST /api/v1/auth/otp/verify`，body `{ "email": "...", "code": "123456" }`。
- 登录返回 `{ "access_token": "...", "expires_in": 900 }`，通过 `Set-Cookie` 返回 `noma_refresh_token`。
- `POST /api/v1/auth/refresh` 使用本地后端持有的 refresh Cookie；`POST /api/v1/auth/logout` 撤销该 Cookie。
- 后续 Local API 使用 `Authorization: Bearer <Noma access token>`。浏览器只收到本地 HttpOnly / SameSite=Strict 会话 Cookie，不收到云端 token。
- 原前端登录入口已复用，增加手机验证码及 Clerk exchange 代理；云端 Token 留在后端。Clerk 仍需配置本地回调和允许来源，不能复用云端网站 Cookie 或要求用户粘贴访问令牌。

## 原前端兼容层

浏览器仍请求原 `/api/v1` 路径，本地网关维护方法 / 路径白名单：账号、记忆和会话管理转发云端，`/home/*` 与 `/ha/*` 由本地处理。HA 授权 / FRP 设置不转发云端。

账号登录 / refresh 响应中的 `access_token` 替换为 `noma-local-cookie-session` 标记，不是云端 JWT，不能脱离本地 HttpOnly Cookie 使用。云端登录无需本地密钥，登录成功创建仅持有该账号凭证的浏览器会话；`POST /api/local/unlock` 校验本地密钥后给当前会话追加 HA 权限，保留云端登录身份。账号退出清除后端云端凭证，保留家庭授权状态；`/api/local/auth/logout` 可进一步锁定实例。

`GET /api/local/status` 无需登录，未授权时仅返回 `ha_authorized: false` 和 `logged_in`，不返回 HA 地址或实体列表。未授权会话的 `/home/status`、`/ha/connections` 只返回未连接状态，`/settings` 隐藏设备授权列表；设备读取、控制、Local 工具轮次均拒绝。游客聊天及额度、语音白名单接口不需要本地会话，仍执行同源与 Host 校验，且沿用云端签名匿名额度 Cookie。

未授权设备的登录用户发送消息时，仅调用下述专用纯聊天接口。云端缺失接口时返回明确的 503 提示使用游客聊天；不转发旧 `/chat/.../messages` 以绕回云端 HA 执行。

### 登录后的纯聊天（云端待实现）

`POST /api/v1/local/chat/sessions/{session_id}/messages`，使用后端持有的云端 Bearer 凭证，body 为 `{ "content": "你好", "request_id": "...", "regenerate": false, "replace_assistant_id": "..." }`。网关校验消息长度和请求 / 会话 ID，仅发送这些字段，不转发查询参数、本地 Cookie、HA 地址、实体或密钥。

云端必须沿用账号归属、额度、历史、记忆和 SSE `meta` / `token` / `done` 事件，同时禁止 HA Client 注入、默认 HA Client 回退、设备目录 / 状态读取与设备工具执行。仅令请求中的 HA 指针为空不足以保证此边界。`request_id` 用于纯聊天请求去重，重生成保持原消息归属校验。此接口不得根据消息文本或查询参数重新开启设备工具。

本地只透传此接口的 SSE 正文和状态码，不向浏览器转发云端账号 Cookie。404 / 405 / 501 映射为 503 并提示使用游客聊天；429 及其额度响应保留，不重试写请求，也不回退到旧聊天或云端 HA 路径。当前 Public 已实现此适配和模拟云端往返测试，Private 实现与生产部署需要单独进行。

原消息发送路径适配下述 Local turn 协议，本地工具循环完成后返回 SSE `meta` / `token` / `done` 事件。当前最终回复一次返回，非逐 token 输出。支持传递 `regenerate` / `replace_assistant_id`，云端需要保持原重生成规则；最终 turn 响应可附带 `message_id` / `assistant_message_id`，供原页面与记忆回写状态关联。

匿名体验沿用原云端 `/guest/*`，仅转发签名匿名额度 Cookie `noma_guest_id`。账号 Cookie / JWT 不转发浏览器。TTS / STT 保留原入口并由云端提供，真实语音流程尚未联调。

## 1. 能力探测

`GET /api/v1/local/capabilities`（需认证）

```json
{ "protocol_version": "1", "remote_tools": true }
```

未实现、版本不匹配、返回 HTML 或 `remote_tools=false` 均停止；不降级到云端 HA 执行接口。

## 2. 发起一轮对话

`POST /api/v1/local/turns`

```json
{
  "protocol_version": "1",
  "request_id": "a-random-request-id-at-least-16-chars",
  "session_id": "existing-cloud-session-id-optional",
  "message": "打开客厅灯"
}
```

新会话省略 `session_id`。云端校验订阅 / 额度、读取属于该用户的历史与记忆，并创建本轮状态。

若需本地工具，返回：

```json
{
  "protocol_version": "1",
  "request_id": "a-random-request-id-at-least-16-chars",
  "session_id": "cloud-session-id-at-least-16-chars",
  "turn_id": "cloud-turn-id-at-least-16-chars",
  "tool_calls": [{
    "id": "unique-tool-call-id-at-least-16-chars",
    "name": "control_device",
    "arguments": { "entity_id": "light.living_room", "action": "turn_on", "params": { "brightness": 180 } },
    "expires_at": "2026-10-18T10:00:30Z"
  }]
}
```

示例时间仅展示 RFC3339 格式；实际值应为服务端当前时间之后、不超过两分钟。每批所有工具调用 ID 必须唯一。本地校验整个批次后按顺序执行；已执行同 ID 则复用缓存，参数改变则中断。

所有请求 / 会话 / turn / tool ID 均为 16–80 位 ASCII 字母、数字、下划线或连字符，UUID 可用。同一轮所有响应保持 `request_id`、`session_id`、`turn_id` 不变。

## 3. 回传工具结果

`POST /api/v1/local/turns/{turn_id}/results`

```json
{
  "protocol_version": "1",
  "request_id": "a-random-request-id-at-least-16-chars",
  "session_id": "cloud-session-id-at-least-16-chars",
  "tool_results": [{
    "id": "unique-tool-call-id-at-least-16-chars",
    "ok": true,
    "data": {
      "accepted": true,
      "state_verified": true,
      "observed_state": { "entity_id": "light.living_room", "state": "on", "attributes": { "brightness": 180 } }
    }
  }]
}
```

失败结果为 `{ "id": "...", "ok": false, "error": "..." }`。HA POST 超时 / 连接断开表示**结果未知**，已执行的结果必须回传给云端，不自动重试。状态回读失败可返回 `accepted=true, state_verified=false`；`state_verified=true` 仅表示已读取实际状态，不能推导状态一定符合目标，云端应检查 `observed_state`。

云端必须验证结果属于当前用户、家庭、会话、未完成 turn 和已下发调用 ID，拒绝重复冲突结果、过期 turn、额外调用 ID 和超大 payload。结果是用户可修改的外部数据，不能作为免额度、越权或系统提示指令。

云端在相同响应结构中返回下一批 `tool_calls`，或返回最终 `reply`：

```json
{
  "protocol_version": "1",
  "request_id": "a-random-request-id-at-least-16-chars",
  "session_id": "cloud-session-id-at-least-16-chars",
  "turn_id": "cloud-turn-id-at-least-16-chars",
  "reply": "客厅灯当前已打开。"
}
```

`reply` 与非空 `tool_calls` 互斥。初版使用非流式 JSON 往返；以后增加 SSE 需显式协商协议。

## 本地开放工具

| name | arguments | 结果 |
| --- | --- | --- |
| `list_devices` | `{}` | 精确实体白名单内的 HA 状态数组 |
| `get_home_status` | `{}` | 同样仅返回授权实体状态，尚无完整家庭画像 / 在家判定 |
| `control_device` | `{entity_id, action, params?}` | 服务接受情况及状态回读 |

只提供授权实体及经过白名单筛选的名称、单位、设备类型、灯光能力 / 颜色 / 亮度、温度等属性。不支持任意 REST、template、script、URL、shell 或执行代码。控制仅支持 light / switch / input_boolean 的 turn_on / turn_off；light.turn_on 可用 brightness（0–255）、brightness_pct（0–100）、white（0–255）、rgb_color / rgbw_color / rgbww_color（3 / 4 / 5 个 0–255 整数通道）、color_temp_kelvin（1000–40000 整数）。实际硬件能力由 HA 校验。旧 Private 工具输出需要适配 v1 结构。

云端应通过 `list_devices` 取得可用实体，不能假定 Local 用户的设备目录与云端 FRP 配置一致。无工具的普通对话也通过 Local turn API，使会话与额度规则统一。

## 生命周期、幂等与限制

- 本地浏览器为每次用户提交生成随机 `request_id`；自动重试关闭。
- 本地缓存同一登录会话内 128 个请求（包含错误），相同 ID 不同消息 / session 返回 409；同 ID 同内容返回已存结果。
- 同一轮工具调用按 ID 去重，最多 16 个不同工具，最多 8 个云端批次响应。每个 HA HTTP 请求超时 10 秒，云端 HTTP 90 秒，整体 turn 150 秒。
- 当前缓存仅内存，重启会失去执行记录。生产不能依赖此版实现跨崩溃“恰好一次”。应补充持久化执行日志、结果重交与过期 turn 回收；恢复时先查询状态，禁止盲目重新控制。
- 云端同样需要以 user / instance / request_id 绑定 turn，确保重复发起不产生两轮 Agent、重复扣费或重下发操作。当前协议只通过用户凭证隔离实例；独立家庭设备绑定和撤销能力为后续生产工作。
- 用户断开后停止新工具调用，但已发送到 HA 的操作可能已经执行。错误信息不可被解释为设备操作没有发生。
- 云端维持现有记忆、对话落库和用量规则；只在实际工具结果返回后记录执行证据。
