# Agent Note: Desktop GUI Minimum-Change Standalone Architecture

Status: proposed

[English](2026-08-14-desktop-gui-minimum-change-standalone-architecture.md) | 中文

## Problem

DeepSeek Harness WebUI 以浏览器应用的形式交付：[`apps/web`](../../../../apps/web/) 是在 [`@deepseek-ai/dsh-client-web`](../../../../packages/client/web/README.md) 外壳之上的 Vite 构建，由 [`dsh-web-app` 组合包](../../../../packages/bundle/web-app/README.md) 叠加在 [`dsh-base`](../../../../packages/bundle/base/README.md) 之上所挂载的回环 HTTP 服务器提供服务。产品需要把这一完全相同的界面以独立桌面 GUI 交付——即操作者直接启动的原生窗口——并以尽可能小的代码增量实现，同时完全保留原有外观与行为。

交付物受三条禁令约束。不得重新设计或制定样式规范，不得改动主题令牌、间距、排版、颜色、布局、文案、图标或组件外观。不得改动后端、运行时、API、RPC、会话数据、提示词、智能体、工具、插件、技能、模型、预设、权限或配置的语义。除本次调研所需的小型基线与探针工件外，不得实现任何其他内容。本说明记录对齐基线、需保留的功能面、侵入性最小的架构、改动边界、启动与生命周期方案，以及对齐测试方案。外壳本身是后续任务。

代码库已经预见了这一客户端形态，只是尚未做出决定：[GUI 分层与 RPC 协议说明](../../implemented/architecture/2026-07-19-gui-layering-and-rpc-protocol.md) 在即将到来的客户端中列出了 Electron，把传输隔离在 `AbstractApiClient.doFetch` 之后，并把「IPC 桥子类」列为尚不存在对应外壳的假想示例。本提案正是那些说明所推迟的决定。

## Proposal

整体复用官方 WebUI，只在其外添加一层薄壳。独立窗口渲染完全相同的已构建 [`apps/web`](../../../../apps/web/) 前端——同一 React 组件树、同一 CSS 令牌、同一浏览器插件名录——因此像素与交互天然一致。桌面进程通过同一 [`dsh-base`](../../../../packages/bundle/base/README.md) + [`dsh-web-app`](../../../../packages/bundle/web-app/README.md) 组合在进程内启动现有 harness 宿主，因此 API 网关、会话日志、工具、沙箱、设置、凭据、智能体预设与目录选择器都以不变语义运行。

载体分两阶段推进，第一阶段刻意做到最小：

- **阶段一——回环 HTTP，零协议改动。** 外壳在 [`dsh-host-webserver`](../../../../packages/host/webserver/README.md) 已提供的规范回环 URL（`http://127.0.0.1:<port>`）处打开一个 Electron `BrowserWindow`，使用现有浏览器 fetch/SSE 载体。无需任何载体、契约、UI 或 harness 语义改动；唯一新增代码是一个启动组合并打开窗口的 Electron 主进程装配。
- **阶段二——IPC fetch 载体，即已记录的后续工作。** 传输已经隔离到一个 seam 上：客户端侧是 [`AbstractApiClient.doFetch`](../../../../packages/host/apiproxy/src/fetch/client.ts)，宿主侧是 [`toFetchHandler(api)`](../../../../packages/host/apiproxy/src/fetch/handler.ts)，其中 [`InProcessApiClient`](../../../../packages/host/apiproxy/src/fetch/client.ts) 证明了同构路径从不触碰网络。后续改动新增一个 Electron IPC 子类，其 `doFetch` 把 `ipcRenderer`/`ipcMain` 桥接到宿主处理器，让窗口经 `file://` 加载 dist 而完全不再需要 HTTP 端口——这正是 [分层说明](../../implemented/architecture/2026-07-19-gui-layering-and-rpc-protocol.md) 与 [webserver 文档](../../../../docs/subsystems/web-server.md) 已经描述的结果（「Electron 通过 `file://` 加载已构建文件，并经 IPC 桥接发送 fetch 请求」）。替换载体不会改动四象限线协议与任何业务路径。

原生能力走已经存在的 seam，而非新造。工作区选择器已经在 `ctx.directoryPicker` 之后拆分 native 与 browse 后端（[seam 说明](../../implemented/architecture/2026-07-28-directory-picker-capability-seam.md)）；Electron 外壳经 Electron 自己的对话框 API 提供 `native` 交互，正如该说明所预见，无需网关或 `ui-workspace` 改动。会话导出、`host.openPath` 以及设置/凭据的「打开文档」都已委托给平台打开器，因此在窗口化宿主中保持不变。

## Visual parity baseline

[`apps/web/tests/snapshots/`](../../../../apps/web/tests/snapshots/) 下已提交的黄金样本是视觉真相源。它们是主要 WebUI 状态的确定性、无密钥渲染，由 Linux PR CI 同样使用的只读模式重放：

