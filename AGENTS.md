# Noma Public / Noma Local

产品名 Noma Local；此目录是独立公开项目，不是 Noma Private 的副本。

- 本地仅包含 Web UI、云端账号代理、远程工具协议适配和局域网 HA 执行器。
- Agent、模型 Key、Memory OS、用户数据、订阅和额度校验属于云端，不可复制到本仓库。
- 不修改相邻 Noma Private；云端变更需单独明确范围。
- 新环境变量使用 NOMA_ 前缀并更新 .env.example 和 README。
- HA Token 只存在于本地后端；不能发送至浏览器、云端、日志或 Git。
- 执行器使用实体及服务白名单；不接受任意 URL、模板、脚本或 shell。
- 写操作不自动重试；超时代表结果未知，不能宣称未执行。
- 协议修改同时更新 docs/CLOUD_PROTOCOL.md 和往返测试。
- 自测：go test ./...、go vet ./...、go build ./...。
- 前端复用 noma-web 原页面与交互；只适配同源 API、本地会话和 HA 连接，不另造界面。前端验证 npm test、npm run build。
- 保持边界最小，不顺手改动无关界面、文案和功能。
- 不提交 .env、shenxun*.env、密钥或任何私有服务实现。
