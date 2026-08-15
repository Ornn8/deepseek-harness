# Agent Note: Desktop GUI Minimum-Change Standalone Architecture

Status: implemented

[English](2026-08-14-desktop-gui-minimum-change-standalone-architecture.md) | 中文

## Problem

DeepSeek Harness WebUI 以浏览器应用的形式交付：[`apps/web`](../../../../apps/web/) 是在 [`@deepseek-ai/dsh-client-web`](../../../../packages/client/web/README.md) 外壳之上的 Vite 构建，由 [`dsh-web-app` 组合包](../../../../packages/bundle/web-app/README.md) 叠加在 [`dsh-base`](../../../../packages/bundle/base/README.md) 之上所挂载的回环 HTTP 服务器提供服务。产品需要把这一完全相同的界面以独立桌面 GUI 交付——即操作者直接启动的原生窗口——并以尽可能小的代码增量实现，同时完全保留原有外观与行为。

交付物受三条禁令约束。不得重新设计或制定样式规范，不得改动主题令牌、间距、排版、颜色、布局、文案、图标或组件外观。不得改动后端、运行时、API、RPC、会话数据、提示词、智能体、工具、插件、技能、模型、预设、权限或配置的语义。除外壳及其对齐探针外，不得实现任何其他内容。本说明记录对齐基线、需保留的功能面、侵入性最小的架构、改动边界、启动与生命周期方案，以及对齐测试方案。

代码库早已预见了这一客户端形态，只是当时尚未决定：[GUI 分层与 RPC 协议说明](2026-07-19-gui-layering-and-rpc-protocol.md) 在即将到来的客户端中列出了 Electron，把传输隔离在 `AbstractApiClient.doFetch` 之后，并把「IPC 桥子类」列为尚不存在对应外壳的假想示例。本说明正是那些说明所推迟的决定。

## Decision

整体复用官方 WebUI，只在其外添加一层薄壳。独立窗口渲染完全相同的已构建 [`apps/web`](../../../../apps/web/) 前端——同一 React 组件树、同一 CSS 令牌、同一浏览器插件名录——因此像素与交互天然一致。桌面进程通过同一 [`dsh-base`](../../../../packages/bundle/base/README.md) + [`dsh-web-app`](../../../../packages/bundle/web-app/README.md) 组合在进程内启动现有 harness 宿主，因此 API 网关、会话日志、工具、沙箱、设置、凭据、智能体预设与目录选择器都以不变语义运行。

已交付的外壳是 `apps/desktop`（`@deepseek-ai/dsh-desktop`）：`apps/` 下的一个 Electron 主进程，负责启动组合、打开窗口并拥有应用私有的信号/打印/退出语义，外加其 `package.json`（Electron 是唯一新增的外部依赖）与小型引导代码。外壳只携带一个载体，即回环 HTTP 源：

- **回环 HTTP，零协议改动。** 外壳在 [`dsh-host-webserver`](../../../../packages/host/webserver/README.md) 已提供的规范回环 URL（`http://127.0.0.1:<port>`）处打开一个 Electron `BrowserWindow`，使用现有浏览器 fetch/SSE 载体。不存在任何载体、契约、UI 或 harness 语义改动；唯一新增代码是一个启动组合并打开窗口的 Electron 主进程装配。
- **IPC 被推迟；IPC 载体需要完整的传输决策，而非 `doFetch` 替换。** 「单一 seam」的读法止步于 `AbstractApiClient` 抽象：`doFetch` 是上行传输方面（[fetch/client.ts](../../../../packages/host/apiproxy/src/fetch/client.ts)、[`toFetchHandler(api)`](../../../../packages/host/apiproxy/src/fetch/handler.ts)，以及证明同构路径从不触碰网络的 [`InProcessApiClient`](../../../../packages/host/apiproxy/src/fetch/client.ts)），但已交付的浏览器载体更宽。connection 插件的浏览器半身内部实例化 `new WebApiClient()`，且不存在 API 客户端注入 seam（[connection 客户端入口](../../../../packages/client/connection/src/client/index.ts)）；`WebApiClient` 又用每个逻辑流一个 WebSocket 下行覆盖了 `openMux`/`openHost`（[web-api-client.ts](../../../../packages/client/connection/src/client/web-api-client.ts)）——增量 IPC 子类永远不会被选中，即便被选中也无法替换下行载体。已构建的前端同样无法经 `file://` 启动：[`ClientModuleRegistry`](../../../../packages/client/modules/src/index.ts) 把引导图以 `window.__DSH_BOOT__` 注入每个被服务的 `index.html`（缺失时 [`parseBootManifest`](../../../../packages/client/modules/src/client/manifest.ts) 直接拒绝），每个图行都从 `/plugins/<id>/client.js` bundle 路由加载外部 classic 脚本，且已构建的 `index.html` 引用根绝对路径的 `/assets/*` URL。因此未来的 IPC 阶段需要自己的架构决策，覆盖引导图交付、无 HTTP 的客户端 bundle 与静态资源加载，以及完整的「一元+流」连接提供方（名录级替换或对上游 `connection` 的改动）。在该决策落地前，桌面路径一直使用回环 HTTP 源。

