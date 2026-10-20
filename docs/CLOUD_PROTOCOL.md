# Noma Local 远程工具协议 v1（提案）

**状态：Public 本地侧及 Private 云端 Local 聊天、能力探测和工具往返均已实现并发布。2026-10-20 真实账号纯聊天及本地只读工具对话生产验收通过；设备写操作使用隔离模拟 HA 验证。**

所有云端请求都由本地后端发起，经 HTTPS 连接固定配置的 cloud origin。不向云端发送 HA URL 或 HA Token。不接受云端指示的新工具地址。浏览器只访问本地同源服务。

## 已有认证接口

- `POST /api/v1/auth/otp/send`，body `{ "email": "..." }`。
- `POST /api/v1/auth/otp/verify`，body `{ "email": "...", "code": "123456" }`。
- 登录返回 `{ "access_token": "...", "expires_in": 900 }`，通过 `Set-Cookie` 返回 `noma_refresh_token`。
- `POST /api/v1/auth/refresh` 使用本地后端持有的 refresh Cookie；`POST /api/v1/auth/logout` 撤销该 Cookie。
- 后续 Local API 使用 `Authorization: Bearer <Noma access token>`。浏览器只收到本地 HttpOnly 会话 Cookie（验证码登录为 SameSite=Strict，Google 顶层回跳为 SameSite=Lax），不收到云端 token。
- 邮箱和手机验证码仍由本地后端代发。Google 登录不在本地初始化 Clerk，也不传递 Clerk Session Token。浏览器跳到固定云端来源完成登录，本地后端再用一次性授权码兑换 Noma 访问凭证。云端 Token 留在后端。

### 官网授权登录

本地 `GET /api/local/auth/google?next=/agent` 只接受本机发起的请求。它生成 `state` 与 PKCE `code_verifier`，把 `state` 放进仅用于 `/login/cloud-callback` 的 HttpOnly、SameSite=Lax Cookie，然后 302 到：

`GET {cloud}/local/authorize?response_type=code&client_id=noma-local&redirect_uri={本地}/login/cloud-callback&state=...&code_challenge=...&code_challenge_method=S256`

`redirect_uri` 由本地根据当前 Host 生成，路径固定为 `/login/cloud-callback`。`next` 只保存在本地，不发给云端。没有客户端密钥。

云端页面在 `https://noma-ai.cloud` 上完成 Clerk 登录，并让用户选择账号。授权码一次性、最长两分钟，绑定该用户、`redirect_uri`、`code_challenge` 和 `client_id=noma-local`。回跳只携带 `code` 与 `state`，或 `error` 与 `state`。不回传 Clerk Session Token、访问令牌或云端 Cookie。`redirect_uri` 必须是 loopback、localhost 或私网地址，路径恰好为 `/login/cloud-callback`，不能带用户信息、查询或片段。

官网授权页复用既有 Google 账号选择，使用专用 `/local/callback` 回调原地接续本地授权，不经过官网 `/login/complete` 或游客记录导入。Google 返回后的回调确认、账号身份同步和授权码签发统一显示现有登录进度页的“正在同步你的信息”阶段，官网回调原地完成账号身份同步与授权码签发，不再次打开官网授权页。仅在授权成功且本地回调地址校验通过后，同一同步页进入 100% 完成态，显示“账号信息同步完成”；完成态绘制后停留约一秒（含进度条动画），再回到 Local。失败不显示完成态。Local 后端完成授权码兑换、创建 HttpOnly 会话后直接跳转原始目标（默认 `/agent`），不再经过本地 `/login/complete` 或重复展示同步进度。OAuth 会话 Cookie 使用 SameSite=Lax，以便顶层跨站回跳链能携带会话；写 API 仍强制同源 Origin。受保护页面由网关验证会话后直接渲染应用，在后台恢复浏览器的会话标记；Google 登录仍设置既有新对话意图，并用短期 `noma.freshLogin` 提示在客户端首次恢复对话前清理旧会话选择，消费后删除；该提示不参与鉴权。打开 Google 前不显示登录完成进度，不使用弹窗，也不展示独立的品牌中转等待页。授权前用刚选中的 Clerk 账号建立云端身份，再仅在官网使用云端 access token 调用 `POST /api/v1/local/oauth/authorize`；请求 JSON 包含上述六个授权参数。接口校验登录身份、固定客户端、回调地址、state 和 S256 challenge，返回 `{ "redirect_url": "{本地}/login/cloud-callback?code=...&state=..." }`。失败时保留错误和重试入口。该接口不由本地网关代理，也不把云端登录凭证传给本地浏览器。授权码摘要作为 Redis key，授权记录两分钟过期；兑换时原子消费，禁止并发重复兑换。

