# Agent Note: Desktop GUI Minimum-Change Standalone Architecture

Status: proposed

[English](2026-08-14-desktop-gui-minimum-change-standalone-architecture.md) | 中文

## Problem

DeepSeek Harness WebUI 以浏览器应用的形式交付：[`apps/web`](../../../../apps/web/) 是在 [`@deepseek-ai/dsh-client-web`](../../../../packages/client/web/README.md) 外壳之上的 Vite 构建，由 [`dsh-web-app` 组合包](../../../../packages/bundle/web-app/README.md) 叠加在 [`dsh-base`](../../../../packages/bundle/base/README.md) 之上所挂载的回环 HTTP 服务器提供服务。产品需要把这一完全相同的界面以独立桌面 GUI 交付——即操作者直接启动的原生窗口——并以尽可能小的代码增量实现，同时完全保留原有外观与行为。

交付物受三条禁令约束。不得重新设计或制定样式规范，不得改动主题令牌、间距、排版、颜色、布局、文案、图标或组件外观。不得改动后端、运行时、API、RPC、会话数据、提示词、智能体、工具、插件、技能、模型、预设、权限或配置的语义。除本次调研所需的小型基线与探针工件外，不得实现任何其他内容。本说明记录对齐基线、需保留的功能面、侵入性最小的架构、改动边界、启动与生命周期方案，以及对齐测试方案。外壳本身是后续任务。

代码库已经预见了这一客户端形态，只是尚未做出决定：[GUI 分层与 RPC 协议说明](../../implemented/architecture/2026-07-19-gui-layering-and-rpc-protocol.md) 在即将到来的客户端中列出了 Electron，把传输隔离在 `AbstractApiClient.doFetch` 之后，并把「IPC 桥子类」列为尚不存在对应外壳的假想示例。本提案正是那些说明所推迟的决定。

## Proposal

整体复用官方 WebUI，只在其外添加一层薄壳。独立窗口渲染完全相同的已构建 [`apps/web`](../../../../apps/web/) 前端——同一 React 组件树、同一 CSS 令牌、同一浏览器插件名录——因此像素与交互天然一致。桌面进程通过同一 [`dsh-base`](../../../../packages/bundle/base/README.md) + [`dsh-web-app`](../../../../packages/bundle/web-app/README.md) 组合在进程内启动现有 harness 宿主，因此 API 网关、会话日志、工具、沙箱、设置、凭据、智能体预设与目录选择器都以不变语义运行。

载体以单一阶段交付——回环 HTTP 源——IPC 替换被推迟，因为在本提案所保持的「纯增量外壳」边界内，它无法作为仅替换 `doFetch` 的后续工作实现：

- **阶段一——回环 HTTP，零协议改动。** 外壳在 [`dsh-host-webserver`](../../../../packages/host/webserver/README.md) 已提供的规范回环 URL（`http://127.0.0.1:<port>`）处打开一个 Electron `BrowserWindow`，使用现有浏览器 fetch/SSE 载体。无需任何载体、契约、UI 或 harness 语义改动；唯一新增代码是一个启动组合并打开窗口的 Electron 主进程装配。
- **阶段二——推迟；IPC 载体需要完整的传输决策，而非 `doFetch` 替换。** 「单一 seam」的读法止步于 `AbstractApiClient` 抽象：`doFetch` 是上行传输方面（[fetch/client.ts](../../../../packages/host/apiproxy/src/fetch/client.ts)、[`toFetchHandler(api)`](../../../../packages/host/apiproxy/src/fetch/handler.ts)，以及证明同构路径从不触碰网络的 [`InProcessApiClient`](../../../../packages/host/apiproxy/src/fetch/client.ts)），但已交付的浏览器载体更宽。connection 插件的浏览器半身内部实例化 `new WebApiClient()`，且不存在 API 客户端注入 seam（[connection 客户端入口](../../../../packages/client/connection/src/client/index.ts)）；`WebApiClient` 又用每个逻辑流一个 WebSocket 下行覆盖了 `openMux`/`openHost`（[web-api-client.ts](../../../../packages/client/connection/src/client/web-api-client.ts)）——增量 IPC 子类永远不会被选中，即便被选中也无法替换下行载体。已构建的前端同样无法经 `file://` 启动：[`ClientModuleRegistry`](../../../../packages/client/modules/src/index.ts) 把引导图以 `window.__DSH_BOOT__` 注入每个被服务的 `index.html`（缺失时 [`parseBootManifest`](../../../../packages/client/modules/src/client/manifest.ts) 直接拒绝），每个图行都从 `/plugins/<id>/client.js` bundle 路由加载外部 classic 脚本，且已构建的 `index.html` 引用根绝对路径的 `/assets/*` URL。因此未来的 IPC 阶段需要自己的架构决策，覆盖引导图交付、无 HTTP 的客户端 bundle 与静态资源加载，以及完整的「一元+流」连接提供方（名录级替换或对上游 `connection` 的改动）——全部超出本提案保持的边界。[分层说明](../../implemented/architecture/2026-07-19-gui-layering-and-rpc-protocol.md) 与 [webserver 文档](../../../../docs/subsystems/web-server.md) 中关于 `file://` 的一行描述只是通往该未来决策的指针，不是已被证明的载体。

