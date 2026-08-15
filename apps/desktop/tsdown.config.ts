import { defineConfig } from 'tsdown'

/**
 * The desktop shell ships one entry: the Electron main process referenced by
 * package.json `main`. Its reachable workspace modules bundle with it; the
 * Electron runtime stays external (the app binary provides it).
 */
export default defineConfig({
  entry: ['lib/types/main.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
  external: ['electron'],
})