官网在建立刚选中的 Clerk 身份时，向云端 `/api/v1/auth/clerk` 附带当前用户的 `name` / `avatar_url` 显示资料，签名凭证中的 `name` / `picture` 优先。账号身份和邮箱仍只取验证后的 JWT；这些显示字段不能更改身份绑定。云端在首次绑定及后续 Google 登录时补全默认昵称、缺失头像，保留自定义资料。同步完成后，下面的兑换和 `/api/v1/me` 均读取同一账号资料；Public 不另存用户资料。

本地校验 Cookie 中的 `state` 后，由后端调用：

`POST /api/v1/local/oauth/token`

```json
{
  "grant_type": "authorization_code",
  "code": "one-time-code",
  "redirect_uri": "http://127.0.0.1:3100/login/cloud-callback",
  "client_id": "noma-local",
  "code_verifier": "pkce-verifier"
}
```

成功响应与验证码登录相同：`access_token`、`expires_in`、`user_id`，以及 `Set-Cookie: noma_refresh_token`。云端必须校验 S256 PKCE、精确的 `redirect_uri`，并拒绝重复使用的授权码。本地随后只给浏览器建立现有 HttpOnly 会话。

## 原前端兼容层

浏览器仍请求原 `/api/v1` 路径，本地网关维护方法 / 路径白名单：账号、记忆和会话管理转发云端，`/home/*` 与 `/ha/*` 由本地处理。HA 授权 / FRP 设置不转发云端。

账号登录 / refresh 响应中的 `access_token` 替换为 `noma-local-cookie-session` 标记，不是云端 JWT，不能脱离本地 HttpOnly Cookie 使用。本地不再使用访问密钥，登录成功创建仅持有该账号凭证的浏览器会话；已登录后 `POST /api/local/ha/authorize`（JSON body `{}`，同源请求）给当前会话启用 HA 权限，保留云端登录身份。`/api/v1/auth/logout` 与 `/api/local/auth/logout` 均删除持久化会话、清除 Cookie，并撤销当前浏览器的设备授权。

本地 Cookie 与服务端会话空闲有效期为 30 天，活动会话最多每天续期一次，Cookie 与持久化到期时间同步更新。配置文件同目录的 `sessions/`（默认 `data/sessions/`，Docker 为 `/data/sessions/`）以会话 ID 的 SHA-256 摘要命名，保存云端来源、用户 ID、到期时间、云端 access / refresh 凭证及 access 到期时间，权限为 0600，目录权限为 0700；不保存账号资料、HA Token、消息正文或工具结果。重启后复用尚有效的 access token，临近到期才用 refresh 换取新凭证；轮换后先原子保存再返回成功，存储失败不宣称登录 / 续期成功。切换云端或到期的会话不会恢复。云端明确以 401 拒绝刷新时撤销本地会话；网络异常、429 和 5xx 保留登录状态并返回错误，不跳转登录或自动重试写操作。

会话还保存 HA 配置摘要形式的设备授权及请求去重摘要。授权只在 HA 地址、令牌和授权实体范围均未变化时恢复；退出 / 切换账号撤销授权。旧版未保存设备授权的会话仍需主动连接一次，不因本地已有 HA 配置而给所有登录用户自动授权。

成功刷新响应中清除旧路径 Cookie 的空值不会覆盖现有续期凭证；仅接收非空且未被删除的新 refresh Cookie。启动时空或无效续期凭证记录不恢复登录，也不阻止其他会话和本地网关启动。

本地实例不提供游客访问。未登录业务 API（含 `/api/local/status`、设备授权接口）返回 401；`/guest/*` 和 `/chat/import` 即使登录后也不转发云端。仅云端验证码 / 登录 / refresh 等认证入口和健康检查允许在登录前调用，同源与 Host 校验始终生效。页面除登录与回调、法律条款和必要静态资源外，未登录均跳转 `/login?next=...`，原始目标路径保留用于登录后恢复。

