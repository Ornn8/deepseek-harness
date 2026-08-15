/**
 * Desktop smoke: the standalone GUI shell (GUI-02) against the REAL web
 * composition. Launches the built Electron main (`apps/desktop/lib/main.js`)
 * with a hermetic temp world and proves the window:
 *
 * - boots the same composition the CLI boots and opens at the canonical
 *   loopback URL,
 * - serves the official frontend with the injected boot manifest and every
 *   built static asset resolvable,
 * - renders the same seeded-session transcript as the browser carrier
 *   (aria-identical captures against the same origin and locale),
 * - maps window close to the bounded shutdown and exits cleanly.
 *
 * Keyless: `llm-deepseek` stays mounted without a credential (its catalog
 * advertises the recorded model route; only streaming would fail) and the
 * seeded fixture renders purely from the log, so no model call is ever
 * issued. The lane self-skips where Electron cannot open a window (binary
 * missing, or no display on Linux), mirroring the keyless self-skip
 * convention of the web lane.
 */
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium, _electron as electron, type ElectronApplication } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  captureStableAria,
  seedSession,
  watchConsole,
  type WebScaffold,
} from '../../web/tests/scaffold.ts'

const MAIN = fileURLToPath(new URL('../lib/main.js', import.meta.url))
const DIST_DIR = fileURLToPath(new URL('../../web/dist', import.meta.url))
const DIST_INDEX = join(DIST_DIR, 'index.html')
const CLI_PROFILE_BOOT = fileURLToPath(new URL('../../cli/lib/profile-boot.js', import.meta.url))
/** The committed seeded-history recording, rendered cold with zero model calls. */
const SEED = fileURLToPath(new URL('../../web/tests/snapshots/seeded-history/seed.jsonl', import.meta.url))
const ARTIFACTS_DIR = fileURLToPath(new URL('../../../.artifacts', import.meta.url))
/** The welcome-notice version the web lane pre-acknowledges (scaffold.ts constant). */
const WELCOME_NOTICE_VERSION = '2026-08-13.1'
const SEED_ID = 'desktop-smoke-seeded'
const VIEWPORT = { width: 1680, height: 1000 }

/** The Electron executable path (the `electron` module's exported value); undefined when not installed. */
function electronBinary(): string | undefined {
  try {
    return createRequire(import.meta.url)('electron') as string
  } catch {
    return undefined
  }
}

/**
 * Whether this host can open an Electron window: the binary must be
 * installed, and a display must exist (Linux CI has none without xvfb).
 */
function canOpenWindow(): boolean {
  if (electronBinary() === undefined) return false
  if (process.platform === 'linux') {
    return process.env.DISPLAY !== undefined || process.env.WAYLAND_DISPLAY !== undefined
  }
  return true
}

/** Fail loud on a stale checkout instead of testing yesterday's artifacts. */
function requireBuilt(): void {
  const missing = ([
    ['desktop main', MAIN],
    ['cli profile-boot', CLI_PROFILE_BOOT],
    ['web dist index', DIST_INDEX],
  ] as readonly (readonly [string, string])[])
    .filter(([, path]) => !existsSync(path)).map(([label]) => label)
  if (missing.length > 0) {
    throw new Error(`desktop smoke needs built artifacts (${missing.join(', ')}) — run \`pnpm run test:desktop\` (or \`pnpm run build\` then \`pnpm run test:desktop:built\`)`)
  }
}

/** Recursively list every emitted dist file (sourcemaps excluded), origin-relative. */
async function listDistFiles(dir: string, base = ''): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    if (entry.isDirectory()) {
      files.push(...await listDistFiles(join(dir, entry.name), `${base}/${entry.name}`))
    } else if (!entry.name.endsWith('.map')) {
      files.push(`${base}/${entry.name}`)
    }
  }
  return files
}

/**
 * Dismiss the first-run credential dialog (llm-deepseek mounted keyless) via
 * its own "Configure later" action — the same path a first-run user takes.
 * No-op when the dialog is not showing.
 */
async function dismissOnboarding(page: Page): Promise<void> {
  const later = page.getByRole('button', { name: /Configure later|稍后配置/ })
  if (await later.count() > 0 && await later.isVisible()) {
    await later.click()
    await later.waitFor({ state: 'detached', timeout: 10_000 }).catch(() => {})
  }
}

/**
 * Click a target, dismissing the onboarding dialog when its mask intercepts
 * the pointer (the dialog can arrive asynchronously after the models join
 * loads). Fails with the last click error when the dialog is not the cause.
 */
async function clickThrough(page: Page, target: ReturnType<Page['locator']>): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await target.click({ timeout: 10_000 })
      return
    } catch (error) {
      const masked = await page.getByRole('button', { name: /Configure later|稍后配置/ }).isVisible()
        .catch(() => false)
      if (!masked) throw error
      await dismissOnboarding(page)
    }
  }
  await target.click({ timeout: 10_000 })
}

