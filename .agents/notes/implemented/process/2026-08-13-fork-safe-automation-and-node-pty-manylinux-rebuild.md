# Agent Note: Fork-safe automation workflows and node-pty manylinux rebuild

Status: implemented

English | [中文](2026-08-13-fork-safe-automation-and-node-pty-manylinux-rebuild.zh.md)

## Problem

`Ornn8/deepseek-harness` forks the upstream repository to run its GitHub-agent automation pipeline, but four failure modes prevent that fork from operating autonomously.

1. The Issue policy check reads `config.json`, whose `organization` and `repository` are both `deepseek-harness`, so `policy.mjs pr` queries `/repos/deepseek-harness/deepseek-harness/...`. A fork PR therefore receives a 404 from the `requested_reviewers` endpoint and the job fails.
2. The Issue lifecycle check hardcodes `owner: deepseek-harness` and `repositories: deepseek-harness` on its `create-github-app-token` step, and that step requires `vars.DSH_ISSUE_APP_CLIENT_ID` plus `secrets.DSH_ISSUE_APP_PRIVATE_KEY`. The fork configures neither, so the action fails with "client-id must be set to a non-empty string".
3. The required `python runtime / release-shaped Linux x64 / node24-linux-x64` check rebuilds the node-pty addon inside the manylinux 2.28 container by reusing the Makefile `pnpm install` generated on the host. node-pty's `binding.gyp` resolves node-addon-api through `require()`, which follows pnpm's symlink into the sibling `.pnpm/node-addon-api@7.1.1/` store directory; gyp then writes and references the `node_addon_api*` sub-makefiles at a relative path one level too shallow (`../../../node-addon-api@7.1.1/...` from the `build/` directory), so the container `make` stops with `No rule to make target .../node_addon_api_maybe.target.mk`.
4. One caller workflow combines Issue dispatch, Codex review, DSH repair, and merge intent. It treats mutable labels and a head-only status as durable state, grants unrelated jobs a coupled permission surface, and relies on `repository_dispatch` even while the receiving workflow exists only in the pull request rather than on the default branch. A blocking review can therefore fail to wake DSH during bootstrap, and a later base update can leave a successful head status that no longer represents the reviewed base/head pair.

## Decision

Each check derives its coordinates from the repository it actually runs in instead of naming the upstream repository, and the App-gated lifecycle becomes inert when its credentials are absent.

Failed or cancelled top-level Agent Issues and Agent PR Rework runs now enter a separate event-driven recovery workflow. The recovery controller verifies the exact reusable controller SHA in the source run's `referenced_workflows`, locates the matching durable Issue or pull-request status record, rechecks the live Issue state or exact PR head, and records no more than three retries. Comments and labels remain audit projections; a forged record cannot authorize a retry. The third exhausted attempt remains an `agent/dsh-failed` dead-letter and does not invoke a model.

`policy.mjs` splits `process.env.GITHUB_REPOSITORY` (`owner/repo`) into `organization` and `repository` and prefers them over the `config.json` defaults; local and test runs leave the variable unset and keep the checked-in defaults. Every REST/GraphQL path that previously interpolated `config.organization`/`config.repository` now interpolates those derived constants.

`issue-lifecycle.yml` adds `vars.DSH_ISSUE_APP_CLIENT_ID != ''` to the job-level `if`, so a credential-less repository (including this fork) skips the job instead of failing it, and derives the App installation from `github.repository_owner` and `github.event.repository.name` so an App-installed fork addresses its own installation rather than upstream.

`build-exe-for-python-sdk.yml` installs the native-build job with pnpm's hoisted linker, resolves the installed node-pty package through Node's module resolver, and then invokes its npm lifecycle with `npm --prefix` to force a Linux source rebuild. Calling npm at the resolved directory avoids guessing pnpm's workspace or store layout, while the forced rebuild bypasses the packaged prebuild, invokes node-gyp against the stable job-level node-addon-api layout, and generates the Makefile before it is mounted into the manylinux container. The generated Makefile also names npm's node-gyp `addon.gypi`, so the job derives the active Node installation prefix from `process.execPath`, verifies that file, and mounts the prefix read-only at the same absolute path. The container then rebuilds the addon against glibc 2.28. The executable builder publishes the resulting addon as the required `${executable}-pty.node` companion, and the checked-in node-pty patch loads that real-filesystem companion before its development build and prebuild candidates. This avoids making the release depend on pkg's opaque SEA native-addon extraction while preserving normal node-mode resolution when no companion exists. The clean manylinux wheel smoke requires the installed companion, rejects unresolved shared-library dependencies with `ldd`, and then starts the complete runtime.

The target repository uses separate workflows for Issue dispatch, exact-pair PR review, trusted rework feedback, explicit landing, and health. Each caller pins the reusable workflow revision in `uses`; the controller revision, role worker, and runner selection are controller-owned rather than caller inputs. CI repair and CI-triggered landing declare the configured CI workflow name as a literal `workflow_run.workflows` subscription so GitHub can register the listeners, then compare the delivered name with `DSH_AUTOMATION_CI_WORKFLOW` before dispatch. Every privileged pull request listener, including project lifecycle and Issue policy, uses `pull_request_target` and checks out the default-branch policy, so a pull request cannot replace a privileged workflow definition before it reaches the default branch. Review-submitted events are not privileged inputs; the automated BLOCK label reaches the same lifecycle through the trusted target listener.