已登录但未授权设备时，`GET /api/local/status` 仅返回 `ha_authorized: false` 和 `logged_in: true`，不返回 HA 地址或实体列表。`/home/status`、`/ha/connections` 只返回未连接状态，`/settings` 隐藏设备授权列表；设备读取、控制、Local 工具轮次均拒绝。退出登录或重新登录 / 切换账号立即撤销设备权限，后续身份不得继承此前授权。

`GET /api/v1/home/devices` 默认只返回家页面可展示的家庭控制实体，以及按 `device_class` 筛选的常用环境 / 安防传感器。备份、太阳时间、手机遥测及可识别的诊断 / 配置 / 隐藏实体不进入默认目录；设备关闭、离线或传感器数值为零不影响可见性。`?include_sensors=true` 返回页面支持的实体候选，并以 `home_visible` 标记默认可见性；传感器仍不提供写操作。`/home/status` 的摘要采用相同可见性规则。筛选沿用原前端显示标记，在本地 HA 适配层实现，不改变执行器的实体 / 服务白名单或 Local 工具协议的读取范围；分类元数据不加入工具状态输出。

本地 `/home/devices` 另返回 `room`、`area_id`、`device_id`，供原页面按 HA 区域分组及统计设备；`/home/status.device_summary` 同步提供 `room`。区域优先使用实体覆盖配置，其次继承设备及父设备区域；没有区域的设备保留在未分配区域。元数据通过配置的同一个 HA 地址的 `/api/websocket` 获取，仅允许固定只读命令 `config/area_registry/list`、`config/device_registry/list`、`config/entity_registry/list`，服务端在认证消息中使用本地 HA Token，不向浏览器或云端返回登记目录或 Token。禁止跟随重定向；登记信息缓存一分钟，失败保留旧值并退避 30 秒，实时设备状态仍从 REST 读取。手机集成、诊断 / 配置 / 隐藏实体和功率、电量、电流、电压读数不作为默认独立卡片；候选查询仍用 `home_visible` 标识。此元数据不改变下方 Local 工具请求 / 响应协议。

连接页及家页面先读账号隔离的浏览器缓存，再异步刷新；连接监测和打开的家页面每 10 秒读取一次。设备列表缓存仅保存在当前标签页 sessionStorage，最长 24 小时；不保存 HA 凭证。明确离线结果覆盖旧在线状态，暂时网络失败保留最近数据。进行中的名称保存与设备控制不会被旧刷新响应覆盖，写操作不因监测而重试。

未授权设备的登录用户发送消息时，仅调用下述专用纯聊天接口。云端缺失接口时返回明确的 503 提示部署管理员完成云端对接；不提供游客回退，也不转发旧 `/chat/.../messages` 以绕回云端 HA 执行。

### 登录后的纯聊天

`POST /api/v1/local/chat/sessions/{session_id}/messages`，使用后端持有的云端 Bearer 凭证，body 为 `{ "content": "你好", "request_id": "...", "regenerate": false, "replace_assistant_id": "..." }`。网关校验消息长度和请求 / 会话 ID，仅发送这些字段，不转发查询参数、本地 Cookie、HA 地址、实体或 Token。

云端必须沿用账号归属、额度、历史、记忆和 SSE `meta` / `token` / `done` 事件，同时禁止 HA Client 注入、默认 HA Client 回退、设备目录 / 状态读取与设备工具执行。仅令请求中的 HA 指针为空不足以保证此边界。`request_id` 用于纯聊天请求去重，重生成保持原消息归属校验。此接口不得根据消息文本或查询参数重新开启设备工具。

本地只透传此接口的 SSE 正文和状态码，不向浏览器转发云端账号 Cookie。404 / 405 / 501 映射为 503 并提示完成云端对接；429 及其额度响应保留，不重试写请求，也不回退到旧聊天或云端 HA 路径。两侧已实现该路径，云端复用登录用户的 Agent、个人记忆和历史流程，显式禁用规则中的设备路径、HA 默认连接回退、家庭记忆召回和设备执行。当前回复以完整文本的单个 token 事件发出，保留 meta / done 和消息 ID。

原消息发送路径适配下述 Local turn 协议，本地工具循环完成后返回 SSE `meta` / `token` / `done` 事件。当前最终回复一次返回，非逐 token 输出。支持传递 `regenerate` / `replace_assistant_id`，云端需要保持原重生成规则；最终 turn 响应可附带 `message_id` / `assistant_message_id`，供原页面与记忆回写状态关联。

