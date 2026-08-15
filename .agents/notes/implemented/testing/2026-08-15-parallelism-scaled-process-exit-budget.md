# Agent Note: Parallelism-scaled process-exit scenario budget

Status: implemented

English | [中文](2026-08-15-parallelism-scaled-process-exit-budget.zh.md)

## Problem

The `node 24 / coverage` CI job intermittently fails in `packages/subprocess/subprocess-local/tests/process-exit.spec.ts`: each scenario launches its fixture host through the source launch path (tsx) and waits up to a fixed 30s budget for the host to publish `tree.json` and `ready` in a temp fixture directory. Under CI runner load the source-launched boot occasionally exceeds that budget, and the tripping subtest varies per run. Evidence: runs 31851826017 (PR #34 head), 31852414258 (PR #10 head), and 31857598811 (PR #37 head) failed at ~30s with `SyntaxError: Unexpected end of JSON input` or `ENOENT` on `ready` inside the readiness polls, while control run 31834738133 (PR #30 head) passed. The job is `pull_request`-only, so master pushes never exercise it and the default-branch proof comes from pull_request runs.

## Decision

`process-exit.spec.ts` derives its readiness budget from machine parallelism instead of a fixed deadline: `Math.max(30_000, availableParallelism() * 4_000)` milliseconds, with a 30s floor that leaves small and local machines unchanged. The budget applies to the host-readiness waits (`tree.json`, `ready`), the observability wait, and the execa child timeout. The per-test deadline keeps the same 15s margin the fixed 30s budget had, and the cleanup-assertion wait (`waitForGone`) keeps its own fixed 10s budget so boot headroom never dilutes the cleanup assertions.

## Verification

The gate's own evidence is the `node 24 / coverage` job on the fixing PR's run: it must pass with no readiness-budget exhaustion. Local focused runs of the spec and the repository gates cover the edit surface.

## Alternatives considered

**Fixed larger budget.** Rejected: a single fixed increase either under-covers the most contended lane (the shared 64-core failover VM runs up to 48 coverage workers) or over-covers small machines for no reason; scaling with machine parallelism matches the budget to the lane's contention.

**Scale by `DSH_COVERAGE_MAX_WORKERS`.** Rejected: the spec would couple to a gate-specific environment variable that only the coverage lane sets, and renaming that variable would silently degrade the budget.

**Reduce coverage-worker concurrency.** Rejected: it trades one flake for longer gate wall-clock on every run and changes CI policy rather than the scenario.

## Consequences

The scenario absorbs multi-minute starved boots on contended shared runners at the cost of a longer worst-case stall when the host is genuinely broken — the budget is a backstop, and healthy boots still complete in seconds. Small machines keep the previous 30s deadline.
