# Noma Local

**在懂你的基础上，让家庭的智能家居更好地为你服务。**

本地连接版，目录为 `Noma Public`。**直接复用 Private 的 Next.js 前端页面、组件、样式与静态资源**，本地部署前后端，通过局域网连接 Home Assistant；Agent、模型、账号、记忆和订阅继续由 Noma Cloud 提供。

```text
浏览器 → 本地 Go 网关 :3100
          ├─ 页面 / 静态资源 → 本地 noma-web（原 Noma Next.js 前端）
          ├─ 账号 / 记忆 / 会话 API → HTTPS → Noma Cloud
          └─ HA 状态 / 控制 → 局域网 Home Assistant
```

不需要 FRPC / FRPS 或额外 Connector，不部署私有 Agent、Memory OS、模型 Key 或数据库服务。

## 前端复用范围

本地部署访问根路径 `/` 直接进入 Agent 对话页 `/agent`，宣传首页及其专用代码、依赖和素材已移除；未登录时先登录，完成后进入对话页。保留原介绍、登录、对话、记忆、家庭、设置与法律页面，以及侧栏、会话列表 / 搜索 / 切换 / 排序、消息滚动、设备卡片和乐观更新等原有实现。

适配集中在连接层：

- 浏览器统一请求同源 `/api/v1`，网关按方法 / 路径白名单代理到云端或本地 HA。
- 云端 JWT / refresh Cookie 留在后端。前端原 access_token 变为会话存在标记；实际鉴权依赖本地 HttpOnly Cookie。
- 原对话发送进入 Local 工具循环，并返回原页面接收的 SSE 事件格式。当前最终文本一次返回，尚未实现逐 token 输出。
- HA 设置沿用原设置布局，连接区域改为局域网连接和云端协议检测。
- 本地实例必须先通过原登录页登录 Noma 云端账号，才可进入页面和使用 API；不提供游客模式。设备访问在设置 → Home Assistant 中由当前登录浏览器一键启用，不需要额外访问密钥。

## 当前状态

原 Next.js 页面已通过生产构建，保留的 40 项 HA 连接 / 设备控制前端测试通过。后端覆盖云端代理、原 API 形状适配、本地 HA 控制与远程工具往返。

**生产云端尚未实现 Local turn 协议，真实 AI 控制仍需云端对接。** 页面复用不代表已经完成生产联调。对话发送不会回退到云端 FRP 执行路径；账号、记忆和会话管理沿用现有云端 API。

本地版关闭 `/guest/*` 和游客历史导入，不进行匿名对话、语音或额度请求。登录后未授权设备时，消息发送调用专用云端纯聊天接口；授权后使用 Local 工具协议，不会回退到可能访问云端 HA 的旧聊天路径。两个云端接口都需要单独对接；本地侧已通过模拟云端验证，生产聊天尚未联调完成。

本地初版支持 `light`、`switch`、`input_boolean` 的 `turn_on` / `turn_off`；灯光还支持经过校验的亮度、RGB / RGBW / RGBWW、白光和色温参数。其他设备目前只提供授权状态读取；原页面按后端 `supported_actions` 展示可用操作。邮箱和手机验证码由本地后端代发。Google 登录会跳到 Noma 官网，本地后端再用授权码换取云端凭证；官网授权页与兑换接口代码已补齐，需发布云端后验证真实账号。语音流程尚未联调。

## Docker 启动

```bash
docker compose up -d --build
```

这是唯一的本地运行方式。前端容器运行 `next dev`，保存页面后通过网关热更新。后端容器轮询 `cmd`、`internal` 和 `go.mod`，Go 文件变更后重新编译并重启网关；重启会清空内存中的本地会话。无需创建 `.env`，也不需要生成访问密钥。默认云端为 `https://noma-ai.cloud`，本地仅监听 `127.0.0.1:3100`。Docker Hub 拉不到 Node 镜像时，可在 shell 中临时把 `NOMA_DEV_NODE_IMAGE` 设为可用镜像源后再构建。

