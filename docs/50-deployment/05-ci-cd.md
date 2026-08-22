# CI/CD 流水线

> 更新：2026-06-10

---

## 部署边界

`vxture` 仓库的 CI/CD 只负责平台控制面：`main` 发布后自动部署 VXTURE_DEPLOY_HOST prod。业务执行面 vx-worker-02 属于外部业务仓库，本仓不得继续新增或使用 vx-worker-02 部署入口。代码与部署环境边界见 [`08-code-environment-map.md`](./08-code-environment-map.md)。

当前业务仓库推进顺序已经明确：Ruyin 迁移和 vx-worker-02 beta/prod 部署由 `vxture/agentstudio-ruyin` 承接，并在该仓沉淀业务工作流模板；Varda 等 Ruyin 模板完整跑顺后，再规划迁移到 `vxture/agentstudio-varda`。

P7a 曾把 vx-worker-02 手动部署入口加入本仓 workflow，这是越界实现。当前已完成 workflow 层修正：`deploy-production` 只允许 VXTURE_DEPLOY_HOST；平台 beta 部署尚未设计，原 `deploy-beta` 占位 workflow（恒 `exit 1`）已删除（YAGNI），待真正设计 `vxture-beta` 临时平台服务器时再按真实需求新建。`docker-build` 也不再构建无消费方的 `:beta` 镜像。

---

## 分支触发矩阵

| 触发事件                 | CI                       | SonarQube | 镜像构建                | 自动部署 | 平台 beta 部署 | vx-worker-02 部署 |
| ------------------------ | ------------------------ | --------- | ----------------------- | -------- | -------------- | ----------------- |
| PR 到 `develop`          | ✅                       | ✅        | —                       | —        | —              | 禁止              |
| 晋升 PR 到 `beta`/`main` | —（复用 head SHA check） | —         | —                       | —        | —              | 禁止              |
| `develop` push           | ✅                       | ✅        | —                       | —        | —              | 禁止              |
| `beta` push（晋升）      | —                        | —         | —                       | —        | 暂无           | 禁止              |
| `main` push（晋升）      | —                        | —         | ✅ `:latest` + `:sha-*` | ✅ 自动  | —              | 禁止              |
| git tag `v*.*.*`         | —                        | —         | ✅ semver 标签          | —        | —              | 禁止              |

> beta/main 仅由 fast-forward 晋升更新；其 SHA 已在 develop 跑过 CI。**B5（2026-06-09）起 `ci.yml` 不再在 `pull_request`→beta/main 上重跑 CI**：晋升 PR 的 head SHA 即 develop tip 同一 commit，required checks 由该 commit 既有的 quality-gate/build/test-coverage/audit 满足；`enforce-branch-flow` 仍由 pr-checks 在 PR 上提供。main push 仍触发镜像构建与生产部署。

---

## 工作流文件总览

| 文件                        | 触发条件                                   | 运行环境      | 用途                                                                                           |
| --------------------------- | ------------------------------------------ | ------------- | ---------------------------------------------------------------------------------------------- |
| `ci.yml`                    | PR(main · beta · develop)；push develop    | ubuntu-latest | `quality-gate`、构建、测试与安全审计；beta/main 经晋升的 SHA 已验证，不重复触发                |
| `pr-checks.yml`             | PR                                         | ubuntu-latest | `pr-checks`，校验 PR 分支流向并输出 `enforce-branch-flow` required check                       |
| `branch-promotion.yml`      | 手动 `workflow_dispatch`                   | ubuntu-latest | `branch-promotion`，校验晋升 PR 并执行受控 fast-forward promotion                              |
| `docker-build.yml`          | push to main；git tag `v*`                 | ubuntu-latest | `docker-build`，构建本仓镜像，按分支/tag 打标；默认推送 GHCR，ACR secrets 齐全时双推           |
| `deploy-production.yml`     | `docker-build` 成功后（仅 main）；手动触发 | ubuntu-latest | `deploy-production`，自动 SSH VXTURE_DEPLOY_HOST；不含 vx-worker-02 目标                       |
| `publish-design-system.yml` | 手动 `workflow_dispatch`；`ds-v*.*.*` tag  | ubuntu-latest | DS 包发布入口，`dry_run` 默认 `true`，后续与其他 `publish-*` 入口统一规划                      |
| `platform-alerts.yml`       | 定时 `schedule`（每日）；手动触发          | ubuntu-latest | SSH VXTURE_DEPLOY_HOST 执行 `51-check-platform-alerts.sh` 常态漂移巡检；从部署链拆出，只读检查 |

CI 内部包含 Format、`audit`、`quality-gate`、`build`、`test-coverage`、SonarQube 等 job。`docker-build.yml` 独立触发（不依赖 CI），`deploy-production.yml` 在 `docker-build` 完成后自动触发 VXTURE_DEPLOY_HOST 生产部署。vx-worker-02 部署不属于本仓职责。

---

## 当前状态与目标状态

本文档同时记录“当前实现”和“目标规划”。当两者不一致时，以本节为准判断是否已经落地，禁止把规划目标误认为当前行为。

| 领域              | 当前实现                                                                                        | 目标状态                                                                  | 落地阶段 |
| ----------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | -------- |
| CI 触发           | `ci.yml` 只监听目标为三主干的 PR，以及 `develop` / `beta` / `main` push                         | 保持 PR 验证与主干 push 验证，取消普通工作分支 push 完整 CI               | 已落地   |
| CI 并发组         | PR 使用 PR 号，push 使用分支名                                                                  | 同一 PR 或同一主干的新提交取消旧运行，避免重复排队                        | 已落地   |
| PR 检查           | `pr-checks.yml` / `pr-checks` / `enforce-branch-flow`                                           | P5b 已迁移文件名和 workflow name；P5d 已迁移 required check 契约          | P5d      |
| 镜像构建          | `docker-build.yml` 默认推 GHCR；ACR secrets 齐全时双推                                          | P2 确认职责边界后进入 P3，第一阶段在构建流程内同时推送 GHCR 与 Aliyun ACR | P3 / P5a |
| 镜像分发          | 尚无独立 `docker-push.yml`                                                                      | ACR 稳定后再评估独立 `docker-push.yml`                                    | P8       |
| 生产发布门禁      | `branch-promotion` 已要求 `release_confirmed` 与 `release_note`，并完成 P4 端到端试跑           | beta 验证通过后才能触发 `beta -> main`；确认点前置到 main 之前            | P4 / P5a |
| 平台 prod 部署    | `main` 更新后 `deploy-production.yml` 自动部署 VXTURE_DEPLOY_HOST；ACR secrets 齐全时优先拉 ACR | `main` 更新即代表已获准生产发布；自动部署，镜像优先拉 ACR                 | P3 / P5a |
| 平台 beta 部署    | 暂无长期 beta 服务器和部署 workflow                                                             | 未来按需部署到临时 `vxture-beta`，用完关闭                                | 待规划   |
| vx-worker-02 部署 | P7a 曾误加入本仓手动入口；P7b 已删除本仓 vx-worker-02 历史部署资产                              | Ruyin 由 `vxture/agentstudio-ruyin` 承接；Varda 待 Ruyin 模板跑顺后再迁移 | 已清理   |
| DS 包发布         | `publish-design-system.yml` / `publish-design-system`                                           | 保持独立 DS 发布入口；后续规划其他 `publish-*` 包发布入口                 | 已落地   |
| 命名规范          | required check 已迁移为 `quality-gate`、`test-coverage` 等 kebab-case 契约                      | P5d 已完成 ruleset 切换和旧契约清理 PR                                    | P5d      |

阶段落地规则：

1. P1 已完成后，先进入 P2 工作流治理设计，不直接跳到镜像加速。
2. P2 只固化 workflow 资产盘点、职责归类、命名迁移台账和执行顺序；不得修改 workflow 文件名、job name、required check name 或 ruleset。
3. P3 负责 GHCR/ACR 镜像加速；不得与命名迁移混在同一 PR。
4. `beta -> main` 的业务确认点必须前置到 promotion 阶段，不得放到 `main` 更新后的 production deploy approval。
5. P4 必须先完成 `branch-promotion` 与 ruleset bypass 的闭环校准；不得再用临时关闭 ruleset 作为发布捷径。
6. P5 才允许进入命名迁移执行；执行前必须已有 P2 台账、迁移顺序和 ruleset 影响评估。
7. required check 名称迁移必须单独设计、单独 PR，不与触发策略、路径过滤或部署策略混改。
8. `publish-design-system.yml` 与 `publish-design-system` 是当前 DS 发布入口；`dry_run` 默认 `true`，真实发布必须显式选择 `dry_run=false`。
9. vx-worker-02 属于外部业务仓库；Ruyin 当前归属 `vxture/agentstudio-ruyin`，任何本仓 workflow 不得新增或保留 vx-worker-02 部署职责。
10. Varda 迁移必须等待 Ruyin 业务仓库工作流模板跑顺后，再进入 `vxture/agentstudio-varda` 规划；不得在本仓恢复 vx-worker-02 workflow。

---

## 工作流规划设计规范

### 设计目标

Vxture 的 GitHub Actions 不是简单的脚本集合，而是分支治理、质量门禁、镜像交付和生产发布的自动化控制面。工作流规划必须同时满足四个目标：

1. **质量可信**：PR 进入主干前必须经过稳定、可审计、可复现的 `quality-gate`。
2. **发布可追溯**：从 `develop` 到 `beta` 再到 `main` 的晋升必须能定位源 commit、目标 commit、触发人、检查结果和部署结果。
3. **成本可控**：同一提交不得无意义地重复运行完整 CI；连续提交应取消旧运行；非代码变更不应触发重型构建。
4. **职责清晰**：CI、PR 检查、镜像构建、部署、包发布、治理类任务必须分工明确，避免一个 workflow 同时承担过多职责。

### 设计理念

工作流治理遵循“先契约，后实现”的原则。文件名、workflow name、job name、required status check name 分别服务于不同对象，不能混用：

| 层级                    | 面向对象                 | 稳定性要求 | 设计原则                                              |
| ----------------------- | ------------------------ | ---------- | ----------------------------------------------------- |
| 文件名                  | 维护者与仓库结构         | 中         | 使用动作和领域命名，便于定位                          |
| Workflow name           | GitHub Actions UI 与审计 | 中         | 简短、清楚、行业通用                                  |
| Job name / Check name   | PR 检查页面与 ruleset    | 高         | 作为 required status check 契约时不得随意改名         |
| Step name               | 排障与日志阅读           | 低         | 允许随实现演进，但必须表达实际执行内容                |
| Workflow dispatch input | 人工触发入口             | 高         | 参数必须少、明确、可校验，不允许靠备注表达关键约束    |
| Repository Ruleset 配置 | 远端强制规则             | 高         | 与 workflow job name 形成契约，变更前必须先改设计文档 |

因此，`quality-gate`、`build`、`test-coverage`、`audit`、`enforce-branch-flow` 这类名称不是展示文案，而是 ruleset 与 workflow 之间的接口。展示层可以优化，契约层必须稳定。

### 命名规范

命名采用机器友好的 `kebab-case`，优先消除脚本执行、YAML 解析、Shell 转义、GitHub CLI 查询和 ruleset 匹配中的歧义。凡是可能被脚本、API、CLI、ruleset、审计工具引用的名称，都必须使用小写字母、数字和连字符。

允许字符：

```text
a-z 0-9 -
```

禁止用于机器引用名称的字符：

```text
空格  中文  ·  /  \  :  ;  #  @  引号  括号  emoji  其他 Unicode 符号
```

命名约束：

1. 文件名、workflow name、job name、required check name、artifact name、concurrency group 前缀、workflow input name 均使用 `kebab-case`。
2. 禁止在新增 workflow/job/check 中使用空格、中点或展示型标题，例如 `Quality Gate`、`Test · Coverage`、`Docker Build`。
3. 面向人的说明写入 `description`、PR 文档或 step 日志，不放入机器契约名称。
4. required check 改名必须先更新 ruleset，再经过迁移窗口验证，禁止在同一 PR 中同时大范围重命名和改执行逻辑。

目标命名：

| 类型         | 文件名建议                  | Workflow name 建议      | Job / Check name 建议       | 说明                                                         |
| ------------ | --------------------------- | ----------------------- | --------------------------- | ------------------------------------------------------------ |
| 持续集成     | `ci.yml`                    | `ci`                    | `quality-gate`              | 负责质量门禁、构建、测试、安全审计                           |
| PR 检查      | `pr-checks.yml`             | `pr-checks`             | `enforce-branch-flow`       | 负责 PR 元信息、分支流向、标题、变更范围等轻检查             |
| 镜像构建     | `docker-build.yml`          | `docker-build`          | `docker-build-{service}`    | 负责镜像构建，第一阶段允许同时推送 GHCR 与 ACR               |
| 镜像分发     | `docker-push.yml`           | `docker-push`           | `docker-push-{registry}`    | 后续承接多 registry 分发、重试和审计                         |
| 生产部署     | `deploy-production.yml`     | `deploy-production`     | `deploy-VXTURE_DEPLOY_HOST` | 负责 平台生产环境部署                                        |
| Beta 部署    | `deploy-beta.yml`           | `deploy-beta`           | `deploy-platform-beta`      | 未来仅用于临时 `vxture-beta` 平台环境；不得指向 vx-worker-02 |
| 分支晋升     | `branch-promotion.yml`      | `branch-promotion`      | `fast-forward-promotion`    | 负责受控 fast-forward promotion                              |
| DS 包发布    | `publish-design-system.yml` | `publish-design-system` | `publish-design-system`     | 现有 DS 包发布实现；后续其他包按 `publish-*` 入口规划        |
| 文档发布     | `publish-docs.yml`          | `publish-docs`          | `publish-docs`              | 未来承接文档站、Storybook、API docs 发布                     |
| Release 发布 | `publish-release.yml`       | `publish-release`       | `publish-release`           | 未来承接 GitHub Release、release notes、归档发布             |
| 安全扫描     | `security-scan.yml`         | `security-scan`         | `security-scan`             | 未来可承接 dependency review、SAST 等                        |
| 清理任务     | `cleanup.yml`               | `cleanup`               | `cleanup`                   | 清理旧 artifacts、缓存、临时环境                             |
| 依赖治理     | `dependency-review.yml`     | `dependency-review`     | `dependency-review`         | 未来可承接依赖变更审计                                       |