/**
 * Open the seeded session in the sidebar. The startup selection expands the
 * current workspace's group with the provisional blank session (selected)
 * first and the seeded session after it; cold sessions carry no projection
 * cache yet, so their rows show no title — target by position: the row that
 * is neither the group nor the selected blank session.
 */
async function openSeededSession(page: Page): Promise<void> {
  await page.waitForSelector('[class*="frame"]', { timeout: 60_000 })
  await dismissOnboarding(page)
  const tree = page.getByRole('tree', { name: /Sessions|会话/ })
  if (await tree.locator('[role="treeitem"]').count() <= 1) {
    const groupRow = tree.locator('[role="treeitem"]').first()
    await groupRow.waitFor({ timeout: 30_000 })
    await clickThrough(page, groupRow)
  }
  const seededRow = tree.locator('[role="treeitem"]:not([aria-selected="true"])').nth(1)
  await seededRow.waitFor({ timeout: 15_000 }).catch(async (error: unknown) => {
    const sidebar = await tree.ariaSnapshot().catch(() => '<no sessions tree>')
    throw new Error(`seeded session row did not appear\n${sidebar}`, { cause: error as Error })
  })
  await clickThrough(page, seededRow)
  try {
    await page.getByText('DONE', { exact: true }).waitFor({ timeout: 20_000 })
  } catch (error) {
    const center = await page.locator('[class*="centerCol"]').first().ariaSnapshot()
      .catch(() => '<no centerCol>')
    throw new Error(`seeded transcript did not render\n${center}`, { cause: error })
  }
}

