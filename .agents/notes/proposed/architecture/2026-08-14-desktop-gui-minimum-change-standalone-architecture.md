# Agent Note: Desktop GUI Minimum-Change Standalone Architecture

Status: proposed

English | [中文](2026-08-14-desktop-gui-minimum-change-standalone-architecture.zh.md)

## Problem

The DeepSeek Harness WebUI ships as a browser application: [`apps/web`](../../../../apps/web/) is a Vite build over the [`@deepseek-ai/dsh-client-web`](../../../../packages/client/web/README.md) shell, served by the loopback HTTP server that the [`dsh-web-app` bundle](../../../../packages/bundle/web-app/README.md) mounts over [`dsh-base`](../../../../packages/bundle/base/README.md). The product needs this exact surface delivered as a standalone desktop GUI — a native window the operator launches directly — with the smallest possible code delta, while preserving the original appearance and behavior exactly.

The deliverable is bounded by three prohibitions. No redesign or style specification, and no changes to theme tokens, spacing, typography, colors, layout, copy, icons, or component appearance. No backend, runtime, API, RPC, session-data, prompt, agent, tool, plugin, skill, model, preset, permission, or configuration semantic changes. And no implementation beyond the small baseline and probe artifacts this investigation needs. This note records the parity baseline, the functional surface to preserve, the least-invasive architecture, the change boundary, the launch and lifecycle plan, and the parity testing plan. The shell itself is a later task.

The codebase has already anticipated this client shape without deciding it: the [GUI layering and RPC protocol note](../../implemented/architecture/2026-07-19-gui-layering-and-rpc-protocol.md) names Electron among the coming clients, isolates the transport behind `AbstractApiClient.doFetch`, and lists an "IPC bridge subclass" as a hypothetical with no such shell yet existing. This proposal is the decision those notes deferred.

## Proposal

Reuse the official WebUI wholesale and add only a thin shell around it. A standalone window renders the exact built [`apps/web`](../../../../apps/web/) frontend — the same React tree, CSS tokens, and browser plugin roster — so pixels and interactions are identical by construction. The desktop process boots the existing harness host in-process through the same [`dsh-base`](../../../../packages/bundle/base/README.md) + [`dsh-web-app`](../../../../packages/bundle/web-app/README.md) composition, so the API gateway, session log, tools, sandbox, settings, credentials, agent presets, and directory picker all run with unchanged semantics.

The carrier proceeds in two phases, the first deliberately minimal:

- **Phase 1 — loopback HTTP, zero protocol change.** The shell opens an Electron `BrowserWindow` at the canonical loopback URL that [`dsh-host-webserver`](../../../../packages/host/webserver/README.md) already serves (`http://127.0.0.1:<port>`), using the existing browser fetch/SSE carrier. No carrier, contract, UI, or harness-semantics edit is required; the only new code is an Electron main-process assembly that boots the composition and opens the window.
- **Phase 2 — IPC fetch carrier, the documented follow-on.** The transport is already isolated to one seam: [`AbstractApiClient.doFetch`](../../../../packages/host/apiproxy/src/fetch/client.ts) on the client side and [`toFetchHandler(api)`](../../../../packages/host/apiproxy/src/fetch/handler.ts) on the host side, with [`InProcessApiClient`](../../../../packages/host/apiproxy/src/fetch/client.ts) proving the isomorphic path never touches the network. A later change adds an Electron IPC subclass whose `doFetch` bridges `ipcRenderer`/`ipcMain` to the host handler, letting the window load the dist over `file://` with no HTTP port at all — the exact outcome the [layering note](../../implemented/architecture/2026-07-19-gui-layering-and-rpc-protocol.md) and [webserver docs](../../../../docs/subsystems/web-server.md) already describe ("Electron loads the built files over `file://` and sends fetch requests through an IPC bridge"). Swapping the carrier leaves the four-quadrant wire protocol and every business path unchanged.

Native affordances ride the seams that already exist rather than new ones. The workspace picker already splits native and browse backends behind `ctx.directoryPicker` ([seam note](../../implemented/architecture/2026-07-28-directory-picker-capability-seam.md)); an Electron shell provides the `native` interaction through Electron's own dialog API, exactly as that note anticipates, with no gateway or `ui-workspace` edits. Session export, `host.openPath`, and settings/credentials "open document" already delegate to the platform opener, so they work unchanged in a windowed host.

## Visual parity baseline

The committed goldens under [`apps/web/tests/snapshots/`](../../../../apps/web/tests/snapshots/) are the visual source of truth. They are the keyless, deterministic renderings of the major WebUI states, replayed by the read-only mode the Linux PR CI also uses:

