# Agent Note: Fork-safe automation workflows and node-pty manylinux rebuild

Status: implemented

[English](2026-08-13-fork-safe-automation-and-node-pty-manylinux-rebuild.md) | 中文

## Problem

`Ornn8/deepseek-harness` 为运行其 GitHub-agent 自动化流水线而 fork 了上游仓库，但四种故障模式使该 fork 无法自主运行。

1. Issue policy 检查读取 `config.json`，其中 `organization` 与 `repository` 均为 `deepseek-harness`，因此 `policy.mjs pr` 会查询 `/repos/deepseek-harness/deepseek-harness/...`。fork 的 PR 于是从 `requested_reviewers` 端点收到 404，作业失败。
2. Issue lifecycle 检查在其 `create-github-app-token` 步骤上硬编码了 `owner: deepseek-harness` 与 `repositories: deepseek-harness`，且该步骤需要 `vars.DSH_ISSUE_APP_CLIENT_ID` 与 `secrets.DSH_ISSUE_APP_PRIVATE_KEY`。fork 两者都未配置，于是该 action 以 "client-id must be set to a non-empty string" 失败。
3. 必选检查 `python runtime / release-shaped Linux x64 / node24-linux-x64` 在 manylinux 2.28 容器内重建 node-pty 插件，方式是复用主机上 `pnpm install` 生成的 Makefile。node-pty 的 `binding.gyp` 通过 `require()` 解析 node-addon-api，而 `require()` 会沿 pnpm 的符号链接进入同级 `.pnpm/node-addon-api@7.1.1/` 存储目录；gyp 随后在一个浅了一层的相对路径（相对 `build/` 目录为 `../../../node-addon-api@7.1.1/...`）上写入并引用 `node_addon_api*` 子 Makefile，于是容器内的 `make` 停在 `No rule to make target .../node_addon_api_maybe.target.mk`。
4. 一个调用工作流同时承担 Issue 分发、Codex 审核、DSH 返工和合并意图。它把可变标签和仅绑定 head 的状态当作持久状态，让无关作业共用耦合的权限范围，并且在接收工作流只存在于 PR、尚未进入默认分支时就依赖 `repository_dispatch`。因此，引导阶段的阻断审核可能无法唤醒 DSH，而后续 base 更新也可能留下一个已成功但不再代表已审核 base/head 对的 head 状态。

## Decision

每项检查都从它实际运行的仓库推导坐标，而不是写死上游仓库；依赖 App 的 lifecycle 在其凭据缺失时变为惰性（inert）。

`policy.mjs` 将 `process.env.GITHUB_REPOSITORY`（`owner/repo`）拆分为 `organization` 与 `repository`，并优先于 `config.json` 的默认值使用；本地与测试运行未设置该变量，保持检入的默认值。所有原先内插 `config.organization`/`config.repository` 的 REST/GraphQL 路径现在都内插这两个推导常量。

`issue-lifecycle.yml` 在作业级 `if` 上加入 `vars.DSH_ISSUE_APP_CLIENT_ID != ''`，使无凭据的仓库（包括本 fork）跳过作业而不是令其失败，并从 `github.repository_owner` 与 `github.event.repository.name` 推导 App 安装归属，使安装了 App 的 fork 指向自身安装而非上游。

`build-exe-for-python-sdk.yml` 在 `Install (immutable)` 步骤上设置 `NODE_OPTIONS: --preserve-symlinks`。于是 Node 把 `require('node-addon-api')` 解析到 node-pty 下的符号链接路径，而非解析后的同级存储路径，gyp 也就把 `node_addon_api*` 子 Makefile 写到 node-pty 下，并带有一个稳定的相对引用，manylinux 重建即可复用而不再遇到缺失的目标文件。

目标仓库用相互独立的薄工作流替换组合调用器，分别负责 Issue 分发、精确版本对 PR 审核、可信返工反馈、显式落地和按需健康检查。每个可复用工作流及其控制器 checkout 都使用专用 `Ornn8/dsh-agent-automation` 仓库中的同一个完整 commit SHA，因此控制器升级会成为目标仓库内一次可审核的改动。

自动化仓库公开一套统一的 Agent Worker 调用与终态回执接口。运行时专用 Adapter 负责启动和观察 DSH Web、ChatGPT Desktop 或使用 JSON 协议的命令；目标工作流把 `review` 与 `change` 角色映射到已配置的 worker id。两个角色分别使用 `agent-reviewer` 与 `agent-change` runner 注册、进程、工作目录、并发组和健康检查作业。