原生能力走已经存在的 seam，而非新造。工作区选择器已经在 `ctx.directoryPicker` 之后拆分 native 与 browse 后端（[seam 说明](../../implemented/architecture/2026-07-28-directory-picker-capability-seam.md)）；阶段一完全按照 Web 界面的方式挂载上游 `directory-picker` 组合，不新增任何自己的选择器面。该 seam 预见的 Electron `native` 交互提供方——同一个单占用空洞中的一个双面后端包，无需网关或 `ui-workspace` 改动——是唯一可能的后续改动，且它替换自动解析出的后端，而不是挂载第二个选择器。会话导出、`host.openPath` 以及设置/凭据的「打开文档」都已委托给平台打开器，因此在窗口化宿主中保持不变。

## Visual parity baseline

视觉真相源由两部分组成——无密钥功能门与渲染基线——外加一份静态美术资源清单。

[`apps/web/tests/snapshots/`](../../../../apps/web/tests/snapshots/) 下已提交的黄金样本是无密钥功能门。它们是主要 WebUI 状态的确定性 `ariaSnapshot()` 转录，由 Linux PR CI 同样使用的只读模式重放：

```sh
DSH_SNAPSHOT=replay pnpm run test:web
```

`test:web` 先重建 `apps/web` 的 dist，再运行浏览器冒烟对（真实宿主用例在无 `DEEPSEEK_API_KEY` 时自动跳过）以及无密钥重放的 e2e 场景。黄金样本枚举了后续工作必须匹配而非重新设计的状态：会话/工作区框架、对话与输入框、计划与目标条、后台任务、工具与工作流行、设置与插件配置、模型选择、引导与错误状态、消息操作，以及导航窗格。它们验证结构、存在性、顺序与文案，但对颜色不敏感，也不携带主题或布局黄金样本——生命周期 e2e 明确说明了这一局限（[lifecycle-chrome.e2e.ts](../../../../apps/web/tests/lifecycle-chrome.e2e.ts)）。

渲染基线是上述状态的已提交像素截图，通过重放通道以无密钥方式录制，由受门控的录制器 `apps/web/tests/visual-baseline.e2e.ts` 生成（`DSH_VISUAL_BASELINE=record pnpm run test:web:built -- -t visual-baseline`）：[`apps/web/tests/snapshots/visual-baseline/`](../../../../apps/web/tests/snapshots/visual-baseline/) 存放截图与 [`recording.md`](../../../../apps/web/tests/snapshots/visual-baseline/recording.md) 录制条件（视口 1680x1000、语言、主题、平台、Chromium 版本、录制日期）。录制器驱动与 aria 通道相同的种子夹具，因此每个状态都无需密钥即可复现；外壳状态跟随平台当前的外壳工具（win32 为 `tool-pwsh`，其他平台为 `tool-bash`），这也是元数据记录平台的原因。后续工作必须匹配这些截图，而非重新设计；像素一致性仅在所记录的录制条件下成立，桌面实现阶段会在其自身平台上重新录制。