```sh
DSH_SNAPSHOT=replay pnpm run test:web
```

`test:web` rebuilds the `apps/web` dist then runs the browser smoke pair (the real-host case self-skips without `DEEPSEEK_API_KEY`) plus the keyless replayed e2e scenarios. The goldens enumerate the states later work must match rather than redesign: session/workspace chrome, the conversation and composer, plan and goal bars, background jobs, tool and workflow rows, settings and plugin configuration, model selection, onboarding and error states, message actions, and navigation panes. The standalone GUI must render these same transcripts; a later desktop deliverable pins them by replaying the same fixtures against the window.

## Functional parity checklist

The standalone window must preserve every user-visible action and state the WebUI composes. The authoritative roster is the [`web-app` bundle patch](../../../../packages/bundle/web-app/cordis.patch.yml) (browser plugin rows and the web-only host rows) plus the shared [`base` bundle patch](../../../../packages/bundle/base/cordis.patch.yml) (models, tools, persistence, policy, settings, credentials). Grouped by surface:

- **Workspaces and sessions:** workspace select/create/rename/archive (`ui-workspace`), sidebar navigation and title/workspace-name search (`ui-sidebar`), session create/resume/fork/rename/export/archive, blank-session reuse, and the `session.export` download.
- **Conversation and composer:** conversation chat nodes and input (`ui-conversation`), queue actions (edit, remove, reorder), attachments and image intake/lightbox (`ui-attachment`), markdown, math, and syntax highlighting.
- **Commands and references:** the `/` and `@` inline pipeline (`ui-input-trigger`), command dispatch (`ui-commands`), skill references (`ui-skill`), and subagent navigation/transcripts (`ui-subagent`).
- **Agent preset and model selection:** preset selection and authoring (`ui-agent-preset`), per-session model selection and the `/model` surface (`ui-model-selection`), and the Models settings page.
- **Tools and results:** the tool-call tree and keyed per-tool views (`ui-tool`), Cordis define/run cards (`ui-cordis`), workflow-run disclosures (`ui-workflow-run`), produced-files tail (`ui-deliverables`), and terminal/search cards.
- **Plan, goals, jobs, trajectory:** plan-mode status and exit (`ui-plan`), the goal bar (`ui-goal`), background-job list (`ui-jobs`), and alternate agent-activity views (`ui-trajectory`).
- **Settings, plugins, permissions:** general, models, and plugins settings sections (`ui-settings`, `ui-settings-general`, `ui-settings-models`, `ui-settings-plugins`), the read-only loader inventory (`ui-settings-plugin-inventory`), and permission presets plus the per-session access switch (`ui-permission`).
- **Feedback, questions, theme, locale:** message feedback with notes (`ui-message-feedback`), agent-requested questions (`ui-user-questions`), theme (`ui-theme`), and localization (`locale`).
- **Loading, error, and empty states:** the boot settle and per-entry failure report (the shell's one-shot render), onboarding welcome/missing, authentication errors, retry and cancel, and cold blank sessions.

None of these surfaces changes: the window is a different carrier and window chrome, not a different application.

## Change boundary

**Added.** An Electron shell assembly under `apps/` — the [layering note's](../../implemented/architecture/2026-07-19-gui-layering-and-rpc-protocol.md) "write an assembly module under `apps/`" step — consisting of a main process that boots the composition, opens the window, and owns the app's private signal/print/exit semantics, plus its `package.json` (Electron as the only new runtime dependency) and a small bootstrap. The phase-2 follow-on adds one `AbstractApiClient` IPC subclass and a host-side IPC-to-`toFetchHandler` bridge, both additive.

**Byte-for-byte or semantically untouched.** Every `packages/client/**` source file, every `apps/web` UI source file, the wire contract under `packages/host/apiproxy/src/api/**`, the browser plugin roster and host rows in [`web-app/cordis.patch.yml`](../../../../packages/bundle/web-app/cordis.patch.yml) and [`base/cordis.patch.yml`](../../../../packages/bundle/base/cordis.patch.yml), the theme tokens and CSS, and all core, api, llm, shell, subprocess, fs, lsp, skill, web, and terminal packages. The desktop shell reuses the `web-app` composition as-is; if it needs a shell-only row (for example a launcher that opens the window), that arrives as an additive bundle layer or a new shell package, never as an edit to an existing row.

## Launch and lifecycle

The shell's main process boots the same composition the CLI boots — `dsh-base` then `dsh-web-app` through the [`app-boot` profile composer](../../../../packages/boot/app-boot/README.md) — so [`web-startup`](../../../../packages/bundle/web-app/src/startup.ts) parses the same `--host`/`--port`/`--trusted-host` flags, [`webserver`](../../../../packages/host/webserver/README.md) binds the loopback port, and [`web-runtime`](../../../../packages/bundle/web-app/src/index.ts) resolves the dist and prints the URL. After the Loader tree settles, the shell reads the canonical URL and opens the `BrowserWindow` at it. The window connects exactly as a browser would: load `index.html`, run the two-stage [`AppWebEntry` boot](../../../../packages/client/web/README.md), mount the client plugin tree, and complete the readiness handshake through [`connection`](../../../../packages/client/connection/README.md). The existing `app:web-surface` prompt section and the `DSH_WEB_URL` shell variable remain accurate for the windowed host, and window close reuses the CLI's bounded shutdown (SIGINT/SIGTERM dispose the root) rather than a new teardown path. In phase 2 the shell opens the window at `file://` and satisfies the same handshake through the IPC carrier, and the HTTP server is simply not mounted.

## Testing plan

Parity is measured by reuse, not by a parallel assertion surface. The desktop shell must pass the same keyless replay that gates the browser surface (`DSH_SNAPSHOT=replay pnpm run test:web`) against the window, and a new desktop smoke must prove the window loads the same boot manifest and completes the same readiness handshake as the browser carrier, then renders the same transcript for a seeded session. Browser-WebUI versus standalone-GUI parity therefore means: identical goldens, identical wire contract, identical client plugin roster, and an identical `host.describe` readiness answer — the only allowed difference is window chrome outside the WebUI. Real-provider parity stays in `test:e2e`, which self-skips without a key; neither shell adds a key-bearing path.

## Alternatives considered

**Rewrite the UI as a native or separate desktop frontend.** This is the tempting default when "desktop app" is read as "desktop toolkit", but it violates the no-redesign prohibition outright and maximizes delta. Rejected.

**Build the window with Tauri instead of Electron.** Tauri introduces a Rust toolchain, a second packaging and signing story, and a webview that diverges from the Chromium the WebUI is tested against, for no functional gain at this stage. Rejected in favor of the Node-first Electron shell that the codebase's own notes already name.

**Ship a browser launcher that opens the loopback URL in the operator's default browser.** This is not a standalone window, offers no shell-owned lifecycle or native window chrome, and fails the "standalone GUI" goal while saving only the window code. Rejected.

**Adopt the IPC carrier as phase 1.** Correct as an end state, but it adds a new carrier and its host-side bridge before any window exists; the loopback HTTP server is already there, already correct, and already trusted. Rejected for phase 1, retained as the documented phase-2 follow-on.

**Expose the native directory picker through a new Electron-specific path.** Unnecessary — the [`directory-picker` seam](../../implemented/architecture/2026-07-28-directory-picker-capability-seam.md) already isolates native versus browse, and its note states an Electron provider of the `native` interaction is one dual-face backend package with no gateway or `ui-workspace` edits. Rejected in favor of reusing the seam.

## Acceptance criteria

- A standalone window renders the official WebUI with no visual or behavioral difference from the browser surface, evidenced by the same keyless replay goldens.
- The harness semantics are unchanged: no backend, runtime, API, RPC, session-data, prompt, agent, tool, plugin, skill, model, preset, permission, or configuration behavior differs from `dsh --profile web`.
- The shell is purely additive; every `packages/client/**` and `apps/web` UI source file and the `/api` wire contract remain byte-for-byte or semantically untouched.
- The window reaches the same `host.describe` readiness answer and mounts the same client plugin roster as the browser.
- Phase 2, when built, swaps only `AbstractApiClient.doFetch` and adds a host-side IPC bridge; the four-quadrant protocol, business paths, and all snapshots stay identical.

## Risks

- **New runtime dependency.** Electron adds a sizable binary and supply-chain surface to the install. Mitigated by keeping the shell thin and the WebUI byte-identical, and by the fact that phase 1 adds no other dependency.
- **A bound port during phase 1.** The loopback HTTP server stays mounted, so the standalone window still opens a local port. Mitigated by phase 2, which removes the server for the desktop path; the port is loopback-only and already fence-guarded, so it widens no attack surface.
- **Visual drift from a divergent dist.** If the desktop path ever built the frontend differently, parity would silently break. Mitigated by keeping one `apps/web` dist as the single source and gating it with the same goldens.
- **Trust-fence scope.** The IPC carrier must preserve the loopback trust assumption the HTTP fence enforces; a phase-2 bridge that accepted non-loopback origins would weaken it. Mitigated by making the IPC channel process-local only and keeping the existing trust logic rather than reimplementing it.
