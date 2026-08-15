# Agent Note: CI baseline integration branch lands four repairs together

Status: implemented

[English](2026-08-15-ci-baseline-integration.md) | 中文

## Problem

四个相互独立的默认分支 CI 基线缺陷各有一份专属修复 PR——#27 → PR #30（快照与浏览器门禁失败）、#31 → PR #32（manylinux node-pty 重建失败）、#36 → PR #37（Windows git-fixture 超时与安装器锁竞争失败）、#38 → PR #39（负载敏感的覆盖率超时）。每个修复 PR 都证明了自己的目标作业通过并带有 exact-head Codex PASS，但每个 PR 仍要针对包含其余三个缺陷的 `master` 运行完整必需 CI 矩阵，因此聚合门禁 `all checks passed` 在每个单独 head 上始终为红。在 exact-review 与全必需检查的落地策略下，任何修复 PR 都无法率先合并；同一基线还阻塞了无关的待办工作（GUI-01 PR #10、webserver 缺陷修复 PR #23）。

## Decision

从当时的 `master`（`039fff89b`）切出单一集成分支 `agent/ci-baseline-integration`，按 PR 顺序 cherry-pick PR #30、#32、#37、#39 的已评审提交，保留每个提交的作者与消息。合并范围恰好是四个已评审 diff 的并集（已逐修复分支对照合并 head 验证），因此组合冲突不可能混入未评审内容。集成 PR 携带 `Closes #40`，对完整合并 diff 获得全新的 exact base/head Codex 评审，并在合并树上运行一次完整必需矩阵。四个修复 PR 作为溯源保持开启，直到合并后的修复到达 `master` 并在其上验证通过；只有此后它们才与 Issues #27、#31、#36、#38 一起关闭。下游 PR #10 与 #23 在修复后的 `master` 上变基并获得新的评审与 CI 证据。

## Alternatives considered

**先合并一个修复 PR。** 被拒：基线上其余三个缺陷使聚合门禁无法在任何单独 head 上通过，而落地策略要求该门禁先于任何合并。

**以豁免或缩减检查集落地。** 被拒：Issue 禁止绕过、禁用或手动标记任何必需检查，且分支保护由落地控制器强制执行。

**以 GitHub stack 或 merge-queue 批次落地四个 PR。** 被拒：每个 stack 层与每个入队 PR 仍要针对自己的基线运行完整必需矩阵并通过 `all checks passed` 才能合并，这只会复现同一循环依赖而非消除它。

## Consequences

基线修复以单个已评审提交范围、单个 CI 结论到达 `master`，取代四个不完整的信号；解除阻塞的主线让 #10 与 #23 得以推进。代价是评审面对一个更大的 diff，以及一次落地后的清理步骤——仅在合并后的修复于 `master` 上验证通过后，才关闭四个被取代的修复 PR 及其 Issue。