审核 worker 获得精确 base/head checkout，不获得 Actions 凭据，并只做只读检查。作业级 Actions token 发布 pending 或最终 `codex/review` 兼容状态、英文审核评论和投影标签。BLOCK 结论记录精确版本对；控制器通过共享的主机 GitHub 身份发布一个不可变、幂等、面向 `change` 角色的 `agent_work_requested` WorkRequest 后，审核任务即终止。接收工作流独立启动，校验 WorkRequest 字段、实时 head、审核标记和标签，再调用其配置的变更 worker。已完成且失败的 `CI` workflow run 会创建一个由 run id 和 attempt 标识的独立请求；只有工作流名为 `CI`、结论为失败、PR 编号匹配且 head 正是当前值时，控制器才允许变更 worker 检查日志或修改分支。

PASS 结论发出 `dsh-land`，而不是启用长期 auto-merge。落地控制器只接受当前指向 `master` 的非草稿 PR，要求精确 base/head PASS 记录和所有实时分支保护上下文均成功，在 squash merge 前立即重复这些检查，否则不改变 PR 即退出。成功的 `CI` workflow run 会在待定检查完成后重试落地。

每次向 `master` 推送后，协调器只为当前 base/head 对既没有已完成审核、也没有待处理审核的同仓库开放 PR 分发审核；草稿、落后以及已有覆盖的 PR 会被跳过。手动健康工作流在各自 runner 上分别检查每个已配置 worker，并检查固定控制器与 GitHub 访问，全程不调用模型。

## Alternatives considered

**保留主机 Makefile，在容器内修补损坏路径。** 在 `make` 前创建缺失的 `node_addon_api*.target.mk` 文件（空文件或手写 stamp 规则）能掩盖符号链接导致的路径问题，却不能修复其根因，而且确切的 stamp 名称必须跟随 gyp 的输出命名；保符号链接的 configure 则在源头修正了生成过程。

**用 `node-linker=hoisted` 提升 node-addon-api。** 提升会改变整个安装布局，而 single-exe 部署步骤已经按阶段精心选择布局（闭包用 `--config.node-linker=hoisted`，源码安装用 isolated），为一个原生插件而做更宽泛的布局变更代价过大。

**用步骤级守卫根据私钥为 lifecycle 设门。** 步骤级守卫能检测 `secrets`，但被跳过的作业才是需求所指定的显式「惰性」状态；`vars.DSH_ISSUE_APP_CLIENT_ID` 与私钥在拥有 App 的仓库中一同设置，因此作业级变量检测是正确且充分的 fork 安全条件。

**保留一个调用工作流处理全部 agent 事件。** 单文件更短，但多数事件投递只会产生被跳过的作业，每次改动都会耦合无关的触发和权限审核，而且引导阶段行为难以与稳定运行阶段区分。拆分调用器让事件归属和权限可见，同时继续由可复用工作流承载实现。

**使用仅绑定 head 的状态和 GitHub auto-merge。** 只附着于 head 的状态可以在 base 改变后继续存在，而 auto-merge 会在创建它的证据已经失效后仍保留合并意图。精确版本对审核记录加短生命周期落地事务会把批准绑定到两个 revision，并在变更前立即复检。

**轮询 GitHub 的 Issue、评论或检查完成状态。** 轮询会增加空闲模型或控制器活动，同时仍引入检测间隔。所有模型调用均由 GitHub 原生事件驱动；协调和健康检查保持确定性且不调用模型。

## Consequences

这三项检查现在在没有 App 凭据、也没有匹配的 issue-management Project 的 fork 上也能通过。`policy.mjs` 的推导不改变上游行为：在那里 `GITHUB_REPOSITORY` 就等于所配置的坐标，Project 查找仍指向拥有该 Project 的组织。

若某个 fork 日后安装了 issue-management App 并希望获得 lifecycle 状态更新，仍需提供匹配的 ProjectV2（`config.json` 仍写死上游的 Project 编号与标题）以及两样 App 凭据；本次工作流级改动只是让凭据缺失不再致命、让 App 安装归属自寻，并不会为 fork 配置 Project。

`--preserve-symlinks` 作用于安装步骤中的每一个 Node 进程，而不仅是 node-gyp。它被限定在这一个构建作业的安装步骤内；未来若有原生依赖的 postinstall 依赖「把 pnpm 符号链接解析为真实路径」，需要做同样的根因复核，而不是直接大范围移除该标志。

目标仓库现在包含更多工作流入口文件，但其逻辑仍位于专用自动化仓库，固定 revision 也让已部署控制器可审计。标签继续作为操作者可见的投影和恢复触发器，而不是批准证据；评论包含精确版本对和可见的 DSH 或 Codex 任务标识，足以监管一次运行。CI 失败返工完全由事件驱动，检查为绿色时不会产生任何模型活动。

停止一个角色 runner 不会影响另一个角色继续工作；属于已停止角色的作业会留在 GitHub 队列中。两个注册当前仍共享同一台 Windows 主机、网络连接、适用时的 DSH Web 服务，以及供控制器传输与变更发布使用的持久主机 GitHub 登录。把一个角色迁移到另一台机器只需调整 runner 标签和机器本地 worker 配置；完整的主机与 GitHub App 隔离仍属于独立的安全加固工作。