P5d 已将历史 required check 名称迁移为 `quality-gate`、`build`、`test-coverage`、`audit`、`enforce-branch-flow`。后续新增 required check 必须直接使用 kebab-case；不得重新引入空格、中点或展示型标题作为 ruleset 契约。

当前仓库允许渐进迁移，不要求一次性重命名所有文件。`publish-design-system.yml` 是已有 Design System 包发布实现，必须保留其发布语义；它不归入 Docker 镜像发布，也不归入产品 release 发布。后续如果规划其他包发布入口，优先按 `publish-*` 命名独立落地，再评估是否需要统一的包发布调度层。重命名 workflow 文件会改变 Actions 历史入口和团队习惯，必须提前确认 ruleset required check 不受影响。

### 触发策略

触发策略的核心原则是：**PR 验证代码，主干 push 验证合入结果，发布 workflow 只响应发布事件。**

| 事件类型                | 应触发内容                          | 不应触发内容                     | 设计原因                                      |
| ----------------------- | ----------------------------------- | -------------------------------- | --------------------------------------------- |
| 工作分支 `push`         | 默认不触发完整 CI                   | 重型 Build、Test、Docker、Deploy | 避免与 PR `synchronize` 双跑                  |
| PR `opened/synchronize` | CI、PR Checks                       | Docker、Deploy、Publish          | PR 是代码进入主干前的主要验证点               |
| `develop` push          | CI                                  | Docker、Deploy                   | 合入后验证集成主线                            |
| `beta` push             | CI、Docker Build                    | Production Deploy                | beta 产物构建与试用环境准备                   |
| `main` push             | CI、Docker Build、Production Deploy | PR-only 检查                     | `main` 只在生产确认通过后推进，推进后自动发布 |
| Release tag push        | Docker semver tag、Package Publish  | PR Checks                        | tag 是发布事件，不是代码评审事件              |
| `workflow_dispatch`     | Promotion、手动发布、维护任务       | 自动 CI 替代品                   | 人工入口必须有明确参数和审计记录              |
| `workflow_run`          | 下游部署或通知                      | 上游质量检查                     | 只用于串联已完成的上游结果                    |

P1 落地前，`ci.yml` 同时监听 PR 和工作分支 push，会导致同一 SHA 在工作分支 push 后、PR synchronize 后各跑一次完整 CI。P1 已取消普通工作分支 push CI，并同步调整 concurrency，仅保留：

```yaml
on:
  pull_request:
    branches:
      - develop
      - beta
      - main
  push:
    branches:
      - develop
      - beta
      - main
```

这样工作分支仍通过 PR 获得完整验证，主干合入后仍保留 push 验证，但不会出现同一提交因工作分支 push 与 PR 事件重复计费。

P1 落地后，工作分支 push 不再触发完整 CI；PR opened / synchronize 仍会稳定创建 required checks，三主干 push 仍保留合入后验证。

### 并发与取消策略

所有自动触发 workflow 必须配置 `concurrency`。并发组的粒度应与“同一类运行是否可以被替代”一致：

| Workflow 类型 | 推荐 concurrency group                                                                    | cancel-in-progress | 原因                                   |
| ------------- | ----------------------------------------------------------------------------------------- | ------------------ | -------------------------------------- |
| CI            | PR 使用 `ci-pr-${{ github.event.pull_request.number }}`；push 使用 `ci-${{ github.ref }}` | `true`             | 同一 PR 或同一分支的新提交可替代旧检查 |
| PR Checks     | `pr-checks-${{ github.event.pull_request.number }}`                                       | `true`             | PR 元信息检查只关心最新状态            |
| Docker Build  | `docker-${{ github.ref }}`                                                                | `true`             | 同一分支新镜像可替代旧镜像构建         |
| Deploy        | `deploy-production` / `deploy-beta`                                                       | `false`            | 部署应串行执行，避免互相踩踏           |
| Promotion     | `promotion-${{ inputs.target }}`                                                          | `false`            | 同一目标分支晋升必须串行               |
| Publish       | `publish-${{ github.ref }}`                                                               | `false`            | 包版本发布不可被中途取消               |
| Cleanup       | `cleanup`                                                                                 | `true`             | 维护任务可用最新运行替代旧运行         |

CI 的并发组不应只使用 `github.ref`。PR 事件下 `github.ref` 通常是 `refs/pull/<id>/merge`，工作分支 push 则是 `refs/heads/<branch>`；如果同时保留两类触发，即使 SHA 相同也无法互相取消。因此更根本的治理方式是取消工作分支 push CI，而不是只依赖 concurrency。

### 路径过滤策略

路径过滤用于减少无效运行，但不能破坏 required checks。设计时必须区分“必须稳定出现的 required checks”和“可按路径触发的重型任务”。

| 变更类型                  | CI / quality-gate | build/test | Docker      | Deploy       | Publish     |
| ------------------------- | ----------------- | ---------- | ----------- | ------------ | ----------- |
| 应用代码                  | 必跑              | 必跑       | 主干触发    | main 后触发  | 不触发      |
| Dockerfile / deploy       | 必跑              | 视影响范围 | 必跑        | main 后触发  | 不触发      |
| `.github/workflows/`      | 必跑              | 必跑       | 视 workflow | 视 workflow  | 视 workflow |
| `package.json` / lockfile | 必跑              | 必跑       | 主干触发    | main 后触发  | 视包发布    |
| 纯文档 `docs/**`          | 轻量检查          | 可跳过     | 跳过 build  | 后续评估跳过 | 跳过        |
| Markdown / 配置说明       | 轻量检查          | 可跳过     | 跳过 build  | 后续评估跳过 | 跳过        |

required checks 不宜直接通过 `paths-ignore` 跳过整个 workflow。若 GitHub ruleset 要求某个 check，而该 check 因路径过滤没有创建，PR 可能长期处于等待状态。更稳妥的做法是：

1. 保持 required check workflow 总是创建。
2. 在 workflow 内部先计算变更范围。
3. 对纯文档变更运行轻量 job，并让 `quality-gate` 以成功状态结束。
4. 对代码或基础设施变更运行完整检查。

路径过滤优先用于非 required workflow，例如 Docker Build、Deploy、Publish、Security Scan；required workflow 内部使用条件步骤或拆分 job 规避“required check missing”问题。

### 计费治理原则

Actions 分钟数治理不应以降低质量为代价，而应减少重复、无效和不可替代的运行。

| 问题                         | 影响                   | 治理原则                                                                                                  |
| ---------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------- |
| PR 提交同时触发 push + PR CI | 同一 SHA 跑两套完整 CI | 工作分支 push 不跑完整 CI，PR synchronize 跑 CI                                                           |
| 连续 push 不取消旧 CI        | 旧检查排队，占用分钟数 | `cancel-in-progress: true`                                                                                |
| 文档变更跑完整 build/test    | 轻变更消耗重型资源     | required check 保持，内部轻量化                                                                           |
| Docker 对无关变更构建全矩阵  | 11 个镜像重复构建      | 已落地：classify-changes 白名单 + B10 动态 matrix（detect→fromJSON），无关变更 0 腿、部分变更只起受影响腿 |
| 部署 workflow 被重复触发     | 生产环境风险和资源浪费 | 部署串行，且只消费成功的上游发布构建                                                                      |
| 发布 workflow 自动范围过宽   | 误发布包或镜像         | 发布只响应 tag 或 workflow_dispatch                                                                       |

治理目标不是“尽量少跑”，而是“该跑的一次跑完整，不该跑的不启动，旧结果可替代时及时取消”。

### 规划落地节奏

工作流治理应分阶段执行，避免一次性改名、改触发、改 ruleset 造成难以定位的问题。

| 阶段 | 目标                       | 内容                                                                               | 风险控制                                                  |
| ---- | -------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------- |
| P0   | 固化设计                   | 更新本文档，明确命名、触发、并发、路径过滤、计费治理原则                           | 不改 workflow 执行逻辑                                    |
| P1   | 消除重复 CI                | `ci.yml` 取消普通工作分支 push 触发，只保留 PR + 主干 push                         | 已落地，required checks 正常出现                          |
| P2   | 工作流治理台账与职责分层   | 盘点现有 workflow、required checks、ruleset 契约、发布入口和目标命名，形成迁移顺序 | 只改设计与台账，不改 workflow 文件名、job name 或 ruleset |
| P3   | 加速部署镜像拉取           | `docker-build` 第一阶段同时推送 GHCR 与 Aliyun ACR，部署优先拉 ACR                 | 保留 GHCR 作为回退源，不做命名迁移                        |
| P4   | 分支晋升闭环治理           | 校准 `branch-promotion.yml`、ruleset bypass、执行权限、审计评论和失败处理          | 不允许临时关闭 ruleset 作为日常晋升方式                   |
| P5   | 命名迁移执行批次           | 按 P2 台账分批迁移 workflow name、文件名、job/check name 和 ruleset 契约           | 独立 PR、独立验证、可回退                                 |
| P6   | 引入路径感知轻量化         | 纯文档变更轻量 `quality-gate`，Docker 按影响范围构建                               | required checks 必须稳定成功                              |
| P7   | Worker-02 自动化与环境拆分 | 增加 beta/prod 环境部署 workflow                                                   | 先手动 dispatch，再考虑自动触发                           |
| P8   | 镜像分发工作流独立化       | ACR 稳定后评估拆出 `docker-push.yml`，承接多 registry 分发、重试和审计             | 只在双推稳定后推进                                        |

P1 完成后，先进入 P2 工作流治理台账与职责分层；P2 经确认后，再进入 P3 镜像分发加速。P4 优先补齐分支晋升闭环，确保 `develop -> beta -> main` 不再依赖人工临时关闭 ruleset；P5 才进入经过确认后的命名迁移执行。workflow name、job/check name 与 workflow 文件名的目标命名在 P2 规划，实际改名只允许进入 P5 独立批次。

### P2 工作项

P2 是 workflow 控制面收口阶段，目标是让后续 ACR 加速、部署拆分、包发布治理都有稳定边界。该阶段不直接重命名 workflow 文件，不修改 required check name，也不改 repository ruleset。

P2 交付物：

- [x] 建立 workflow 资产台账：记录文件名、workflow name、触发事件、concurrency、主要 job、是否 required。
- [x] 建立 required checks 契约表：记录 `quality-gate`、`build`、`test-coverage`、`audit`、`enforce-branch-flow` 与 ruleset 的绑定关系。
- [x] 固化能力归类：`ci`、`pr-checks`、`branch-promotion`、`docker-build`、`deploy-production`、`publish-design-system`、`publish-docs`、`security-scan`、`cleanup`。
- [x] 明确当前缺口：`publish-docs`、`security-scan`、`cleanup`、`dependency-review` 暂为目标能力；`deploy-beta` 当前仅是平台 beta 占位入口，不执行部署。
- [x] 输出命名迁移顺序：先新增稳定契约，再切换 ruleset，最后考虑重命名文件或 UI 名称。
- [x] 明确 P3 准入条件：`docker.yml` 的职责、目标命名、触发边界和部署消费关系已经在设计文档中确认。
- [x] 执行 P5a 非 required workflow 命名迁移：`branch-promotion`、`docker-build.yml`、`deploy-production.yml`。
- [x] 执行 P5b PR 检查 workflow 命名迁移：`pr-checks.yml` / `pr-checks`。
- [x] 执行 P5c CI workflow name 迁移：`CI` -> `ci`。
- [x] 执行 P5d required check 名称迁移：ruleset required checks 已切换到 kebab-case，并清理旧 job/check 名。
- [x] 完成 P5e 发布 workflow 调整：DS 发布入口迁移为 `publish-design-system.yml` / `publish-design-system`，手动 `dry_run` 默认 `true`。
- [x] 完成 P5f 发布与治理缺口评估：没有明确业务入口前不新增空 workflow。
- [x] 执行 P6a 路径感知轻量化：纯文档变更保留 required check 但跳过重型 `quality-gate` / `build` / `test-coverage` 步骤，Docker matrix 按镜像影响范围跳过无关 build/push。
- [x] 修正 P7a 越界实现：移除本仓 vx-worker-02 手动部署入口，保留 平台 prod 自动部署；未来平台 beta 另行设计 `vxture-beta` 临时环境。
- [x] P7b 清理遗留 vx-worker-02 compose/env/scripts 文件：本仓已删除，后续由外部业务仓库维护。

P2 完成只代表治理台账和迁移顺序已固化，不代表命名迁移已经执行。`.github/workflows/`、job name、required check name 和 repository ruleset 的实际变更仍必须进入 P5 独立批次。

#### Workflow 资产台账