describe.skipIf(!canOpenWindow())('desktop shell smoke: the window renders the official WebUI unchanged', () => {
  let electronApp: ElectronApplication
  let window: Page
  let browser: Browser
  let browserPage: Page
  let worldDir: string
  let workspaceCwd: string
  let harnessHome: string
  let tripwire: ReturnType<typeof watchConsole>
  const appStderr: string[] = []

  beforeAll(async () => {
    requireBuilt()
    const binary = electronBinary()
    if (binary === undefined) throw new Error('desktop smoke: electron binary missing — cannot launch')
    worldDir = await mkdtemp(join(tmpdir(), 'dsh-desktop-smoke-'))
    workspaceCwd = join(worldDir, 'workspace-root')
    harnessHome = join(worldDir, 'dsh-home')
    const persistenceRoot = join(harnessHome, 'sessions')
    await mkdir(workspaceCwd, { recursive: true })
    await mkdir(harnessHome, { recursive: true })
    await mkdir(persistenceRoot, { recursive: true })
    // The recorded read-tool targets of the seeded fixture, in the session cwd
    // (the cwd rewrite in the web lane's fixture realization drops the
    // recording's `/workspace` suffix).
    await writeFile(join(workspaceCwd, 'a.txt'), 'alpha\n')
    await writeFile(join(workspaceCwd, 'b.txt'), 'beta\n')
    // Pre-acknowledge the welcome notice the way the web lane does, so the
    // boot settles on the product's regular hero state.
    await writeFile(join(harnessHome, 'settings.yaml'),
      `ui-onboarding:\n  welcomeNoticeVersion: ${WELCOME_NOTICE_VERSION}\n`)
    // Hermetic world: every row whose default touches the real harness home or
    // the network is pinned to the temp world. The shipped rows that already
    // resolve through $DSH_HOME (settings, credentials, storage, sessions)
    // need no patch — the environment below points them at the temp home.
    // `llm-deepseek` stays MOUNTED (its catalog advertises the recorded model
    // route without a credential; only streaming would fail, and the seeded
    // transcript renders with zero model calls).
    const overlayPath = join(worldDir, 'overlay.yml')
    await writeFile(overlayPath, [
      '- id: agent-instructions',
      '  disabled: true',
      '- id: session-title-llm',
      '  disabled: true',
      '- id: session-telemetry-otel',
      '  disabled: true',
      '- id: webserver',
      '  config:',
      "    host: '127.0.0.1'",
      '    port: 0',
      '- id: web-runtime',
      '  config:',
      '    printUrl: false',
      '    surfaceContext: true',
      // The shipped -auto chooser resolves its interaction from the running
      // host; pin -browse deterministically like the web lane.
      '- id: directory-picker',
      '  disabled: true',
      '- insert:',
      '    - id: directory-picker-browse',
      '      name: \'@deepseek-ai/dsh-host-directory-picker-browse\'',
      '',
    ].join('\n'))
    // Seed the recorded session cold through the real persistence API, using
    // the web lane's own fixture helpers: realizeSeedFixture splices the
    // workspace cwd in its JSON-escaped form, so the native Windows path
    // (backslashes included) stays valid JSON on every host.
    await seedSession({ workspaceCwd, persistenceRoot } as unknown as WebScaffold,
      await readFile(SEED, 'utf8'), SEED_ID)

    const env: Record<string, string> = { ...process.env as Record<string, string> }
    env.DSH_HOME = harnessHome
    env.DSH_AGENTS_HOME = join(workspaceCwd, '.agents-home')
    env.DSH_BUNDLED_SKILL_DIR = join(workspaceCwd, '.bundled-skills')
    delete env.DEEPSEEK_API_KEY
    const args = [MAIN, '--patch', overlayPath]
    if (process.platform === 'linux' && typeof process.getuid === 'function' && process.getuid() === 0) {
      args.push('--no-sandbox')
    }
    electronApp = await electron.launch({ executablePath: binary, args, cwd: workspaceCwd, env })
    electronApp.process().stderr?.on('data', (chunk: Buffer) => { appStderr.push(chunk.toString()) })
    try {
      window = await electronApp.firstWindow()
    } catch (error) {
      throw new Error(`desktop smoke: the shell exited before opening a window\n${appStderr.join('')}`, { cause: error })
    }
    tripwire = watchConsole(window)
  }, 240_000)

  afterAll(async () => {
    try {
      await electronApp?.close()
    } catch {
      // The app already exited through the bounded-shutdown assertion.
    }
    await browser?.close()
    if (worldDir !== undefined) await rm(worldDir, { recursive: true, force: true })
  })

  it('opens at the canonical loopback URL with the injected boot manifest', async () => {
    onTestFailed(async () => { await window.screenshot({ path: join(ARTIFACTS_DIR, 'desktop-smoke-failure.png') }) })
    expect(window.url()).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/)
    // The boot manifest proves the window loads the SERVED index.html with the
    // modules node half's injected entry graph (the same graph a browser gets).
    const boot = await window.evaluate(() => (window as { __DSH_BOOT__?: unknown }).__DSH_BOOT__)
    expect(boot).toBeDefined()
    const graph = boot as { rev?: unknown; entries?: { url?: unknown }[] }
    expect(typeof graph.rev).toBe('string')
    expect(graph.entries?.length).toBeGreaterThan(10)
    expect(graph.entries?.every(row => typeof row.url === 'string' && row.url.startsWith('/plugins/'))).toBe(true)
    // The product's initial state: the resident hero with the workspace chip.
    await window.waitForSelector('[aria-label="Choose workspace"], [aria-label="选择工作区"]', { timeout: 60_000 })
    expect(tripwire.pageErrors).toEqual([])
  }, 120_000)

  it('resolves every built static asset through the window origin', async () => {
    const origin = new URL(window.url()).origin
    const failed: string[] = []
    for (const file of await listDistFiles(DIST_DIR)) {
      const ok = await window.evaluate(async url => (await fetch(url)).ok, `${origin}${file}`)
      if (!ok) failed.push(file)
    }
    expect(failed).toEqual([])
  }, 120_000)

  it('renders the seeded session transcript identical to the browser carrier', async () => {
    onTestFailed(async () => { await window.screenshot({ path: join(ARTIFACTS_DIR, 'desktop-smoke-failure.png') }) })
    // Wire-level guard: the seeded session is visible to the window's own
    // host through the real /api transport before the UI navigates to it.
    const listed = await window.evaluate(async () => {
      const response = await fetch('/api/session.list', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: 'desktop-smoke-list', method: 'session.list', payload: {} }),
      })
      const body = await response.json() as { result?: { ok?: boolean; value?: { items?: { sessionId?: string }[] } } }
      return body.result?.ok === true ? (body.result.value?.items ?? []).map(item => item.sessionId) : []
    })
    expect(listed).toContain(SEED_ID)
    await openSeededSession(window)
    await window.screenshot({ path: join(ARTIFACTS_DIR, 'desktop-smoke-window.png') })
    const posixWorkspaceCwd = workspaceCwd.split('\\').join('/')
    const windowAria = await captureStableAria(window, '[class*="centerCol"]', posixWorkspaceCwd)
    // The browser page against the SAME origin and SAME locale: any
    // divergence between the window and the browser carrier shows up here.
    browser = await chromium.launch()
    const windowLocale = await window.evaluate(() => navigator.language)
    browserPage = await browser.newPage({ viewport: VIEWPORT, locale: windowLocale })
    await browserPage.goto(window.url(), { waitUntil: 'load' })
    await openSeededSession(browserPage)
    await browserPage.screenshot({ path: join(ARTIFACTS_DIR, 'desktop-smoke-browser.png') })
    const browserAria = await captureStableAria(browserPage, '[class*="centerCol"]', posixWorkspaceCwd)
    expect(windowAria).toBe(browserAria)
    expect(tripwire.pageErrors).toEqual([])
  }, 180_000)

  it('maps window close to the bounded shutdown and exits cleanly', async () => {
    const child = electronApp.process()
    const exited = new Promise<number | null>((resolve) => {
      if (child.exitCode !== null) {
        resolve(child.exitCode)
        return
      }
      child.once('exit', (code) => { resolve(code) })
    })
    await window.close()
    const code = await Promise.race([
      exited,
      new Promise<number | null>((_, reject) => {
        setTimeout(() => { reject(new Error('desktop app did not exit after the last window closed')) }, 30_000)
      }),
    ])
    expect(code).toBe(0)
  }, 60_000)
})
