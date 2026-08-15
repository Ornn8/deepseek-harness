/**
 * The desktop shell's launcher-argument split: `--patch` overlays belong to
 * the shell, everything after them is the web app's own flag family.
 * @module @deepseek-ai/dsh-desktop/args
 */

/** Diagnostic prefix for the shell's own messages. */
const BIN_NAME = 'dsh-desktop'

/** One parsed desktop launch invocation: launcher-owned overlays plus web app arguments. */
export interface LaunchInvocation {
  /** `--patch <path>` overlay files, in argument order. */
  patches: string[]
  /** Everything after the shell's own flags, verbatim, for the web app's flag family. */
  args: string[]
}

/**
 * Parse the shell's launcher flags from the Electron main-process argv.
 * Electron's argv is `[binary, ...chromium switches, app path, ...user
 * args]`: Playwright (and any CDP harness) injects switches such as
 * `--inspect=0` and `--remote-debugging-port=0` before the app path, so the
 * shell's own command line starts after the first non-switch token (the app
 * path). Within that tail, `--patch` is launcher-owned, the same split as the
 * `dsh` launcher; the first token that is not part of a `--patch` pair starts
 * the web app's own arguments (`--host`, `--port`, `--trusted-host`, ...),
 * which are forwarded verbatim.
 * @param argv - the Electron main-process `process.argv`.
 * @returns the overlay paths and the forwarded web arguments.
 * @throws when a `--patch` flag has no value.
 */
export function parseLaunchArgs(argv: readonly string[]): LaunchInvocation {
  let index = 1
  while (index < argv.length && (argv[index] ?? '').startsWith('-')) index += 1
  index += 1 // the app path (the main script), present in every real launch
  const patches: string[] = []
  for (; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === undefined) break
    if (token === '--patch') {
      const path = argv[index + 1]
      if (path === undefined) throw new Error(`${BIN_NAME}: --patch needs a path`)
      patches.push(path)
      index += 1
      continue
    }
    if (token.startsWith('--patch=')) {
      const path = token.slice('--patch='.length)
      if (path === '') throw new Error(`${BIN_NAME}: --patch needs a path`)
      patches.push(path)
      continue
    }
    break
  }
  return { patches, args: argv.slice(index) }
}
