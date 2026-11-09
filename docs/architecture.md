# TypeScript 架构

v0.1.1 的维护入口为 `src/host/index.ts` 与 `src/client/index.ts`。协议仍为 v1，DSH 兼容版本仍为 `0.2.2-rc.1`，本次迁移不增加运行依赖。

## 模块职责

| 模块 | 职责 |
| --- | --- |
| `src/shared/protocol.ts` | 路由、协议结构、状态联合类型及未知值读取；不依赖 Node 或浏览器 |
| `src/host/index.ts` | desktop profile 检查、规范化数据根、实例令牌、会话预检、effect 组合 |
| `src/host/context.ts` | 本插件实际使用的 DSH Host 服务结构类型 |
| `src/host/validation.ts` | 外部请求的精确字段、标识符、版本、实例、数据根和截止时间校验 |
| `src/host/auth.ts` | loopback / Host / Origin 检查及等长、恒时 Bearer 比较 |
| `src/host/bridge.ts` | 消费者租约、最新请求队列、预检、投递、授权、回执和释放 |
| `src/host/jobs.ts` | 请求 Promise、计时器、消费者和长轮询等待者的结构及初始化 |
| `src/host/discovery.ts` | 私有发现目录、排除符号链接、原子替换和按实例清理 |
| `src/host/http.ts` | 两个外部令牌路由与经过 DSH `connection.admit` 的 RPC 信封适配 |
| `src/host/public.ts` | 独立 Broker 导出，编译为 `lib/bridge.js` |
| `src/client/index.ts` | 顶层桌面页面隔离、effect 生命周期和轮询主循环 |
| `src/client/context.ts` | Connection、Session、Workspace、Layout 的服务结构类型 |
| `src/client/async.ts` | 可取消的快照等待与重试延迟 |
| `src/client/rpc.ts` | DSH RPC 调用、消费者 ID 以及同版本 Host 响应边界 |
| `src/client/navigation.ts` | 历史加载、归档复查、最后授权、导航及真实 `mainView` 选中确认 |

## 数据与生命周期

外部调用方读取发现记录，以该代实例的令牌发送打开请求。Host 先验证字段及实例身份，再进行会话存在、子会话来源和持久化目录预检。此阶段不导航桌面。

一个实例只允许一个已认证 DSH peer 与消费者 ID 持有有效租约。Client 在 `dsh-app://app/` 或 `/index.html` 顶层页面中等待 Connection、Session 列表和 Workspace 列表就绪，再发起长轮询。浏览器、嵌入帧和欢迎页不会注册消费者。

Host 队列只保留最新请求为 active。投递附带随机 deliveryToken；Client 加载历史后，在导航之前重新向 Host 授权，因此被取代或过期的投递不能迟到切换会话。`opened` 回执还必须对应目标 sessionId 与实际 `mainView` 保留状态。

保留原有时限：外部请求最多允许未来16秒的校验容差、轮询20秒、消费者租约25秒、已完成请求保留一分钟、总请求记录最多256条。重复请求必须字段值全部一致；重试返回同一个 job Promise，不重新投递。请求校验仍拒绝额外字段和不安全标识符。

Cordis effects 管理发现记录和路由；Client effect 取消连接等待、轮询和加载，随后释放租约。卸载旧实例时，只有发现记录中的 instanceId 与自身一致才删除文件，避免清理替代实例。

## 类型边界

HTTP body、RPC payload、JSON 解码结果与不合法请求中的回显 ID 均从 `unknown` 开始。校验器只在已证明字段的边界缩窄为协议类型；不会把未经检查的外部数据声明为完整请求。内部 poll 的消费者 ID 保留 v1 的既有正则转换行为，不额外收紧协议。

Client 的 `rpc.ts` 对已认证、同版本 Host 的返回值作协议断言，之后以判别联合读取状态。它不引入第二套运行时协议转换。DSH 服务只声明实际使用的结构形状，不打入 DSH 内部实现包或伪造全局声明。

## 编译与安装

`pnpm build` 使用 esbuild 编译 Node 24 ESM Host/Broker，以及 ES2023 浏览器 Client；随后由 tsc 生成 `lib/types/` 声明。TypeScript 使用 `strict` 和 NodeNext 模块解析，相对源码引用显式使用 `.js` 后缀，使声明也能供 NodeNext 消费者解析。

Client 编译结果包在 `window.__ModuleLoader__.load({ id, factory })` 内，工厂返回 `apply` 和 `inject`。工厂注册阶段不访问桌面服务；桌面页面检查仍在 `apply` 中。没有浏览器 ESM import、外部 npm require 或第二套 RPC/导航实现。

`package.json` 的主入口、Client 和 Broker 子路径都指向 `lib/`。编译产物和声明纳入 Git，Git/目录安装无需构建；`src/` 是唯一维护来源，根目录旧 JS 实现已移除。测试先重建，再直接加载发布入口。CI 运行锁文件安装、strict、全部回归、产物差异检查和打包。