```sh
DSH_SNAPSHOT=replay pnpm run test:web
```

`test:web` 先重建 `apps/web` 的 dist，再运行浏览器冒烟对（真实宿主用例在无 `DEEPSEEK_API_KEY` 时自动跳过）以及无密钥重放的 e2e 场景。黄金样本枚举了后续工作必须匹配而非重新设计的状态：会话/工作区框架、对话与输入框、计划与目标条、后台任务、工具与工作流行、设置与插件配置、模型选择、引导与错误状态、消息操作，以及导航窗格。独立 GUI 必须渲染这些相同转录；后续桌面交付物通过对着窗口重放相同夹具来固化这一点。

## Functional parity checklist

独立窗口必须保留 WebUI 组合出的每一个用户可见动作与状态。权威名录是 [`web-app` 组合包 patch](../../../../packages/bundle/web-app/cordis.patch.yml)（浏览器插件行与仅 Web 的宿主行）加上共享的 [`base` 组合包 patch](../../../../packages/bundle/base/cordis.patch.yml)（模型、工具、持久化、策略、设置、凭据）。按界面分组：

- **工作区与会话：** 工作区选择/创建/重命名/归档（`ui-workspace`）、侧栏导航与标题/工作区名搜索（`ui-sidebar`）、会话创建/恢复/派生/重命名/导出/归档、空白会话复用，以及 `session.export` 下载。
- **对话与输入框：** 对话聊天节点与输入（`ui-conversation`）、队列动作（编辑、移除、重排）、附件与图片接收/灯箱（`ui-attachment`）、Markdown、数学与语法高亮。
- **命令与引用：** `/` 与 `@` 内联管线（`ui-input-trigger`）、命令分发（`ui-commands`）、技能引用（`ui-skill`），以及子智能体导航/转录（`ui-subagent`）。
- **智能体预设与模型选择：** 预设选择与编写（`ui-agent-preset`）、每会话模型选择与 `/model` 界面（`ui-model-selection`），以及 Models 设置页。
- **工具与结果：** 工具调用树与按工具定制的视图（`ui-tool`）、Cordis 定义/运行卡片（`ui-cordis`）、工作流运行披露（`ui-workflow-run`）、产物文件尾巴（`ui-deliverables`），以及终端/搜索卡片。
- **计划、目标、任务、轨迹：** 计划模式状态与退出（`ui-plan`）、目标条（`ui-goal`）、后台任务列表（`ui-jobs`），以及备选的智能体活动视图（`ui-trajectory`）。
- **设置、插件、权限：** 通用、模型与插件设置分区（`ui-settings`、`ui-settings-general`、`ui-settings-models`、`ui-settings-plugins`）、只读 loader 名录（`ui-settings-plugin-inventory`），以及权限预设与每会话访问开关（`ui-permission`）。
- **反馈、提问、主题、本地化：** 带备注的消息反馈（`ui-message-feedback`）、智能体请求的提问（`ui-user-questions`）、主题（`ui-theme`）与本地化（`locale`）。
- **加载、错误与空状态：** 启动结算与逐条目失败报告（外壳的一次性渲染）、引导欢迎/缺失、认证错误、重试与取消，以及冷空白会话。

这些界面一律不改动：窗口只是不同的载体与窗口框架，不是不同的应用。

## Change boundary

**新增。** 位于 `apps/` 下的 Electron 外壳装配——即 [分层说明](../../implemented/architecture/2026-07-19-gui-layering-and-rpc-protocol.md) 的「在 `apps/` 下写一个装配模块」步骤——包含一个启动组合、打开窗口并拥有应用私有信号/打印/退出语义的主进程，以及它的 `package.json`（Electron 是唯一新增的运行时依赖）和一个小型引导。阶段二的后续工作新增一个 `AbstractApiClient` IPC 子类与一个宿主侧 IPC 到 `toFetchHandler` 的桥，均为增量。

**逐字节或语义不变。** 所有 `packages/client/**` 源文件、所有 `apps/web` UI 源文件、`packages/host/apiproxy/src/api/**` 下的线契约、[`web-app/cordis.patch.yml`](../../../../packages/bundle/web-app/cordis.patch.yml) 与 [`base/cordis.patch.yml`](../../../../packages/bundle/base/cordis.patch.yml) 中的浏览器插件名录与宿主行、主题令牌与 CSS，以及所有 core、api、llm、shell、subprocess、fs、lsp、skill、web 与 terminal 包。桌面外壳原样复用 `web-app` 组合；若需要仅外壳的行（例如打开窗口的启动器），它应作为一个增量组合层或新外壳包出现，而绝不修改既有行。

## Launch and lifecycle

