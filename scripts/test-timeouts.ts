/**
 * Per-test deadline for specs that build temporary Git repositories and
 * spawn several Git and Node subprocesses per case (init/commit/branch,
 * worktree and symlink fixtures, concurrent installers). Windows process
 * spawn and filesystem work take several times longer than on POSIX, and
 * the CI Windows lane runs the two heavy coverage gates concurrently, so
 * the Vitest default 5000ms deadline trips there under runner load without
 * any test behavior changing. The tripping spec varies per run
 * (change-scope, translation-pairing-merge, install-lefthook), so every
 * git-fixture spec shares this budget instead of tuning per case.
 */
export const GIT_FIXTURE_TEST_TIMEOUT_MS = process.platform === 'win32' ? 60_000 : 30_000