The automation repository exposes one Agent Worker invocation and terminal-receipt interface. Runtime-specific Adapters start and observe DSH Web, ChatGPT Desktop, or a JSON-speaking command; target workflows map the `review` and `change` roles to a configured worker id. The roles use separate `agent-reviewer` and `agent-change` runner registrations, processes, work directories, concurrency groups, and health jobs.

The review worker receives an exact base/head checkout with no Actions credential and performs read-only inspection. A job-scoped Actions token publishes the pending or final `codex/review` compatibility status, the English review comment, and projection labels. A BLOCK verdict records the exact pair and terminates the review task after the controller publishes an immutable, idempotent `agent_work_requested` WorkRequest for the `change` role. The receiving workflow starts independently, validates the WorkRequest fields, live head, review marker, and label, and then invokes its configured change worker. A completed failed workflow whose name equals `DSH_AUTOMATION_CI_WORKFLOW` creates a separate request keyed by run id and attempt; the controller requires that name, failure conclusion, matching PR number, and exact current head before the change worker may inspect its logs or modify the branch.

A PASS verdict emits `dsh-land` instead of enabling long-lived auto-merge. The landing controller accepts only a current non-draft PR to the repository default branch, requires an exact base/head PASS record and every live branch-protection context at success, repeats those checks immediately before a squash merge, and otherwise exits without changing the PR. A successful configured CI workflow run retries landing after pending checks complete.

After a push to the repository default branch, reconciliation dispatches review only for open same-repository PRs whose current base/head pair has no completed or pending exact-pair review; it skips draft, behind, and already-covered PRs. The manual health workflow checks each configured worker on its own runner plus the pinned controller and GitHub access without invoking a model.

## Alternatives considered

**Keep the host Makefile and patch the broken path in the container.** Creating the missing `node_addon_api*.target.mk` files (empty or with hand-written stamp rules) before `make` would paper over the symlink-derived path without fixing its cause, and the exact stamp names must track gyp's output naming; the hoisted layout plus an explicit source rebuild fixes the generated dependency path at its source.

**Keep `NODE_OPTIONS=--preserve-symlinks`.** The failed hosted run proved that it did not change the generated dependency path. It also changes every Node process in the install step rather than selecting an install layout that makes node-gyp's generated path reproducible.

**Keep node-pty embedded in the SEA archive.** pkg can extract native addons from its virtual filesystem, but node-pty catches each generated-path load error and reports only its final prebuild miss. A release would therefore depend on an opaque extraction path whose actionable failure is hidden. An explicit wheel companion keeps the native payload and its platform tag visible and lets the operating-system loader report the real error.

**Gate the lifecycle on the private key with a step guard.** A step-level guard can test `secrets`, but a skipped job is the explicit "inert" state the requirement names; `vars.DSH_ISSUE_APP_CLIENT_ID` is set together with the private key in the repositories that own the App, so the job-level variable test is the correct and sufficient fork-safety condition.

**Keep one caller workflow for all agent events.** A single file is shorter, but most event deliveries produce skipped jobs, every change couples unrelated trigger and permission review, and bootstrap behavior is difficult to distinguish from steady-state behavior. Separate callers keep event ownership and permissions visible while reusable workflows retain the implementation.

**Use a head-only status with GitHub auto-merge.** A status attached only to the head can survive a base change, while auto-merge retains merge intent after the evidence that created it is stale. An exact-pair review record plus a short-lived landing transaction binds approval to both revisions and rechecks immediately before mutation.

**Poll GitHub for Issues, comments, or check completion.** Polling adds idle model or controller activity and still introduces a detection interval. Native GitHub events drive every model invocation; reconciliation and health remain deterministic and model-free.

## Consequences

The three checks now pass on a fork without App credentials or a matching issue-management Project. The `policy.mjs` derivation changes no upstream behavior: `GITHUB_REPOSITORY` equals the configured coordinates there, and the Project lookup still targets the owning organization.

A fork that later installs the issue-management App and wants lifecycle status updates must still provide a matching ProjectV2 (`config.json` still names the upstream Project number and title) and both App credentials; the workflow-level changes only make credential absence non-fatal and the App installation self-addressing, they do not provision a fork Project.

The hoisted linker and forced source rebuild are scoped to node-pty in the Linux native-build job. A native dependency whose lifecycle depends on isolated pnpm store paths requires its own compatibility review before this job's layout changes again.

The target repository now contains more workflow entry files, but their logic remains in the dedicated automation repository and their immutable pin makes the deployed controller auditable. Labels remain operator-visible projections and recovery triggers, not approval evidence; comments contain the exact pair and visible DSH or Codex task identity needed to supervise a run. CI failure repair is event-driven and creates no model activity while checks are green.

Stopping one role runner leaves the other role operational; jobs for the stopped role remain queued in GitHub. Both registrations currently share one Windows host, network connection, DSH Web service where applicable, and persistent host GitHub login used by controller transport and change publication. Moving a role to another machine needs only its runner labels and machine-local worker configuration, while complete host and GitHub-App isolation remains separate security hardening.
