import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')

describe('node-pty package patch', () => {
  it('loads the packaged native addon from an executable companion', () => {
    const patch = readFileSync(resolve(root, 'patches/node-pty@1.1.0.patch'), 'utf8')
    const builder = readFileSync(resolve(root, 'scripts/build-exe-for-python-sdk.ts'), 'utf8')

    expect(patch).toContain('var companion = process.execPath + "-" + name + ".node";')
    expect(patch).toContain('const companion = `${process.execPath}-${name}.node`;')
    expect(patch).toContain('module: require(companion)')
    expect(builder).toContain('const ptyCompanion = `${product}-pty.node`')
    expect(builder).toContain('await copyFile(nativePty, ptyCompanion)')
    expect(builder).toContain("resolveDependency('node-pty/package.json'")
    expect(builder).not.toContain("'subprocess-local', 'node_modules', 'node-pty', 'build'")
    expect(builder.indexOf('await copyFile(nativePty, ptyCompanion)')).toBeLessThan(
      builder.indexOf('await this.run(`pkg ${target.spec}`'),
    )
  })
})
