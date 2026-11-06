# DSH session bridge

让本机应用精确打开 **DeepSeek Harness 桌面应用中的指定会话**，并确认目标历史已加载、主窗口已选中目标。插件同时包含 Cordis Host 与 Client 两侧，兼容并已在 **DSH 0.2.2-rc.1** 验证。

A reusable local session navigation bridge for DeepSeek Harness. External desktop applications can request an exact conversation and receive a confirmed result after its history loads.

[换台 Huantai](https://github.com/Stxr/huantai) 是一个调用方。其他本机应用可直接接入下面的 HTTP 协议，不需要安装换台，也无需修改 DSH 应用包或模拟鼠标点击。

## 让 AI 安装

在 **DSH 桌面应用**中，把这句话发给 AI：

```text
请帮我安装 DSH 会话跳转桥：先阅读 https://github.com/Stxr/dsh-session-bridge 的 README，再用 plugin_manager 将推荐的 Git 版本安装到 desktop profile，按返回结果处理重启并检查桥接是否就绪。
```

当前推荐 **v0.1.0**，包名为 `@stxr/dsh-session-bridge`，仅兼容 `0.2.2-rc.1`。DSH Agent 可以安装 Git 标签：

```json
{"action":"install_bundle","target":"git+https://github.com/Stxr/dsh-session-bridge.git#v0.1.0"}
```

开发时也可克隆本仓库，再将实际绝对目录传给 `plugin_manager`。目录安装会链接源码，须保留该目录。不要在 profile 中手改依赖或配置来代替插件管理器。

插件只在 **desktop profile** 提供桥接；安装到 web profile 不会启用桌面跳转。根据插件管理器返回的 `application`、`warnings` 和 `nextStep` 判断是否立即生效，若提示重启则重启官方桌面应用，不绕过版本检查。升级已经加载的代码时也应按返回指引处理。

从最初换台仓库中的开发包迁移时，先通过插件管理器移除 `@huantai/dsh-session-bridge`，再安装本包，避免两个包同时注册同一桥接路由。v1 协议地址保持兼容，换台无须修改协议。

## 检查安装

安装后，DSH 数据根目录中会出现 `huantai-bridge/desktop.json`：发现目录权限为0700，文件权限为0600。使用该文件内的独立令牌请求其 endpoint 同源的 `GET /huantai/session-bridge/v1/status`，`ready: true` 表示桌面消费者已连接。

实际成功必须以单次打开请求的 `opened` 回执为准。使用换台时，DSH 数据根目录应与换台来源设置一致，默认 `~/.dsh`；打开一个普通会话即可验收。其他应用可按下一节接入。

本插件不会自行启动 DSH 或把系统窗口置前。调用方应先唤起官方桌面应用，再在截止时间内重试发现和请求。

## 本机桥接协议 v1

发现记录为 `<DSH_HOME>/huantai-bridge/desktop.json`，其目录名及 HTTP 路径保留早期换台集成的 v1 命名，任何本机客户端都能使用。数据根通过桌面启动器的 `profileContext` 获取；双方使用同一个规范化绝对路径。

每次插件启动生成新实例 ID 和独立随机令牌，通过临时文件原子替换发现记录，卸载时只移除本实例的记录。不读取 DSH Cookie 或账号凭据。

记录字段：`protocolVersion:1`、`instanceId`、`pid`、`profile:"desktop"`、`dataDir`、`endpoint`、`token` 和 Unix 毫秒时间戳 `startedAt`。`endpoint` 使用 DSH 自有 WebServer 的动态端口，固定路径为 `/huantai/session-bridge/v1/open`，只接受 `http://127.0.0.1:<端口>`。不要硬编码 DSH GUI 端口。

向 endpoint 发送 `POST application/json`，使用 `Authorization: Bearer <token>`：

```json
{
  "protocolVersion": 1,
  "instanceId": "发现记录中的实例 ID",
  "requestId": "本次打开操作的 UUID",
  "sessionId": "目标会话 ID",
  "dataDir": "/Users/example/.dsh",
  "expiresAt": 0
}
```

实际 `expiresAt` 应为不超过未来15秒的 Unix 毫秒时间戳，不能使用示例中的0。`sessionId`、`requestId` 仅允许1至128个字母、数字、下划线或连字符。重试保持原始全部字段和请求 ID。

响应包含 `protocolVersion`、`requestId`、`sessionId` 和 `status`。调用方应核对身份字段；仅 `opened` 表示成功。

| 状态 | 含义 |
| --- | --- |
| `opened` | 历史已加载，桌面主窗口已选中目标 |
| `not-ready` | 桌面页面尚未连接；截止时间前可重试 |
| `not-found` | 当前实例中不存在目标会话 |
| `archived` | 需要用户先在 DSH 中恢复 |
| `unsupported-target` | 初版不支持子会话 |
| `load-failed` | 历史无法打开或格式不兼容 |
| `instance-mismatch` | 实例 ID 或来源数据目录不匹配 |
| `superseded` | 请求被后来的跳转取代 |
| `timeout` | 已到期，后续不再导航 |
| `invalid-request` | 参数、协议或重复请求内容不合法 |

成功与业务失败一般返回 HTTP200；`not-ready` 返回503，`invalid-request` 返回400，`instance-mismatch` 返回409。缺少或不匹配的令牌返回401。

每个请求只有一个桌面消费者；普通浏览器页面和嵌入帧不参与。Client 加载历史后再次校验请求有效性和归档状态，取消尚未完成的工作区恢复，通过 `uiWorkspace.openSession` 导航，并核对 `mainView` 保留和目标 ID 后回执。队列只保留最新跳转，已完成结果短期保留供去重，重启不重放请求。

同样使用本机令牌请求 `GET /huantai/session-bridge/v1/status` 可查看就绪状态、消费者最近报告的选择及最后结果；诊断状态不能替代单次回执。外部路由限制来源 IP、Host、Origin、请求体和读取时限，不开放 CORS。

内部 Client 使用公开 `connection.rpc.call` 的 JSON 信封。针对0.2.2-rc.1的 Host `connection.rpc.handle` 注入问题，Host 在自有路由适配同一信封，通过 `connection.admit` 认证 DSH 页面；独立令牌只供外部本机入口使用。所有路由由 Cordis effect 管理。

## 被发现与安装

本仓库使用 GitHub **`dsh-plugin`** topic，并提供符合官方格式的[插件索引](https://raw.githubusercontent.com/Stxr/dsh-session-bridge/main/index.json)。DSH 不内置公共索引源：用户可以在“插件 → 自定义插件索引 → 发现”中添加该 URL，再从卡片安装指定 Git 提交。无需发布到 npm。

第三方市场对 GitHub 话题的收录与 DSH 官方索引机制不同；部分市场默认安装到 web profile，本插件必须安装到 desktop profile。来源、规则和维护方式见[发现规则](docs/discovery.md)。

## 开发与验证

无第三方运行依赖，无需构建或安装脚本：

```bash
node --check index.js
node --check bridge.js
node --check client.js
node --test tests/*.test.js
```

15项插件测试覆盖鉴权、跨实例、去重、过期、并发取代、消费者取消、浏览器隔离、归档拒绝、加载失败、主会话确认和 HTTP/RPC 适配及卸载清理。真实桌面验证已通过换台 CLI 打开并恢复普通会话，详见[验证记录](docs/verification.md)。

图标为原创 SVG，包内提供中英文标题和说明。初版不支持子会话，归档会话需先恢复；冷启动、最小化和隐藏窗口恢复尚未逐项人工验收。普通 `dsh://open` 仅用于唤起应用，本插件不扩展桌面主进程的系统深链接分发。
