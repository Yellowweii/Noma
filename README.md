# Noma Local

**在懂你的基础上，让家庭的智能家居更好地为你服务。**

本地连接版，目录为 `Noma Public`。**直接复用 Private 的 Next.js 前端页面、组件、样式与静态资源**，本地部署前后端，通过局域网连接 Home Assistant；Agent、模型、账号、记忆和订阅继续由 Noma Cloud 提供。

```text
浏览器 → 本地 Go 网关 :3000
          ├─ 页面 / 静态资源 → 本地 noma-web（原 Noma Next.js 前端）
          ├─ 账号 / 记忆 / 会话 API → HTTPS → Noma Cloud
          └─ HA 状态 / 控制 → 局域网 Home Assistant
```

不需要 FRPC / FRPS 或额外 Connector，不部署私有 Agent、Memory OS、模型 Key 或数据库服务。

## 前端复用范围

保留原首页、介绍、登录、对话、记忆、家庭、设置与法律页面，以及侧栏、会话列表 / 搜索 / 切换 / 排序、消息滚动、设备卡片和乐观更新等原有实现。

适配集中在连接层：

- 浏览器统一请求同源 `/api/v1`，网关按方法 / 路径白名单代理到云端或本地 HA。
- 云端 JWT / refresh Cookie 留在后端。前端原 access_token 变为会话存在标记；实际鉴权依赖本地 HttpOnly Cookie。
- 原对话发送进入 Local 工具循环，并返回原页面接收的 SSE 事件格式。当前最终文本一次返回，尚未实现逐 token 输出。
- HA 设置沿用原设置布局，连接区域改为局域网连接和云端协议检测。
- 页面和游客聊天可直接使用；云端账号继续通过原登录页登录。只有查看、连接和控制本地设备时，才需要在设置 → Home Assistant 中输入本地访问密钥授权。

## 当前状态

原 Next.js 页面已通过生产构建，保留的 40 项 HA 连接 / 设备控制前端测试通过。后端覆盖云端代理、原 API 形状适配、本地 HA 控制与远程工具往返。

**生产云端尚未实现 Local turn 协议，真实 AI 控制仍需云端对接。** 页面复用不代表已经完成生产联调。对话发送不会回退到云端 FRP 执行路径；账号、记忆和会话管理沿用现有云端 API。

游客聊天沿用云端 `/guest/chat`，无需本地密钥。登录后未授权设备时，消息发送调用专用云端纯聊天接口；授权后使用 Local 工具协议，不会回退到可能访问云端 HA 的旧聊天路径。两个云端接口都需要单独对接，当前可先使用游客聊天；本地侧已通过模拟云端验证。

本地初版支持 `light`、`switch`、`input_boolean` 的 `turn_on` / `turn_off`；灯光还支持经过校验的亮度、RGB / RGBW / RGBWW、白光和色温参数。其他设备目前只提供授权状态读取；原页面按后端 `supported_actions` 展示可用操作。语音与 Clerk 登录入口已保留并提供代理，但真实流程尚未联调。

## Docker 启动

```bash
cp .env.example .env
# 设置随机 NOMA_LOCAL_ACCESS_KEY（至少24字符），填写 HA 地址、Token、允许的实体
docker compose up -d --build
```

PowerShell：`Copy-Item .env.example .env`。示例占位密钥会被拒绝。可用 `python -c "import secrets; print(secrets.token_urlsafe(32))"` 生成密钥。

访问 [http://localhost:3000](http://localhost:3000)，直接进入原 Noma 页面并使用游客聊天。需要本地设备能力时，进入设置 → Home Assistant，使用 `NOMA_LOCAL_ACCESS_KEY` 授权当前浏览器。此密钥不是云端登录密码，也不是 HA Token。Compose 启动 `noma-web` 和 `noma-local`，只有 Go 网关对外映射端口。

| 配置 | 说明 |
| --- | --- |
| `NOMA_CLOUD_URL` | 云端 API origin，不带 `/api/v1`。默认 `https://noma-ai.cloud`，尚未验证该域名提供 Local 协议；除 loopback 开发外要求 HTTPS |
| `NOMA_HA_URL` | 从容器看见的 HA 地址，如 `http://192.168.1.20:8123`；宿主机 HA 可用 `http://host.docker.internal:8123` |
| `NOMA_HA_TOKEN` | HA 长期令牌，仅注入 Go 后端 |
| `NOMA_HA_ALLOWED_ENTITIES` | 逗号分隔的精确实体白名单，同时限制读取和控制；空列表不授权设备 |
| `NOMA_LOCAL_BIND` / `NOMA_LOCAL_PORT` | 默认 `127.0.0.1:3000`；手机访问可将 bind 设为 `0.0.0.0` 并使用服务器局域网 IP |
| `NOMA_LOCAL_SECURE_COOKIE` | 本地 HTTPS 反向代理时设为 true，代理需保留 Host；初版 Host 只接受 IP / localhost |
| `NOMA_WEB_URL` | 原生开发默认 `http://127.0.0.1:3001`；Compose 自动配置内部服务名 |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | 可选 Clerk 公开 Key，作为前端 build arg；需另外配置 Clerk / 云端允许的本地来源和回调 |

修改运行配置后 `docker compose up -d --force-recreate`；修改 Clerk Key 后需重新构建前端。邮箱 / 手机登录复用原云端验证码接口。

局域网 HTTP 会明文传输凭证和对话；手机录音等浏览器能力需要安全上下文，正式家庭部署建议本地 HTTPS。服务需持续运行，初版不提供离家远程访问部署方案。

## 原生开发

需要 Go 1.25+、Node.js 22.13+。Go 无第三方依赖，前端沿用原 package-lock.json。`.env` 由 Compose 读取；原生模式自行设置 shell 环境变量。

终端 1 启动前端：

```powershell
cd noma-web
npm ci
$env:NOMA_INTERNAL_API_URL = 'http://127.0.0.1:3000/api/v1'
npm run dev
```

终端 2 在根目录启动网关：

```powershell
$env:NOMA_LOCAL_ACCESS_KEY = '<随机密钥，至少24字符>'
$env:NOMA_CLOUD_URL = 'https://noma-ai.cloud'
$env:NOMA_WEB_URL = 'http://127.0.0.1:3001'
$env:NOMA_HA_URL = 'http://192.168.1.20:8123'
$env:NOMA_HA_TOKEN = '<HA长期令牌>'
$env:NOMA_HA_ALLOWED_ENTITIES = 'light.living_room'
go run ./cmd/noma-local
```

浏览器访问网关端口 3000，前端开发端口 3001 仅供网关访问；直接打开 Next.js 端口不具备本地 API 路由。

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

实例面向一个受信任家庭，共享本地 HA 授权范围，云端凭证按浏览器会话隔离。会话最长 8 小时，仅保存在后端内存中，重启后重新登录。历史会话通过原云端 API 加载，访客历史保留原浏览器存储实现。

工具去重仅覆盖当前进程内同一本地会话 / request_id，每会话 128 轮，单轮 16 个不同工具、8 次云端往返。不承诺跨崩溃恰好执行一次；生产仍需持久化执行日志、实例 / 家庭绑定和恢复机制。

仅复用用户要求的前端及资源，未复制 Private 核心后端、环境文件或 Git 历史，未修改 Private。公开发布前由项目所有者确定许可证与资源授权，本次未擅自选定授权条款。