不转发匿名额度 Cookie `noma_guest_id`，不读写游客聊天存储或自动导入游客历史。账号 Cookie / JWT 不转发浏览器。登录用户的 TTS / STT 保留原入口并由云端提供，真实语音流程尚未联调。

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
| `list_devices` | `{}` | 授权范围内的 HA 状态数组，默认全部实体 |
| `get_home_status` | `{}` | 同样仅返回授权实体状态，尚无完整家庭画像 / 在家判定 |
| `control_device` | `{entity_id, action, params?}` | 服务接受情况及状态回读 |

只提供授权实体及经过白名单筛选的名称、单位、设备类型、灯光能力 / 颜色 / 亮度、温度等属性。不支持任意 REST、template、script、URL、shell 或执行代码。控制仅支持 light / switch / input_boolean 的 turn_on / turn_off；light.turn_on 可用 brightness（0–255）、brightness_pct（0–100）、white（0–255）、rgb_color / rgbw_color / rgbww_color（3 / 4 / 5 个 0–255 整数通道）、color_temp_kelvin（1000–40000 整数）。实际硬件能力由 HA 校验。旧 Private 工具输出需要适配 v1 结构。

云端应通过 `list_devices` 取得可用实体，不能假定 Local 用户的设备目录与云端 FRP 配置一致。无工具的普通对话也通过 Local turn API，使会话与额度规则统一。

## 生命周期、幂等与限制

- 本地浏览器为每次用户提交生成随机 `request_id`；自动重试关闭。
- 本地缓存同一登录会话内 128 个请求（包含错误），相同 ID 不同消息 / session 返回 409；同 ID 同内容返回已存结果。
- 同一轮工具调用按 ID 去重，最多 16 个不同工具，最多 8 个云端批次响应。每个 HA HTTP 请求超时 10 秒，云端 HTTP 90 秒，整体 turn 150 秒。
- 在发起 Local turn 前，先持久化 `request_id` 与规范请求体的 SHA-256 摘要；保存失败不开始新操作。重启后，相同 ID / 内容返回 409 并明确提示结果无法恢复、先检查设备状态，不重发操作；同 ID 不同内容仍为 409。完整响应与单轮工具结果只在内存缓存，不能依赖此版实现跨崩溃“恰好一次”；生产仍需结果重交、实例 / 家庭绑定与过期 turn 回收。
- 云端同样需要以 user / instance / request_id 绑定 turn，确保重复发起不产生两轮 Agent、重复扣费或重下发操作。当前协议只通过用户凭证隔离实例；独立家庭设备绑定和撤销能力为后续生产工作。
- 用户断开后停止新工具调用，但已发送到 HA 的操作可能已经执行。错误信息不可被解释为设备操作没有发生。
- 云端维持现有记忆、对话落库和用量规则；只在实际工具结果返回后记录执行证据。

### 云端 Local 执行生命周期

云端以账号和 `request_id` 在数据库中先占用请求，再扣用现有聊天额度、写入消息并启动 Agent。同 ID 不同内容 / 聊天模式返回 409；完成请求按保存的消息 ID 读取原聊天记录并重放最终响应，不重复扣额度、写消息或启动 Agent。请求日志不再复制回复正文，原消息删除后不可重放。重生成校验账号、会话、原助手消息及对应用户内容。会话被删除后不能继续该轮或重放已删除会话的回复。

Local Agent 只使用本轮的协议执行器，不读取账号保存的云端 HA 地址、Token 或实体授权。现有规划和执行流程通过内存适配器暂停并返回单个固定工具调用，收到绑定正确的结果后继续同一轮 Agent；不会转发任意 HTTP 地址或 template。v1 仅提供 light / switch / input_boolean 的开关和前述灯光参数；设备目录缓存只用于本轮，写后仅使用真实 `observed_state` 或新的本地状态读取，服务接受不等于目标状态已确认。

工具结果严格绑定账号、request / session / turn / tool ID 及有效期。同一调用的相同结果复用后续响应，冲突结果、额外调用和过期结果被拒绝。整轮最长 150 秒，单次调用最多一分钟，本实现最多七个单工具批次加最终响应，满足本地八次往返上限。

