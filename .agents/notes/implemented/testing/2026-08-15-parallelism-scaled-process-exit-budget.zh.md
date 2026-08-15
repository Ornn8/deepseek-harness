# Agent Note: 按并行度缩放的 process-exit 场景预算

Status: implemented

[English](2026-08-15-parallelism-scaled-process-exit-budget.md) | 中文

## Problem

`node 24 / coverage` CI job 会间歇性地在 `packages/subprocess/subprocess-local/tests/process-exit.spec.ts` 中失败：每个场景都通过 source launch 路径（tsx）启动 fixture host，并等待最多 30 秒的固定预算，让 host 在临时 fixture 目录中发布 `tree.json` 和 `ready`。在 CI runner 负载下，source-launched 启动偶尔会超过该预算，且每次运行触发失败的具体子测试都不同。证据：run 31851826017（PR #34 head）、31852414258（PR #10 head）和 31857598811（PR #37 head）在约 30 秒时以 `SyntaxError: Unexpected end of JSON input` 或针对 `ready` 的 `ENOENT` 在就绪轮询中失败，而对照 run 31834738133（PR #30 head）通过。该 job 仅限 `pull_request`，因此 master push 永远不会执行它，default branch 的证明来自 pull_request 运行。

## Decision

`process-exit.spec.ts` 改为从机器并行度推导就绪预算，而不是固定期限：`Math.max(60_000, availableParallelism() * 4_000)` 毫秒。下限为 60 秒而非最初的 30 秒：托管 4-vCPU coverage runner 在最近五次运行中有两次在门禁负载下触发 30 秒下限（run 31857598811 与 31867328646——CI 基线集成分支 head——均在约 30 秒时因读到不完整的 `tree.json` 而在 `direct` 场景失败），因此小型机器保留真实余量，而更大 lane 仍随并行度缩放（每 CPU 4 秒）。该预算适用于 host 就绪等待（`tree.json`、`ready`）、可观察性等待以及 execa child 超时。测试级期限保持与固定 30 秒预算相同的 15 秒余量，而清理断言等待（`waitForGone`）保留自己固定的 10 秒预算，因此启动余量永远不会稀释清理断言。

## Verification

该门禁自身的证据是修复 PR 的 run 上的 `node 24 / coverage` job：它必须通过且不出现就绪预算耗尽。本地对 spec 的定向运行以及仓库门禁覆盖本次改动面。

## Alternatives considered

**固定的更大预算。** 拒绝，因为单次固定增加要么覆盖不足竞争最激烈的 lane（共享 64 核 failover VM 最多运行 48 个 coverage worker），要么对小型机器过度放宽而毫无理由；按机器并行度缩放能让预算与 lane 的竞争程度匹配。

**按 `DSH_COVERAGE_MAX_WORKERS` 缩放。** 拒绝，因为 spec 会耦合到仅 coverage lane 设置的、门禁专用的环境变量，重命名该变量会静默削弱预算。

**降低 coverage worker 并发。** 拒绝，因为它用每次运行更长的门禁墙钟时间换取一个 flake，并且改变的是 CI 策略而不是场景本身。

## Consequences

场景能够吸收竞争激烈的共享 runner 上长达数分钟的饥饿启动，代价是 host 真正损坏时最坏情况的停顿更长——预算只是兜底，健康的启动仍然在数秒内完成。小型机器保留 60 秒下限，是最初固定期限的两倍，负载下的小型 runner 不再把 flake 变成掷硬币。