访问 [http://localhost:3100](http://localhost:3100)，先登录 Noma 云端账号。其余页面和业务 API 仍要求有效登录会话；设置 → Home Assistant 中点击“启用设备访问”后，仅可访问后端白名单内的设备。Compose 启动前后端两个服务，仅网关对外映射端口。

## 可选的 HA 配置

云端地址、端口和本地 HTTP Cookie 策略都有默认值。HA 地址、Token 与设备白名单属于每个家庭，无法使用共享默认值；不连接 HA 时无需配置文件。

需要连接 HA 时，仅在本地后端创建 `data/local.json`，不要把它提交到 Git：

```json
{
  "ha_url": "http://homeassistant.local:8123",
  "ha_token": "<你的 HA 长期令牌>",
  "allowed_entities": ["light.living_room", "switch.desk"]
}
```

原生后端默认读取 `data/local.json`。Docker 后端读取持久化数据卷中的 `/data/local.json`；可先在本机准备上述文件，然后执行 `docker compose cp data/local.json noma-local:/data/local.json`、`docker compose restart noma-local`。Token 只由本地后端读取，不发送至浏览器或云端；建议限制本地文件的读取权限。空白名单不授权任何设备。

高级部署可在同一 JSON 文件中覆盖 `listen`、`cloud_url`、`web_url`、`secure_cookie`。原生监听默认 `127.0.0.1:3100`；Docker 对外绑定和映射端口在 `compose.yaml` 中修改，容器内部路由由 Compose 自动设置。手机访问需明确允许局域网绑定；所有能访问实例并登录的受信任家庭用户均可自行启用该实例的设备范围。需要本地 HTTPS 时设置 `secure_cookie: true`，代理保留 Host。当前 Host 仍仅接受 IP / localhost。

Google 登录从本机跳到 `https://noma-ai.cloud/local/authorize`，不在本地加载 Clerk，也不需要 Clerk Key。官网完成登录后带回两分钟有效的一次性授权码，只由本地后端通过 PKCE 兑换。生产 Clerk 实例因此不必把 `localhost` 加为 Web 来源。云端需部署包含官网授权页及 `/api/v1/local/oauth/authorize`、`/api/v1/local/oauth/token` 的版本。HA Token 单独保存在本地后端配置文件中，不使用共享默认凭证。

局域网 HTTP 会明文传输凭证和对话；手机录音等浏览器能力需要安全上下文，正式家庭部署建议本地 HTTPS。服务需持续运行，初版不提供离家远程访问部署方案。

## 原生开发

需要 Go 1.25+、Node.js 22.13+。Go 无第三方依赖，前端沿用原 package-lock.json。无需 `.env`；可选 HA 配置由 Go 后端读取。

终端 1 启动前端：

```powershell
cd noma-web
npm ci
npm run dev
```

终端 2 在根目录启动网关：

```powershell
go run ./cmd/noma-local
```

浏览器访问网关端口 3100，前端开发端口 3001 仅供网关访问；直接打开 Next.js 端口不具备本地 API 路由。

```text
noma-web/           复用的 Next.js 前端、原组件 / 样式 / 资源 / 测试
cmd/noma-local/     Go 网关入口
internal/app/      本地会话、原 API 适配、云端代理和工具循环
internal/cloud/    云端认证与 HTTP 客户端
internal/ha/       HA 白名单及执行器
internal/protocol/ 云端远程工具协议
docs/              协议、路线和验证记录
```

## 验证与边界

```bash
go test ./internal/... ./cmd/...
go vet ./internal/... ./cmd/...
go build ./cmd/...
cd noma-web
npm test
npm run build
```

详见 [验证记录](docs/VALIDATION.md)、[云端协议](docs/CLOUD_PROTOCOL.md)、[后续路线](docs/ROADMAP.md)。测试不发送真实验证码、不控制真实设备。

实例面向一个受信任家庭，共享本地 HA 授权范围，云端凭证按浏览器会话隔离。会话最长 8 小时，仅保存在后端内存中，重启后重新登录。退出账号同时撤销当前浏览器的 HA 授权，下次登录需重新点击启用设备访问。历史会话通过原云端 API 加载，不再读写或自动导入游客历史。

工具去重仅覆盖当前进程内同一本地会话 / request_id，每会话 128 轮，单轮 16 个不同工具、8 次云端往返。不承诺跨崩溃恰好执行一次；生产仍需持久化执行日志、实例 / 家庭绑定和恢复机制。

仅复用用户要求的前端及资源，未复制 Private 核心后端、环境文件或 Git 历史。本次经用户明确授权，仅在 Private 补齐本地 Google 授权登录及测试。公开发布前由项目所有者确定许可证与资源授权，本次未擅自选定授权条款。
