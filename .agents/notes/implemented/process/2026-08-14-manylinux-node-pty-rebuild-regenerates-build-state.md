# Agent Note: Manylinux node-pty rebuild regenerates its build state

Status: implemented

English | [中文](2026-08-14-manylinux-node-pty-rebuild-regenerates-build-state.zh.md)

## Problem

The `python runtime / release-shaped Linux x64 / node24-linux-x64` CI job failed at the `Rebuild Linux node-pty against manylinux 2.28` step in [build-exe-for-python-sdk.yml](../../../../.github/workflows/build-exe-for-python-sdk.yml) with `Makefile:347: ../../../node-addon-api@7.1.1/node_modules/node-addon-api/node_addon_api_maybe.target.mk: No such file or directory`. The step runs `make -C build` inside the manylinux container from node-pty's pnpm virtual-store realpath, so the generated Makefile's node-addon-api includes must resolve inside the mounted workspace. The frozen install's pnpm side-effects cache restores node-pty's `build/` directory but not the node-addon-api target files: node-gyp writes those files outside the package directory (a sibling of its inner `node_modules`), so the cache never contains them. A warm-cache install therefore yields a Makefile whose includes resolve nowhere, and the container rebuild fails before compiling anything.

## Decision

Before the container rebuild, the step runs `pnpm rebuild -r node-pty` on the runner, forcing node-pty's install script (`node scripts/prebuild.js || node-gyp rebuild`) to regenerate `build/` and the node-addon-api target files in the current tree. The recursive form is required: from the workspace root a bare `pnpm rebuild node-pty` silently skips the package because node-pty is only a transitive dependency of the root project, leaving the poisoned `build/` that the cached install restored. The container's `make -C build BUILDTYPE=Release` then starts from a consistent layout and compiles the addon against manylinux. The regeneration is unconditional: it costs one host-side node-pty rebuild per run, and it keeps the step independent of whatever state the frozen install produced. The workflow spec pins the `pnpm rebuild -r node-pty` call, so removing the regeneration later fails the spec.

## Alternatives considered

**Run node-gyp rebuild inside the container.** This would regenerate everything in the container, but the manylinux image ships no Node binary, and wiring a Node download plus node-gyp and header handling into the step adds moving parts that the host-side rebuild does not need.

**Repoint the Makefile includes in place.** The dangling includes reference `.mk` files that exist nowhere in the poisoned tree, so rewriting the include paths cannot work; only regenerating the files provides them.

**Disable pnpm's side-effects cache for the install.** This changes install semantics job-wide and depends on pnpm configuration internals; the explicit rebuild is self-contained and fails loud if node-pty cannot build.

**Switch the workspace to a hoisted node linker.** A flat `node_modules` would change the relative paths node-gyp emits, but it is a repository-wide layout change with no other consumer, taken to fix one CI step.

## Consequences

The job pays for one extra node-pty source build per run (about a minute); the container compile and GLIBC checks are unchanged. The step no longer depends on the side-effects cache's fidelity for files node-gyp writes outside the package directory, and the reproduction (fresh build passes, cached `build/` without the mirror files fails at the same include) is now a known failure mode recorded here.
