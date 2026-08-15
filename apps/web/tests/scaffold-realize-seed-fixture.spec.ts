// Regression coverage for realizeSeedFixture's Windows path handling (the
// desktop shell seeds the same fixtures on Windows): a native workspace cwd
// holds backslashes, and splicing that path into the fixture's JSON text raw
// would reject the session header as invalid escape sequences. Realization
// must splice the JSON-escaped form so parseSessionLog still parses the log
// and the intended cwd survives.
import { describe, expect, it } from 'vitest'
import { parseSessionLog } from '@deepseek-ai/dsh-llm-replay'
import { realizeSeedFixture, type WebScaffold } from './scaffold.ts'

const WINDOWS_WORKSPACE_CWD = 'C:\\Users\\harness\\AppData\\Local\\Temp\\dsh-web-e2e-ws-abc123'

/** A recorded seed in the committed fixture convention: tokenized cwd, closed recording. */
const SEED_FIXTURE = [
  '{"type":"session","version":0,"id":"{{sessionId}}","createdAt":1785403668101,"cwd":"{{cwd}}/workspace"}',
  '{"type":"command/run","seq":0,"time":1785403668197,"data":{"commandId":"cmd-0ab130cc-1","name":"permission","args":" read-only","source":{"kind":"user"}}}',
  '{"type":"turn/end","seq":1,"time":1785403668198,"data":{}}',
  '',
].join('\n')

function scaffoldWithCwd(cwd: string): WebScaffold {
  return { workspaceCwd: cwd } as WebScaffold
}

describe('realizeSeedFixture', () => {
  it('splices a backslash workspace cwd as valid JSON and keeps the intended cwd', () => {
    const realized = realizeSeedFixture(scaffoldWithCwd(WINDOWS_WORKSPACE_CWD), SEED_FIXTURE, 'seeded-win-1')
    const events = parseSessionLog(realized)
    expect(events.map(event => event.type)).toEqual(['command/run', 'turn/end'])
    const header = JSON.parse(realized.split('\n', 1)[0] ?? '') as { cwd: string }
    expect(header.cwd).toBe(WINDOWS_WORKSPACE_CWD)
  })

  it('rewrites a recorded literal Windows cwd to another backslash cwd as valid JSON', () => {
    const recorded = SEED_FIXTURE.replace(
      '"cwd":"{{cwd}}/workspace"',
      '"cwd":"D:\\\\work\\\\recorded\\\\repo"',
    )
    const realized = realizeSeedFixture(scaffoldWithCwd(WINDOWS_WORKSPACE_CWD), recorded, 'seeded-win-2')
    expect(() => parseSessionLog(realized)).not.toThrow()
    const header = JSON.parse(realized.split('\n', 1)[0] ?? '') as { cwd: string }
    expect(header.cwd).toBe(WINDOWS_WORKSPACE_CWD)
  })

  it('leaves POSIX realization unchanged', () => {
    const posixCwd = '/tmp/dsh-web-e2e-ws-abc123'
    const realized = realizeSeedFixture(scaffoldWithCwd(posixCwd), SEED_FIXTURE, 'seeded-posix-1')
    expect(() => parseSessionLog(realized)).not.toThrow()
    const header = JSON.parse(realized.split('\n', 1)[0] ?? '') as { cwd: string }
    expect(header.cwd).toBe(posixCwd)
  })
})
