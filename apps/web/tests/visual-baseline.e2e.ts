// Keyless visual-baseline recorder for the desktop-GUI parity note
// (.agents/notes/proposed/architecture/2026-08-14-desktop-gui-minimum-change-standalone-architecture.md).
// Boots the REAL web composition through the replay lane (no API key, no
// model calls), drives the major WebUI states exactly like the e2e scenarios
// do, and screenshots them at the lane baseline viewport into
// snapshots/visual-baseline/ together with the recording metadata and the
// static-asset inventory. The lane is skip-gated: CI's DSH_SNAPSHOT=replay run
// never records; the captures are the committed rendered baseline, re-recorded
// with:
//
//   DSH_VISUAL_BASELINE=record pnpm run test:web:built -- -t visual-baseline
//
// (`pnpm run build` first — `pnpm run test:web` does this automatically.)
//
// Platform note: the shipped `standard` agent preset disables `tool-bash` on
// win32 and mounts `tool-pwsh` instead (apps/cli/config/agent-presets/
// standard/agent.cordis.yml), so the recorded shell states pick the platform's
// live shell tool and its recorded fixture. Recording metadata records the
// platform; later work compares captures recorded under the same conditions.
// Privacy: the workspace-picker state is captured from a staged fixture
// directory, never the recording host's home (the browse backend's default
// listing target), so the committed PNGs carry no host directory or identity.
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { arch, platform, release } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CallId } from '@deepseek-ai/dsh-llm'
import { JobId } from '@deepseek-ai/dsh-jobs'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Locator, Page } from 'playwright'
import { chromium } from 'playwright'
import { describe, expect, it } from 'vitest'
import {
  WELCOME_NOTICE_COPY, launchWebScaffold, seedSession, type WebScaffold,
} from './scaffold.ts'
import { ZH_BROWSER_LOCALE, newEnglishPage } from './support.ts'

const OUT_DIR = fileURLToPath(new URL('./snapshots/visual-baseline', import.meta.url))
const RECORD = process.env.DSH_VISUAL_BASELINE === 'record'
const SEEDED_HISTORY_SEED = fileURLToPath(new URL('./snapshots/seeded-history/seed.jsonl', import.meta.url))
const FRESH_ROUND_TRIP_FIXTURE = fileURLToPath(new URL('./snapshots/fresh-round-trip/session.jsonl', import.meta.url))
const NAVIGATION_PANES_SEED = fileURLToPath(new URL('./snapshots/navigation-panes/seed.jsonl', import.meta.url))
const PWSH_TERMINAL_SEED = fileURLToPath(new URL('./snapshots/pwsh-terminal/seed.jsonl', import.meta.url))
const PUBLIC_DIR = fileURLToPath(new URL('../public', import.meta.url))
const DIST_ASSETS_DIR = fileURLToPath(new URL('../dist/assets', import.meta.url))
/** The platform's live shell tool: the standard preset mounts pwsh on win32, bash elsewhere. */
const SHELL_TOOL = platform() === 'win32' ? 'pwsh' : 'bash'
/** Recorded shell round with a terminal card for this platform's shell tool. */
const SHELL_SEED = platform() === 'win32' ? PWSH_TERMINAL_SEED : NAVIGATION_PANES_SEED
/** Content-search term that opens the platform shell seed's session. */
const SHELL_SEARCH = platform() === 'win32' ? 'Run a PowerShell command' : 'WATERFALL'
/**
 * The picker fixture the workspace-picker capture shows: deterministic
 * directory names staged inside the scaffold temp workspace, so the committed
 * capture never shows the recording host's home directory.
 */
const PICKER_FIXTURE_ENTRIES = ['archive-2024', 'docs', 'notes', 'projects'] as const
/** Fixture directory name under the scaffold temp workspace. */
const PICKER_FIXTURE_DIR = 'picker-fixture'

/**
 * Wait for the painted surface to settle before capturing: fonts loaded plus
 * one idle frame, the pixel analogue of the aria lane's double-capture
 * stabilization.
 * @param page - the page under test.
 */
async function settle(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(300)
}

/** Screenshot the current viewport into the committed baseline directory. */
async function capture(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: join(OUT_DIR, `${name}.png`) })
}

