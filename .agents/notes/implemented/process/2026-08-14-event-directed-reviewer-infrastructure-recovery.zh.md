# Agent Note: 由事件驱动的评审基础设施恢复

Status: implemented

[English](2026-08-14-event-directed-reviewer-infrastructure-recovery.md) | 中文

## 问题

此前评审工作流失败同时可能表示 Codex 给出了明确的 BLOCK，也可能表示评审基础设施在产生 verdict 前已失败。把两者视为同一种失败，既可能在基础设施故障后启动变更代理，也可能使中断的评审永久无法解决。

## 决策

可复用评审工作流仅把已验证的 `pass` 或 `block` verdict 写入 `GITHUB_OUTPUT`。它在 exact pull request head 上创建并终结由 GitHub Actions 拥有、指向当前 `pull_request_target` run URL 的 `codex/review` CheckRun。BLOCK 会成功完成评审 step、发布独立变更请求，再使专用最终 step 失败；BLOCK 和基础设施失败均把该 exact-head CheckRun 终结为 failure，PASS 则终结为 success。任何 verdict 之前的失败都是评审基础设施失败：不发布变更请求，并记录 `automation/review-failed`。

Agent Recovery 订阅失败或取消的 `Agent PR Review` run。控制器只接受 reusable review workflow 被固定到 controller repository 和 SHA 的失败 run 中、当前仍一致的 exact base/head pair。它读取受信 job steps：成功的评审 step 加上专用 BLOCK 保留 step 的失败，证明是明确 BLOCK，绝不重审。其它所有失败或取消的受信 review run 最多三次移除后重加 `automation/review-ready`，由默认分支的 `pull_request_target:labeled` 评审路径为当前 pair 唤醒评审。由 bot 身份认证的 recovery marker 拥有尝试计数；达到上限后，控制器记录 dead letter 并应用 `automation/review-failed`，不再调用模型。

## 验证

控制器测试覆盖明确 BLOCK 的抑制、不受信或被篡改的评审 provenance 拒绝、评审基础设施重试，以及第三次尝试后的 dead letter。工作流测试覆盖评审恢复订阅和 BLOCK 与基础设施的 step 路由。

## 考虑过的替代方案

**从评审评论或标签推断 verdict。** 评论和标签只是审计投影，可能被复制或人工修改。受信 reusable workflow run 及其完成的 job steps 才是授权证据。

**重试每个失败的评审工作流。** 重复有效的 BLOCK 会额外消耗模型调用，也可能创建冲突的变更请求。专用最终 step 可区分业务结果，而无需信任文本。

**使用轮询或定时 reconciler。** 工作流完成事件已提供 durable event、exact run ID 和 concurrency key。定时扫描会增加延迟和新的授权表面。

## 后果

控制器只在失败或取消的受信 review run 后额外读取一次 jobs API。恢复有意保持保守：没有唯一且当前一致的 exact base/head pair 的 run 会被忽略；达到上限的评审失败保持可见，而不是无限静默重试。既有的事件驱动 PR review status 记录仍保持独立，因为它管理的是 Project 生命周期状态，而不是评审执行恢复。
