# Agent Note: Event-directed reviewer infrastructure recovery

Status: implemented

English | [中文](2026-08-14-event-directed-reviewer-infrastructure-recovery.zh.md)

## Problem

A failed review workflow previously meant both that Codex had returned a deliberate BLOCK and that the reviewer infrastructure had failed before a verdict. Treating both as one failure can start a change agent after an infrastructure outage, or leave an interrupted reviewer permanently unresolved.

## Decision

The reusable review workflow records only a validated `pass` or `block` verdict in `GITHUB_OUTPUT`. It creates and completes a GitHub Actions-owned `codex/review` CheckRun on the exact pull request head, with the current `pull_request_target` run URL. A BLOCK completes the review step successfully, publishes the independent change request, and then fails a dedicated final step; BLOCK and infrastructure failures complete that exact-head CheckRun as failure, while PASS completes it as success. Any failure before a verdict is reviewer infrastructure failure: no change request is published, and the workflow records `automation/review-failed`.

Agent Recovery subscribes to failed or cancelled `Agent PR Review` runs. The controller accepts only the current exact base/head pair from a failed run whose reusable review workflow is pinned to the controller repository and SHA. It reads the trusted job steps: the successful review step plus the dedicated BLOCK-preservation failure proves a deliberate BLOCK and is never re-reviewed. All other failed or cancelled trusted review runs remove and re-add `automation/review-ready`, which wakes the default-branch `pull_request_target:labeled` review path for that current pair, up to three times. A bot-authenticated recovery marker owns the attempt count; after the cap the controller records a dead letter and applies `automation/review-failed` without another model call.

## Verification

Controller tests cover intentional BLOCK suppression, untrusted or altered review provenance rejection, reviewer-infrastructure retry, and the third-attempt dead letter. Workflow tests cover the review recovery subscription and the BLOCK-versus-infrastructure step routing.

## Alternatives considered

**Infer the verdict from a review comment or label.** Comments and labels are audit projections and may be copied or manually changed. The trusted reusable workflow run and its completed job steps are the authorization evidence.

**Retry every failed review workflow.** Repeating a valid BLOCK spends another model call and can create conflicting change requests. The dedicated final step makes the business result distinguishable without trusting prose.

**Use polling or a scheduled reconciler.** Workflow completion already provides the durable event, exact run ID, and concurrency key. A scheduled scan adds delay and another authorization surface.

## Consequences

The controller performs an additional jobs API read only after a failed or cancelled trusted review run. Recovery is intentionally conservative: a run without one exact current base/head pair is ignored, and an exhausted reviewer failure remains visible rather than silently retrying indefinitely. The existing event-directed PR review status record remains independent because it governs Project lifecycle state, not reviewer execution recovery.