/** Open the single seeded session through the sidebar tree (message-actions pattern). */
async function openSeededSession(page: Page): Promise<void> {
  const groupRow = page.locator('[role="treeitem"]').first()
  await groupRow.waitFor({ timeout: 15_000 })
  await groupRow.click()
  const sessionRow = page.locator('[role="treeitem"]').nth(1)
  await sessionRow.waitFor({ timeout: 10_000 })
  await sessionRow.click()
}

/** Open a seeded session through content search (navigation-panes/pwsh-terminal pattern). */
async function openSeededBySearch(page: Page, term: string): Promise<void> {
  const searchButton = page.getByRole('button', { name: 'Search sessions' })
  if (await searchButton.getAttribute('aria-expanded') !== 'true') await searchButton.click()
  const search = page.getByPlaceholder('Search sessions', { exact: false })
  await search.fill(term)
  const result = page.getByRole('tree', { name: 'Search results' }).getByRole('treeitem')
  await expect.poll(() => result.count(), { timeout: 15_000 }).toBe(1)
  await result.click()
  await page.getByRole('tab', { name: 'Chat', exact: true }).waitFor({ timeout: 15_000 })
}

/**
 * Read a committed seed fixture realized for THIS scaffold. On Windows the
 * shared realizeSeedFixture splices the raw cwd path into the fixture's first
 * JSON line, whose backslashes then fail JSON.parse; pre-escape the path so
 * the splice stays valid on every host (Linux paths carry no backslashes, so
 * the escape is a no-op there).
 * @param scaffold - the scaffold whose temp workspace the seed targets.
 * @param seedPath - the committed seed fixture path.
 * @returns the realized fixture text.
 */
async function realizedSeed(scaffold: WebScaffold, seedPath: string): Promise<string> {
  const raw = await readFile(seedPath, 'utf8')
  const escapedCwd = JSON.stringify(scaffold.workspaceCwd).slice(1, -1)
  return raw.split('{{cwd}}').join(escapedCwd)
}

/**
 * Wait for the Host to publish the live Agent that opening a session resumes
 * (background-job-list pattern).
 * @param scaffold - the booted web scaffold.
 * @param sessionId - the opened session's identity.
 * @returns the registered Agent instance.
 */
async function liveAgent(scaffold: WebScaffold, sessionId: SessionId): Promise<Agent> {
  const deadline = Date.now() + 30_000
  for (;;) {
    const found = scaffold.ctx.agents.get(sessionId)
    if (found !== undefined) return found
    if (Date.now() > deadline) throw new Error(`opening session "${sessionId}" published no live Agent`)
    await new Promise(resolve => setTimeout(resolve, 100))
  }
}

/**
 * The inventory and metadata are written by the last test; list every file
 * under a directory (relative slash paths, files only).
 * @param dir - the directory to walk.
 * @returns relative file paths.
 */
async function walkFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true })
  return entries
    .filter(entry => entry.isFile())
    .map(entry => entry.name.split('\\').join('/'))
    .sort()
}