| 文件名                      | 当前 workflow name      | 触发事件                                                                        | concurrency                               | 主要 job / check name                                                                               | 是否 required | 能力归类                | P2 结论                                                          |
| --------------------------- | ----------------------- | ------------------------------------------------------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------- | ----------------------- | ---------------------------------------------------------------- |
| `ci.yml`                    | `ci`                    | `pull_request` to `main` / `beta` / `develop`；三主干 push                      | `ci-pr-*` / `ci-push-*`                   | `Format`、`audit`、`quality-gate`、`build`、`test-coverage`、`SonarQube`                            | 部分 required | `ci`                    | P5c/P5d 已迁移 workflow name 与 required check name              |
| `pr-checks.yml`             | `pr-checks`             | `pull_request`                                                                  | `pr-checks-${{ pr.number }}`              | `enforce-branch-flow`                                                                               | 是            | `pr-checks`             | P5b/P5d 已迁移文件名、workflow name 与 required check name       |
| `branch-promotion.yml`      | `branch-promotion`      | `workflow_dispatch`                                                             | `promotion-${{ inputs.target }}`          | `Fast-forward Promotion`                                                                            | 否            | `branch-promotion`      | P4/P5a 已落地；后续只在发布身份变化时调整                        |
| `docker-build.yml`          | `docker-build`          | `push` to `main`；`v*.*.*` tag                                                  | `docker-${{ github.ref }}`                | `detect` job + 动态 matrix build job（`website`、`console`、`admin`、BFF、services、agent servers） | 否            | `docker-build`          | P3/P5a/B10 已落地；后续 P8 再评估独立 `docker-push.yml`          |
| `deploy-production.yml`     | `deploy-production`     | `workflow_run` after `docker-build` success on `main`；手动 `workflow_dispatch` | `deploy-production`                       | `Deploy to VXTURE_DEPLOY_HOST`                                                                      | 否            | `deploy-production`     | P7a 已移除 vx-worker-02 手动 job，保留 平台 prod                 |
| `deploy-beta.yml`           | `deploy-beta`           | 手动 `workflow_dispatch`                                                        | `deploy-beta`                             | `platform-beta-not-configured`                                                                      | 否            | `deploy-beta`           | 平台 beta 占位入口；当前不部署，未来需重设目标 `vxture-beta`     |
| `publish-design-system.yml` | `publish-design-system` | `workflow_dispatch`；`ds-v*.*.*` tag                                            | `publish-design-system-${{ github.ref }}` | `publish-design-system`                                                                             | 否            | `publish-design-system` | DS 发布入口已迁移为 `publish-*` 命名，手动 `dry_run` 默认 `true` |

#### Required Checks 契约表

Repository ruleset 当前使用 kebab-case job/check name 作为稳定契约。旧展示型名称只作为 P5d 迁移历史记录保留，不再作为 required status check。

| Check 契约名          | 来源 workflow / job               | `develop` | `beta`   | `main`   | 迁移批次 | 说明                                         |
| --------------------- | --------------------------------- | --------- | -------- | -------- | -------- | -------------------------------------------- |
| `quality-gate`        | `ci.yml` / `check`                | required  | required | required | P5d      | 内含 Type Check、Lint、Guardrail、Boundaries |
| `build`               | `ci.yml` / `build`                | -         | required | required | P5d      | beta/main 晋升前要求构建通过                 |
| `test-coverage`       | `ci.yml` / `test`                 | -         | required | required | P5d      | 单元测试与覆盖率产物                         |
| `audit`               | `ci.yml` / `audit`                | -         | -        | required | P5d      | main 额外要求依赖安全审计                    |
| `enforce-branch-flow` | `pr-checks.yml` / `branch-policy` | required  | required | required | P5d      | PR 来源/目标合法性检查                       |
| `SonarQube`           | `ci.yml` / `sonar`                | optional  | optional | optional | 后续评估 | 暂不纳入 ruleset required checks             |

当前 ruleset 绑定：

| Ruleset           | ID         | 分支      | enforcement | required checks                                                          | 说明                                |
| ----------------- | ---------- | --------- | ----------- | ------------------------------------------------------------------------ | ----------------------------------- |
| `protect-develop` | `16494328` | `develop` | `active`    | `quality-gate`、`enforce-branch-flow`                                    | develop 保持轻量门禁                |
| `protect-beta`    | `16494280` | `beta`    | `active`    | `quality-gate`、`build`、`test-coverage`、`enforce-branch-flow`          | beta 需要构建与测试，服务公测验证   |
| `protect-main`    | `16485743` | `main`    | `active`    | `quality-gate`、`build`、`test-coverage`、`audit`、`enforce-branch-flow` | main 额外要求审计，代表生产发布准入 |

P5d 采用“先新增兼容 check、再切换 ruleset、最后清理旧名”的顺序完成。迁移期间已验证新旧 check 并行成功；ruleset 切换后，workflow 只保留 kebab-case required check 名。

#### branch-promotion 闭环基准

`branch-promotion.yml` 已存在且 workflow name 为 `branch-promotion`，它必须成为 `develop -> beta`、`beta -> main` 的唯一日常晋升执行入口。晋升 PR 只承担审计、确认和 required checks 聚合职责；GitHub UI merge 按钮不用于主干晋升。

正式闭环要求：

1. `protect-beta`、`protect-main` 保持 `active`，不得为日常晋升临时关闭 ruleset。
2. ruleset bypass 只允许专用 promotion actor，且仅供 `branch-promotion` workflow 执行普通 fast-forward push。
3. 如果 `branch-promotion` 被 ruleset、权限或 required checks 阻断，必须停止发布并修复 workflow / ruleset 配置；禁止改用人工 PATCH ref、临时 disable ruleset 或本地直接 push 兜底。
4. `target=main` 必须提供 `release_confirmed=true` 和非空 `release_note`；生产确认点前置到 `beta -> main` 之前。
5. workflow 成功后必须在晋升 PR 写入源 commit、目标 commit、操作者、release note 和执行时间。

晋升执行身份必须独立于普通 CI 身份。P4 试跑已验证：使用 `GITHUB_TOKEN` / `github-actions[bot]` 对受保护分支执行 direct push 时，ruleset 仍可能按普通推送处理并拒绝。因此 `branch-promotion` 不再以 `github-actions[bot]` 作为规则绕过主体。

执行身份基准：

1. P4 首次落地允许使用 owner-controlled `stonesmoker` 作为 promotion actor，仓库 secret 命名为 `PROMOTION_TOKEN`。
2. 后续多人协作或发布职责分离后，再迁移到专用 machine user 或 GitHub App installation token；若采用 GitHub App，必须新增运行时 token 生成步骤，不得把短期 installation token 当长期 secret 保存。
3. `PROMOTION_TOKEN` 只授予晋升所需权限：Contents read/write、Pull requests read/write、Checks read、Commit statuses read。
4. `protect-beta`、`protect-main` 的 bypass actor 必须指向当前 `PROMOTION_TOKEN` 所属账号。
5. 禁止临时关闭 ruleset、PATCH Git ref 或本地直接 push 作为日常晋升路径。

标准触发方式：

```bash
gh workflow run branch-promotion.yml \
  --repo vxture/vxture \
  -f target=main \
  -f pr_number=<beta-to-main-pr> \
  -f expected_sha=<origin-beta-sha> \
  -f release_confirmed=true \
  -f release_note="<beta validation and production release note>"
```

P4 的完成定义不是“能手工推进一次 main”，而是：

- [x] 使用 `branch-promotion` 完成一次 `develop -> beta` 受控 fast-forward。
- [x] 使用 `branch-promotion` 完成一次 `beta -> main` 受控 fast-forward。
- [x] 两次晋升均无需临时关闭 ruleset。
- [x] `PROMOTION_TOKEN` 已使用专用 promotion actor，并加入 `protect-beta` / `protect-main` bypass。
- [x] 晋升 PR 均自动留下审计评论。
- [x] 晋升后分支关系满足目标状态：`develop == beta` 或 `develop == beta == main`。

P4 验收记录（2026-06-01）：

- `#74 develop -> beta`：`branch-promotion` run `26733565922` 成功，`beta` fast-forward 到 `ba04e0e0d17595bed10391c5f3f492f8809af7ea`。
- `#75 beta -> main`：`branch-promotion` run `26734737012` 成功，`main` fast-forward 到 `ba04e0e0d17595bed10391c5f3f492f8809af7ea`，release note 为“验证通过，确认发布”。
- `main` push 后续链路已通过：CI run `26734742143`、Docker build run `26734742144`、Deploy production run `26734763630`。

#### 能力归类与缺口

| 能力                    | 当前承载                    | 目标命名 / 目标入口         | 状态       | 下一步                                                                    |
| ----------------------- | --------------------------- | --------------------------- | ---------- | ------------------------------------------------------------------------- |
| `ci`                    | `ci.yml`                    | `ci.yml` / `ci`             | 已命名     | P5d 已完成 required check 迁移                                            |
| `pr-checks`             | `pr-checks.yml`             | `pr-checks.yml`             | 已命名     | P5d 已完成 required check 迁移                                            |
| `branch-promotion`      | `branch-promotion.yml`      | `branch-promotion.yml`      | 已落地     | P5a 已迁移 workflow name                                                  |
| `docker-build`          | `docker-build.yml`          | `docker-build.yml`          | 已落地     | P5a 已迁移文件名与 workflow name                                          |
| `deploy-production`     | `deploy-production.yml`     | `deploy-production.yml`     | 已落地     | P5a 已迁移文件名、workflow name 与触发引用                                |
| `publish-design-system` | `publish-design-system.yml` | `publish-design-system.yml` | 已落地     | DS 包发布入口；后续其他包按 `publish-*` 规划                              |
| `publish-docs`          | 无                          | `publish-docs.yml`          | 已评估缺口 | 有文档站/Storybook 发布需求后新增                                         |
| `publish-release`       | 无                          | `publish-release.yml`       | 已评估缺口 | 有正式 release notes 流程后新增                                           |
| `security-scan`         | `ci.yml` 内部 `audit`       | `security-scan.yml`         | 未独立     | 依赖审计/SAST 独立治理后新增                                              |
| `cleanup`               | 无                          | `cleanup.yml`               | 缺口       | artifacts、缓存或临时环境治理时新增                                       |
| `dependency-review`     | 无                          | `dependency-review.yml`     | 缺口       | 依赖变更审计独立化时新增                                                  |
| `deploy-beta`           | `deploy-beta.yml`           | `deploy-beta.yml`           | 已断开     | 当前为平台 beta 占位入口；不得用于 vx-worker-02，未来平台 beta 需重新设计 |

#### 命名迁移顺序

命名迁移必须遵循“先兼容、再切换、后清理”的节奏，禁止在同一 PR 中同时改名、改触发、改部署策略。

1. 在 P2 台账中确认当前契约与目标命名，列出受影响 ruleset。
2. 在 P5a 中先迁移非 required workflow/file name，验证不会影响 required checks。
3. ruleset 切换完成后，再删除旧 job/check name，避免 PR required check missing。
4. P5b/P5c 已迁移 PR、CI 的文件名或 workflow name；P5d 单独迁移 required check 类契约。
5. P5e/P5f 只在确有业务入口时新增发布或治理 workflow，禁止为了凑齐命名体系而创建空 workflow。

#### P3 准入条件

P3 已在原 `docker.yml` 和 `deploy-VXTURE_DEPLOY_HOST.yml` 名称下完成，不需要等待 P5 命名迁移。P5a 执行后，当前入口已迁移为 `docker-build.yml` 和 `deploy-production.yml`。进入 P3 前必须满足：

- P2 台账已确认原 `docker.yml` 当前职责是镜像构建，P3 只增加 GHCR + ACR 双推。
- P2 台账已确认原 `deploy-VXTURE_DEPLOY_HOST.yml` 当前职责是生产部署，P3 只调整生产拉取源优先级。
- P3 不改 workflow 文件名、workflow name、job/check name 或 required status checks。
- P3 必须保留 GHCR 回退源，避免 ACR 首次接入造成单点风险。

### P5 命名迁移批次边界

P5 是命名迁移执行阶段，不再承载台账建设。P5 必须拆成多个小批次，每个批次只解决一种契约迁移：

| 批次 | 范围                           | 原则                                                                                            |
| ---- | ------------------------------ | ----------------------------------------------------------------------------------------------- |
| P5a  | 非 required workflow/file name | 迁移 `branch-promotion`、`docker-build.yml`、`deploy-production.yml`，保持 required checks 不变 |
| P5b  | PR 检查 workflow               | 已迁移为 `pr-checks.yml` / `pr-checks`，并完成 `enforce-branch-flow` check 迁移                 |
| P5c  | CI workflow name               | 已迁移为 `ci`，并完成 `quality-gate` 等 required job/check 名称迁移                             |
| P5d  | required check / job name      | 已完成 ruleset 切换与旧契约清理；required checks 使用 kebab-case                                |
| P5e  | Publish workflow               | 已评估保持 DS 发布入口现状；统一包发布需求明确前不重命名                                        |
| P5f  | Release / Docs / Governance    | 已评估无当前业务入口；不新增 `publish-release`、`publish-docs` 或治理类空 workflow              |

---

## CI 工作流（ci.yml）

仅对 `develop` 的 PR 与 push 触发（B5 起）。`beta`/`main` 的晋升 PR 不重跑 CI：其 head SHA 与 develop tip 为同一 commit，required checks 由该 commit 既有结果满足。

```
Format
audit
quality-gate
  → build:backend-deps            ← shared + core-* .d.ts 是 type-check 前提
  → prisma generate
  → type-check:all                ← pnpm --recursive type-check
  → lint                          ← pnpm --recursive --if-present lint
  → lint:design                   ← Design System guardrail 脚本
  → lint:boundaries               ← dep-cruiser 包边界检测
build                              ← depends on quality-gate
test-coverage                      ← depends on quality-gate
SonarQube                          ← depends on test-coverage
```

`quality-gate` 是 ruleset 使用的稳定 required status check 契约名，不是展示文案。它内部包含 Type Check、Lint、Guardrail、Boundaries 四类检查；如果内部步骤调整，优先保持 `quality-gate` 名称稳定。

### Required checks 矩阵

| 目标分支  | Required checks                                                          |
| --------- | ------------------------------------------------------------------------ |
| `develop` | `quality-gate`、`enforce-branch-flow`                                    |
| `beta`    | `quality-gate`、`build`、`test-coverage`、`enforce-branch-flow`          |
| `main`    | `quality-gate`、`build`、`test-coverage`、`audit`、`enforce-branch-flow` |

`SonarQube` 暂不作为 required check。待扫描稳定性、外部状态名称和失败处理策略明确后，再纳入 ruleset。

### 关键设计决策

- `--frozen-lockfile`：CI 强制使用 lockfile，防止依赖漂移
- `--if-present`：lint 步骤跳过没有 lint 脚本的包
- `cancel-in-progress: true`：同一分支新推送取消旧运行，节省 runner 分钟数
- required status check 名称必须稳定；workflow job name 与 ruleset 绑定，改名必须先改设计文档并确认切换窗口