外壳复用 CLI 自己的 profile-boot 模块：`apps/cli` 导出 `./profile-boot`（其 `runProfile` 及配套函数，作为 bin 之外的第二个 tsdown 入口打包），桌面主进程通过它启动 `web` profile，并使用 CLI 的安装锚点与随附 agent-preset 根目录。因此 CLI 与桌面外壳按构造启动完全相同的组合——包括随附 agent-presets 覆盖层；没有任何引导代码被复制。外壳的启动器只拥有自己的一个标志族（`--patch <path>` 覆盖层）；其后的所有内容原样转发给 Web 应用的标志族（`--host`、`--port`、`--trusted-host`），由 CLI 服务的同一个 `web-startup` 行解析。

原生能力走已经存在的 seam，而非新造。工作区选择器已经在 `ctx.directoryPicker` 之后拆分 native 与 browse 后端（[seam 说明](2026-07-28-directory-picker-capability-seam.md)）；桌面完全按照 Web 界面的方式挂载上游 `directory-picker` 组合，不新增任何自己的选择器面。该 seam 预见的 Electron `native` 交互提供方——同一个单占用空洞中的一个双面后端包，无需网关或 `ui-workspace` 改动——是唯一可能的后续改动，且它替换自动解析出的后端，而不是挂载第二个选择器。会话导出、`host.openPath` 以及设置/凭据的「打开文档」都已委托给平台打开器，因此在窗口化宿主中保持不变。

## Visual parity baseline

视觉真相源由两部分组成——无密钥功能门与渲染基线——外加一份静态美术资源清单。

[`apps/web/tests/snapshots/`](../../../../apps/web/tests/snapshots/) 下已提交的黄金样本是无密钥功能门。它们是主要 WebUI 状态的确定性 `ariaSnapshot()` 转录，由 Linux PR CI 同样使用的只读模式重放：

```sh
DSH_SNAPSHOT=replay pnpm run test:web
```

`test:web` 先重建 `apps/web` 的 dist，再运行浏览器冒烟对（真实宿主用例在无 `DEEPSEEK_API_KEY` 时自动跳过）以及无密钥重放的 e2e 场景。黄金样本枚举了后续工作必须匹配而非重新设计的状态：会话/工作区框架、对话与输入框、计划与目标条、后台任务、工具与工作流行、设置与插件配置、模型选择、引导与错误状态、消息操作，以及导航窗格。它们验证结构、存在性、顺序与文案，但对颜色不敏感，也不携带主题或布局黄金样本——生命周期 e2e 明确说明了这一局限（[lifecycle-chrome.e2e.ts](../../../../apps/web/tests/lifecycle-chrome.e2e.ts)）。

