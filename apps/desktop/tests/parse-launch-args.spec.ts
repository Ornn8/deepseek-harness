/** The desktop shell's launcher-argument split, pinned without booting Electron. */

import { describe, expect, it } from 'vitest'
import { parseLaunchArgs } from '../src/args.ts'

describe('desktop launcher arguments', () => {
  it('splits launcher-owned --patch overlays from forwarded web arguments', () => {
    expect(parseLaunchArgs(['electron', '/app/main.js', '--patch', 'a.yml', '--port', '8080']))
      .toEqual({ patches: ['a.yml'], args: ['--port', '8080'] })
  })

  it('skips chromium switches and the app path before the shell command line', () => {
    // Playwright launches Electron with CDP switches before the app path.
    expect(parseLaunchArgs(['electron', '--inspect=0', '--remote-debugging-port=0', '/app/main.js', '--patch', 'a.yml']))
      .toEqual({ patches: ['a.yml'], args: [] })
  })

  it('accepts repeatable and equals-form --patch flags', () => {
    expect(parseLaunchArgs(['electron', '/app/main.js', '--patch=a.yml', '--patch', 'b.yml', '--port', '0']))
      .toEqual({ patches: ['a.yml', 'b.yml'], args: ['--port', '0'] })
  })

  it('forwards everything after the first non-patch token verbatim', () => {
    expect(parseLaunchArgs(['electron', '/app/main.js', '--patch', 'a.yml', '-h']))
      .toEqual({ patches: ['a.yml'], args: ['-h'] })
  })

  it('returns no arguments for a bare launch', () => {
    expect(parseLaunchArgs(['electron', '/app/main.js'])).toEqual({ patches: [], args: [] })
  })

  it('rejects a trailing --patch without a value', () => {
    expect(() => parseLaunchArgs(['electron', '/app/main.js', '--patch']))
      .toThrow(/--patch needs a path/)
    expect(() => parseLaunchArgs(['electron', '/app/main.js', '--patch=']))
      .toThrow(/--patch needs a path/)
  })
})