---

## dep-cruiser 包边界检测

**配置文件：** `.depcruiserc.cjs`（CommonJS，项目根目录）

```bash
pnpm lint:boundaries
```

### 禁止规则一览

| 规则名                         | from                                    | to（禁止引用）                                                     | 说明                                    |
| ------------------------------ | --------------------------------------- | ------------------------------------------------------------------ | --------------------------------------- |
| `no-portal-to-backend`         | `portals/` `agent-studio/` `business/`  | `packages/core/` `packages/ai/` `services/` `bff/` `agent-server/` | 门户层只能通过 HTTP 调用 BFF            |
| `no-service-to-upper`          | `services/`                             | `bff/` `portals/` `agent-studio/` `business/`                      | Service 层不可向上                      |
| `no-agent-server-to-portal`    | `agent-server/`                         | `portals/` `agent-studio/` `business/` `bff/`                      | Agent Server 不可向上                   |
| `no-core-to-upper`             | `packages/core/`                        | `services/` `bff/` `portals/` `packages/ai/`                       | Core 层只能引用 shared                  |
| `no-ai-sdk-to-upper`           | `packages/ai/`                          | `services/` `bff/` `portals/`                                      | Model Runtime Client 基础设施，不可向上 |
| `no-shared-to-upper`           | `packages/shared/`                      | 所有业务包                                                         | Shared 必须零内部依赖                   |
| `no-infra-package-to-business` | `packages/design/` `packages/platform/` | `services/` `bff/` `portals/`                                      | 工具包不可引用业务层                    |

违反任意规则 → `error` 级别 → CI 失败。

```bash
# 本地运行
pnpm lint:boundaries

# 仅检查某个目录
npx depcruise portals --config .depcruiserc.cjs

# 输出可视化依赖图（需要 graphviz）
npx depcruise portals --config .depcruiserc.cjs --output-type dot | dot -T svg > dep-graph.svg
```

---

## Docker 构建工作流（docker-build.yml）

push 到 `main` 或 `beta`，或推送 `v*.*.*` 格式 tag 时触发。

### 多 Registry 策略

当前主要瓶颈是 VXTURE_DEPLOY_HOST 从 GHCR 拉取镜像速度慢，影响部署窗口和故障恢复效率。当前 `docker-build.yml` 会同时推送 GHCR，并在 ACR secrets 齐全时推送 Aliyun ACR；P3 第一阶段目标不是立即重构为完整的 `docker-build` + `docker-push` 双 workflow，而是先让 GitHub Actions 在构建阶段同时推送 GHCR 与 Aliyun ACR，并让 部署优先从 Aliyun ACR 拉取镜像。

第一阶段链路：

```text
main / beta push
  -> ci
  -> docker-build
       -> push ghcr
       -> push aliyun-acr
   -> deploy-production (main -> VXTURE_DEPLOY_HOST)
       -> pull aliyun-acr first
       -> ghcr as rollback or fallback source
```

设计取舍：

1. **优先解决部署慢**：VXTURE_DEPLOY_HOST 拉取速度是当前主要痛点，部署侧改拉 Aliyun ACR 的收益最大。
2. **保留 GHCR 回退源**：GHCR 继续作为默认公共镜像源和回滚参照，避免一次切换引入单点风险。
3. **暂不强制拆 `docker-push`**：第一阶段双推放在 `docker-build` workflow 内，减少 digest/artifact 传递复杂度。
4. **为后续拆分预留接口**：镜像 tag、registry namespace、secret 名称和部署 compose 配置必须按 `docker-push` 独立化方向设计。
5. **后续演进为分发 workflow**：当 Aliyun ACR 稳定后，再拆出 `docker-push.yml`，由它消费 build metadata 并负责 GHCR、Aliyun ACR、Harbor/ECR 等多 registry 分发。

目标 registry：

| Registry   | 用途                     | 当前阶段 | 说明                                 |
| ---------- | ------------------------ | -------- | ------------------------------------ |
| GHCR       | 现有镜像源、回退源、审计 | 保留     | 继续推送 `ghcr.io/vxture-platform/*` |
| Aliyun ACR | 中国区/近端部署拉取      | 新增     | 部署优先拉取，解决 GHCR 拉取慢问题   |

P3 采用可选启用策略：当 `ALIYUN_ACR_*` secrets 齐全时，`docker-build.yml` 在同一次 build 中同时推送 GHCR 与 Aliyun ACR；当 secrets 缺失时，workflow 只推送 GHCR，不阻断现有 beta/main 发布链路。部署同样优先使用 ACR，缺少 ACR secrets 时回退到 GHCR 默认镜像。

Aliyun ACR secret 命名建议：

| Secret 名                  | 说明                     |
| -------------------------- | ------------------------ |
| `ALIYUN_ACR_REGISTRY`      | ACR registry host        |
| `ALIYUN_ACR_NAMESPACE`     | ACR namespace            |
| `ALIYUN_ACR_USERNAME`      | ACR 登录用户名           |
| `ALIYUN_ACR_PASSWORD`      | ACR 登录密码或访问 token |
| `ALIYUN_ACR_REGION`        | ACR 区域，供后续脚本复用 |
| `ALIYUN_ACR_INTERNAL_HOST` | 可选，服务器内网拉取地址 |

待办清单：

- [x] 确认 Aliyun ACR 实例、地域、namespace、仓库命名规则（已用 `crpi-*.cn-hangzhou.personal.cr.aliyuncs.com/vxture/*`）。
- [x] 配置 GitHub Secrets：`ALIYUN_ACR_REGISTRY`、`ALIYUN_ACR_NAMESPACE`、`ALIYUN_ACR_USERNAME`、`ALIYUN_ACR_PASSWORD`。
- [x] 更新 `docker-build.yml` 登录 Aliyun ACR，并为平台/保留 Agent 镜像增加 ACR tag 输出。
- [x] 确认 GHCR tag 与 ACR tag 一一对应：`latest`、`beta`、`sha-*`、semver tag。
- [x] 更新 VXTURE_DEPLOY_HOST compose，生产部署优先使用 ACR 镜像。
- [x] 为 VXTURE_DEPLOY_HOST 保留 GHCR 回退说明和手动回滚命令。
- [x] 断开 P7a 中 vx-worker-02 workflow 部署入口，业务 ACR/镜像源策略转外部业务仓库维护。
- [x] 确认 Ruyin 迁移与 vx-worker-02 部署归属 `vxture/agentstudio-ruyin`，该仓作为业务工作流模板起点。
- [ ] 等 Ruyin 模板跑顺后，再规划 Varda 迁移到 `vxture/agentstudio-varda`。
- [x] P7b 删除 `deploy/vx-worker-02` 历史 compose/env/scripts 文件。
- [x] 验证 main 发布链路：Docker 双推成功后，VXTURE_DEPLOY_HOST 从 ACR 拉取并部署（生产 compose 已运行 ACR 镜像）。
- [ ] 记录首次切换的部署耗时，对比 GHCR 拉取耗时（见「进一步提效 backlog」B2）。
- [ ] 第二阶段评估拆出 `docker-push.yml`，支持 registry 分发重跑和 digest-based copy（见 backlog B6）。

### 标签策略

| 触发条件         | 打出的镜像标签                                        |
| ---------------- | ----------------------------------------------------- |
| push `main`      | `:latest` · `:sha-<short>`                            |
| push `beta`      | `:beta` · `:sha-<short>`                              |
| git tag `v1.2.3` | `:1.2.3` · `:1.2` · `:1` · `:latest` · `:sha-<short>` |

使用 `docker/metadata-action` + `docker/build-push-action`，标签由 `type=raw` / `type=semver` / `type=sha` 组合自动生成。

### 构建矩阵

当前 `docker-build.yml` 只保留平台镜像和仍在本仓的 Varda 相关镜像。构建矩阵不等于部署边界；是否构建某个镜像不能推导出本仓可以部署 vx-worker-02。Ruyin 的实际部署与模板沉淀在 `vxture/agentstudio-ruyin`；Varda 的业务仓库迁移等待该模板验证后再规划。

| 类别         | 服务                                       | GHCR 镜像名                            | ACR 镜像名                                                | Dockerfile                                 |
| ------------ | ------------------------------------------ | -------------------------------------- | --------------------------------------------------------- | ------------------------------------------ |
| 门户         | website / console / admin                  | `ghcr.io/vxture-platform/{name}`       | `$ALIYUN_ACR_REGISTRY/$ALIYUN_ACR_NAMESPACE/{name}`       | `Dockerfile.nextjs`                        |
| 平台 BFF     | gateway / auth / website / console / admin | `ghcr.io/vxture-platform/bff-{name}`   | `$ALIYUN_ACR_REGISTRY/$ALIYUN_ACR_NAMESPACE/bff-{name}`   | `Dockerfile.gateway` / `Dockerfile.nestjs` |
| Agent BFF    | varda                                      | `ghcr.io/vxture-platform/bff-{name}`   | `$ALIYUN_ACR_REGISTRY/$ALIYUN_ACR_NAMESPACE/bff-{name}`   | `Dockerfile.nestjs`                        |
| Agent Server | varda                                      | `ghcr.io/vxture-platform/agent-{name}` | `$ALIYUN_ACR_REGISTRY/$ALIYUN_ACR_NAMESPACE/agent-{name}` | `Dockerfile.nestjs-prisma`                 |

P6a 起按路径影响范围跳过无关镜像；**B10（#234）进一步改为前置 `detect` job + 动态 matrix**：`detect` 调用 `scripts/workflows/classify-changes.mjs --matrix`（镜像构建配置外置 `scripts/workflows/images.mjs`，单一数据源）算出需重建的镜像集合，`build` job 用 `fromJSON(needs.detect.outputs.matrix)` 动态展开——docs/scripts-only 变更产出 **0 腿**（build job 整体跳过，不再逐腿自跳过），单包改只起受影响腿。旧的静态 11 项 `matrix.include` 与 per-leg classify 已移除。release tag 仍构建全部镜像，`package.json` / lockfile / workspace 配置 / `.dockerignore` / Dockerfile / `packages/shared` / `packages/core` 变更按全局影响处理。

push `beta` 时，只有受影响服务会构建 `:beta` 镜像；当前没有长期平台 beta 环境，不自动部署。push `main` 时，受影响服务构建 `:latest` 镜像，`deploy-production` 继续在 `docker-build` 成功后串行执行 部署。vx-worker-02 不属于本仓部署目标。

### GHA 缓存

每个服务使用独立 `scope`（`cache-from/cache-to: type=gha,scope=${{ matrix.name }}`），互不干扰，同一服务跨 push 复用 Docker 层缓存。

---

## 部署工作流（deploy-production.yml）

`docker-build.yml` 在 `main` 分支成功完成后自动触发 `deploy-production.yml`（`workflow_run` + `branches: [main]`）。生产确认点不设置在 `deploy-production.yml` 的 approval 环节，而是前置到 `beta -> main` 的 `branch-promotion` 阶段；因此 `main` 一旦更新，就代表该版本已经通过 beta 验证和发布确认，可以自动进入生产部署链路。

```
docker-build.yml 完成（main）
  → deploy-production.yml 触发
    → SSH VXTURE_DEPLOY_HOST（Tailscale）
      → 上传当前提交的 deploy bundle（compose / scripts / maintenance / nginx / guardrails / database）
        → 选择镜像源：ACR secrets 齐全时优先 ACR，否则 GHCR
          → bash scripts/31-regular-upgrade-platform.sh
            → 13 prepare runtime env
              → 20 sync nginx + nginx compose up
                → 21 check PostgreSQL health + DATABASE_URL login
                  → 30 docker compose pull + up -d --remove-orphans
                    → 40 verify + 51 alerts
```

`deploy-production.yml` 只执行常规升级链路，不自动执行 `prisma migrate deploy` 或 seed。首次部署、应用层 reset 后重建数据库、或明确需要补种初始化数据时，必须由人工在 VXTURE_DEPLOY_HOST 上执行：

```bash
cd /srv/vxture/deploy
CONFIRM_FIRST_DEPLOY=yes bash scripts/24-first-deploy-platform.sh
```

### GitHub Secrets 配置

| Secret 名                      | 说明                                                  |
| ------------------------------ | ----------------------------------------------------- |
| `DEPLOY_HOST`                  | VXTURE_DEPLOY_HOST 公网 IP（39.103.62.17）            |
| `DEPLOY_USER`                  | SSH 用户名（ecs-user）                                |
| `DEPLOY_SSH_KEY`               | 部署专用 SSH 私钥                                     |
| `DEPLOY_GHCR_USERNAME`         | GHCR 登录用户名（可选，拉私有镜像用）                 |
| `DEPLOY_GHCR_TOKEN`            | GHCR 读取 token（可选）                               |
| `ALIYUN_ACR_REGISTRY`          | ACR registry host，构建推送和部署拉取复用             |
| `ALIYUN_ACR_INTERNAL_HOST`     | ACR 内网拉取地址（可选，VXTURE_DEPLOY_HOST 优先使用） |
| `ALIYUN_ACR_NAMESPACE`         | ACR namespace                                         |
| `ALIYUN_ACR_USERNAME`          | ACR 登录用户名                                        |
| `ALIYUN_ACR_PASSWORD`          | ACR 登录密码或访问 token                              |
| `SONAR_TOKEN`                  | SonarQube 扫描凭证                                    |
| `CF_TURNSTILE_TENANT_SITE_KEY` | Cloudflare Turnstile key（Next.js 构建时注入）        |
| `CF_TURNSTILE_ADMIN_SITE_KEY`  | Cloudflare Turnstile admin key（Next.js 构建时注入）  |

> 部署专用 SSH Key 建议单独生成（`ssh-keygen -t ed25519 -C "deploy-VXTURE_DEPLOY_HOST"`），仅授权执行 `docker compose` 命令，不与开发者个人 Key 共用。

---

## P7a/P7b 越界修正状态

