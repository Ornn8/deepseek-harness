import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'
import { standardDecoratorPlugin, vitestExecArgv } from './vitest.shared.ts'

// Desktop GUI lane: the standalone Electron shell smoke against the REAL web
// composition. Runs the built shell (`apps/desktop/lib/main.js`) with a
// hermetic temp world, keyless like the web replay lane. Self-skips where
// Electron cannot open a window (no binary or no display); `pnpm run
// test:desktop` rebuilds the lib and frontend dist first.
export default defineConfig({
  // Same resolution note as vitest.config.ts: the tsconfig.base.json paths
  // facade has no include (match-all), so apps/desktop/tests resolves bare
  // workspace imports to source like every other lane.
  plugins: [
    tsconfigPaths({ projects: ['./tsconfig.base.json'] }),
    standardDecoratorPlugin(),
  ],
  test: {
    execArgv: vitestExecArgv,
    include: [
      'apps/desktop/tests/**/*.e2e.ts',
    ],
    // A real window boot + composition settle is slow; run serial.
    testTimeout: 240_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
})
