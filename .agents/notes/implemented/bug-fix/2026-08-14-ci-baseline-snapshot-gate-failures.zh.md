# Agent Note: CI 基线快照门禁 — keep-alive 余量、tool-pwsh 行冲突与流门控滚动覆盖

Status: implemented

[English](2026-08-14-ci-baseline-snapshot-gate-failures.md) | 中文

## Problem

`node 24 / snapshots and artifacts` 任务仅由 `pull_request` 触发，master 推送从不经过 `test:snapshot` 与 web 浏览器快照门禁；自动化的 CI 基线 issue 在默认分支树上暴露了四个可复现失败（issue #27 记录了三个；陈旧的 pwsh-tool-turn 黄金文件是第四个）。

1. `headless.snapshot.ts`（"keeps provider comments alive and sends DeepSeek defaults through the one-shot app"）断言只发一次请求，实际收到两次。mock 服务器以 60ms 间隔发送三条 SSE keep-alive，fixture 的 `streamIdleTimeoutMs` 为 150ms；在 CI 事件循环负载下，任意一次超过 90ms 的传输间隔都会触发适配器的空闲看门狗，抛出 `TIMEOUT`，而 `dsh-llm-retry`（由 `dsh-agent-spine-demo` 挂载）按默认策略重试——于是回合仍然成功，测试只在请求计数上失败。
2. `pwsh-terminal.e2e.ts` 无法启动：`duplicate loader entry id: tool-pwsh`。web-app bundle patch 就地禁用了随附的 `tool-pwsh` 行（2026-08-11 的 "disable rather than delete" preset 重构），而该 lane 的 overlay 又插入了一条同 id 的新 `tool-pwsh` 行；Loader 拒绝最终条目列表中的重复 id。
3. `chat-scroll-contract.e2e.ts:514`（`expected 124 to be greater than 129`）——第一个场景的节奏化文本流（120 个 delta，24ms 间隔，约 3 秒）在慢速 CI 下先于测试计算锚点而结束，chunk 增长轮询因此饿死。
4. `acp.snapshot.ts`（`pwsh-tool-turn`）——钉住的 tool-schemas 黄金文件仍保留重命名前的 "task" 措辞与旧版 pwsh 描述；只有带 `pwsh` 的主机才能录制该 lane，因此命名契约刷新跳过了它。

## Decision

1. deepseek-defaults 快照现在以数量级余量证明注释重新武装机制：fixture 的 `streamIdleTimeoutMs` 为 1000ms，mock 以 60ms 间隔发送 25 条 keep-alive（数据约 1.5s 后到达，超过空闲超时，因此若注释不再算作传输活动，单请求契约仍会响亮失败）。CI 停顿现在需要超过约 940ms 的事件间隔，而非约 90ms。
2. pwsh-terminal overlay 改为重新启用随附的 `tool-pwsh` 行（带 name 守卫的 `disabled: false`），而不是插入重复行，并随 `bash-sandbox` 一起禁用随附的 `pwsh-sandbox` 执行器——两个 `shell` 提供方不能同时挂载，而该 lane 只渲染种子会话，不做受限执行。宿主行与 preset 的按会话行属于不同的注册表层，因此同名工具可同时注册。
3. 第一个 chat-scroll 场景用与其兄弟场景相同的基于文件的工具门控住实时文本流：回合以阻塞在 release 文件上的工具调用开场，测试在工具确证运行期间滚动离开并挂起历史请求，然后释放文件使文本流在锚点计算之后才开始——"读者离开时流仍在继续"从竞速墙钟变为确定性。
4. pwsh-tool-turn 的 tool-schemas 黄金文件通过无密钥刷新路径重新生成（回放已提交的转录并重建 sidecar）。

## Alternatives considered

- **加长节奏化流而非门控。** 拒绝：任何固定时长仍是时序赌博，且兄弟场景已拥有确定性的文件门控模式。
- **重命名插入的 `tool-pwsh` 行 id。** 拒绝：会为一个工具留下两行，并使 lane 偏离随附身份；重新启用现有行恰好保留一行。
- **将 fixture 的重试策略钉为不重试。** 拒绝：只改变失败形态（响亮的回合错误而非第二次请求），并掩盖时序缺陷而非加宽余量。
- **手工修正陈旧黄金文件。** 仅修词被拒绝；无密钥刷新一次性重新生成整个 sidecar，同时纠正措辞与工具排序。

## Consequences

快照与 web 浏览器门禁不再依赖亚 100ms 的负载时序。keep-alive 重新武装契约仍被断言（keep-alive 跨度超过空闲超时），pwsh lane 只保留一行 `tool-pwsh`，并在随附沙箱执行器否则会冲突的主机上可启动；滚动场景与其兄弟场景一样执行真实的工具往返。这些 lane 仍仅限 macOS/Linux：chat-scroll 种子会把 Windows 临时路径替换进 JSON，而 pwsh lane 在 Windows 本地的运行仍需在 Linux CI 上复核终端卡片黄金文件，CI 拥有该信号。