P7a 把 vx-worker-02 手动部署入口加入了本仓，这是错误边界。P7b 继续删除 Ruyin 残留和 vx-worker-02 历史资产。正确边界如下：

| 项目                         | 正确归属                                        |
| ---------------------------- | ----------------------------------------------- |
| VXTURE_DEPLOY_HOST prod 部署 | `vxture` 仓库                                   |
| vxture 平台 beta             | 未来临时 `vxture-beta` 服务器，需另行设计       |
| vx-worker-02 业务 beta       | 当前 Ruyin 归属 `vxture/agentstudio-ruyin`      |
| vx-worker-02 业务 prod       | 当前 Ruyin 归属 `vxture/agentstudio-ruyin`      |
| vx-worker-02 secrets         | 外部业务仓库                                    |
| vx-worker-02 compose         | 外部业务仓库或迁移/归档                         |
| Varda 业务迁移               | Ruyin 模板跑顺后规划 `vxture/agentstudio-varda` |

已完成：

1. `deploy-production.yml` 仅保留 部署目标，移除 vx-worker-02 手动 target 和 `WORKER02_*` secrets 依赖。
2. `deploy-beta.yml` 改为平台 beta 占位入口，当前立即失败，不上传、不执行 vx-worker-02 文件。
3. P7b 已删除 `deploy/vx-worker-02` 历史 compose/env/scripts 资产，防止从本仓误触发业务部署。
4. 保留 VXTURE_DEPLOY_HOST prod 自动部署链路不变。
5. Ruyin 的 vx-worker-02 部署职责已明确转入 `vxture/agentstudio-ruyin`，本仓仅记录边界。

待单独确认：

1. 未来平台 beta 是否启用临时 `vxture-beta` 服务器及其独立部署设计。
2. Ruyin 业务仓库模板跑顺后，启动 Varda 到 `vxture/agentstudio-varda` 的迁移规划。

禁止使用：

- `deploy-beta` workflow 作为实际部署入口。
- `deploy-production` 中任何 `vx-worker-02-*` target。
- `WORKER02_HOST` / `WORKER02_USER` / `WORKER02_SSH_KEY` 等 secrets。

---

## SonarQube（ci.yml job）

与 CI 并行运行，不阻塞镜像构建。触发条件：PR + push to main / beta / develop。

---

## 本地 Git Hooks（Husky）

| Hook         | 执行内容                                                   |
| ------------ | ---------------------------------------------------------- |
| `pre-commit` | `lint-staged`（prettier + eslint 仅对暂存文件）            |
| `pre-push`   | **分支保护**：阻止直接 push 到 `main` / `beta` / `develop` |

Husky 在 `pnpm install` 后由 `prepare` 脚本自动安装（`.husky/` 随代码提交到仓库）。

### 分支保护（pre-push hook）

```bash
# 错误示例：直接在 develop 上 push
git push origin develop
# ✗  Direct push to 'develop' is not allowed.
#    Create a feature/fix branch and open a Pull Request.

# 正确做法：从工作分支 push
git push origin feature/my-feature
# → 正常 push，无拦截

# 紧急绕过（慎用）
git push --no-verify
```

### 与 GitHub Ruleset 的关系

GitHub Repository Rulesets 已配置并生效：

| Ruleset           | 目标分支  | 职责                                                    |
| ----------------- | --------- | ------------------------------------------------------- |
| `protect-develop` | `develop` | 禁止直接 push / 非 PR 变更，要求 required checks        |
| `protect-beta`    | `beta`    | 禁止删除和非快进，要求 promotion 流程与 required checks |
| `protect-main`    | `main`    | 禁止删除和非快进，要求 promotion / hotfix 例外流程      |

Husky pre-push hook 是本地提前失败层；GitHub Ruleset 是远端强制层。两者都存在时，以 GitHub Ruleset 为最终裁决。

### Promotion 与部署触发

`beta` / `main` 的日常晋升目标是 fast-forward promotion，而不是 GitHub UI 的普通 merge commit。原因见 `docs/10-standards/git-workflow.md`：

```
develop == beta == main
```

当 `beta` 被 fast-forward 到 `develop`，会触发 beta 镜像构建；当 `main` 被 fast-forward 到 `beta`，会触发正式镜像构建和 自动部署。promotion 操作必须记录源 commit、目标 commit、操作者和时间，确保部署追溯链不依赖 merge commit。

### 生产发布门禁

生产发布确认点位于 `beta -> main` promotion 之前，而不是 `main` 更新后的 deploy approval。原因是 `main` 在业务语义上代表已获准进入生产发布链路的版本；如果先推进 `main` 再卡部署审批，会造成 `main` 已是新版本但生产仍运行旧版本，削弱生产版本追溯语义。

标准流程：

```text
develop -> beta
  -> beta image build
  -> beta deploy / manual deploy
  -> beta 公测、验收、观察
  -> release confirmation
  -> beta -> main branch-promotion
  -> main image build
  -> VXTURE_DEPLOY_HOST production auto deploy
```

允许状态：

| 状态              | 分支关系                                 | 说明                         |
| ----------------- | ---------------------------------------- | ---------------------------- |
| `all-equal`       | `develop == beta == main`                | 发布完成态                   |
| `beta-validating` | `develop == beta`，`main` 为上一生产版本 | beta 验证窗口，允许短期存在  |
| `main-promoting`  | `beta -> main` promotion 执行中          | 发布确认已通过，正在推进生产 |

`beta-validating` 不是倒挂。真正禁止的是 `main` 比 `beta` 新、`beta` 比 `develop` 新，或通过回灌方向修复一致性。

`branch-promotion target=main` 必须在执行前校验或记录：

- `beta -> main` 晋升 PR 已存在且 required checks 通过。
- `expected_sha` 等于当前 `origin/beta`。
- `main` 是 `beta` 的祖先，允许 fast-forward。
- beta 验证、公测或业务验收已通过。
- 发布确认说明已写入 workflow input、PR comment 或 release 记录。
- 操作者具备生产发布权限。

### branch-promotion 工作流

`.github/workflows/branch-promotion.yml` 是唯一日常晋升执行入口，workflow name 为 `branch-promotion`。它通过 `workflow_dispatch` 手动触发，但执行逻辑由机器强制校验：

| 输入                | beta 晋升                               | main 晋升                                 |
| ------------------- | --------------------------------------- | ----------------------------------------- |
| `target`            | `beta`                                  | `main`                                    |
| `pr_number`         | `develop -> beta` PR                    | `beta -> main` PR                         |
| `expected_sha`      | 当前 `origin/develop`（完整 40 位 SHA） | 当前 `origin/beta`（完整 40 位 SHA）      |
| `release_confirmed` | 不要求                                  | 必须为 `true`，表示 beta 验证或验收已通过 |
| `release_note`      | 不要求                                  | 必须填写，记录生产发布确认依据            |

执行前校验：

1. 晋升 PR 必须为 `OPEN`，且来源/目标分支匹配。
2. PR head SHA、源分支 SHA、`expected_sha` 必须一致。**`expected_sha` 必须传完整 40 位 SHA**——校验是精确字符串比对，短 SHA（如 `c27fdf6b`）会被判为 `Source SHA mismatch` 而拒绝（用 `git rev-parse origin/<source>` 取完整值）。
3. 目标分支必须是源分支祖先，保证 fast-forward。
4. required checks 必须成功。
5. `target=main` 时必须提供 `release_confirmed=true` 和非空 `release_note`。
6. workflow 使用专用 `PROMOTION_TOKEN` 执行普通 push 推进目标分支，禁止 force push。
7. 推进完成后在晋升 PR 写入审计评论。

Repository rulesets 对 `beta` / `main` 保持保护状态，仅允许专用 promotion actor 作为自动化执行者绕过 PR push 限制，并启用 required linear history 阻断 GitHub UI merge commit 晋升路径。该 bypass 只用于 `branch-promotion` 的受控 fast-forward；日常人工不得本地临时关闭 ruleset 或直接 push 主干。

`branch-promotion` 的执行凭据必须来自仓库 secret `PROMOTION_TOKEN`。P4 首次落地允许使用 owner-controlled `stonesmoker` token，以降低当前单人维护阶段的操作复杂度；后续多人协作或发布职责分离后，再迁移到专用 machine user 或 GitHub App。`github-actions[bot]` / `GITHUB_TOKEN` 只适合执行普通 CI 校验，不作为受保护主干晋升的 bypass 身份。

标准触发方式：

```bash
gh workflow run branch-promotion.yml \
  --repo vxture/vxture \
  -f target=main \
  -f pr_number=<beta-to-main-pr> \
  -f expected_sha=<origin-beta-sha> \
  -f release_confirmed=true \
  -f release_note="<beta validation and production release note>"
```

首次上线 `branch-promotion.yml` 时，由于 `workflow_dispatch` 只有在 workflow 文件进入默认分支后才可触发，才允许一次 bootstrap 晋升把该 workflow 推进到 `main`。若 `branch-promotion.yml` 已经在默认分支可触发，则不得再声明 bootstrap 例外。bootstrap 完成后，后续 `develop -> beta -> main` 必须改用 `branch-promotion`。

若 `branch-promotion` 被 ruleset、权限或 required checks 阻断，发布必须暂停，先修复 workflow / ruleset 闭环，再重新触发 workflow；不得改用人工 PATCH ref、临时 disable ruleset 或本地直接 push 兜底。

---

## Design System 包发布

Design System 发布体系当前由 `.github/workflows/publish-design-system.yml` 承担，GitHub Actions UI 中显示为 `publish-design-system`。该入口用于发布 `@vxture/shared` 与 `@vxture/design-system` 到 GitHub Packages，并支持 dry run 与 `ds-v*.*.*` tag 发布。

当前已按 `publish-*` 命名方向完成 DS 发布入口迁移。后续规划其他包发布时，应继续使用清晰的 `publish-{package-group}.yml` 入口，避免把包发布、镜像发布和产品 release 发布混在同一个 workflow 中。

当前约束：

- `.github/workflows/publish-design-system.yml` 是 DS 包发布入口。
- `workflow_dispatch` 的 `dry_run` 默认必须保持 `true`。
- 真实发布必须显式选择 `dry_run=false`。
- `ds-v*.*.*` tag 入口保留。
- `docs/10-standards/design-system-release.md` 中定义的 dry run、真实发布、发布后验证流程必须同步维护。

未来如果建设统一包发布调度层，DS 发布应作为 `package_group=design-system` 或等价参数进入该能力，并保持现有版本检查、跳过已发布版本、发布后验证等语义不变。

---

## CI/CD 优化全景与剩余建议（总览，2026-06-10）

> 本节是优化工作的**单一入口与及时依托**：实施前先看这里定位「做什么/为什么/剩多少」，每完成一项回填本表与对应详细节（文档驱动闭环：固化设计 → 按文档实施 → 实测回填）。详细机理见下方各「Bx 设计」与「提效 backlog」。

### 已落地（收口到 main）

| 手法                       | 内容                                                                      | 兑现收益                                  |
| -------------------------- | ------------------------------------------------------------------------- | ----------------------------------------- |
| 并行 matrix                | docker-build 11 镜像并行、`fail-fast:false`                               | 单镜像失败不拖累其余                      |
| classify-changes（手法 B） | allow-list 模型逐镜像判定影响，未变镜像 SKIP；docs/.github 默认跳过       | 单服务变更只构建 1–2/11；纯文档零镜像构建 |
| GHA buildx 缓存            | `type=gha,scope=<name>,mode=max` 每镜像独立 scope                         | 层字节级命中复用（umbra 未做）            |
| ACR 双推                   | GHCR + Aliyun ACR，VXTURE_DEPLOY_HOST 走 ACR                              | compose pull ≈44s                         |
| **B1** 度量基线            | 四指标实测样本（#190 / run `27187424347`）                                | 提效验收前提                              |
| **B2** ACR 拉取基线化      | ~44s（run `27187584716`）                                                 | 量化 ACR 价值                             |
| **B5** 晋升 PR CI 去重     | `ci.yml` 去 `pull_request`→beta/main，复用 head SHA 的 develop-push check | **发布 run 8→6**，双路径金丝雀通过        |
| **B3** 外部镜像 digest 锁  | pg/redis `tag@sha256:…`                                                   | 防上游 `:latest` 漂移被动重启             |

### 已评估否决

- **B4**（CI build/test 按 workspace 裁剪）⛔ — CI 墙钟仅 ~2min，裁剪至多省 30–60s，`pnpm --filter` 跨包漏检风险高于收益。复议门槛：quality-gate 超 ~5min 或包数显著增长（届时上 turbo/nx）。

### 剩余建议（按优先级，各自独立 PR + 金丝雀）

| 编号        | 任务                               | 落地点                                                                   | 状态                                                                                                                                                                                               |
| ----------- | ---------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ✅ B7       | Dockerfile 构建缓存（cache mount） | `Dockerfile.nextjs`/`nestjs`/`nestjs-prisma`（10 镜像）                  | **已上线（#225，main 2026-06-10）**；本地实测 ≈3×；CI 干净增量收益待下一次 main 构建                                                                                                               |
| ✅ B8       | buildx/registry 抖动重试           | `docker-build.yml`（buildx setup + build-push）                          | **已上线（#226）**；无抖动时行为不变，已随全量重建验证                                                                                                                                             |
| ✅ B9       | 部署侧 deployability 门            | `classify-changes.mjs` + `docker-build.yml` + `deploy-production.yml`    | **已上线（#227）**；deployable=true 放行路径已验证（两次），docs-only 跳过路径已验证（2026-06-10，deploy-production run `27260838060`：gate deployable=false → 跳过 Deploy to VXTURE_DEPLOY_HOST） |
| ✅ B10      | detect job + 动态 matrix           | `images.mjs`（新）+ `classify-changes.mjs --matrix` + `docker-build.yml` | **已上线（#234，main `b095107d`）**；机制已验证（detect→fromJSON→11 腿）；0-腿跳过路径已验证（2026-06-10，docker-build run `27260827979`：detect any=false → build job 0 腿/跳过）                 |
| ✅ 回归测试 | classify-changes allow-list 断言   | `classify-changes.test.mjs` + `ci.yml` quality-gate                      | **已上线（#231）**；22 断言，含 umbra docs+scripts 陷阱用例，CI 常跑                                                                                                                               |
| ⚪ B6       | `docker-push.yml` 拆分             | 多 registry 分发/重试                                                    | 低/未来，待 ACR 双推长期稳定                                                                                                                                                                       |

