# Agent Note: CI baseline integration branch lands four repairs together

Status: implemented

English | [中文](2026-08-15-ci-baseline-integration.zh.md)

## Problem

Four independent default-branch CI baseline defects each had a dedicated repair pull request — #27 → PR #30 (snapshot and browser gate failures), #31 → PR #32 (manylinux node-pty rebuild failure), #36 → PR #37 (Windows git-fixture timeout and lock-contention failures), #38 → PR #39 (load-sensitive coverage timeout). Every repair PR proved its own target job green with an exact-head Codex PASS, but each PR still runs the full required CI matrix against a `master` containing the other three defects, so the aggregate `all checks passed` gate stayed red on every individual head. Under the exact-review and all-required-checks landing policy no repair PR could be first to merge, and the same baseline blocked unrelated ready work (GUI-01 PR #10, webserver bugfix PR #23).

## Decision

One integration branch, `agent/ci-baseline-integration`, is cut from the then-current `master` (`039fff89b`) and cherry-picks the reviewed commits of PRs #30, #32, #37, and #39 in PR order, preserving each commit's author and message. The combined range is exactly the union of the four reviewed diffs (verified per repair branch against the combined head), so combination conflicts cannot smuggle in unreviewed content. The integration pull request carries `Closes #40`, receives a fresh exact base/head Codex review over the complete combined diff, and runs the full required matrix once on the combined tree. The individual repair pull requests stay open as provenance until the combined fixes reach `master` and are verified there; only then do they close together with Issues #27, #31, #36, and #38. Downstream PRs #10 and #23 rebase onto the repaired `master` and get fresh review and CI evidence.

## Alternatives considered

**Merge one repair PR first.** Rejected: the aggregate gate cannot pass on any individual head because the other three defects are in the base, and the landing policy requires that gate before any merge.

**Land with a waived or re-scoped check set.** Rejected: the issue forbids bypassing, disabling, or manually marking any required check, and branch protection is enforced by the landing controller.

**Land the four as a GitHub stack or merge-queue batch.** Rejected: every stack layer and every queued PR still runs the full required matrix against its base and must pass `all checks passed` before merging, which reproduces the same circular dependency instead of removing it.

## Consequences

The baseline repairs reach `master` as one reviewed commit range with one CI verdict instead of four partial signals, and the unblocked mainline lets #10 and #23 proceed. The cost is a single larger diff for review and a post-landing cleanup step that closes the four superseded repair PRs and their issues only after the combined fixes are verified on `master`.
