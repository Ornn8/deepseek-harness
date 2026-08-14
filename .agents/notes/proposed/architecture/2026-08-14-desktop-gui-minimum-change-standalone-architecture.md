# Agent Note: Desktop GUI Minimum-Change Standalone Architecture

Status: proposed

English | [中文](2026-08-14-desktop-gui-minimum-change-standalone-architecture.zh.md)

## Problem

The DeepSeek Harness WebUI ships as a browser application: [`apps/web`](../../../../apps/web/) is a Vite build over the [`@deepseek-ai/dsh-client-web`](../../../../packages/client/web/README.md) shell, served by the loopback HTTP server that the [`dsh-web-app` bundle](../../../../packages/bundle/web-app/README.md) mounts over [`dsh-base`](../../../../packages/bundle/base/README.md). The product needs this exact surface delivered as a standalone desktop GUI — a native window the operator launches directly — with the smallest possible code delta, while preserving the original appearance and behavior exactly.

The deliverable is bounded by three prohibitions. No redesign or style specification, and no changes to theme tokens, spacing, typography, colors, layout, copy, icons, or component appearance. No backend, runtime, API, RPC, session-data, prompt, agent, tool, plugin, skill, model, preset, permission, or configuration semantic changes. And no implementation beyond the small baseline and probe artifacts this investigation needs. This note records the parity baseline, the functional surface to preserve, the least-invasive architecture, the change boundary, the launch and lifecycle plan, and the parity testing plan. The shell itself is a later task.

The codebase has already anticipated this client shape without deciding it: the [GUI layering and RPC protocol note](../../implemented/architecture/2026-07-19-gui-layering-and-rpc-protocol.md) names Electron among the coming clients, isolates the transport behind `AbstractApiClient.doFetch`, and lists an "IPC bridge subclass" as a hypothetical with no such shell yet existing. This proposal is the decision those notes deferred.

## Proposal

Reuse the official WebUI wholesale and add only a thin shell around it. A standalone window renders the exact built [`apps/web`](../../../../apps/web/) frontend — the same React tree, CSS tokens, and browser plugin roster — so pixels and interactions are identical by construction. The desktop process boots the existing harness host in-process through the same [`dsh-base`](../../../../packages/bundle/base/README.md) + [`dsh-web-app`](../../../../packages/bundle/web-app/README.md) composition, so the API gateway, session log, tools, sandbox, settings, credentials, agent presets, and directory picker all run with unchanged semantics.

The carrier ships in one phase — the loopback HTTP origin — and the IPC swap is deferred, because it is not implementable as a `doFetch`-only follow-on within the additive-shell boundary this proposal keeps:

- **Phase 1 — loopback HTTP, zero protocol change.** The shell opens an Electron `BrowserWindow` at the canonical loopback URL that [`dsh-host-webserver`](../../../../packages/host/webserver/README.md) already serves (`http://127.0.0.1:<port>`), using the existing browser fetch/SSE carrier. No carrier, contract, UI, or harness-semantics edit is required; the only new code is an Electron main-process assembly that boots the composition and opens the window.
- **Phase 2 — deferred; an IPC carrier needs a full transport decision, not a `doFetch` swap.** The one-seam reading stops at the `AbstractApiClient` abstraction: `doFetch` is the uplink transport aspect ([fetch/client.ts](../../../../packages/host/apiproxy/src/fetch/client.ts), [`toFetchHandler(api)`](../../../../packages/host/apiproxy/src/fetch/handler.ts), and [`InProcessApiClient`](../../../../packages/host/apiproxy/src/fetch/client.ts) proving the isomorphic path never touches the network), but the shipped browser carrier is broader. The connection plugin's browser half instantiates `new WebApiClient()` internally with no API-client injection seam ([connection client entry](../../../../packages/client/connection/src/client/index.ts)), and `WebApiClient` overrides `openMux`/`openHost` with one WebSocket downlink per logical stream ([web-api-client.ts](../../../../packages/client/connection/src/client/web-api-client.ts)) — an additive IPC subclass would never be selected, and a selected one would not replace the downlink carrier. The built frontend cannot boot over `file://` either: [`ClientModuleRegistry`](../../../../packages/client/modules/src/index.ts) injects the boot graph into every served `index.html` as `window.__DSH_BOOT__` (which [`parseBootManifest`](../../../../packages/client/modules/src/client/manifest.ts) rejects when absent), every graph row loads an external classic script from the `/plugins/<id>/client.js` bundle route, and the built `index.html` references root-absolute `/assets/*` URLs. A future IPC phase therefore needs its own architecture decision covering boot-graph delivery, client-bundle and static-asset loading without HTTP, and a complete unary-plus-stream connection provider (a roster-level swap or an upstream `connection` change) — all outside the boundary this proposal keeps. The one-line `file://` descriptions in the [layering note](../../implemented/architecture/2026-07-19-gui-layering-and-rpc-protocol.md) and [webserver docs](../../../../docs/subsystems/web-server.md) are pointers to that future decision, not a proven carrier.

