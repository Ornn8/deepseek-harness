# Agent Note: Fork-safe agent automation

Status: implemented

[English](2026-08-13-fork-safe-agent-automation.md) | 中文

## Problem

`Ornn8/deepseek-harness` 为运行其 GitHub-agent 自动化流水线而 fork 了上游仓库，但四种故障模式使该 fork 无法自主运行。

1. Issue policy 检查读取 `config.json`，其中 `organization` 与 `repository` 均为 `deepseek-harness`，因此 `policy.mjs pr` 会查询 `/repos/deepseek-harness/deepseek-harness/...`。fork 的 PR 于是从 `requested_reviewers` 端点收到 404，作业失败。
2. Issue lifecycle 检查在其 `create-github-app-token` 步骤上硬编码了 `owner: deepseek-harness` 与 `repositories: deepseek-harness`，且该步骤需要 `vars.DSH_ISSUE_APP_CLIENT_ID` 与 `secrets.DSH_ISSUE_APP_PRIVATE_KEY`。fork 两者都未配置，于是该 action 以 "client-id must be set to a non-empty string" 失败。
3. 一个调用工作流同时承担 Issue 分发、Codex 审核、DSH 返工和合并意图。它把可变标签和仅绑定 head 的状态当作持久状态，让无关作业共用耦合的权限范围，并且在接收工作流只存在于 PR、尚未进入默认分支时就依赖 `repository_dispatch`。因此，引导阶段的阻断审核可能无法唤醒 DSH，而后续 base 更新也可能留下一个已成功但不再代表已审核 base/head 对的 head 状态。
4. 必需 CI 作业默认使用仅上游拥有的 larger-runner 标签。个人 fork 没有带这些标签的 runner，因此必需检查会一直排队而不执行。

## Decision

每项检查都从它实际运行的仓库推导坐标，而不是写死上游仓库；依赖 App 的 lifecycle 在其凭据缺失时变为惰性（inert）。

失败或取消的顶层 Agent Issues、Agent PR Rework、Agent PR CI Repair 与 Agent PR Review run 进入独立的事件驱动恢复工作流。恢复控制器验证 source run 的 `referenced_workflows` 中精确的可复用 controller SHA，定位匹配的持久 Issue 或 pull request 状态记录，重新检查实时 Issue 状态或精确 PR 版本对，并且最多记录三次重试。评论和标签仍是审计投影；伪造记录不能授权重试。第三次耗尽后保留 `agent/dsh-failed` 或 `automation/review-failed` dead-letter，且不会调用模型。

`policy.mjs` 将 `process.env.GITHUB_REPOSITORY`（`owner/repo`）拆分为 `organization` 与 `repository`，并优先于 `config.json` 的默认值使用；本地与测试运行未设置该变量，保持检入的默认值。所有原先内插 `config.organization`/`config.repository` 的 REST/GraphQL 路径现在都内插这两个推导常量。

ProjectV2 与组织级 Issue Fields 是仅限组织的 GitHub 功能：在个人账户仓库上，REST `issue-field-values` 端点返回 404，GraphQL `organization(...)` 根也不存在。因此 `config.json` 显式声明这两项能力（`project.enabled` 与 `issueFields.enabled`），个人账户仓库将二者都设为禁用，而不是让每个 PR 都因不支持的元数据而失败。被禁用的能力完全跳过对应端点，`validateIssue` 也不再检查 Type、Priority 与 Status；解析 Issue 引用与仓库本地标签的校验仍然保留。对已启用的能力，任何 API 错误仍然直接使作业失败，并且 `policy.mjs` 从实时仓库元数据选择 GraphQL 所有者根（个人账户用 `user(...)`，组织用 `organization(...)`），因此具备组织能力的 fork 无需改动代码即可保留完整策略。

`issue-lifecycle.yml` 在作业级 `if` 上加入 `vars.DSH_ISSUE_APP_CLIENT_ID != ''`，使无凭据的仓库（包括本 fork）跳过作业而不是令其失败，并从 `github.repository_owner` 与 `github.event.repository.name` 推导 App 安装归属，使安装了 App 的 fork 指向自身安装而非上游。

