# Agent Note: Manylinux node-pty rebuild regenerates its build state

Status: implemented

English | [中文](2026-08-14-manylinux-node-pty-rebuild-regenerates-build-state.zh.md)

## Problem

`python runtime / release-shaped Linux x64 / node24-linux-x64` CI 作业在 [build-exe-for-python-sdk.yml](../../../../.github/workflows/build-exe-for-python-sdk.yml) 的 `Rebuild Linux node-pty against manylinux 2.28` 步骤失败，报错为 `Makefile:347: ../../../node-addon-api@7.1.1/node_modules/node-addon-api/node_addon_api_maybe.target.mk: No such file or directory`。该步骤在 manylinux 容器内、node-pty 的 pnpm 虚拟存储真实路径下运行 `make -C build`，因此生成的 Makefile 对 node-addon-api 的 include 必须在挂载的工作区内可解析。冻结安装的 pnpm side-effects 缓存会恢复 node-pty 的 `build/` 目录，却不会恢复 node-addon-api 的目标文件：node-gyp 把这些文件写到包目录之外（包内层 `node_modules` 的兄弟位置），缓存里从来就没有它们。于是热缓存的安装得到一份 include 全部悬空的 Makefile，容器重建在编译任何东西之前就失败。

## Decision

在容器重建之前，步骤先在 runner 上运行 `pnpm rebuild node-pty`，强制 node-pty 的安装脚本（`node scripts/prebuild.js || node-gyp rebuild`）在当前树中重新生成 `build/` 与 node-addon-api 目标文件。随后容器内的 `make -C build BUILDTYPE=Release` 从一致的布局出发，针对 manylinux 编译 addon。重新生成是无条件的：每次运行多付出一次宿主侧 node-pty 重建的代价，同时让该步骤不再依赖冻结安装产生的任何状态。工作流 spec 固定了 `pnpm rebuild node-pty` 调用，日后删除该重新生成会令 spec 失败。

## Alternatives considered

**在容器内运行 node-gyp rebuild。** 这会在容器里完成全部重新生成，但 manylinux 镜像不携带 Node 二进制；在步骤中引入 Node 下载、node-gyp 与 header 处理，比宿主侧重建多出许多易变环节。

**就地改写 Makefile 的 include。** 悬空的 include 指向的 `.mk` 文件在中毒后的树中任何位置都不存在，改写 include 路径无法生效；只有重新生成文件才能提供它们。

**为安装禁用 pnpm 的 side-effects 缓存。** 这会改变整个作业的安装语义并依赖 pnpm 配置内部机制；显式重建自包含，且在 node-pty 无法构建时响亮失败。

**把工作区切换到 hoisted node linker。** 扁平 `node_modules` 会改变 node-gyp 输出的相对路径，但这是仓库级布局变更，没有任何其他消费方，仅为修复一个 CI 步骤不值当。

## Consequences

每次运行多付出一次 node-pty 源码构建（约一分钟）；容器编译与 GLIBC 检查不变。该步骤不再依赖 side-effects 缓存对包目录之外文件的保真度；全新构建通过、缓存 `build/` 缺少镜像文件时在同一 include 处失败的复现路径，作为已知失败模式记录于此。