describe.skipIf(!RECORD)('web e2e: visual-baseline recorder', () => {
  it('records the empty-world hero and the workspace-picker dialog', async () => {
    const scaffold = await launchWebScaffold({})
    const browser = await chromium.launch()
    try {
      const page = await newEnglishPage(browser)
      await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
      await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
      await settle(page)
      await capture(page, '01-hero-empty-workspace')
      await page.getByRole('textbox', { name: 'Choose workspace' }).click()
      const dialog = page.getByRole('dialog', { name: 'Select Workspace Directory' })
      await dialog.waitFor({ timeout: 10_000 })
      // The dialog opens on the browse backend's default listing target — the
      // recording host's home directory. Never capture that: the committed PNG
      // must not carry a maintainer's real home entries or identity. Point the
      // picker at the staged fixture and capture its listing instead.
      await pickerFixture(dialog, scaffold)
      await settle(page)
      await capture(page, '02-workspace-picker-dialog')
    } finally {
      await browser.close()
      await scaffold.close()
    }
  })

  it('records the slash command menu and the active plan bar', async () => {
    const scaffold = await launchWebScaffold({})
    const browser = await chromium.launch()
    try {
      const page = await newEnglishPage(browser)
      await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
      await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
      await connectWorkspace(page, scaffold)
      const launcher = page.getByRole('button', { name: 'Commands' })
      await launcher.click()
      const menu = page.getByRole('listbox', { name: 'Trigger suggestions' })
      await menu.waitFor({ timeout: 10_000 })
      await settle(page)
      await capture(page, '11-command-menu')
      await page.locator('textarea').first().press('Escape')
      await launcher.click()
      await menu.getByRole('option', { name: 'plan Enter or leave plan mode' }).click()
      const input = page.locator('textarea').first()
      await input.press('Enter')
      const planButton = page.getByRole('button', { name: 'Plan mode on, press to turn off' })
      await planButton.waitFor({ timeout: 10_000 })
      await expect.poll(() => input.inputValue(), { timeout: 10_000 }).toBe('')
      await settle(page)
      await capture(page, '05-plan-active')
    } finally {
      await browser.close()
      await scaffold.close()
    }
  })

  it('records a seeded conversation in light and dark theme', async () => {
    const scaffold = await launchWebScaffold({})
    await seedSession(scaffold, await realizedSeed(scaffold, SEEDED_HISTORY_SEED), SessionId('visual-baseline-seed-1'))
    const browser = await chromium.launch()
    try {
      const page = await newEnglishPage(browser)
      await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
      await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
      await openSeededSession(page)
      await page.locator('[data-variant="read"]').first().waitFor({ timeout: 15_000 })
      await settle(page)
      await capture(page, '03-conversation-seeded')
      await page.evaluate(() => { document.body.setAttribute('data-ds-dark-theme', '') })
      await settle(page)
      await capture(page, '04-conversation-seeded-dark')
    } finally {
      await browser.close()
      await scaffold.close()
    }
  })

  it('records the background-jobs list with a running job', async () => {
    const scaffold = await launchWebScaffold({})
    await seedSession(scaffold, await realizedSeed(scaffold, FRESH_ROUND_TRIP_FIXTURE), SessionId('visual-baseline-jobs'))
    const browser = await chromium.launch()
    try {
      const page = await newEnglishPage(browser)
      await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
      await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
      await openSeededSession(page)
      const agent = await liveAgent(scaffold, SessionId('visual-baseline-jobs'))
      const command = SHELL_TOOL === 'pwsh' ? 'Start-Sleep -Seconds 45' : 'sleep 45'
      const started = await scaffold.ctx.tools.execute({
        signal: new AbortController().signal,
        callId: CallId('visual-baseline-jobs'),
        name: SHELL_TOOL,
        arguments: { command, description: 'Hold a background slot open', run_in_background: true },
        agent,
      })
      const reported = started.content.map(block => block.type === 'text' ? block.text : '').join('')
      const matched = new RegExp(`\\b${SHELL_TOOL}-\\d+\\b`).exec(reported)
      if (matched === null) throw new Error(`background ${SHELL_TOOL} reported no job id: ${reported}`)
      const jobId = JobId(matched[0])
      const trigger = page.getByRole('button', { name: '1 background job running' })
      await trigger.waitFor({ timeout: 15_000 })
      await trigger.click()
      const row = page.getByRole('list', { name: 'Background jobs' }).getByRole('listitem').first()
      await row.waitFor({ timeout: 10_000 })
      await settle(page)
      await capture(page, '06-background-jobs')
      scaffold.ctx.jobs.kill(jobId, agent, 'visual baseline teardown')
    } finally {
      await browser.close()
      await scaffold.close()
    }
  })

  it('records a shell terminal card', async () => {
    const scaffold = await launchWebScaffold({})
    await seedSession(scaffold, await realizedSeed(scaffold, SHELL_SEED), SessionId('visual-baseline-shell'))
    const browser = await chromium.launch()
    try {
      const page = await newEnglishPage(browser)
      await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
      await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
      await openSeededBySearch(page, SHELL_SEARCH)
      const row = page.locator(SHELL_TOOL === 'pwsh' ? '[data-tool="pwsh"]' : '[data-sample="bash"]').first()
      await row.waitFor({ timeout: 15_000 })
      if (await row.getAttribute('aria-expanded') !== 'true') await row.click()
      const card = page.locator('[data-terminal]').first()
      await card.waitFor({ timeout: 15_000 })
      await settle(page)
      await capture(page, '07-shell-terminal-card')
    } finally {
      await browser.close()
      await scaffold.close()
    }
  })

  it('records the trajectory tab', async () => {
    const scaffold = await launchWebScaffold({})
    await seedSession(scaffold, await realizedSeed(scaffold, NAVIGATION_PANES_SEED), SessionId('visual-baseline-nav'))
    const browser = await chromium.launch()
    try {
      const page = await newEnglishPage(browser)
      await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
      await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
      await openSeededBySearch(page, 'WATERFALL')
      await page.getByRole('tab', { name: 'Trajectory' }).click()
      const plot = page.getByLabel('Timeline overview; drag horizontally to focus events')
      await plot.waitFor({ timeout: 15_000 })
      await settle(page)
      await capture(page, '08-trajectory')
    } finally {
      await browser.close()
      await scaffold.close()
    }
  })

  it('records the settings dialog plugin and model sections', async () => {
    const scaffold = await launchWebScaffold({})
    const browser = await chromium.launch()
    try {
      // The settings surface localizes from the browser locale; the shared
      // settings-chrome scenario uses the Chinese page, and so does this one.
      const page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: ZH_BROWSER_LOCALE })
      await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
      await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
      await page.getByRole('button', { name: '设置', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: '设置' })
      await dialog.waitFor({ timeout: 10_000 })
      await dialog.getByRole('button', { name: '插件', exact: true }).click()
      await dialog.getByRole('heading', { name: '插件', exact: true }).waitFor({ timeout: 10_000 })
      await settle(page)
      await capture(page, '09-settings-plugins')
      await dialog.getByRole('button', { name: '模型' }).click()
      await expect.poll(() => dialog.getByRole('button', { name: '模型' }).getAttribute('aria-current'), {
        timeout: 5_000,
      }).toBe('true')
      // The empty models section: the provider list is unconfigured, so the
      // section's only entry is the add-provider action (models-settings pattern).
      await dialog.getByRole('button', { name: '添加提供方' }).waitFor({ timeout: 10_000 })
      await settle(page)
      await capture(page, '10-settings-models')
    } finally {
      await browser.close()
      await scaffold.close()
    }
  })

  it('records the onboarding credential step', async () => {
    const scaffold = await launchWebScaffold({ deepSeekMissingCredential: true, welcomeNoticePending: true })
    const browser = await chromium.launch()
    try {
      // The welcome and credential dialogs are the product's Chinese surface
      // (onboarding-deepseek-config pattern).
      const page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: ZH_BROWSER_LOCALE })
      await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
      await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
      const welcome = page.getByRole('dialog', { name: WELCOME_NOTICE_COPY.zh.title })
      await welcome.waitFor({ timeout: 15_000 })
      await welcome.getByRole('button', { name: WELCOME_NOTICE_COPY.zh.continueLabel }).click()
      const credentialStep = page.getByRole('dialog', { name: '添加一个 API Key 开始使用' })
      await credentialStep.waitFor({ timeout: 15_000 })
      await settle(page)
      await capture(page, '12-onboarding-credential-step')
    } finally {
      await browser.close()
      await scaffold.close()
    }
  })

  it('writes the recording metadata and the static-asset inventory', async () => {
    await mkdir(OUT_DIR, { recursive: true })
    const captures = (await walkFiles(OUT_DIR)).filter(name => name.endsWith('.png'))
    if (captures.length === 0) throw new Error('visual baseline recorded no captures')
    const browser = await chromium.launch()
    const chromiumVersion = browser.version()
    await browser.close()
    const recording = [
      '# Visual baseline — recording metadata',
      '',
      'The committed captures in this directory are the rendered baseline for the desktop-GUI parity note',
      '(.agents/notes/proposed/architecture/2026-08-14-desktop-gui-minimum-change-standalone-architecture.md).',
      'They record the real WebUI states driven keylessly through the replay lane (no API key, no model',
      'calls) at the web e2e lane baseline viewport. Re-record with:',
      '',
      '```sh',
      'DSH_VISUAL_BASELINE=record pnpm run test:web:built -- -t visual-baseline',
      '```',
      '',
      '(`pnpm run build` first; `pnpm run test:web` does this automatically.)',
      '',
      '## Recording conditions',
      '',
      '- Viewport: 1680x1000 (the web e2e lane baseline; see tests/support.ts newEnglishPage)',
      '- Locale: en-US (product surface English unless the state itself is Chinese, e.g. the settings dialog)',
      '- Theme: light by default; 04-conversation-seeded-dark records the `body[data-ds-dark-theme]` cascade',
      `- Platform: ${platform()} ${arch()} (${release()})`,
      `- Browser: Playwright Chromium ${chromiumVersion}`,
      `- Recorded: ${new Date().toISOString()}`,
      '',
      '## Caveats',
      '',
      '- Seeded-session captures show the scaffold temp workspace directory basename, which varies per run;',
      '  treat that region as non-asserted (the aria lane normalizes the same value to {{workspace}}).',
      '- The workspace-picker capture (02-workspace-picker-dialog) shows the staged picker fixture under',
      '  the scaffold temp workspace, never the recording host\'s home directory (the dialog opens on the',
      '  browse backend\'s home default); its basename region varies per run and is non-asserted.',
      '- Pixel rendering (fonts, antialiasing) is platform-dependent; captures are authoritative for the',
      '  recorded platform only, and the desktop implementation phase re-records on its own platform.',
      '',
      '## Captures',
      '',
      ...captures.map(name => `- ${name}`),
      '',
    ].join('\n')
    const publicFiles = (await walkFiles(PUBLIC_DIR)).map(name => `- ${name}`)
    const distAssets = (await walkFiles(DIST_ASSETS_DIR)).map(name => `- ${name}`)
    const inventory = [
      '# Static-art inventory — upstream WebUI visual/static resources',
      '',
      'Generated by the visual-baseline recorder (apps/web/tests/visual-baseline.e2e.ts) from the source',
      'tree and the built dist as of the recording run. The desktop packaged app must keep every entry',
      'present and resolvable; a later desktop deliverable proves that per entry.',
      '',
      `## apps/web/public/ (${publicFiles.length} files, source-controlled)`,
      '',
      ...publicFiles,
      '',
      `## apps/web/dist/assets/ (${distAssets.length} files, Vite-emitted imported assets)`,
      '',
      ...distAssets,
      '',
    ].join('\n')
    await writeFile(join(OUT_DIR, 'recording.md'), recording)
    await writeFile(join(OUT_DIR, 'static-assets.md'), inventory)
  })
})