运行中的 Agent continuation 保存在单个云端进程；多副本部署需将同一 turn 路由到该进程。请求占用和最终响应存于数据库，跨进程或重启时不能恢复的未完成请求返回明确错误，不自动重新执行设备操作。完成后临时 continuation 保留五分钟用于工具结果重放；过期结果需由用户确认设备状态后发起新请求。

## 本地部署默认值

无需 `.env` 或访问密钥。默认云端 `https://noma-ai.cloud`，原生及 Docker 对外入口 `127.0.0.1:3100`。HA 原生及 Compose 默认地址均为 `http://localhost:8123`，`NOMA_HA_URL` 可覆盖默认值；明确保存的地址优先。`localhost` 指 Noma 后端所在的运行环境（Docker 中为后端容器）；HA 在其他运行环境时需填写后端可访问的 HA 局域网地址。本地后端持久化 HA 地址、Token 和实体授权范围至 `data/local.json`（Docker 为 `/data/local.json`）。旧 `/api/local/unlock` 已移除。原设备启用接口仍只接受空 JSON 对象；设置页改用下面的本地配置接口一次完成连接与启用。

### 本地 HA 设置（仅本地，不代理云端）

`GET /api/local/ha/defaults` 要求云端登录，只返回部署的默认 `ha_url`，不暴露保存的家庭配置。未启用的 `/api/local/status` 仍只返回登录及授权标记。

`POST /api/local/ha/configure` 要求有效云端登录、本地 HttpOnly 会话和同源 Origin，Content-Type 为 `application/json`，不接受查询参数。请求示例：

```json
{ "ha_token": "<用户一次性提交的 HA 长期令牌>" }
```

可选 `ha_url` 仅接受 origin URL，拒绝用户名、密码、路径、查询或片段；省略时保留现有地址。`ha_token` 省略或空字符串时复用本地已存 Token；尚未配置 Token 时返回 400。可选 `allowed_entities` 是实体 ID 数组，或单独的 `["*"]` 表示全部实体；不接受通配符与实体 ID 混用。显式 `[]` 表示不授权任何设备。

每次配置省略 `allowed_entities` 时，默认设置为 `["*"]`，包括重新连接；不再冻结首次发现的实体快照。全部实体模式在读取时请求 `/api/states`，校验实体 ID 并筛选属性，因此自动包含新增实体。控制前先校验实体 ID、服务和参数，再读取目标实体确认存在且 ID 匹配，随后只发送一次服务请求。显式实体数组仍仅逐个读取所列实体。配置文件省略或设为 null 的实体范围默认全部实体，显式空数组仍拒绝所有实体；Token 未配置或当前会话未启用时不能访问 HA。

HA 验证及配置保存失败时保留原配置，不发送设备控制请求，不重试写操作。后端保留文件中的其他部署字段，使用权限为 0600 的临时文件替换配置，成功后即时切换本地 HA Client，保存本次连接时间并持久化当前浏览器的配置绑定授权。若配置已保存而会话授权保存失败，返回明确错误，不宣称连接完成。连接或授权范围变化使其他会话在下次 API 请求时失去设备权限，需重新确认。响应包含 `ok`、`ha_authorized`、`ha_configured`、`ha_url`、`allowed_entities`、`home_name`、`last_connected_at`；永不包含 Token。

连接成功后显示原版连接状态卡片、上次连接时间及家庭名称表单。`POST /api/local/ha/name` 仅接受 `{ "home_name": "家庭名称" }`，要求有效登录、同源请求及当前 HA 配置的设备授权，不接受查询参数、空名称、超过 80 字符或未知字段。只更新配置文件的 `home_name`，保留 HA 凭证、授权范围、连接时间和其他部署字段；返回 `{ "ok": true, "home_name": "家庭名称" }`。该接口不调用云端或 HA 服务。`/api/local/status` 与 `/api/v1/ha/connections` 对已授权浏览器返回名称及上次连接时间，刷新 / 重启后可恢复连接摘要。

未登录返回 401，跨站 / 无 Origin 请求返回 403，未知字段、无效 JSON / URL / 实体返回 400。退出或切换账号撤销当前浏览器的启用状态，保存的 Token 不删除；下次点击“连接”可复用。Token 不进入 URL、浏览器存储、日志、云端请求或 Git。