外壳主进程启动与 CLI 相同的组合——通过 [`app-boot` profile 组合器](../../../../packages/boot/app-boot/README.md) 依次为 `dsh-base`、`dsh-web-app`——因此 [`web-startup`](../../../../packages/bundle/web-app/src/startup.ts) 解析相同的 `--host`/`--port`/`--trusted-host` 标志，[`webserver`](../../../../packages/host/webserver/README.md) 绑定回环端口，[`web-runtime`](../../../../packages/bundle/web-app/src/index.ts) 解析 dist 并打印 URL。Loader 树结算后，外壳读取规范 URL 并在该处打开 `BrowserWindow`。窗口与浏览器完全一样地连接：加载 `index.html`、运行两阶段 [`AppWebEntry` 引导](../../../../packages/client/web/README.md)、挂载客户端插件树，并经 [`connection`](../../../../packages/client/connection/README.md) 完成就绪握手。现有的 `app:web-surface` 提示词区段与 `DSH_WEB_URL` 外壳变量对窗口化宿主依然准确，窗口关闭复用 CLI 的有界关闭（SIGINT/SIGTERM 处置根节点），而非新增拆除路径。阶段二中外壳在 `file://` 处打开窗口并经 IPC 载体完成同一握手，此时不再挂载 HTTP 服务器。

## Testing plan

对齐以复用来度量，而非靠一套平行的断言面。桌面外壳必须对着窗口通过为浏览器面把关的同一无密钥重放（`DSH_SNAPSHOT=replay pnpm run test:web`），新增的桌面冒烟必须证明窗口加载相同的引导清单、完成与浏览器载体相同的就绪握手，并对一个种子会话渲染相同的转录。因此，浏览器 WebUI 与独立 GUI 的对齐意味着：相同的黄金样本、相同的线契约、相同的客户端插件名录、相同的 `host.describe` 就绪应答——唯一允许的差异是 WebUI 之外的窗口框架。真实提供方的对齐仍在 `test:e2e` 中，它在无密钥时自动跳过；两种外壳都不新增携带密钥的路径。

## Alternatives considered

**把 UI 重写为原生或独立的桌面前端。** 当「桌面应用」被理解为「桌面工具包」时，这是诱人的默认选项，但它直接违反不重新设计禁令，且把增量最大化。已否决。

**用 Tauri 而非 Electron 构建窗口。** Tauri 引入 Rust 工具链、第二套打包与签名体系，以及一个与 WebUI 所测试的 Chromium 有差异的 webview，在当前阶段没有任何功能收益。已否决，改选代码库自身说明已点名的、以 Node 为先的 Electron 外壳。

**发布一个在操作者默认浏览器中打开回环 URL 的浏览器启动器。** 这不是独立窗口，不提供外壳拥有的生命周期或原生窗口框架，省下的只有窗口代码，却无法满足「独立 GUI」目标。已否决。

**把 IPC 载体作为阶段一。** 作为最终形态它是对的，但它会在任何窗口存在之前就新增一个载体及其宿主侧桥；回环 HTTP 服务器已经存在、已经正确、已经受信。对阶段一已否决，保留为已记录的阶段二后续工作。

**经新的 Electron 专属路径暴露原生目录选择器。** 不必要——[`directory-picker` seam](../../implemented/architecture/2026-07-28-directory-picker-capability-seam.md) 已经隔离 native 与 browse，其说明指出提供 `native` 交互的 Electron 提供方只是一个双面后端包，无需网关或 `ui-workspace` 改动。已否决，改选复用该 seam。

## Acceptance criteria

- 独立窗口渲染官方 WebUI，与浏览器面无视觉或行为差异，以相同的无密钥重放黄金样本为证据。
- harness 语义不变：后端、运行时、API、RPC、会话数据、提示词、智能体、工具、插件、技能、模型、预设、权限或配置的行为与 `dsh --profile web` 无任何差异。
- 外壳纯属增量；所有 `packages/client/**` 与 `apps/web` UI 源文件以及 `/api` 线契约保持逐字节或语义不变。
- 窗口达到与浏览器相同的 `host.describe` 就绪应答，并挂载相同的客户端插件名录。
- 阶段二（当构建时）只替换 `AbstractApiClient.doFetch` 并新增宿主侧 IPC 桥；四象限协议、业务路径与所有快照保持不变。

## Risks

- **新增运行时依赖。** Electron 为安装包新增了可观的二进制与供应链面。缓解：外壳保持轻薄、WebUI 逐字节不变，且阶段一不再新增其他依赖。
- **阶段一期间仍绑定端口。** 回环 HTTP 服务器仍挂载，因此独立窗口依然打开一个本地端口。缓解：阶段二为桌面路径移除该服务器；端口仅回环且已有栅栏防护，因此不扩大攻击面。
- **dist 分叉导致视觉漂移。** 若桌面路径曾以不同方式构建前端，对齐会悄然失效。缓解：保持单一 `apps/web` dist 为唯一来源，并用相同黄金样本把关。
- **信任栅栏范围。** IPC 载体必须保留 HTTP 栅栏所强制的回环信任假设；若阶段二的桥接受非回环来源，就会削弱它。缓解：让 IPC 通道仅限进程本地，并保留现有信任逻辑而非重写。