/**
 * Point the picker dialog at the staged fixture and wait for its listing.
 * The dialog opens on the browse backend's default listing target — the
 * recording host's home directory — so a capture taken right after open
 * would expose real home entries and the host's identity; the fixture keeps
 * the committed baseline private and deterministic (only its basename, under
 * the scaffold temp workspace, varies per run). The waits double as the
 * assertion that the visible listing is the fixture's.
 * @param dialog - the open Select Workspace Directory dialog.
 * @param scaffold - the booted scaffold whose temp workspace stages the fixture.
 */
async function pickerFixture(dialog: Locator, scaffold: WebScaffold): Promise<void> {
  const fixture = join(scaffold.workspaceCwd, PICKER_FIXTURE_DIR)
  for (const entry of PICKER_FIXTURE_ENTRIES) await mkdir(join(fixture, entry), { recursive: true })
  await dialog.getByRole('button', { name: 'Edit path' }).click()
  const pathInput = dialog.getByRole('textbox', { name: 'Edit path' })
  await pathInput.fill(fixture)
  await pathInput.press('Enter')
  for (const entry of PICKER_FIXTURE_ENTRIES) {
    await dialog.getByRole('button', { name: entry, exact: true }).waitFor({ timeout: 10_000 })
  }
}

/**
 * Drive the hero's workspace picker until the composer unlocks — the first
 * capture set's "connected" prerequisite (support.ts connectFreshWorkspace
 * steps, inlined to keep this recorder's surface explicit).
 * @param page - the page under test.
 * @param scaffold - the booted scaffold whose workspace the folder is staged in.
 */
async function connectWorkspace(page: Page, scaffold: WebScaffold): Promise<void> {
  const root = scaffold.workspaceCwd
  await mkdir(join(root, 'workspace'), { recursive: true })
  await page.getByRole('textbox', { name: 'Choose workspace' }).click()
  const dialog = page.getByRole('dialog', { name: 'Select Workspace Directory' })
  await dialog.waitFor({ timeout: 10_000 })
  await dialog.getByRole('button', { name: 'Edit path' }).click()
  const pathInput = dialog.getByRole('textbox', { name: 'Edit path' })
  await pathInput.fill(join(root, 'workspace'))
  await pathInput.press('Enter')
  await dialog.getByRole('button', { name: 'Open', exact: true }).click()
  await page.locator('textarea:enabled[placeholder="Describe what you want to build"]')
    .waitFor({ timeout: 15_000 })
}