渲染基线是上述状态的已提交像素截图，通过重放通道以无密钥方式录制，由受门控的录制器 `apps/web/tests/visual-baseline.e2e.ts` 生成（`DSH_VISUAL_BASELINE=record pnpm run test:web:built -- -t visual-baseline`）：[`apps/web/tests/snapshots/visual-baseline/`](../../../../apps/web/tests/snapshots/visual-baseline/) 存放截图与 [`recording.md`](../../../../apps/web/tests/snapshots/visual-baseline/recording.md) 录制条件（视口 1680x1000、语言、主题、平台、Chromium 版本、录制日期）。录制器驱动与 aria 通道相同的种子夹具，因此每个状态都无需密钥即可复现；外壳状态跟随平台当前的外壳工具（win32 为 `tool-pwsh`，其他平台为 `tool-bash`），这也是元数据记录平台的原因。后续工作必须匹配这些截图，而非重新设计；像素一致性仅在所记录的录制条件下成立，桌面实现会在其自身平台上重新录制。

静态美术资源另有自己的清单检查：独立应用必须让每项上游视觉/静态资源保持存在且可解析。已提交的 [`static-assets.md`](../../../../apps/web/tests/snapshots/visual-baseline/static-assets.md) 清单列出 [`apps/web/public/**`](../../../../apps/web/public/)（`favicon.svg`、`manifest.webmanifest`）以及构建发射进 dist 的每一项资源（KaTeX 字体、语法高亮语言分块、CSS 与 JS 包）；桌面冒烟测试证明每一项都能经窗口源解析。

独立 GUI 渲染相同的转录、匹配相同的截图、解析相同的资源；桌面冒烟测试对窗口重放相同的夹具。

## Functional parity checklist

独立窗口必须保留 WebUI 组合出的每一个用户可见动作与状态。权威名录是 [`web-app` 组合包补丁](../../../../packages/bundle/web-app/cordis.patch.yml)（浏览器插件行与仅 Web 的宿主行）加上共享的 [`base` 组合包补丁](../../../../packages/bundle/base/cordis.patch.yml)（模型、工具、持久化、策略、设置、凭据）。按界面分组：

- **工作区与会话：** 工作区选择/创建/重命名/归档（`ui-workspace`）、侧边栏导航与标题/工作区名搜索（`ui-sidebar`）、会话创建/恢复/分叉/重命名/导出/归档、空白会话复用，以及 `session.export` 下载。
- **对话与输入框：** 对话聊天节点与输入（`ui-conversation`）、队列动作（编辑、移除、重排）、附件与图片摄取/灯箱（`ui-attachment`）、Markdown、数学与语法高亮。
- **命令与引用：** `/` 与 `@` 内联管线（`ui-input-trigger`）、命令分发（`ui-commands`）、技能引用（`ui-skill`），以及子代理导航/转录（`ui-subagent`）。
- **智能体预设与模型选择：** 预设选择与编写（`ui-agent-preset`）、按会话的模型选择与 `/model` 界面（`ui-model-selection`），以及模型设置页。
- **工具与结果：** 工具调用树与按工具的视图（`ui-tool`）、Cordis define/run 卡片（`ui-cordis`）、工作流运行披露（`ui-workflow-run`）、产物文件尾部（`ui-deliverables`），以及终端/搜索卡片。
- **计划、目标、任务、轨迹：** 计划模式状态与退出（`ui-plan`）、目标条（`ui-goal`）、后台任务列表（`ui-jobs`），以及备选智能体活动视图（`ui-trajectory`）。
- **设置、插件、权限：** 常规、模型与插件设置区块（`ui-settings`、`ui-settings-general`、`ui-settings-models`、`ui-settings-plugins`）、只读加载器清单（`ui-settings-plugin-inventory`），以及权限预设与按会话的访问开关（`ui-permission`）。
- **反馈、提问、主题、语言：** 带备注的消息反馈（`ui-message-feedback`）、智能体发起的提问（`ui-user-questions`）、主题（`ui-theme`）与本地化（`locale`）。
- **加载、错误与空状态：** 引导落定与逐条目失败报告（外壳的一次性渲染）、引导欢迎/缺失、认证错误、重试与取消，以及冷空白会话。

这些界面一个都不变：窗口只是不同的载体与窗口装饰，而不是不同的应用。

