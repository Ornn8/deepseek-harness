# Agent Note: Fork-safe automation workflows and node-pty manylinux rebuild

Status: implemented

English | [中文](2026-08-13-fork-safe-automation-and-node-pty-manylinux-rebuild.zh.md)

## Problem

`Ornn8/deepseek-harness` forks the upstream repository to run its GitHub-agent automation pipeline, but three checks fail in the fork for reasons that are hardcoded-upstream artifacts, not fork changes.

1. The Issue policy check reads `config.json`, whose `organization` and `repository` are both `deepseek-harness`, so `policy.mjs pr` queries `/repos/deepseek-harness/deepseek-harness/...`. A fork PR therefore receives a 404 from the `requested_reviewers` endpoint and the job fails.
2. The Issue lifecycle check hardcodes `owner: deepseek-harness` and `repositories: deepseek-harness` on its `create-github-app-token` step, and that step requires `vars.DSH_ISSUE_APP_CLIENT_ID` plus `secrets.DSH_ISSUE_APP_PRIVATE_KEY`. The fork configures neither, so the action fails with "client-id must be set to a non-empty string".
3. The required `python runtime / release-shaped Linux x64 / node24-linux-x64` check rebuilds the node-pty addon inside the manylinux 2.28 container by reusing the Makefile `pnpm install` generated on the host. node-pty's `binding.gyp` resolves node-addon-api through `require()`, which follows pnpm's symlink into the sibling `.pnpm/node-addon-api@7.1.1/` store directory; gyp then writes and references the `node_addon_api*` sub-makefiles at a relative path one level too shallow (`../../../node-addon-api@7.1.1/...` from the `build/` directory), so the container `make` stops with `No rule to make target .../node_addon_api_maybe.target.mk`.

## Decision

Each check derives its coordinates from the repository it actually runs in instead of naming the upstream repository, and the App-gated lifecycle becomes inert when its credentials are absent.

`policy.mjs` splits `process.env.GITHUB_REPOSITORY` (`owner/repo`) into `organization` and `repository` and prefers them over the `config.json` defaults; local and test runs leave the variable unset and keep the checked-in defaults. Every REST/GraphQL path that previously interpolated `config.organization`/`config.repository` now interpolates those derived constants.

`issue-lifecycle.yml` adds `vars.DSH_ISSUE_APP_CLIENT_ID != ''` to the job-level `if`, so a credential-less repository (including this fork) skips the job instead of failing it, and derives the App installation from `github.repository_owner` and `github.event.repository.name` so an App-installed fork addresses its own installation rather than upstream.

`build-exe-for-python-sdk.yml` sets `NODE_OPTIONS: --preserve-symlinks` on the `Install (immutable)` step. Node then resolves `require('node-addon-api')` to the symlink path under node-pty instead of the resolved sibling store path, and gyp writes the `node_addon_api*` sub-makefiles under `node-pty` with a stable relative reference, which the manylinux rebuild reuses without a broken target file.

## Alternatives considered

**Keep the host Makefile and patch the broken path in the container.** Creating the missing `node_addon_api*.target.mk` files (empty or with hand-written stamp rules) before `make` would paper over the symlink-derived path without fixing its cause, and the exact stamp names must track gyp's output naming; the symlink-preserving configure fixes the generation at its source.

**Hoist node-addon-api with `node-linker=hoisted`.** Hoisting changes the whole install layout, which the single-exe deploy step already carefully selects per-stage (`--config.node-linker=hoisted` for the closure, isolated for the source install), and would force a broader layout change for one native addon.

**Gate the lifecycle on the private key with a step guard.** A step-level guard can test `secrets`, but a skipped job is the explicit "inert" state the requirement names; `vars.DSH_ISSUE_APP_CLIENT_ID` is set together with the private key in the repositories that own the App, so the job-level variable test is the correct and sufficient fork-safety condition.

## Consequences

The three checks now pass on a fork without App credentials or a matching issue-management Project. The `policy.mjs` derivation changes no upstream behavior: `GITHUB_REPOSITORY` equals the configured coordinates there, and the Project lookup still targets the owning organization.

A fork that later installs the issue-management App and wants lifecycle status updates must still provide a matching ProjectV2 (`config.json` still names the upstream Project number and title) and both App credentials; the workflow-level changes only make credential absence non-fatal and the App installation self-addressing, they do not provision a fork Project.

`--preserve-symlinks` applies to every Node process in the install step, not just node-gyp. This is scoped to the single build job's install step; a future native dependency whose postinstall depends on resolving a pnpm symlink to its real path would need the same root-cause review rather than a broad removal of the flag.
