# Agent Note: CI baseline snapshot gates — keep-alive margins, the tool-pwsh row collision, and stream-gated scroll coverage

Status: implemented

English | [中文](2026-08-14-ci-baseline-snapshot-gate-failures.zh.md)

## Problem

The `node 24 / snapshots and artifacts` job is `pull_request`-only, so master pushes never exercise the `test:snapshot` and web-browser-snapshot gates; the automated CI-baseline issue surfaced four reproducible failures on the default-branch tree (issue #27 tracked three; the stale pwsh-tool-turn golden is the fourth).

1. `headless.snapshot.ts` ("keeps provider comments alive and sends DeepSeek defaults through the one-shot app") asserted one request and received two. The mock server sends three SSE keep-alives at 60ms and the fixture's `streamIdleTimeoutMs` was 150ms; under CI event-loop load a single >90ms gap between transport events fired the adapter's idle watchdog, threw `TIMEOUT`, and `dsh-llm-retry` (mounted by `dsh-agent-spine-demo`) retried it per the default policy — so the turn still succeeded and the test failed only on the request count.
2. `pwsh-terminal.e2e.ts` failed to boot: `duplicate loader entry id: tool-pwsh`. The web-app bundle patch disables the shipped `tool-pwsh` row in place (the "disable rather than delete" preset refactor, 2026-08-11), while the lane's overlay inserted a fresh `tool-pwsh` row with the same id; the Loader rejects duplicate ids in the final entry list.
3. `chat-scroll-contract.e2e.ts:514` (`expected 124 to be greater than 129`) — the first scenario's pace-paced text stream (120 deltas at 24ms, ~3s total) finished before the test computed its anchor under slow CI, so the chunk-growth poll starved.
4. `acp.snapshot.ts` (`pwsh-tool-turn`) — the pinned tool-schemas golden still carried the pre-rename "task" wording and the old pwsh description; only a host with `pwsh` can record that lane, so the naming-contract refresh skipped it.

## Decision

1. The deepseek-defaults snapshot now proves comment-rearming with an order-of-magnitude margin: the fixture's `streamIdleTimeoutMs` is 1000ms and the mock sends 25 keep-alives at 60ms (data at ~1.5s, past the idle timeout, so the single-request contract still fails loudly if comments ever stop counting as transport activity). A CI stall must now exceed ~940ms between events instead of ~90ms.
2. The pwsh-terminal overlay re-enables the shipped `tool-pwsh` row (`disabled: false` with the name guard) instead of inserting a duplicate, and disables the shipped `pwsh-sandbox` executor alongside `bash-sandbox` — two `shell` providers cannot both mount, and the lane renders a seeded session rather than a confined execution. The host row and the preset's per-session row are different registry layers, so both may register the same tool name.
3. The first chat-scroll scenario gates its live text stream behind the same file-based tool gate as its siblings: the turn opens with a tool call that blocks on a release file, the test scrolls away and holds the history request while the tool is provably running, then releases the file so the text stream starts after the anchor is computed — "streaming continues while the reader is away" becomes deterministic instead of racing the wall clock.
4. The pwsh-tool-turn tool-schemas golden was refreshed through the keyless refresh path (replay of the committed transcript regenerates the sidecars).

## Alternatives considered

- **Lengthen the pace-paced stream instead of gating it.** Rejected: any fixed duration remains a timing bet, and the sibling scenarios already own the deterministic file-gate pattern.
- **Rename the inserted `tool-pwsh` row id.** Rejected: it would leave two rows for one tool and diverge the lane from the shipped identity; re-enabling the existing row keeps exactly one.
- **Pin the fixture's retry policy to no-retry.** Rejected: it only changes the failure signature (a loud turn error instead of a second request) and masks the timing defect instead of widening the margin.
- **Update the stale golden by hand.** Rejected for the words alone; the keyless refresh regenerated the whole sidecar so every divergence (wording and tool ordering) was corrected at once.

## Consequences

The snapshot and web-browser gates no longer depend on sub-100ms timing under load. The keep-alive rearm contract stays asserted (the keep-alive span exceeds the idle timeout), the pwsh lane keeps one `tool-pwsh` row and boots on hosts where the shipped sandboxed executor would otherwise collide, and the scroll scenario exercises the same real tool round trip as its siblings. The lanes remain macOS/Linux-only: the chat-scroll seeds substitute Windows temp paths into JSON and the pwsh lane's local Windows run still needs the terminal-card golden to be re-verified on Linux CI, which owns the signal.