## Change boundary

**新增。** `apps/desktop` 下的 Electron 外壳装配——[分层说明](2026-07-19-gui-layering-and-rpc-protocol.md) 的「在 `apps/` 下编写装配模块」步骤——由一个启动组合、打开窗口并拥有应用私有信号/打印/退出语义的主进程，外加其 `package.json` 与小型引导代码组成。外壳原样复用 `web-app` 组合；目前不存在外壳专用行，若将来需要，也会以增量组合层或新的外壳包形式出现，绝不会编辑现有行。

**逐字节或语义上未改动。** 每个 `packages/client/**` 源文件、每个 `apps/web` UI 源文件、`packages/host/apiproxy/src/api/**` 下的线契约、[`web-app/cordis.patch.yml`](../../../../packages/bundle/web-app/cordis.patch.yml) 与 [`base/cordis.patch.yml`](../../../../packages/bundle/base/cordis.patch.yml) 中的浏览器插件名录与宿主行、主题令牌与 CSS，以及所有 core、api、llm、shell、subprocess、fs、lsp、skill、web 与 terminal 包。

**外壳要求的上游文件改动及其原因（增量代码无法解决）。** `apps/cli/package.json` 新增 `exports` 映射，暴露 `./profile-boot`（以及包根）；`apps/cli/tsdown.config.ts` 新增对应的第二个 bundle 入口——共享的 profile-boot 胶水本就在 CLI 应用中，桌面外壳必须调用完全相同的 `runProfile` 而非副本或参数化抽取，因此 CLI 的模块成了共享模块。`pnpm-workspace.yaml` 批准 Electron 的 postinstall（运行时二进制下载）；工作区默认拒绝未列出的构建脚本，而桌面外壳没有该二进制就无法运行。`scripts/check-workspace-constraints.ts` 新增该应用的发布文件策略条目，`tsconfig.host.json` 注册新应用及其测试。

## Launch and lifecycle

外壳的主进程启动与 CLI 相同的组合——`dsh-base` 再 `dsh-web-app`，经共享的 profile-boot 胶水——因此 [`web-startup`](../../../../packages/bundle/web-app/src/startup.ts) 解析相同的 `--host`/`--port`/`--trusted-host` 标志，[`webserver`](../../../../packages/host/webserver/README.md) 绑定回环端口，[`web-runtime`](../../../../packages/bundle/web-app/src/index.ts) 解析 dist 并打印 URL。Loader 树稳定后，外壳读取规范 URL 并在其上打开 `BrowserWindow`。窗口与浏览器的连接方式完全相同：加载 `index.html`、运行两阶段 [`AppWebEntry` 启动](../../../../packages/client/web/README.md)、挂载客户端插件树，并经 [`connection`](../../../../packages/client/connection/README.md) 完成就绪握手。现有的 `app:web-surface` 提示词区块与 `DSH_WEB_URL` shell 变量对窗口化宿主依然准确。窗口关闭显式映射到 CLI 的有界关闭：[`runProfile`](../../../../apps/cli/src/profile-boot.ts) 安装 SIGINT/SIGTERM 处理器，调用其返回的 `ProcessShutdown` 控制器来销毁根——关闭 `BrowserWindow` 不会发出任一信号，因此外壳拦截 Electron 的生命周期（`window-all-closed` 或 `before-quit`），调用同一个关闭控制器，等待根销毁，然后退出。该映射是外壳私有的退出语义，不是 harness 改动。桌面路径保持使用回环 HTTP 源；不存在 `file://` 阶段。

## Testing