> 一句话定位：**CI 层 + Docker 构建/部署层主要提效项均已收口**（run 去重、镜像 skip、GHA 缓存、ACR、B7 cache mount、B8 重试、B9 部署门控、B10 动态 matrix、分类器回归测试）。剩 B6（低/未来）。B9/B10 的「纯 docs 晋 main → 跳过部署 + 0 build 腿」路径已于 2026-06-10 验证（docker-build run `27260827979` detect any=false / 0 腿；deploy-production run `27260838060` gate deployable=false / 跳过部署）。**仅剩一个开放验证点**：B7 的干净 cache-mount CI 增量（须「源码变、Dockerfile 不变」的一次 main 构建——`type=gha` 层缓存会在源码未变时整层命中、绕过 mount，故不能用全量重建测）。

---

## 提效度量基线与目标

提效不以降低质量为代价；收益必须用**真实运行日志**对比基线验证，不靠推断（见 `docs/10-standards/cicd-optimization-playbook.md`）。本节定义可量化指标，并记录基线与目标；后续每个提效改动须在 PR 内用同口径数字对比。

### 指标定义

| 指标            | 口径                                                      | 采集方式                                         |
| --------------- | --------------------------------------------------------- | ------------------------------------------------ |
| 发布 run 数     | 一次 `develop -> 生产` 涉及的 GitHub Actions run 总数     | `gh run list` 按发布窗口统计                     |
| 镜像构建数      | 单次 `docker-build` 真正 build+push 的镜像数（skip 不计） | docker-build 各 matrix job 的 build 步骤是否执行 |
| recreate 容器数 | 单次部署被 `docker compose up` 重建的容器数               | 部署后各容器 `Created/Up` 时间                   |
| 端到端耗时      | 合并 develop 到生产就绪（40-verify 绿）总时长             | 各 run `createdAt/updatedAt` 累加                |

### 基线（实测样本，2026-06-09）

采集方法：取一次真实发布窗口，用 `gh run list` / `gh run view --json/--log` 复采。下表以 **PR #190（多文件变更：website + website-bff + auth-bff + service-iam）→ main `f4f9c9ef`** 为审计样本，run ID 可回溯。

| 指标                   | 实测值     | 样本 / 来源                                                                                                                                                                                          |
| ---------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 发布 run 数            | 8          | branch-promotion×2（promote beta/main）+ ci×2（晋升 PR #191/#192）+ pr-checks×2 + docker-build×1 + deploy-production×1。**晋升 PR 的 ci×2 是对已验证 SHA 的重复运行**（见 B5）                       |
| 镜像构建数             | 4 / 11     | docker-build run `27187424347`：真构建 `website`/`bff-website`/`bff-auth`/`bff-console`；跳过 7（admin/bff-admin/bff-gateway/console/service-model-platform/agent-varda/bff-varda）。手法 B 实锤生效 |
| recreate 容器数        | 仅变更服务 | `:latest`+pull+「未变镜像不重推」→ 未变镜像 digest 不变 → `compose up` 不 recreate                                                                                                                   |
| docker-build 耗时      | ~240s      | run `27187424347`，11 个 matrix job 并行（含缓存命中与 skip）                                                                                                                                        |
| deploy-production 耗时 | ~186s      | SSH + compose pull + up + 40-verify                                                                                                                                                                  |
| ACR compose pull 窗口  | ~44s       | deploy run `27187584716`：`[3/4] 拉取` 06:14:44 → `[4/4] 启动` 06:15:28，11 镜像 **串行**（`COMPOSE_PARALLEL_LIMIT=1`），未变镜像只校验 digest                                                       |

> 镜像构建数随变更面浮动（单服务变更通常 1–2/11）；#190 因含 service-iam（被多个 BFF 依赖）构建 4/11。后续提效项须用**同口径**（取一次发布窗口、记 run ID）对比此基线。
>
> **B2 ACR 拉取结论**：VXTURE_DEPLOY_HOST 已从 Aliyun ACR 拉取，整轮 `compose pull` ≈ 44s（串行、含 11 镜像 digest 校验）。GHCR 对照不再实测——ACR 采用本就是为解决「GHCR 拉取慢」的原始痛点，刻意退回 GHCR 做一次慢部署只为取数不划算。串行拉取（`COMPOSE_PARALLEL_LIMIT=1`，为 2C2G worker 控内存）是已知的可调点，但当前 44s 不构成瓶颈，暂不改。

### 目标

1. **发布 run 数**：消除晋升 PR 对已验证 SHA 的重复 CI（B5），目标从 ~8 降到 ~6。
2. **镜像构建数 / recreate 数**：维持「仅变更项」现状，不回退。
3. **端到端耗时**：ACR 拉取耗时基线化（B2），确认 ACR 相对 GHCR 的实测收益。
4. **稳定性**：覆盖无缺口（required checks 仍全绿）、外部镜像不被上游 `:latest` 漂移被动重启（B3）。

---

## 进一步提效 backlog（P9 候选）

在既有 A/B/D/ACR 成果之上的增量项。遵循 playbook 纪律：**一项一 PR、本地预检 + CI 绿、晋升后用运行日志对比基线、默认安全（不确定即全量）**。

| 编号       | 任务                                                                                                                                                   | 价值                                                  | 风险 / 注意                                                                                                                                                                                                                                                                                                                                           | 优先级 |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| ~~B1~~ ✅  | 度量基线落地：按发布窗口精采四项指标，写入上节基线表（以 #190 / run `27187424347` 为审计样本）                                                         | 提效验收前提                                          | 已完成（2026-06-09）                                                                                                                                                                                                                                                                                                                                  | 高     |
| ~~B2~~ ✅  | 记录 ACR 部署拉取耗时（~44s，run `27187584716`）；GHCR 对照不实测（详见基线节结论）                                                                    | 量化 ACR 价值                                         | 已完成（2026-06-09）                                                                                                                                                                                                                                                                                                                                  | 高     |
| ~~B5~~ ✅  | 晋升 PR 重复 CI 去重：`ci.yml` 去掉 `pull_request`→beta/main（方案 A，见上「B5 设计」）                                                                | 每次发布省 ~2 个完整 CI run（8→6）                    | 已实施 + 金丝雀验证通过（2026-06-09）：晋升 PR #198 无新建 ci，required checks 由 head SHA 的 develop-push run `27194658460` 满足，`branch-promotion.yml` run `27194935129` 放行 beta=`f1af785d`                                                                                                                                                      | 高     |
| ~~B3~~ ✅  | 外部镜像（`postgres:18-alpine`、`redis:8-alpine`）显式 digest（`@sha256`）锁定                                                                         | 防上游 `:latest`/浮动 tag 漂移导致有状态服务被动重启  | 已完成（2026-06-09）：`compose.platform.yml` 改为 `tag@sha256:…`（digest 见文件注释）。升级时显式改 tag+digest；pg/redis 数据在卷，重建仅短暂重启不丢数据                                                                                                                                                                                             | 中     |
| ~~B4~~ ⛔  | 评估 CI 的 `build` / `test-coverage` 按 workspace 影响裁剪                                                                                             | 纯文档/局部变更省重型 job                             | 已评估，**暂不实施**（2026-06-09，结论见下「B4 评估」）：CI 墙钟 ~2min、收益边际、跨包漏检风险高于收益                                                                                                                                                                                                                                                | 中     |
| B6         | `docker-push.yml` 拆分（P8）准入评估                                                                                                                   | 多 registry 分发/重试/digest-copy                     | 仅在 ACR 双推稳定后；属架构演进，非即时收益                                                                                                                                                                                                                                                                                                           | 低     |
| ~~B7~~ ✅  | **Dockerfile 构建缓存**：`pnpm` store + Next `.next/cache` 用 BuildKit `--mount=type=cache`（见下「B7 设计」+「本地实测结果」+「上线与 CI 实测记录」） | 消除每次构建的全量重装依赖 + 冷编译，构建墙钟大降     | **已上线（#225，main `9a9c8eb2`，2026-06-10）**：3 个 Dockerfile（nextjs/nestjs/nestjs-prisma）加 cache mount。本地实测增量 459s→153s（≈3×）；CI 首跑（冷 mount）不代表增量收益，干净 CI 增量与 `type=gha` 持久化结论待下一次 main 构建                                                                                                               | 高     |
| ~~B8~~ ✅  | **Buildx/registry 抖动重试**：`docker-build.yml` 的 buildx setup / build-push 首发失败自动重试                                                         | 抗 GHCR/ACR/buildx 基础设施抖动，避免单镜像缺失卡部署 | **已上线（#226）**：首次 `continue-on-error` + `if: failure()` 重试 step；重试幂等（push 同 tag 覆盖）。无抖动时行为不变已随全量重建验证                                                                                                                                                                                                              | 中     |
| ~~B9~~ ✅  | **部署侧 deployability 门**：`deploy-production` 仅在「镜像有变 ∪ `deploy/*` 有变」时执行                                                              | docs-only 晋 main 时免去 ~3min 近 no-op 部署+verify   | **已上线（#227）**：`classify-changes --aggregate` 算 `deployable` → docker-build 上传 artifact → deploy 的 `gate` job 门控（fail-open）。deployable=true 放行路径已验证（两次），docs-only 跳过路径已验证（2026-06-10，deploy-production run `27260838060`：gate deployable=false → 跳过 `Deploy to VXTURE_DEPLOY_HOST`）                            | 低     |
| ~~B10~~ ✅ | **detect job + 动态 matrix**：前置算出需重建镜像集合，build job 用 `fromJSON` 动态 matrix；docs/scripts-only → 整体跳过、单包改 → 只起受影响腿         | docs-only push 省 11 腿空转；部分构建省无关腿         | **已上线（#234，main `b095107d`，2026-06-10）**：镜像配置外置 `images.mjs`（单一源），`classify-changes --matrix` 产出 matrix；deployability artifact 移入 detect（build 跳过时仍产出，护住 B9 fail-open）。机制已验证（detect→11 腿）；0-腿跳过路径已验证（2026-06-10，docker-build run `27260827979`：detect any=false → build job 整体跳过、0 腿） | 低     |

执行顺序：**B1 ✅ → B2 ✅ → B5 ✅ → B3 ✅ → B4 ⛔ → B7 ✅ → B8 ✅ → B9 ✅ → B10 ✅ → B6（低/未来）**。每项完成后回填本文件对应状态与实测对比。