静态美术资源另有自己的清单检查：打包后的桌面应用必须让每项上游视觉/静态资源保持存在且可解析。已提交的 [`static-assets.md`](../../../../apps/web/tests/snapshots/visual-baseline/static-assets.md) 清单列出 [`apps/web/public/**`](../../../../apps/web/public/)（`favicon.svg`、`manifest.webmanifest`）以及构建发射进 dist 的每一项资源（KaTeX 字体、语法高亮语言分块、CSS 与 JS 包）；后续桌面交付物证明每一项都能在打包应用中解析。

独立 GUI 必须渲染相同的转录、匹配相同的截图并解析相同的资源；后续桌面交付物通过对着窗口重放相同夹具来一并固化这三者。

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

**新增。** 位于 `apps/` 下的 Electron 外壳装配——即 [分层说明](../../implemented/architecture/2026-07-19-gui-layering-and-rpc-protocol.md) 的「在 `apps/` 下写一个装配模块」步骤——包含一个启动组合、打开窗口并拥有应用私有信号/打印/退出语义的主进程，以及它的 `package.json`（Electron 是唯一新增的运行时依赖）和一个小型引导。阶段一就是全部范围：不承诺任何 IPC 载体，外壳也不伴随任何客户端包或名录改动。未来的 IPC 阶段是单独的架构决策（见 Proposal），届时可能正当地改动 `connection` 包或其名录行；在该决策落地前，桌面路径以回环 HTTP 源交付。

**逐字节或语义不变。** 所有 `packages/client/**` 源文件、所有 `apps/web` UI 源文件、`packages/host/apiproxy/src/api/**` 下的线契约、[`web-app/cordis.patch.yml`](../../../../packages/bundle/web-app/cordis.patch.yml) 与 [`base/cordis.patch.yml`](../../../../packages/bundle/base/cordis.patch.yml) 中的浏览器插件名录与宿主行、主题令牌与 CSS，以及所有 core、api、llm、shell、subprocess、fs、lsp、skill、web 与 terminal 包。桌面外壳原样复用 `web-app` 组合；若需要仅外壳的行（例如打开窗口的启动器），它应作为一个增量组合层或新外壳包出现，而绝不修改既有行。

## Launch and lifecycle

外壳主进程启动与 CLI 相同的组合——通过 [`app-boot` profile 组合器](../../../../packages/boot/app-boot/README.md) 依次为 `dsh-base`、`dsh-web-app`——因此 [`web-startup`](../../../../packages/bundle/web-app/src/startup.ts) 解析相同的 `--host`/`--port`/`--trusted-host` 标志，[`webserver`](../../../../packages/host/webserver/README.md) 绑定回环端口，[`web-runtime`](../../../../packages/bundle/web-app/src/index.ts) 解析 dist 并打印 URL。Loader 树结算后，外壳读取规范 URL 并在该处打开 `BrowserWindow`。窗口与浏览器完全一样地连接：加载 `index.html`、运行两阶段 [`AppWebEntry` 引导](../../../../packages/client/web/README.md)、挂载客户端插件树，并经 [`connection`](../../../../packages/client/connection/README.md) 完成就绪握手。现有的 `app:web-surface` 提示词区段与 `DSH_WEB_URL` 外壳变量对窗口化宿主依然准确。窗口关闭显式映射到 CLI 的有界关闭：[`runProfile`](../../../../apps/cli/src/profile-boot.ts) 安装的 SIGINT/SIGTERM 处理器会调用其返回的 `ProcessShutdown` 控制器，后者处置根节点——关闭 `BrowserWindow` 不会发出其中任何一个信号，因此外壳必须拦截 Electron 的生命周期（`window-all-closed` 或 `before-quit`），调用同一关闭控制器，等待根节点处置完毕，然后退出。该映射属于外壳自身的私有退出语义，不是 harness 改动。桌面路径停留在回环 HTTP 源；本提案不存在 `file://` 阶段。

## Testing plan

