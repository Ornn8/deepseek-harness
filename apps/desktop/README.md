# `@deepseek-ai/dsh-desktop`

English | [中文](README.zh.md)

The standalone GUI shell: an Electron main process that boots the same `web` profile composition the CLI boots and renders the official WebUI unchanged in a native window. The shell adds no product surface of its own — the window is a different carrier and window chrome, not a different application.

## How it boots

The main process (`src/main.ts`) boots the `web` profile through the shared profile-boot glue the CLI uses (`@deepseek-ai/dsh/profile-boot`), with the CLI's install anchor and shipped agent-preset root, so the composition, the served `apps/web` dist, and every flag default are identical by construction. After the Loader tree settles, the shell reads the bound loopback port and opens a `BrowserWindow` at the canonical URL (`http://127.0.0.1:<port>`); the window connects exactly as a browser would — the served `index.html`, the injected `window.__DSH_BOOT__` entry graph, the client plugin tree, and the readiness handshake.

Window close maps to the CLI's bounded shutdown: closing a `BrowserWindow` emits no signal, so the shell intercepts Electron's lifecycle (`window-all-closed` / `before-quit`), invokes the same shutdown controller `runProfile` returned, awaits root disposal, and then quits.

## Arguments

The shell owns one launcher flag, `--patch <path>` (repeatable, same contract as the `dsh` launcher's); the first token that is not part of a `--patch` pair starts the web app's own arguments, forwarded verbatim:

```sh
dsh-desktop --patch ./extra.yml --port 8080
```

`--host`, `--port`, and `--trusted-host` behave exactly as they do for `dsh --profile web` (including `--port 0` letting the OS pick a free port).

## Development

```sh
pnpm run build          # repository root: builds libs and the web frontend dist
pnpm --filter @deepseek-ai/dsh-desktop run start
```

Production runs require the built package and frontend artifacts; the start script resolves both through the workspace.

The desktop smoke lane runs the real shell against a hermetic temp world and compares its seeded-session transcript with the browser carrier:

```sh
pnpm run test:desktop
```

The lane self-skips where Electron cannot open a window (no binary, or no display on Linux).

## Known Limitations and Deferred Work

- **Development launch only.** Packaging, signing, and the packaged layout of the shipped agent-preset roster belong to GUI-05; the shell currently resolves the CLI's shipped presets from the workspace.
- **Loopback HTTP carrier.** The desktop path stays on the loopback HTTP origin the webserver already serves; an IPC carrier is a separate transport decision and may touch the `connection` package or its roster row.
- **Initial locale.** The WebUI derives its initial locale from the operating system, exactly as the browser WebUI derives it from the browser; a stored preference in settings overrides it.