Native affordances ride the seams that already exist rather than new ones. The workspace picker already splits native and browse backends behind `ctx.directoryPicker` ([seam note](../../implemented/architecture/2026-07-28-directory-picker-capability-seam.md)); phase 1 mounts the upstream `directory-picker` composition exactly as the Web surface does and adds no picker surface of its own. The seam's anticipated Electron provider of the `native` interaction — one dual-face backend package in the same single-occupant hole, with no gateway or `ui-workspace` edits — is the only later change, and it replaces the auto-resolved backend rather than mounting a second picker. Session export, `host.openPath`, and settings/credentials "open document" already delegate to the platform opener, so they work unchanged in a windowed host.

## Visual parity baseline

The visual source of truth has two parts — the keyless functional gate and a rendered baseline — plus a static-art inventory.

The committed goldens under [`apps/web/tests/snapshots/`](../../../../apps/web/tests/snapshots/) are the keyless functional gate. They are deterministic `ariaSnapshot()` transcripts of the major WebUI states, replayed by the read-only mode the Linux PR CI also uses:

```sh
DSH_SNAPSHOT=replay pnpm run test:web
```

`test:web` rebuilds the `apps/web` dist then runs the browser smoke pair (the real-host case self-skips without `DEEPSEEK_API_KEY`) plus the keyless replayed e2e scenarios. The goldens enumerate the states later work must match rather than redesign: session/workspace chrome, the conversation and composer, plan and goal bars, background jobs, tool and workflow rows, settings and plugin configuration, model selection, onboarding and error states, message actions, and navigation panes. They verify structure, presence, order, and copy, but they are color-blind and carry no theme or layout golden — the lifecycle e2e states that limitation explicitly ([lifecycle-chrome.e2e.ts](../../../../apps/web/tests/lifecycle-chrome.e2e.ts)).

The rendered baseline is committed as pixel captures of those states, recorded keylessly through the replay lane by the skip-gated recorder `apps/web/tests/visual-baseline.e2e.ts` (`DSH_VISUAL_BASELINE=record pnpm run test:web:built -- -t visual-baseline`): [`apps/web/tests/snapshots/visual-baseline/`](../../../../apps/web/tests/snapshots/visual-baseline/) holds the captures plus the [`recording.md`](../../../../apps/web/tests/snapshots/visual-baseline/recording.md) conditions (viewport 1680x1000, locale, theme, platform, Chromium version, recording date). The recorder drives the same seeded fixtures the aria lane uses, so every state reproduces without a key; shell states follow the platform's live shell tool (`tool-pwsh` on win32, `tool-bash` elsewhere), which is why the metadata records the platform. Later work must match these captures, not redesign them; pixel equality holds only under the stated recording conditions, and the desktop implementation phase re-records on its own platform.

Static art gets an inventory check of its own: every upstream visual/static resource must stay present and resolvable in the packaged desktop app. The committed [`static-assets.md`](../../../../apps/web/tests/snapshots/visual-baseline/static-assets.md) inventory lists [`apps/web/public/**`](../../../../apps/web/public/) (`favicon.svg`, `manifest.webmanifest`) and every asset the build emits into the dist (KaTeX font faces, syntax-highlight language chunks, CSS and JS bundles); a later desktop deliverable proves each entry resolves in the packaged app.

The standalone GUI must render the same transcripts, match the same captures, and resolve the same assets; a later desktop deliverable pins all three by replaying the same fixtures against the window.

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

