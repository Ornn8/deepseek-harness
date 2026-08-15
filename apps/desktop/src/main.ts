#!/usr/bin/env node
/**
 * dsh-desktop — the standalone GUI shell. An Electron main process that boots
 * the SAME `web` profile composition the CLI boots — through the shared
 * profile-boot glue (`@deepseek-ai/dsh/profile-boot`) with the CLI's install
 * anchor and shipped agent-preset root, so the composition, the served
 * frontend dist, and every flag default are identical by construction — and
 * renders the official WebUI unchanged in a `BrowserWindow` at the canonical
 * loopback URL the webserver already serves.
 *
 * Window close maps to the CLI's bounded shutdown explicitly: closing a
 * `BrowserWindow` emits no signal, so the shell intercepts Electron's
 * lifecycle (`window-all-closed` / `before-quit`), invokes the same shutdown
 * controller `runProfile` returned, awaits root disposal, and then quits.
 *
 * Development launch only: packaging, signing, and the deferred IPC carrier
 * are later tasks (GUI-05 and a separate transport decision).
 * @module @deepseek-ai/dsh-desktop
 */

import { app, BrowserWindow } from 'electron'
import { loadLayeredEnv } from '@deepseek-ai/dsh-app-boot'
import { runProfile, type RunProfileOptions } from '@deepseek-ai/dsh/profile-boot'
import { parseLaunchArgs } from './args.ts'
// Type-only: resolves `ctx.get('webServer')` to the bound-port service.
import type {} from '@deepseek-ai/dsh-host-webserver'

/** Diagnostic prefix for this shell's own messages. */
const BIN_NAME = 'dsh-desktop'
/** The profile this shell boots: the same shipped template the CLI's `web` alias boots. */
const PROFILE = 'web'
/** The recorded visual-baseline viewport (apps/web/tests/snapshots/visual-baseline/recording.md). */
const WINDOW_VIEWPORT = { width: 1680, height: 1000 } as const
/** The loopback address the local URL always prints (the webserver schema's default bind). */
const LOOPBACK_HOST = '127.0.0.1'

/** The settled boot result once `runProfile` resolves. */
let booted: Awaited<ReturnType<typeof runProfile>> | undefined

let quitting = false

/**
 * Dispose the booted tree through the bounded shutdown, then let Electron
 * exit. Idempotent: the first caller owns the quit; a later event no-ops. A
 * close during the boot window quits directly — the in-flight boot is
 * abandoned the same way a signal during CLI startup abandons it.
 */
function quitBounded(): void {
  if (quitting) return
  quitting = true
  if (booted === undefined) {
    app.quit()
    return
  }
  void booted.shutdown.shutdown(0).then(() => { app.quit() })
}

/**
 * Boot the web profile composition exactly as the CLI does, then open the
 * window at the canonical loopback URL.
 * @throws when the boot fails or the composition binds no loopback server.
 */
async function bootShell(): Promise<void> {
  const invocation = parseLaunchArgs(process.argv)
  booted = await runProfile({
    environment: loadLayeredEnv(BIN_NAME),
    profile: PROFILE,
    patchFiles: invocation.patches,
    args: invocation.args,
  } satisfies RunProfileOptions)
  if (quitting) {
    app.quit()
    return
  }
  await app.whenReady()
  const port = booted.ctx.get('webServer')?.port
  if (port === undefined) {
    throw new Error(`${BIN_NAME}: the web composition bound no loopback server (webServer service missing after a settled boot)`)
  }
  const window = new BrowserWindow({ width: WINDOW_VIEWPORT.width, height: WINDOW_VIEWPORT.height })
  await window.loadURL(`http://${LOOPBACK_HOST}:${String(port)}`)
}

app.on('window-all-closed', quitBounded)
app.on('before-quit', (event) => {
  // A quit that did not start with the last window closing (OS shutdown, a
  // menu action) must still dispose the tree before the process ends.
  if (quitting) return
  event.preventDefault()
  quitBounded()
})

bootShell().catch((error: unknown) => {
  console.error(`${BIN_NAME}: failed to start: ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
  app.exit(1)
})
