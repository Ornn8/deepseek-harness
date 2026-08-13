# Agent Note: Fork-safe automation workflows and node-pty manylinux rebuild

Status: implemented

[English](2026-08-13-fork-safe-automation-and-node-pty-manylinux-rebuild.md) | 中文

## Problem

`Ornn8/deepseek-harness` 为运行其 GitHub-agent 自动化流水线而 fork 了上游仓库，但 fork 中有三项检查失败，原因都是硬编码上游坐标这一历史遗留，而非 fork 自身的改动。

1. Issue policy 检查读取 `config.json`，其中 `organization` 与 `repository` 均为 `deepseek-harness`，因此 `policy.mjs pr` 会查询 `/repos/deepseek-harness/deepseek-harness/...`。fork 的 PR 于是从 `requested_reviewers` 端点收到 404，作业失败。
2. Issue lifecycle 检查在其 `create-github-app-token` 步骤上硬编码了 `owner: deepseek-harness` 与 `repositories: deepseek-harness`，且该步骤需要 `vars.DSH_ISSUE_APP_CLIENT_ID` 与 `secrets.DSH_ISSUE_APP_PRIVATE_KEY`。fork 两者都未配置，于是该 action 以 "client-id must be set to a non-empty string" 失败。
3. 必选检查 `python runtime / release-shaped Linux x64 / node24-linux-x64` 在 manylinux 2.28 容器内重建 node-pty 插件，方式是复用主机上 `pnpm install` 生成的 Makefile。node-pty 的 `binding.gyp` 通过 `require()` 解析 node-addon-api，而 `require()` 会沿 pnpm 的符号链接进入同级 `.pnpm/node-addon-api@7.1.1/` 存储目录；gyp 随后在一个浅了一层的相对路径（相对 `build/` 目录为 `../../../node-addon-api@7.1.1/...`）上写入并引用 `node_addon_api*` 子 Makefile，于是容器内的 `make` 停在 `No rule to make target .../node_addon_api_maybe.target.mk`。

## Decision

每项检查都从它实际运行的仓库推导坐标，而不是写死上游仓库；依赖 App 的 lifecycle 在其凭据缺失时变为惰性（inert）。

`policy.mjs` 将 `process.env.GITHUB_REPOSITORY`（`owner/repo`）拆分为 `organization` 与 `repository`，并优先于 `config.json` 的默认值使用；本地与测试运行未设置该变量，保持检入的默认值。所有原先内插 `config.organization`/`config.repository` 的 REST/GraphQL 路径现在都内插这两个推导常量。

`issue-lifecycle.yml` 在作业级 `if` 上加入 `vars.DSH_ISSUE_APP_CLIENT_ID != ''`，使无凭据的仓库（包括本 fork）跳过作业而不是令其失败，并从 `github.repository_owner` 与 `github.event.repository.name` 推导 App 安装归属，使安装了 App 的 fork 指向自身安装而非上游。

`build-exe-for-python-sdk.yml` 在 `Install (immutable)` 步骤上设置 `NODE_OPTIONS: --preserve-symlinks`。于是 Node 把 `require('node-addon-api')` 解析到 node-pty 下的符号链接路径，而非解析后的同级存储路径，gyp 也就把 `node_addon_api*` 子 Makefile 写到 node-pty 下，并带有一个稳定的相对引用，manylinux 重建即可复用而不再遇到缺失的目标文件。

## Alternatives considered

**保留主机 Makefile，在容器内修补损坏路径。** 在 `make` 前创建缺失的 `node_addon_api*.target.mk` 文件（空文件或手写 stamp 规则）能掩盖符号链接导致的路径问题，却不能修复其根因，而且确切的 stamp 名称必须跟随 gyp 的输出命名；保符号链接的 configure 则在源头修正了生成过程。

**用 `node-linker=hoisted` 提升 node-addon-api。** 提升会改变整个安装布局，而 single-exe 部署步骤已经按阶段精心选择布局（闭包用 `--config.node-linker=hoisted`，源码安装用 isolated），为一个原生插件而做更宽泛的布局变更代价过大。

**用步骤级守卫根据私钥为 lifecycle 设门。** 步骤级守卫能检测 `secrets`，但被跳过的作业才是需求所指定的显式「惰性」状态；`vars.DSH_ISSUE_APP_CLIENT_ID` 与私钥在拥有 App 的仓库中一同设置，因此作业级变量检测是正确且充分的 fork 安全条件。

## Consequences

这三项检查现在在没有 App 凭据、也没有匹配的 issue-management Project 的 fork 上也能通过。`policy.mjs` 的推导不改变上游行为：在那里 `GITHUB_REPOSITORY` 就等于所配置的坐标，Project 查找仍指向拥有该 Project 的组织。

若某个 fork 日后安装了 issue-management App 并希望获得 lifecycle 状态更新，仍需提供匹配的 ProjectV2（`config.json` 仍写死上游的 Project 编号与标题）以及两样 App 凭据；本次工作流级改动只是让凭据缺失不再致命、让 App 安装归属自寻，并不会为 fork 配置 Project。

`--preserve-symlinks` 作用于安装步骤中的每一个 Node 进程，而不仅是 node-gyp。它被限定在这一个构建作业的安装步骤内；未来若有原生依赖的 postinstall 依赖「把 pnpm 符号链接解析为真实路径」，需要做同样的根因复核，而不是直接大范围移除该标志。