**Added.** An Electron shell assembly under `apps/` — the [layering note's](../../implemented/architecture/2026-07-19-gui-layering-and-rpc-protocol.md) "write an assembly module under `apps/`" step — consisting of a main process that boots the composition, opens the window, and owns the app's private signal/print/exit semantics, plus its `package.json` (Electron as the only new runtime dependency) and a small bootstrap. Phase 1 is the whole scope: no IPC carrier is promised, and no client-package or roster edit accompanies the shell. A future IPC phase is a separate architecture decision (see Proposal) and may legitimately touch the `connection` package or its roster row; until that decision lands, the desktop path ships on the loopback HTTP origin.

**Byte-for-byte or semantically untouched.** Every `packages/client/**` source file, every `apps/web` UI source file, the wire contract under `packages/host/apiproxy/src/api/**`, the browser plugin roster and host rows in [`web-app/cordis.patch.yml`](../../../../packages/bundle/web-app/cordis.patch.yml) and [`base/cordis.patch.yml`](../../../../packages/bundle/base/cordis.patch.yml), the theme tokens and CSS, and all core, api, llm, shell, subprocess, fs, lsp, skill, web, and terminal packages. The desktop shell reuses the `web-app` composition as-is; if it needs a shell-only row (for example a launcher that opens the window), that arrives as an additive bundle layer or a new shell package, never as an edit to an existing row.

## Launch and lifecycle

The shell's main process boots the same composition the CLI boots — `dsh-base` then `dsh-web-app` through the [`app-boot` profile composer](../../../../packages/boot/app-boot/README.md) — so [`web-startup`](../../../../packages/bundle/web-app/src/startup.ts) parses the same `--host`/`--port`/`--trusted-host` flags, [`webserver`](../../../../packages/host/webserver/README.md) binds the loopback port, and [`web-runtime`](../../../../packages/bundle/web-app/src/index.ts) resolves the dist and prints the URL. After the Loader tree settles, the shell reads the canonical URL and opens the `BrowserWindow` at it. The window connects exactly as a browser would: load `index.html`, run the two-stage [`AppWebEntry` boot](../../../../packages/client/web/README.md), mount the client plugin tree, and complete the readiness handshake through [`connection`](../../../../packages/client/connection/README.md). The existing `app:web-surface` prompt section and the `DSH_WEB_URL` shell variable remain accurate for the windowed host. Window close maps to the CLI's bounded shutdown explicitly: [`runProfile`](../../../../apps/cli/src/profile-boot.ts) installs SIGINT/SIGTERM handlers that invoke its returned `ProcessShutdown` controller, which disposes the root — closing a `BrowserWindow` emits neither signal, so the shell must intercept Electron's lifecycle (`window-all-closed` or `before-quit`), invoke the same shutdown controller, await root disposal, and then quit. That mapping is part of the shell's own private exit semantics, not a harness change. The desktop path stays on the loopback HTTP origin; there is no `file://` phase in this proposal.

## Testing plan

Parity is measured by reuse, not by a parallel assertion surface. The desktop shell must pass the same keyless replay that gates the browser surface (`DSH_SNAPSHOT=replay pnpm run test:web`) against the window, and a new desktop smoke must prove the window loads the served `index.html` with the injected boot manifest, completes the same readiness handshake as the browser carrier, renders the same transcript for a seeded session, and resolves every static-asset inventory entry. Browser-WebUI versus standalone-GUI parity therefore means: identical goldens, identical screenshots, identical asset resolution, identical wire contract, identical client plugin roster, and an identical `host.describe` readiness answer — the only allowed difference is window chrome outside the WebUI. Real-provider parity stays in `test:e2e`, which self-skips without a key; neither shell adds a key-bearing path.

## Alternatives considered

**Rewrite the UI as a native or separate desktop frontend.** This is the tempting default when "desktop app" is read as "desktop toolkit", but it violates the no-redesign prohibition outright and maximizes delta. Rejected.

**Build the window with Tauri instead of Electron.** Tauri introduces a Rust toolchain, a second packaging and signing story, and a webview that diverges from the Chromium the WebUI is tested against, for no functional gain at this stage. Rejected in favor of the Node-first Electron shell that the codebase's own notes already name.

**Ship a browser launcher that opens the loopback URL in the operator's default browser.** This is not a standalone window, offers no shell-owned lifecycle or native window chrome, and fails the "standalone GUI" goal while saving only the window code. Rejected.

**Adopt the IPC carrier as phase 1.** Correct as an end state, but it is not a small follow-on: it requires the full boot-graph, bundle, asset, and connection-provider design this proposal declines to promise. Rejected for phase 1 and deferred; the loopback HTTP server is already there, already correct, and already trusted.

**Expose the native directory picker through a new Electron-specific path.** Unnecessary — the [`directory-picker` seam](../../implemented/architecture/2026-07-28-directory-picker-capability-seam.md) already isolates native versus browse, and its note states an Electron provider of the `native` interaction is one dual-face backend package with no gateway or `ui-workspace` edits. Rejected in favor of reusing the seam.

## Acceptance criteria

- A standalone window renders the official WebUI with no visual or behavioral difference from the browser surface, evidenced by the same keyless replay goldens, the committed screenshot baseline (captures plus recording conditions), and the static-asset resolution check.
- The harness semantics are unchanged: no backend, runtime, API, RPC, session-data, prompt, agent, tool, plugin, skill, model, preset, permission, or configuration behavior differs from `dsh --profile web`.
- The shell is purely additive; every `packages/client/**` and `apps/web` UI source file and the `/api` wire contract remain byte-for-byte or semantically untouched.
- The window reaches the same `host.describe` readiness answer and mounts the same client plugin roster as the browser.
- The desktop path ships on the loopback HTTP origin; no IPC carrier, client-package edit, or roster change is part of this change, and any future IPC carrier is a separate architecture decision.

## Risks

- **New runtime dependency.** Electron adds a sizable binary and supply-chain surface to the install. Mitigated by keeping the shell thin and the WebUI byte-identical, and by the fact that phase 1 adds no other dependency.
- **A bound port.** The loopback HTTP server stays mounted, so the standalone window always opens a local port. The port is loopback-only and already fence-guarded, so it widens no attack surface; removing it is deferred together with the IPC carrier.
- **Visual drift from a divergent dist.** If the desktop path ever built the frontend differently, parity would silently break. Mitigated by keeping one `apps/web` dist as the single source and gating it with the same goldens.
- **Trust-fence scope of a future IPC carrier.** If a deferred IPC carrier is ever designed, it must preserve the loopback trust assumption the HTTP fence enforces; a bridge accepting non-loopback origins would weaken it. Any such design keeps the channel process-local and reuses the existing trust logic; until then the HTTP fence is the only trust boundary.