目标仓库用相互独立的工作流负责 Issue 分发、精确版本对 PR 审核、可信返工反馈、显式落地和健康检查。每个调用方在 `uses` 中固定可复用工作流 revision；控制器 revision、角色 worker 和 runner 选择由控制器持有，不再作为调用方输入。必需 CI 作业在上游仓库中继续使用 larger runner；在 fork 中则选择标准 GitHub-hosted runner，除非仓库变量显式选择 self-hosted 故障转移池。CI 修复与 CI 触发的落地工作流把所配置的 CI 工作流名称声明为字面量 `workflow_run.workflows` 订阅，使 GitHub 能注册这些 listener，再在分发前把收到的名称与 `DSH_AUTOMATION_CI_WORKFLOW` 比对。包括项目生命周期和 Issue policy 在内的所有特权 PR listener 都使用 `pull_request_target` 并签出默认分支 policy，因此 PR 在进入默认分支前不能替换特权工作流定义。review-submitted 事件不再作为特权输入；自动化 BLOCK 标签只是精确审核 CheckRun 与不可变返工 WorkRequest 的可见投影。

自动化仓库公开一套统一的 Agent Worker 调用与终态回执接口。运行时专用 Adapter 负责启动和观察 DSH Web、ChatGPT Desktop 或使用 JSON 协议的命令；目标工作流把 `review` 与 `change` 角色映射到已配置的 worker id。两个角色分别使用 `agent-reviewer` 与 `agent-change` runner 注册、进程、工作目录、并发组和健康检查作业。

审核 worker 获得精确 base/head checkout，不获得 Actions 凭据，并只做只读检查。作业级 Actions token 发布 pending 或最终 `codex/review` CheckRun、英文审核评论和投影标签。由于 GitHub 可能规范化其可见 details URL，该 CheckRun 将原始 Actions run URL 存为不透明的外部元数据；落地过程读取该 run 并验证固定的可复用控制器引用。BLOCK 结论记录精确版本对；控制器发布一个不可变、幂等、面向 `change` 角色的返工 WorkRequest 后，审核任务即终止。接收工作流独立启动，校验 WorkRequest 字段、实时 head、审核证据和标签，再调用其配置的变更 worker。名称等于 `DSH_AUTOMATION_CI_WORKFLOW` 的已完成失败工作流会创建一个由 run id 和 attempt 标识的独立请求；只有名称、失败结论、PR 编号和当前 head 全部匹配时，控制器才允许变更 worker 检查日志或修改分支。

PASS 结论发出 `dsh-land`，而不是启用长期 auto-merge。落地控制器只接受当前指向仓库默认分支的非草稿 PR，要求精确 base/head PASS 记录，以及由 GitHub Actions App 发布在精确 head 上且名称为 `all checks passed` 的已配置 CheckRun，在 squash merge 前立即重复这些检查，否则不改变 PR 即退出。由于工作流 token 无法读取仓库管理设置，安装和在线诊断会独立强制执行分支保护要求。成功的已配置 CI workflow run 会在待定检查完成后重试落地。