对齐靠复用度量，而非平行的断言面。桌面外壳通过约束浏览器界面的同一无密钥重放（`DSH_SNAPSHOT=replay pnpm run test:web`），而桌面冒烟测试（`pnpm run test:desktop`）在封闭的临时世界中启动真实构建的外壳，证明窗口加载带注入引导清单的被服务 `index.html`、完成与浏览器载体相同的就绪握手、针对同一源与语言环境下的种子会话渲染与浏览器相同的 aria 转录、经窗口源解析每个已构建静态资源，并在最后一个窗口关闭时干净退出。在 Electron 无法打开窗口的环境（无二进制，或 Linux 无显示）中，冒烟测试自动跳过；像素重录仍是平台本地的任务。因此浏览器 WebUI 与独立 GUI 的对齐意味着：相同的黄金样本、相同的截图、相同的资源解析、相同的线契约、相同的客户端插件名录，以及相同的 `host.describe` 就绪回答——唯一允许的差异是 WebUI 之外的窗口装饰。真实提供方对齐留在 `test:e2e`，无密钥时自动跳过；两个外壳都不新增需要密钥的路径。

## Alternatives considered

**把 UI 重写为原生或独立的桌面前端。** 当「桌面应用」被读作「桌面工具包」时，这是诱人的默认选择，但它直接违反禁止重新设计的规定，且增量最大。已拒绝。

**用 Tauri 而非 Electron 构建窗口。** Tauri 引入 Rust 工具链、第二套打包与签名流程，以及一个与 WebUI 所测 Chromium 分叉的 webview，现阶段没有功能收益。已拒绝，选择代码库自身说明已点名的 Node-first Electron 外壳。

**交付一个浏览器启动器，在操作者的默认浏览器中打开回环 URL。** 这不是独立窗口，不提供外壳拥有的生命周期或原生窗口装饰，并且在只省下窗口代码的同时无法达成「独立 GUI」目标。已拒绝。

**把 IPC 载体作为阶段一。** 作为终态是正确的，但它不是小型后续工作：它需要本决策拒绝承诺的完整引导图、bundle、资源与连接提供方设计。阶段一已拒绝并推迟；回环 HTTP 服务器已经存在、已经正确、已经可信。

**把 profile-boot 胶水抽取到新的 `@deepseek-ai/dsh-profile-boot` 包。** 这能让桌面外壳的依赖方向干净，代价是移动并参数化 CLI 的启动代码（安装锚点、随附预设根、bin 名）、迁移随附 agent-preset 目录，并让整片移动面通过按文件覆盖率门。已拒绝，改为导出 CLI 现有模块（`@deepseek-ai/dsh/profile-boot`）：桌面外壳在开发启动阶段是同一安装的第二个启动器，因此逐字复用 CLI 的事实更小、按构造保证完全相同的组合，并把预设名录的迁移自由留给 GUI-05 打包。

**通过新的 Electron 专用路径暴露原生目录选择器。** 没有必要——[`directory-picker` seam](2026-07-28-directory-picker-capability-seam.md) 已经隔离 native 与 browse，其说明也指出 `native` 交互的 Electron 提供方是同一个单占用空洞中的一个双面后端包，无需网关或 `ui-workspace` 改动。已拒绝，改为复用该 seam。

## Consequences

独立窗口渲染官方 WebUI，与浏览器界面没有任何视觉或行为差异，证据是相同的无密钥重放黄金样本、已提交的截图基线（截图加录制条件），以及桌面冒烟测试中的静态资源解析检查。harness 语义不变：没有后端、运行时、API、RPC、会话数据、提示词、智能体、工具、插件、技能、模型、预设、权限或配置行为与 `dsh --profile web` 不同，窗口达到相同的 `host.describe` 就绪回答，并挂载与浏览器相同的客户端插件名录。已接受的代价：Electron 给安装增加可观的二进制与供应链面（通过保持外壳轻薄且 WebUI 逐字节相同来缓解，阶段一也不新增其他依赖）；回环 HTTP 服务器保持挂载，因此独立窗口总是打开一个本地端口（仅回环且已有围栏防护，不会扩大攻击面；与 IPC 载体一起推迟移除）；`apps/web` 的单一 dist 仍是唯一来源，由同一黄金样本把关，因此分叉的桌面构建无法悄然破坏对齐；未来的 IPC 载体必须保留 HTTP 围栏强制执行的回环信任假设——接受非回环源的桥会削弱它，因此任何此类设计都保持通道进程内并复用现有信任逻辑。