对齐以复用来度量，而非靠一套平行的断言面。桌面外壳必须对着窗口通过为浏览器面把关的同一无密钥重放（`DSH_SNAPSHOT=replay pnpm run test:web`），新增的桌面冒烟必须证明窗口加载带有已注入引导清单的被服务 `index.html`、完成与浏览器载体相同的就绪握手、对一个种子会话渲染相同的转录，并解析静态资源清单中的每一项。因此，浏览器 WebUI 与独立 GUI 的对齐意味着：相同的黄金样本、相同的截图、相同的资源解析、相同的线契约、相同的客户端插件名录、相同的 `host.describe` 就绪应答——唯一允许的差异是 WebUI 之外的窗口框架。真实提供方的对齐仍在 `test:e2e` 中，它在无密钥时自动跳过；两种外壳都不新增携带密钥的路径。

## Alternatives considered

**把 UI 重写为原生或独立的桌面前端。** 当「桌面应用」被理解为「桌面工具包」时，这是诱人的默认选项，但它直接违反不重新设计禁令，且把增量最大化。已否决。

**用 Tauri 而非 Electron 构建窗口。** Tauri 引入 Rust 工具链、第二套打包与签名体系，以及一个与 WebUI 所测试的 Chromium 有差异的 webview，在当前阶段没有任何功能收益。已否决，改选代码库自身说明已点名的、以 Node 为先的 Electron 外壳。

**发布一个在操作者默认浏览器中打开回环 URL 的浏览器启动器。** 这不是独立窗口，不提供外壳拥有的生命周期或原生窗口框架，省下的只有窗口代码，却无法满足「独立 GUI」目标。已否决。

**把 IPC 载体作为阶段一。** 作为最终形态它是对的，但它不是小型后续工作：它需要本提案拒绝承诺的完整引导图、bundle、资源与连接提供方设计。对阶段一已否决并推迟；回环 HTTP 服务器已经存在、已经正确、已经受信。

**经新的 Electron 专属路径暴露原生目录选择器。** 不必要——[`directory-picker` seam](../../implemented/architecture/2026-07-28-directory-picker-capability-seam.md) 已经隔离 native 与 browse，其说明指出提供 `native` 交互的 Electron 提供方只是一个双面后端包，无需网关或 `ui-workspace` 改动。已否决，改选复用该 seam。

## Acceptance criteria

- 独立窗口渲染官方 WebUI，与浏览器面无视觉或行为差异，以相同的无密钥重放黄金样本、已提交的截图基线（截图加录制条件）以及静态资源解析检查为证据。
- harness 语义不变：后端、运行时、API、RPC、会话数据、提示词、智能体、工具、插件、技能、模型、预设、权限或配置的行为与 `dsh --profile web` 无任何差异。
- 外壳纯属增量；所有 `packages/client/**` 与 `apps/web` UI 源文件以及 `/api` 线契约保持逐字节或语义不变。
- 窗口达到与浏览器相同的 `host.describe` 就绪应答，并挂载相同的客户端插件名录。
- 桌面路径以回环 HTTP 源交付；本改动不包含任何 IPC 载体、客户端包改动或名录改动，任何未来的 IPC 载体都是单独的架构决策。

## Risks

- **新增运行时依赖。** Electron 为安装包新增了可观的二进制与供应链面。缓解：外壳保持轻薄、WebUI 逐字节不变，且阶段一不再新增其他依赖。
- **绑定端口。** 回环 HTTP 服务器仍挂载，因此独立窗口始终打开一个本地端口。端口仅回环且已有栅栏防护，因此不扩大攻击面；移除端口与 IPC 载体一同推迟。
- **dist 分叉导致视觉漂移。** 若桌面路径曾以不同方式构建前端，对齐会悄然失效。缓解：保持单一 `apps/web` dist 为唯一来源，并用相同黄金样本把关。
- **未来 IPC 载体的信任栅栏范围。** 若被推迟的 IPC 载体将来被设计出来，它必须保留 HTTP 栅栏所强制的回环信任假设；接受非回环来源的桥会削弱它。任何此类设计都应让通道仅限进程本地并复用现有信任逻辑；在那之前，HTTP 栅栏是唯一的信任边界。