每次向仓库默认分支推送后，协调器都会把同仓库 PR 记录的 base commit 与当前默认分支 commit 比较，并且无论 GitHub 的临时 mergeability 状态如何都会更新陈旧 base。这项变更在 change 角色 runner 上使用经验证的主机 GitHub 凭据，因此 GitHub 会发出普通 pull request 事件并同时重跑 CI 与审核；若使用 Actions 作业 token，这些事件会被抑制。对于不需要更新分支的当前版本，只有缺少可信精确版本对证据时才会显式分发审核。Backlog 与有界恢复也使用显式 `repository_dispatch` 事件；Issue 的 opened、reopened、edited 与 closed 事件会触发不调用模型的 backlog 重算，只有可信的加 `agent/dsh` 标签事件才会直接启动 Issue 工作。若一个可执行 Issue 既没有关闭它的 PR，也没有终态失败，backlog 可以重新认领它，而工作流并发控制和稳定的 WorkRequest 标识会阻止第二个模型轮次。没有声明分支但 marker 验证通过的 CI baseline Issue 会在确定性的 `agent/issue-<number>` 分支上进入同一队列。受保护默认分支上的 listener 与固定的可复用控制器会在调用模型前重新核验实时 Issue 或精确 PR 版本对。手动健康工作流在各自 runner 上分别检查每个已配置 worker，并检查固定控制器与 GitHub 访问，全程不调用模型。新增的 `repository-supervision.yml` 调用方每六小时在第 17 分钟于默认分支上运行固定的仓库监督器，上游为 `deepseek-ai/deepseek-harness`，变更预算为五次；定时运行会应用受保护的变更，而手动分发默认只做 dry run，仅在显式传入 `apply_changes: true` 时才应用。该调用方只监听定时与手动分发事件，且只授予 `actions`/`checks`/`contents` 读取与 `issues`/`pull-requests` 写入权限，因此监督不会与 issue 或 PR listener 竞争。

## Alternatives considered

**用步骤级守卫根据私钥为 lifecycle 设门。** 步骤级守卫能检测 `secrets`，但被跳过的作业才是需求所指定的显式「惰性」状态；`vars.DSH_ISSUE_APP_CLIENT_ID` 与私钥在拥有 App 的仓库中一同设置，因此作业级变量检测是正确且充分的 fork 安全条件。

**保留一个调用工作流处理全部 agent 事件。** 单文件更短，但多数事件投递只会产生被跳过的作业，每次改动都会耦合无关的触发和权限审核，而且引导阶段行为难以与稳定运行阶段区分。拆分调用器让事件归属和权限可见，同时继续由可复用工作流承载实现。

**使用仅绑定 head 的状态和 GitHub auto-merge。** 只附着于 head 的状态可以在 base 改变后继续存在，而 auto-merge 会在创建它的证据已经失效后仍保留合并意图。精确版本对审核记录加短生命周期落地事务会把批准绑定到两个 revision，并在变更前立即复检。

**轮询 GitHub 的 Issue、评论或检查完成状态。** 轮询会增加空闲模型或控制器活动，同时仍引入检测间隔。所有模型调用均由 GitHub 原生事件驱动；协调和健康检查保持确定性且不调用模型。

## Consequences

policy 与 lifecycle 检查现在也能在本个人账户 fork 上通过，其 `config.json` 将两项仅限组织的能力都声明为禁用；在那里，解析 Issue 引用与仓库本地标签仍是强制执行的策略面。能力开关不改变上游行为：`GITHUB_REPOSITORY` 等于所配置的坐标，`project.enabled` 与 `issueFields.enabled` 保持 `true`，Project 查找仍通过 `organization(...)` 根指向拥有该 Project 的组织。

若某个 fork 日后安装了 issue-management App 并希望获得 lifecycle 状态更新，需将 `project.enabled` 设为 `true` 并提供匹配的 ProjectV2 编号与标题（仓库使用组织 Issue Fields 时还需将 `issueFields.enabled` 设为 `true` 并配置 `priorityField`），以及两样 App 凭据；能力开关与工作流级改动只是让凭据缺失不再致命、让 App 安装归属自寻，并不会为 fork 配置 Project。

目标仓库现在包含更多工作流入口文件，但其逻辑仍位于专用自动化仓库，固定 revision 也让已部署控制器可审计。标签继续作为操作者可见的投影，而不是事件传输或批准证据；评论包含精确版本对和可见的 DSH 或 Codex 任务标识，足以监管一次运行。CI 失败返工完全由事件驱动，检查为绿色时不会产生任何模型活动。

停止一个角色 runner 不会影响另一个角色继续工作；属于已停止角色的作业会留在 GitHub 队列中。两个注册当前仍共享同一台 Windows 主机、网络连接、适用时的 DSH Web 服务，以及供控制器传输与变更发布使用的持久主机 GitHub 登录。把一个角色迁移到另一台机器只需调整 runner 标签和机器本地 worker 配置；完整的主机与 GitHub App 隔离仍属于独立的安全加固工作。
