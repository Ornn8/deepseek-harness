import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')

describe('node-pty package patch', () => {
  it('keeps native addon lookup compatible with exact-key package filesystems', () => {
    const patch = readFileSync(resolve(root, 'patches/node-pty@1.1.0.patch'), 'utf8')
    const builder = readFileSync(resolve(root, 'scripts/build-exe-for-python-sdk.ts'), 'utf8')

    expect(patch).toContain('module: require(dir + name + ".node")')
    expect(patch).toContain('module: require(`${dir}${name}.node`)')
    expect(patch).toContain('-                return { dir: dir, module: require(dir + "/" + name + ".node") };')
    expect(patch).toContain('-        return { dir, module: require(`${dir}/${name}.node`) };')
    expect(builder).toContain("'node_modules/node-pty/build/Release/pty.node'")
  })
})