> 进度：B1/B2/B5/B3/**B7/B8/B9/B10** ✅ + 分类器回归测试（均于 2026-06-10 上线 main，最终对齐 `b095107d`），B4 ⛔（评估否决）。CI 层与 Docker 构建/部署层主要提效项均已收口；剩 B6（`docker-push.yml` 拆分，低优先/未来项，待 ACR 双推长期稳定后再议）。**剩一个开放验证点**：B7 干净 cache-mount CI 增量（须「源码变、Dockerfile 不变」的一次 main 构建；全量重建会被 `type=gha` 层缓存整层命中、绕过 mount）。B9/B10 的纯 docs 晋 main 跳过路径已于 2026-06-10 验证（docker-build run `27260827979` 0 腿；deploy-production run `27260838060` gate 跳过部署）。
>
> umbra 纪要的其余手法在本仓的适配结论：并行 matrix（已做）、buildx GHA 缓存 `mode=max`（**已做，umbra 未做**）、`.github`/docs 不触发构建（classify-changes 白名单**默认 skip**，优于 umbra 的 catch-all 补丁）、必需检查名 `quality-gate` 聚合契约（已有）；npm `/download/` 401 坑**不适用**（本仓为 monorepo，`@vxture/*` 是 workspace 成员、源码构建，不拉远端 tarball）。

#### 交叉映射定论：umbra 的 detect = 本仓 classify-changes（allow-list）+ B9（2026-06-10）

umbra 2026-06 修了一个「docs PR 顺带改 `scripts/checks/` → 被判可部署 → 误触发完整部署」的 bug，修法是把 `scripts/*` 加进「非可部署白名单」。本仓收到该排查后交叉核对，结论是**本仓结构上对该 bug 类免疫，无需照搬 umbra 的 detect 模式**：

- **umbra = deny-list（默认部署）**：`deployable` 默认 true，靠枚举「不该部署的路径」排除；漏一类路径 → 默认就部署 = **fail-dangerous**。仓库每长出一类新顶层路径都可能再踩同款坑。
- **本仓 = allow-list（默认 SKIP）**：`classify-changes.mjs` 只在命中 `DOCKER_GLOBAL_RULES`/`IMAGE_RULES` 时才构建/部署，未命中一律跳过。`scripts/*`/未知根文件不在任何规则 → `deployable=false` = **fail-safe**（漏 → 不部署 → 易发现补规则）。已由 `classify-changes.test.mjs` 锁成 CI 回归（含 `docs+scripts → false` 的 umbra 原始陷阱用例）。
- **umbra 的 `imagetools create` digest-retag** 是其按 commit-SHA 打标策略下给 unchanged 镜像现造 tag 的手段；本仓部署 `:latest`，skip 的镜像 `:latest` digest 不变 → compose 自然不 recreate，**无需 retag**。该 digest-copy 原语对本仓的价值在 **B6**（多 registry 分发），不在变更检测这里。
- **回礼**：本仓已把 allow-list 模型 + 迁移路径 + 断言用例表整理为给 umbra 的设计简报（建议 umbra 把 detect 由 deny-list 反转为 allow-list，从根上消除该 bug 类）。

> 给未来 AI 的提示：**不要再"照搬 umbra 的 detect/deny-list 模式"** —— 本仓的 allow-list + B9 已是更优解，照搬反而是降级。

### B4 评估：CI build/test 按 workspace 影响裁剪（已评估，暂不实施）

现状（`ci.yml`）：`build` 已 `--filter` 只构建 2 个服务（model-platform、varda）；`type-check`（`type-check:all`）、`lint`（`--recursive`）、`test-coverage`（`--recursive`，实测 ~28s）为全量；纯文档变更已在 P6a 跳过重型 job。

结论 **暂不实施**，理由：

1. **收益边际**：CI 总墙钟 ~2min（quality-gate ~1m50s 为大头、test ~28s）。monorepo 规模不大，按受影响包裁剪在小改上至多省 30–60s。
2. **风险实在**：`pnpm --filter ...[ref]` 增量检测虽含 dependents，但脆弱；跨包 type 断裂正需全量才稳，**漏检即污染主干**，代价远高于省的几十秒。
3. **原则**：playbook「该跑的一次跑完整」——纯文档已轻量化，代码变更保持全量 type-check / test 是正确取舍。
4. **复议门槛**：若 quality-gate 墙钟超 ~5min 或包数显著增长，届时引入 turbo/nx 的「带缓存 + 依赖感知」增量图，而非手搓 pnpm filter。

### B5 设计与实施：晋升 PR 重复 CI 去重（方案 A 已实施，待金丝雀验证）

#### 问题机理

`ci.yml` 触发为 `pull_request`→main/beta/develop + `push`→**仅 develop**（beta/main push 已不跑 CI）。但 `pull_request`→beta/main——即 `develop->beta`、`beta->main` 两个晋升 PR——**仍各跑一次完整 ci**（`ci.yml` 注释明示这是为满足 ruleset required checks 而故意保留）。这两次 ci 跑在 PR 合成 merge SHA 上，而其 head SHA = develop tip，**已在 develop push 时跑过完整 ci**（quality-gate / build / test-coverage / audit 全有）。每次发布因此有 **2 次完整 CI 纯重复**（见基线：发布 8 run 中 ci×2）。

#### 关键洞察

晋升是 **fast-forward**：`develop tip == beta tip == main tip` 为同一 commit SHA。GitHub 的 check-run 挂在 **commit** 上（非 PR），该 SHA 在 develop push 时已带上 quality-gate / build / test-coverage / audit 的绿 check。所以晋升 PR 的 head SHA **本就携带这些 check**。

#### 方案对比

| 方案          | 做法                                                                                                                                                                 | 评价                                                   |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| **A（推荐）** | `ci.yml` 去掉 `pull_request`→beta/main 触发（保留 develop）；晋升 PR 的 required checks 由 head SHA 既有 develop-push check 满足；`enforce-branch-flow` 仍在 PR 上跑 | 干净，省 2 次完整 CI/发布；依赖「check 挂 commit」特性 |
| B             | 保留触发但 head SHA 已绿时跳过重型 job                                                                                                                               | 条件逻辑复杂、脆弱                                     |
| C             | 改 `branch-promotion.yml` 校验 head-SHA check + 放松 ruleset required                                                                                                | **削弱主干门禁，危险**，否决                           |

#### 唯一不确定点 + 上线前验证

GitHub 的 PR required-status-check 是否认可「来自 develop-push 事件、挂在同一 head SHA 上的 check」？理论上认可（check 是 commit 级），但须**金丝雀验证**：方案 A 合入后，开一个 `develop->beta` 晋升 PR，确认 quality-gate / build / test-coverage **直接显示已通过（无新 run）** 且 `branch-promotion.yml` 校验放行。

#### 风险与回退

- **风险**：若 GitHub 不认 head-SHA check → 晋升 PR required check missing → `branch-promotion.yml` 被阻、发布暂停。属 **fail-closed**（安全方向，不会误放行）。
- **回退**：恢复 `ci.yml` 的 `pull_request`→beta/main 一行即可，零数据风险。
- `enforce-branch-flow` 始终保留；`audit`（main required）在 develop push 也跑，head SHA 已具备。

#### 收益

每次发布 **8 -> 6 run**（省 2 次完整 ci），与基线目标一致。

### B7 设计：Dockerfile 构建缓存（pnpm store + Next 增量缓存）

#### 问题机理（已验证）

三个 Dockerfile 同一模式——**先 COPY 全部 workspace 源码，再 `pnpm install --frozen-lockfile`，且无任何 cache mount**：

- `deploy/docker/Dockerfile.nextjs:21-33`（影响 website/console/admin）
- `deploy/docker/Dockerfile.nestjs:20-31`（影响 5 个 BFF + bff-varda）
- `deploy/docker/Dockerfile.nestjs-prisma:23-34`（影响 agent-varda / service-model-platform）

Docker 层缓存按输入内容哈希判定：**任一应用源码改动 → `COPY packages|portals|bff|services|…` 层 hash 变 → 其后的 `pnpm install` 层级联失效 → 每次构建全量重装依赖**；Next/Nest 编译同样从冷开始。`docker-build.yml:228-229` 的 GHA buildx 缓存（`type=gha,mode=max`）只在**层字节级命中**时有效——而我们触发构建恰恰因为源码变了，故对最常见路径（改代码→重建）几乎无帮助。

> 注意：行内注释「先复制 lockfile，最大化 install 缓存命中」的**意图未达成**——install 被排在源码 COPY 之后，命中前提（仅 lockfile 变才重装）被打破。

#### 方案（两层叠加，互补）

| 层                    | 手法                                                                                                                                                      | 效果                                                             |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| **依赖**              | `RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile`（配 `pnpm config set store-dir /pnpm/store` 或 `ENV PNPM_HOME`） | install 层即便重跑，包从持久 store 取，免去重复下载/解压         |
| **编译**              | Next：`--mount=type=cache,target=${PORTAL_PATH}/.next/cache`；Nest：tsc/swc 产物目录同理                                                                  | 增量编译，避免冷编译                                             |
| **结构（进阶/可选）** | 用 `pnpm fetch --frozen-lockfile`（只需 lockfile，不需源码）→ 再 COPY 源码 → `pnpm install --offline`                                                     | 把依赖解析层提到源码 COPY **之前**，install 层不再被源码改动击穿 |

最小改动版 = 仅加两个 cache mount（不动 COPY 顺序），低风险、收益已显著；进阶版（pnpm fetch 重排）收益最大但改动面大，作为第二步。

#### 关键约束

- **BuildKit 必需**：cache mount 是 BuildKit 语法；`docker-build.yml` 已用 `setup-buildx-action` + `build-push-action`，原生 BuildKit，满足。
- **GHA 缓存后端对 cache mount 的持久化**：`type=gha` 默认**不导出** `--mount=type=cache` 内容（buildx 已知限制）。需确认收益是否依赖跨 run 持久——若依赖，评估 `reproducible-containers/buildkit-cache-dance` 或 registry 缓存承载 mount cache；若仅图单 run 内多镜像复用 store，则 GHA 现状即可。**此点须在本地/CI 实测确认**，不可纸面假设。
- **产物不变**：cache mount 只加速过程，不改最终镜像内容（`--frozen-lockfile` 保证依赖版本一致）。

#### 验证（量化，先本地后 CI）

1. **本地基线**：`docker build`（无 mount，clean buildx）冷构建一个 portal + 一个 prisma 服务，记墙钟。
2. **本地改后**：加 cache mount，改一行源码后重构，记墙钟（应显著低于基线，install/编译走缓存）。
3. **CI 实测**：合入后看 `docker-build` 各 matrix 腿墙钟对比历史 run；确认 cache mount 在 CI 环境实际生效（结合上「GHA 持久化」约束的结论）。
4. **产物校验**：改前/改后镜像 `docker run` + 健康端点一致；40-verify 绿。

#### 风险与回退

- **风险**：cache mount 未在 GHA 持久 → CI 收益不及本地（但本地构建与单 run 内复用仍受益）；属**只赚不亏**，不影响正确性。
- **回退**：删除 `--mount` 行即恢复原行为，零产物/数据风险。
- **顺序**：先做最小改动版（加 mount）→ 实测 → 视 GHA 持久化结论决定是否上进阶版（pnpm fetch 重排）或缓存后端调整。

#### 本地实测结果（2026-06-10）

样本：`admin` 门户走 `Dockerfile.nextjs`，本机 Docker Desktop（buildx 0.34，BuildKit 原生）。改后变体在原 Dockerfile 基础上加两个 cache mount（pnpm store `--mount=type=cache,target=/pnpm/store` + Next `.next/cache`）。每个 regime 前 `buildx prune -af` 清缓存保证公平；「增量」= 改一行 `portals/admin/.../page.tsx` 后重建。

| 场景                       | 基线（无 mount） | 改后（cache mount） | 变化              |
| -------------------------- | ---------------- | ------------------- | ----------------- |
| 冷构建（缓存全空）         | 854s             | 1270s               | 无收益（见下注）  |
| **增量重建（改一行源码）** | **459s**         | **153s**            | **≈3×，省 ~306s** |

**结论**：

- **增量重建是真收益点，且收益显著**：改一行源码触发重建时，基线因「`pnpm install` 排在源码 COPY 之后」全量重装 + 冷编译耗 459s；改后 install 命中 store 缓存（日志实测 `reused 1066, downloaded 0`，零下载）、Next 走 `.next/cache` 增量编译（~59s），总 153s。日常开发与 CI 改代码重建走的正是此路径。
- **冷构建非收益点（且改后更慢）**：缓存全空时 cache mount 需首次填充 store，叠加基础镜像重拉的网络噪声（`baseline_cold` 854s 大头是 `node:24-alpine` 慢速下载），故 `after_cold` 1270s 反高于基线。冷构建在 CI 上罕见（runner 基础镜像已缓存 + GHA 层缓存），不代表常态。
- **本地数为机制上限佐证**：本机 buildx 的 `type=cache` mount 原生跨构建持久，故能完整体现收益。**CI 用 `type=gha` 默认不导出 cache mount 内容**（见上「关键约束」），CI 实际收益须在合入后用 `docker-build` 历史 run 对比确认，必要时引入 `buildkit-cache-dance` 或 registry 缓存承载 mount——本地数不直接等同 CI 数。

> 量化方法可复用：clean cache → cold → 改一行 → incremental，比 `incr` 对 `incr`（同复用基础镜像、同源码改动），剔除冷构建的镜像拉取噪声。

---

## 提效成果与验证记录（2026-06-09）

本批 CI/CD 提效（T0 文档 + B1/B2/B5/B3 + B4 评估）已实施并验证、收口对齐到 main。

### B5 双路径金丝雀验证

B5 去掉了 `pull_request`→beta/main 的 CI 触发，依赖晋升 PR 的 head SHA（= develop tip，fast-forward 同一 commit）携带 develop-push 的 check。两条晋升路径均已实测确认：

| 晋升 PR                           | quality-gate / build / test-coverage 来源   | 是否新建 ci |
| --------------------------------- | ------------------------------------------- | ----------- |
| #198（develop->beta，首次金丝雀） | develop-push run `27194658460`（秒级显绿）  | 否          |
| #202（develop->beta，对齐批）     | develop-push run `27195795283`（3–5s pass） | 否          |
| #203（beta->main，对齐批）        | 同上 run `27195795283`（3–5s pass）         | 否          |

取证：对齐期间 `ci.yml` 的近 8 个 run 全部为 `push develop` 或 `pull_request <feature 分支>`，**零 `pull_request beta` / `pull_request main`**。`branch-promotion.yml` 在三次晋升均正常放行（required checks 由 head SHA 既有 check 满足）。结论：**发布 run 8 -> 6 已稳定兑现，门禁未被削弱（fail-closed 不变）。**

### B3 digest 锁定上线验证

对齐部署（deploy run `27195991455`）首次应用 `compose.platform.yml` 的 `@sha256` 锁定。compose 因 image ref 由 `tag` 变为 `tag@digest` 触发 **pg/redis 各一次重建**：`vx-platform-pg Recreated -> Started -> Healthy`（~10s 恢复）、`vx-platform-redis` 同。**数据在卷未丢**；此后 digest 冻结，常规 deploy 拉到相同 digest 不再重启有状态容器。

### 收口对齐

`develop == beta == main == 27b4e23d`。本批改动全为 docs + CI/部署配置，应用镜像未变（docker-build 手法 B 全跳），无应用层重启；仅 B3 触发了上述一次性 pg/redis 切换。

### 剩余

- **B6**（`docker-push.yml` 拆分）：低优先/未来，待 ACR 双推长期稳定后再议。
- 提效 backlog 的即时收益项已全部收口。

---

## 分支对齐与 branch-promotion 改名验证记录（2026-06-10）

合入 #215（`promote.yml` → `branch-promotion.yml` 改名，WF 名与内容 0 变更）与 #216（`shell-quote` 经 `pnpm.overrides` 锁 `^1.8.4`，清除当日新公开 critical 公告 GHSA-w7jw-789q-3m8p）后，执行 `develop -> beta -> main` 晋升对齐，三分支收口于 `c27fdf6b`。本轮同时复测 B5 去重并首次实跑改名后的 `branch-promotion.yml`。

### B5 去重金丝雀复测（改名后整链）

| 晋升 PR                 | quality-gate / build / test-coverage / audit 来源                  | 是否新建 ci |
| ----------------------- | ------------------------------------------------------------------ | ----------- |
| #217（develop -> beta） | develop-push run `27219087339`（共享 commit `c27fdf6b`，秒级显绿） | 否          |
| #218（beta -> main）    | 同上 run `27219087339`                                             | 否          |

取证：`ci.yml` 近期 run 全为 `push develop` 或 `pull_request <develop 分支的 PR>`，**零 `pull_request beta` / `pull_request main`**；两个晋升 PR 上仅 `enforce-branch-flow`（pr-checks.yml）各新跑 ~4s，heavy checks 全部由 head SHA 既有 develop-push check 满足。结论：**B5 在 `branch-promotion.yml` 新名下整链生效，发布 run 8 -> 6 维持，门禁未削弱。**

### branch-promotion.yml 新名首跑

beta 晋升、main 晋升均由 `gh workflow run branch-promotion.yml` 正常放行并 fast-forward 推进。**操作经验**：首次 beta dispatch 传短 SHA 触发 `Source SHA mismatch`（run `27219366810` 失败）——`expected_sha` 必须传 `git rev-parse origin/<source>` 的完整 40 位 SHA（已回填上方操作说明）。

### main 晋升的全量重建与部署验证

#216 改了根 `package.json` + `pnpm-lock.yaml`，属 `classify-changes.mjs` 的 `DOCKER_GLOBAL_RULES`（"workspace metadata changed"）→ 晋到 main 触发 docker-build **全量重建 11 镜像**（run `27219587714` success）→ deploy-production 经 `workflow_run` 自动重部署（run `27219862190` success）。40-verify 全绿：

- **9 个应用容器**（website/console/admin 门户 + 5 BFF + model-platform）recreate 后全 `healthy`（Up ~28–53s）。
- **pg/redis 未重建**（digest 未变，Up 2h）——全量重建只触应用镜像，有状态容器零扰动，印证 B3 digest 锁定行为。
- 内部 `/healthz` 全 OK；`model-platform readiness=ready`；公网 `https://api.../healthz -> OK`。
- 改动为 dev-only（`shell-quote` override 仅影响开发工具链，不进生产镜像运行时），运行时等价已由全栈 healthy + readiness ready 证实。

### 收口对齐

`develop == beta == main == c27fdf6b`。7 个工作流文件名与 WF 名全一致；今后晋升统一用 `gh workflow run branch-promotion.yml …`。

---

## 二次分支对齐记录（纯 docs，空重部署）（2026-06-10）

继上次对齐（`c27fdf6b`）后，develop 又合入 3 个 **docs-only** 提交（#219 改名/金丝雀验证记录、#220 CI/CD backlog + 运行时 workplan、#221 B7 本地实测），再次执行 `develop -> beta -> main` 对齐，三分支收口于 `516f2bbf`。本轮与上次形成关键对照：**上次含 `package.json`/lock 改动 → 全量重建；本次纯 docs → 全镜像 SKIP，但部署仍空跑一次**，实证了 B9（部署侧缺镜像变更门控）。

### 晋升执行

| 晋升 PR                 | branch-promotion run | 结果                      |
| ----------------------- | -------------------- | ------------------------- |
| #222（develop -> beta） | `27246952114` ✅     | fast-forward → `516f2bbf` |
| #223（beta -> main）    | `27246997346` ✅     | fast-forward → `516f2bbf` |

`expected_sha` 统一传完整 40 位 `516f2bbf63cdffbcda791c21cd3e1a70f93a1d34`；main 晋升带 `release_confirmed=true` + `release_note`。两个晋升 PR 上的 heavy checks 全部复用 develop head `516f2bbf` 既有 develop-push check（B5 去重持续生效），仅 `enforce-branch-flow` 各新跑一次秒级显绿。

### docker-build 全量 SKIP（与上次全量重建对照）

main 推送触发 docker-build run `27247003521` success，但 11 镜像**全部** `No Docker image inputs changed; build and push skipped`——3 个 commit 仅动 `docs/*.md`，`classify-changes.mjs` 的 allow-list 正确判定零镜像影响，**无构建、无推送，`:latest` digest 全部不变**。对照上次（#216 命中 `DOCKER_GLOBAL_RULES` → 重建 11 镜像），印证 classify-changes 的 docs/.github 路径默认 SKIP 行为。

### 空重部署验证（B9 实证）

`deploy-production` 经 `workflow_run`（on docker-build success）照常触发 run `27247014108` success（1m22s）。由于当前 deploy 侧**无镜像变更门控**，即便没有任何新镜像也会跑完整部署流程：

- **9 个应用容器全 `(healthy)` 且 `Up 9 hours` 未重建**——`:latest` digest 未变，compose 判定 up-to-date，跳过 recreate（与上次 recreate「Up ~28–53s」形成对照）。
- `vx-platform-pg` / `vx-platform-redis` 固定 digest 未动（`Up 12 hours`）。
- 净效果：一次**对生产零状态变更的空跑部署**。说明 B9 价值——可在 deploy 触发前加「本次 docker-build 是否实际推送过镜像」门控，省掉这类无意义部署。

### 收口对齐

`develop == beta == main == 516f2bbf`。docs-only 晋升对生产零影响已实证；B9 backlog 的现实场景由本轮空跑直接复现。

---

## B7/B8/B9 上线与 CI 实测记录（2026-06-10）

B7（#225）、B8（#226）、B9（#227）按金丝雀依次合入 develop，统一晋升 `develop -> beta -> main`，三分支对齐 `9a9c8eb2`。因 B8/B9 改了 `docker-build.yml`（命中 `DOCKER_GLOBAL_RULES`「workspace metadata」）→ docker-build **全量重建 11 镜像**（run `27249602047` success）→ deploy-production 经新 B9 gate 放行后部署（run `27249715582` success）。

### B7 — CI 首跑（带 mount 冷缓存）墙钟，对照改前全量重建

首跑 cache mount 为空、`type=gha` 默认不导出 mount，故**首跑不代表增量收益**，仅作「带 mount 基线」。与改前一次全量重建（#216 / run `27219587714`，因改 `package.json`+lockfile 全量重建）逐腿对照：

| 镜像                   | 改前全量（27219587714） | B7 首跑（27249602047） |
| ---------------------- | ----------------------- | ---------------------- |
| website                | 273s                    | 186s                   |
| console                | 214s                    | 188s                   |
| admin                  | 196s                    | 176s                   |
| bff-website            | 132s                    | 108s                   |
| bff-auth               | 115s                    | 104s                   |
| bff-console            | 126s                    | 119s                   |
| bff-admin              | 124s                    | 139s                   |
| bff-varda              | 186s                    | 133s                   |
| agent-varda            | 135s                    | 114s                   |
| service-model-platform | 155s                    | 151s                   |
| bff-gateway（不涉 B7） | 48s                     | 37s                    |

**诚实判读**：首跑多数腿略低，但**这不是干净的 B7 测量**——① 首跑 mount 冷、改前那次同时改了 lockfile（额外依赖解析/下载），两边负载不对等；② runner/网络/基础镜像拉取噪声未剔除；③ install 层指令变了（加 mount）→ `type=gha` 层缓存对 install 必然 miss，首跑仍是冷装。**B7 的干净 CI 增量收益须看下一次 main 构建**（只改源码、不改 lockfile/Dockerfile），用其各腿对比本次首跑；并据此判定 `type=gha` 是否跨 run 承载了 cache mount（若否，评估 `buildkit-cache-dance`/registry 缓存）。本地已证机制上限 ≈3×（见上「本地实测结果」），CI 侧结论保持开放。

### B8 — 抖动重试（行为不变已验证）

本次 11 镜像无基础设施抖动 → 首发 build-push/ buildx setup 全部一次 success、`(retry)` step 全部跳过，docker-build 整体 success。证实**无抖动时 B8 不改变常态**；真实重试路径无法人为制造，留待真实抖动触发。

### B9 — deployability gate（deployable=true 放行路径已验证）

- docker-build 新增 `Resolve deployability` job：`any_image_build=true, deploy_changed=false, deployable=true` → 写 `true` → 上传 artifact（success）。
- deploy-production 新增 `gate` job：下载 artifact、解析 `deployability gate → deployable=true` → 放行 `Deploy to VXTURE_DEPLOY_HOST`。
- 部署结果：**9 应用容器 recreate 后全 `(healthy)`（Up ~12–32s）**，`vx-platform-pg`/`redis` digest 未动（`Up 13h`，B3 持续生效）。证实**门控不破坏正常部署**。
- **已覆盖（2026-06-10 补验）**：`deployable=false`（docs-only）跳过路径已复现——纯 docs 晋 main 的 deploy-production run `27260838060` 在 `gate` 解析 deployable=false 后直接跳过 `Deploy to VXTURE_DEPLOY_HOST`（同轮 docker-build run `27260827979` detect any=false、0 build 腿）。详见文末「B9/B10 跳过路径验证与收口」记录。
- **小遗留（已清）**：原 `actions/download-artifact@v4` 触发的 Node.js 20 弃用告警已解决——artifact actions 已对齐到 `actions/upload-artifact@v7` + `actions/download-artifact@v8`，无 @v4 残留，Node20 告警清除（#232）。

### 收口对齐

`develop == beta == main == 9a9c8eb2`（此为该批收口时的快照）。B7/B8/B9 全部上线；当时遗留两个开放验证点（B7 干净 CI 增量、B9/B10 纯 docs 晋升跳过路径），其中 B9/B10 跳过路径已于 2026-06-10 复现（deploy-production run `27260838060` 跳过部署、docker-build run `27260827979` 0 腿），仅余 B7 干净 cache-mount CI 增量一个待「源码变、Dockerfile 不变」构建复现的开放验证点（已在 backlog 状态标注）。

---

## B 组上线与 B10 验证记录（2026-06-10）

工程化夯实批：分类器回归测试（#231）、artifact 版本对齐（#232）、umbra 交叉映射注（#233）、**B10 动态 matrix（#234）**，按金丝雀逐项合入 develop 后统一晋升，三分支对齐 `b095107d`。因 `docker-build.yml` 改动命中 `DOCKER_GLOBAL_RULES` → 全量重建（docker-build run `27259712988`）→ deploy（run `27259758863`）。

### B10 — detect → 动态 matrix（机制已验证）

- `Detect images` job 运行 `classify-changes --matrix`，输出 `any=true`、`deployable=true`、`matrix={"include":[…11 项…]}`（首项 website，携带完整 build config）。
- `build` job 经 `fromJSON(needs.detect.outputs.matrix)` 正确展开为 **11 个命名腿**，全部 success。动态 matrix 机制端到端打通。
- deployability artifact 由 detect 产出（不再依赖 build），deploy `gate` 正常下载 → `deployable=true`。
- **已覆盖（2026-06-10 补验）**：docs/scripts-only 的 **0-腿跳过**路径已复现——纯 docs 晋 main 的 docker-build run `27260827979` detect 输出 `any=false` → build job 整体跳过（0 腿），同轮 deploy-production run `27260838060` gate deployable=false 跳过部署。详见文末「B9/B10 跳过路径验证与收口」记录。

### B7 — 第二次构建墙钟（诚实归因：层缓存命中，非 cache-mount）

本次为带 mount 的**第二次**全量构建，各腿相对首跑（run `27249602047`）暴跌：

| 镜像                   | 首跑（冷 mount） | 第二次 | 说明 |
| ---------------------- | ---------------- | ------ | ---- |
| website                | 186s             | 33s    |      |
| console                | 188s             | 38s    |      |
| admin                  | 176s             | 38s    |      |
| service-model-platform | 151s             | 42s    |      |
| bff-varda              | 133s             | 34s    |      |
| 其余 BFF/agent         | 104–139s         | 32–43s |      |
| bff-gateway（不涉 B7） | 37s              | 32s    |      |

**但这不是 cache-mount 的功劳**：本批 5 个 commit 未碰任何镜像源码（portals/bff/packages），Dockerfile 也未变 → 镜像层输入哈希不变 → **`cache-from type=gha` 整层命中**，`RUN --mount … pnpm install` 层被**恢复而非执行**，mount 根本没被考验。这只证明了既有 GHA 层缓存在源码未变时的威力（186→33s）。**B7 cache-mount 的干净 CI 增量仍未测得**——须一次「镜像源码变、Dockerfile 不变」的 main 构建（install 层重跑、mount 供依赖），届时对比同口径首跑。

### B9 — deployable=true 路径复验

`deployability gate → deployable=true` → 放行 `Deploy to VXTURE_DEPLOY_HOST` → **9 应用容器 recreate 全 `(healthy)`（Up ~36–56s）**，`vx-platform-pg`/`redis` 未动（`Up 17 hours`，B3 持续）。deployable=true 路径第二次确认稳定。

### 收口对齐

`develop == beta == main == b095107d`。B 组（回归测试/版本对齐/交叉映射/B10）+ B7/B8/B9 全部上线。B9/B10 纯 docs 晋 main 的跳过路径已于 2026-06-10 验证（docker-build run `27260827979` 0 腿；deploy-production run `27260838060` gate 跳过部署，详见文末追加记录）。**剩一个开放验证点**（待自然触发，无需专门操作）：B7 干净 cache-mount 增量（下一次"源码变、Dockerfile 不变"的 main 构建）。剩余 backlog 仅 B6（低/未来）。

---

## B9/B10 跳过路径验证与收口（纯 docs 晋升）（2026-06-10）

继 `b095107d` 对齐后，又一次纯 docs 晋升 `develop -> beta -> main`，三分支收口于 `46a2cea7`，首次端到端实证 B9/B10 的「纯 docs → 0 build 腿 + 跳过部署」路径。

- **docker-build run `27260827979`**：detect job 输出 `any=false`（classify-changes allow-list 判定零镜像影响）→ build job 整体跳过、0 腿，`:latest` digest 全部不变。
- **deploy-production run `27260838060`**：`gate` job 解析 `deployable=false` → 直接跳过 `Deploy to VXTURE_DEPLOY_HOST`，对生产零状态变更、零空跑部署（对照「二次分支对齐记录」中 B9 未门控时的空跑部署）。

结论：B9（部署侧 deployability 门）+ B10（0-腿跳过）两条跳过路径均已端到端验证。**至此 backlog 仅剩 B7 干净 cache-mount CI 增量一个开放验证点**（须「源码变、Dockerfile 不变」的一次 main 构建）。`develop == beta == main == 46a2cea7`。

---

## 参考文档

- `.github/workflows/` — 所有工作流文件
- `.depcruiserc.cjs` — dep-cruiser 规则配置
- `docs/50-deployment/03-containers.md` — Dockerfile 模板和构建顺序
- `docs/30-design/architecture/02-package-boundaries.md` — 层边界规范（dep-cruiser 规则的原始来源）
- `docs/10-standards/git-workflow.md` — 分支策略与版本晋升流程
