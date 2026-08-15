import { defineConfig } from 'tsdown'

/**
 * The dsh CLI ships the `bin` referenced by package.json `bin` plus a second
 * entry exposing the shared profile-boot glue (`./profile-boot` export) that
 * the standalone desktop shell boots the same composition through. The root
 * tsdown builds only `lib/types/index.js`, so this override points at
 * `lib/types/bin.js` instead; each entry's reachable mode modules bundle with
 * it. Declarations come from `tsc -b` (dts: false), matching every package.
 */
export default defineConfig({
  entry: ['lib/types/bin.js', 'lib/types/profile-boot.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})
