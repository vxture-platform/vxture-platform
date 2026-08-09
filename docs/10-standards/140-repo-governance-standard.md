# Vxture 产品仓库治理规范（org 级整顿依据）

> **适用**：org 下全部产品仓库（vxture-platform、vxture-arda、vxture-karda、vxture-varda、umbra 等）。
> **用途**：**全栈产品仓的模板与要求**——新仓照此搭、旧仓照此整顿，统一到**主干模式 + tag→环境 CD +
> 稳健 CD 构件 + 敏感信息/SCA 治理 + 数据层/护栏 + 统一骨架**。
> **参照实现**：`vxture-platform`（治理/SCA/数据层，2026-07-15 起）+ `vxture-arda`（稳健 CD 构件 +
> 仓库骨架/docs 分类范本）。
> **配套**：**各仓照 [`自整顿 runbook`](../50-deployment/rebuild/20-self-rectify-runbook.md) 自行整顿**（可移植工具清单 +
> 分批步骤 + 每步机检命令）；迁移操作见 [`rebuild/README`](../50-deployment/rebuild/10-README.md)；密钥/边界见
> [`security.md`](./150-security.md)；CI 提效见 [`cicd-optimization-playbook.md`](./010-cicd-optimization-playbook.md)；
> 容器健康见 [`container-healthcheck-standard.md`](./020-container-healthcheck-standard.md)。

本文定"每个全栈仓必须具备/对齐什么"（要求 WHAT），末尾附**整顿检查清单**。**执行模型**：标准明确+严格且
**机器可验**（每项对应一条验收命令 / CI 硬门，不达标即拦合并，无需人主观判断）；各仓 owner/agent **自整顿**，
vxture-platform 只提供标准 + 参照实现 + 工具，**不代做**。新缺口先补进标准（本文/taxonomy）再各仓照新标准整顿。

**偏离纪律（2026-07-21 增）**：标准条款因前置依赖未就绪（如共享包未发布、平台端点未上线）而暂不可满足时，
**不得静默自行发挥**。必须三步：① 实现处显式标注偏离与原因（代码注释引用被偏离的标准条款）；② 本仓技术债
登记处记名 TD 条目（条款 / 原因 / 回收条件）；③ 向平台线回报，由平台确认"过渡态可接受"或"先补标准"。
前置就绪后按登记回收，平台发布依赖更新时会据登记逐仓催收。**静默偏离 = 未达标**（整顿验收不通过；本条为
PR 评审比对项，不设新机检）。实例教训：vxtpl 在 `@vxture/shared@1.5.0` 未发包时自写 health identity 组装
且未申报，与标准 025"共享助手禁止各写一份"条款的冲突直到平台侧核查 arda 来函时才后置发现（2026-07-21）。

---

## 1. 分支与发布：主干模式（trunk-based）

**唯一长期分支 = `main`。**

- 短生命特性分支 → PR → **squash 合并 → 删分支**。禁止直接 push `main`。
- CI 跑在 **PR 与 push `main`** 上（不再有 develop/beta 分支 CI）。
- **弃用整套 gitflow**：`develop`/`beta`/`main` 三分支晋升、`branch-promotion.yml`、
  `deploy-production.yml`、`PROMOTION_TOKEN`/`PROMOTION_ACTOR`、Fast-forward Promotion。
- **分支保护 ruleset**（`rebuild/main-ruleset.json` 同款套用）：required status checks（按 job 名匹配）、
  push 前需 PR、禁 force-push、线性历史；单人仓 `required_approving_review_count=0`（靠 checks 把关），
  多人仓改 `1`；**`bypass_actors` 清空（2026-07-28 起）**，含仓库 admin 在内一律不得绕过，PR + required checks
  是唯一入 `main` 通道。
  - **必需 checks 集合权威 = `main-ruleset.json` 的五项**：`quality-gate` / `build` / `test-coverage` /
    `audit` / `gitleaks`（CI job 名必须精确产出这五个 context，改 job 名 = 分支保护失效）。**无单测的产品仓仍须提供
    一个恒绿的 `test-coverage` job**（占住该 context，零测试即通过）——不得从 required 里删该项。
    （`vxture-arda` 现行只有四项、缺 `test-coverage`，属偏差，见其仓整改线。）
  - **matrix 作业必须另配聚合作业承载 context（2026-08-10 起，回应 `vxture-umbra` liaison platform#190）**：
    matrix 只产出 `build (website)` 这类按腿 context，**永远不产出裸 `build`**。把 required check 指向 matrix
    作业，得到的是一个**永不上报**的必需检查——表现为永久 pending 而非失败，所以看起来不像配置错误，
    而是"CI 还没跑完"，分支就此永久不可合。多产物仓的正确形状：matrix 用别的名字（如 `portal-build`），
    再加一个 `needs: [portal-build]` 的空壳作业叫 `build` 承载该 context。任一腿失败时聚合作业被 skip，
    ruleset 视 skip 为未通过，**门禁强度不变**——这与 `quality-gate` 已在用的形状同源。
    参照实现见 `vxture-umbra` `.github/workflows/ci.yml`。
- **落地时机（关键顺序）**：空仓先 `git init`→`main`→首推建立 `main`→跑一次 CI 让 required checks
  至少产生一次→**此时**再 apply ruleset（先加限制性 ruleset 会挡住首次代码导入）。

---

## 2. 敏感信息检查逻辑（secret hygiene）

**铁律：凭证永不入库，只经环境/配置注入。** 泄露即在**源头控制台 revoke**，不靠改历史。

**四层检测，缺一不可：**

1. **GitHub secret scanning + push protection**（仓库 Settings 开启）——推送即拦。**公开仓免费全量启用**
   （私有仓需 GHAS/付费才有 secret scanning），故公开姿态下此层反而更强。
2. **gitleaks CI**（`.github/workflows/secret-scan.yml`）——全量 + PR 增量扫描，命中即 fail 阻断合并；
   直接跑 pinned gitleaks 二进制（org 仓免 license），规则见仓库根 **`.gitleaks.toml`**。
3. **本地 husky pre-commit**（`.husky/pre-commit`）——提交前本地 gitleaks，早拦。
4. **仓库公开（开发阶段默认，owner 2026-07-20 定；不再要求私有）**——不靠私有兜底，故上"凭证永不入库"为
   **绝对铁律**、无例外；一切敏感内容按**已公开**处理，泄露即世界可见，须源头**即刻** revoke。

**重建/迁移专用**：干净树导入前先 gitleaks **全史扫描**，命中即停 → 源头 revoke 泄露凭证 →
干净重导（orphan/丢历史包袱），不把历史里的密钥带进新仓。

**代码里的开源/协议残留**（LICENSE/MIT 标记等）：**公开仓尤须清除误标**——公开仓默认 **all-rights-reserved**，
一个残留的 MIT/开源标记会**真的授出开源权利**（比私有仓风险更高）。是否显式加 LICENSE 由 owner 另定（**公开 ≠ 开源**）。

---

## 3. Secret vs Variable 分类原则

|              | 定义                                    | 例                                                            |
| ------------ | --------------------------------------- | ------------------------------------------------------------- |
| **secret**   | 泄露即危害的**凭证**                    | password / token / 私钥 / passphrase / oauth secret           |
| **variable** | **公开标识/配置**（日志可读、便于排障） | hostname / registry URL / namespace / 公开 site key / ACL tag |

- **不要过度 mask 公开标识**（把 registry host 当 secret 只会妨碍排障，无安全收益）。
- **层级**：
  - **org 级**：跨仓共享的凭证与 host（ACR user/password/registry/internal-host、tailscale oauth、npm token）——**权威层级 = org**：在 org 配一次、share 给选定 repo，单一轮换点、零重复（`vxture-arda` 现配在 repo 级是偏差，见其仓整改线）。
  - **repo 级**：仓库专属公开标识（镜像 `NAMESPACE`、前端公开 `*_SITE_KEY`）。
  - **environment 级**：部署目标 + 审批门（`DEPLOY_HOST_*`/`DEPLOY_USER`/`DEPLOY_SSH_KEY`/`_PASSPHRASE`）。
- 命名 `SCREAMING_SNAKE_CASE`；**定期审计死值/重复**（0 引用的旧凭证及时删，减攻击面）。
- host/username/client-id 等"保守地当 secret"可接受（defense-in-depth），但非必须。

---

## 4. 部署：tag → 环境 CD

**部署只由 tag 触发**，前缀决定环境：

| tag               | 环境              | 门控                        |
| ----------------- | ----------------- | --------------------------- |
| `dev-YYYYMMDD.N`  | develop           | 仅 dev-\*                   |
| `beta-YYYYMMDD.N` | beta              | 仅 beta-\*                  |
| `vX.Y.Z`          | production        | 仅 v\*.\*.\* + **必审人门** |
| `varda-\*`        | varda（自有节奏） | —                           |

> **产品仓默认两档**：新建产品仓的 tag→env 集合默认 `beta-*`→beta、`v*.*.*`→production 两档；`dev-*`→develop
> 与 `varda-*` 是**平台仓特有**行（产品仓不建 develop/varda 环境）。

**CD 流水线拓扑（正典 = 可复用 build workflow）**：`deploy.yml`（tag 触发）经 `workflow_call` 调 `build.yml`
（`needs: call-build` 取 `outputs.image_tag=sha-<short>`）——build 与 deploy 在**同一 run 内有序**，从根上消除竞态、
无需轮询（`vxture-arda` 范本即此；caller 须显式给 `security-events: write` 否则整 run startup-fail）。**踩过的坑（必须规避）：**

- **镜像 tag 一致**：deploy 用 `github.ref_name`（如 `v0.1.0`）拉取；build workflow 的 metadata **必须带
  `type=raw,value=${{ github.ref_name }}`**——semver 模式会把 `v0.1.0` 剥成 `0.1.0`，且
  `dev-*`/`beta-*`/`varda-*` 非 semver 只产出 `sha-`，没有 raw tag 会 **image not found**。
- **build 与 deploy 的时序**：正典用 `workflow_call`（上文）在同一 run 内串起 build→deploy，无竞态。**旧式**分离
  拓扑（独立 tag 触发的 `docker-build.yml` + deploy 轮询）仍可用但需 deploy 过审批门后**轮询等本 tag 的镜像
  构建成功再拉**（需 `actions: read`），否则拉空——新仓一律用 `workflow_call` 正典，避开此坑。
- **registry 与部署主机同区域**：云 ACR 的 **VPC 内网端点按区域隔离**，跨区不可达。ACR 必须建在与部署
  ECS **同 region**（否则内网 login 超时，只能走公网、慢且付费）。
- **内存受限主机（如 2C2G）逐服务替换**：整栈一次性 `compose pull + up -d`（尤其容器改名→全量重建）会
  打爆内存、拖垮 tailnet。改为**逐服务 pull + `up -d --no-deps`**（停旧起新内存 1:1）。
- **生产写走人工审批门**：生产部署/DB 写由 owner 在 GitHub 环境 **Review deployments 点击批准**，
  不靠 agent/口头授权自审。

**第三方 action 钉版（2026-08-10 起，回应 `vxture-atlas` liaison platform#188）**：本规范 §9 已因供应链
顾虑拒用第三方 SCA action、改跑 pinned 二进制，但同一顾虑此前没有落到**握凭证的** action 上——那才是
爆炸半径最大的地方。规则：

- **first-party（`actions/*`、`github/*`）用 major tag 即可**：与 runner 同一信任根，钉 SHA 收益甚微、噪声不小。
- **第三方一律钉完整 commit SHA**，尾随 `# vX.Y.Z` 注释标明版本。Dependabot 原生支持 SHA pin 的更新并会
  同步改注释，维护成本≈0（"钉 SHA 会破坏 dependabot 流"是常见误解，不成立）。
- **按爆炸半径排序整改，不按字母**：持有 SSH 私钥/passphrase 的最先，其次 tailnet OAuth，再次 registry
  凭证，最后只读 token 的扫描器。可变 tag 意味着上游一次账号失陷即可把 tag 移到恶意提交上，而**你的
  生产私钥正作为输入递给它**。
- **能删就别钉**：凡涉及凭证的第三方 action，优先换成"复合动作 + 原生命令"（见下方交付构件里的原生
  `ssh`/`rsync` 条）。钉 SHA 只是缩小窗口，移除才是关闭窗口。

**稳健 CD 构件（`vxture-arda` 范本，新仓/迁入照此搭，别现搓）：**

- **复用复合动作 `.github/actions/tailnet-ssh-connect`**：一处封装 tailnet join + 写部署私钥/known_hosts，
  deploy/rollback/seed 等所有 SSH 工作流共用（连接逻辑改一处即全改，不散落各 workflow）。
- **`tailscale/github-action@v4` + `ping: <deploy-host>`**：加入 tailnet 后**探到直连再继续**，SSH 前
  快速失败而非静默超时。（`@v3` 的 SHA256SUM 下载步无 retry，`pkgs.tailscale.com` 一次 5xx 即整步挂——
  若暂用 v3，按本仓 build 段 `continue-on-error`+retry idiom 加 3 次退避兜住瞬时降级。探其是否恢复用
  **服务端 fetch**，不受本机网络/GFW 影响。）
- **原生 `ssh -i ~/.ssh/deploy_key` / `rsync -az --delete`（带 staging 目录）**做交付，不用未 pin 的第三方
  ssh/scp action；staging 让 `--delete` 原子、不会中途留下半套 compose/config。
- **拉不可变 `sha-<short>` tag**（确定性、可精确回滚），而非可变 release tag。
- **`docker login` 带 `timeout` + 多端点 fallback，主源按主机 profile（§5）定、非单一固定序**：Aliyun-VPC
  同区主机 = 内网 ACR 主源 → 公网 ACR → GHCR 兜底；**非 VPC 主机**（worker-02、海外 worker-04）= GHCR 主源 →
  公网 ACR 兜底（内网 ACR 端点不可达）。`IMAGE_REGISTRY`/`FALLBACK_IMAGE_REGISTRY` 按主机置。
- **bootstrap `.env`**：host 无 `<stack_root>/etc/.env` 则从环境 secret base64 推入 + `chmod 600`，
  **已存在则不覆盖**（本机长驻 `.env`/secret/证书不被 CI 冲掉）。
- **VERSION 溯源 + 交付校验**：部署 SHA 写 host `VERSION` 文件；`grep` 落地 compose 的关键服务名，
  catch 陈旧 compose 交付回归。
- **stack_root 约定** = `/srv/md0/<product>`（数据盘阵列；beta 可 `/srv/md1/<product>-beta`）。

> 内存受限主机（2C2G）另按§上"逐服务 recreate"；数据盘充裕的独立业务箱可整栈 `pull+up -d`（arda/varda 于 worker-02）。

---

## 5. 镜像仓库 profile（双仓按地理）

- **domestic（ACR 内网 + tailnet）**：境内部署机（platform→worker-01、varda→worker-02）。CI runner
  入 tailnet 走内网到主机 + ACR 同区内网拉镜像。
- **overseas（GHCR + 公网）**：海外部署机（umbra→worker-04，**不在 tailnet**）。去掉 tailscale join、
  镜像换 GHCR、直连公网 SSH。ACR 内网端点对海外主机不适用。

**跨 registry 拷贝必须带退避重试（2026-08-10 起，回应 `vxture-umbra` liaison platform#191）**：双仓要求
配合 `docker buildx imagetools create` 做 GHCR→ACR 拷贝时，GHCR 在并发下会对部分镜像返回
`403 Forbidden / denied`。**这是限流，不是权限问题**——判据是同一次运行里用同一套凭证、同一份 workflow
代码，有的镜像成功有的失败；单纯 `rerun --failed` 即可全过。权限故障不会挑镜像。

- 每次拷贝**独立重试 3 次、指数退避**（如 5s/15s/45s），而不是整个作业重跑——重跑会把已成功的镜像
  再推一遍，放大并发、加剧限流。
- **串行化拷贝循环**，或把并发上限压到 2；`matrix` 并行拷贝正是触发条件。
- 重试耗尽才失败，且错误信息里**写明"疑似 GHCR 限流，非权限"**——照字面读 `403 denied` 会把人送去查
  token 权限，那条路是死的（本仓 `docker-build.yml` 的 buildx setup 与 build+push 已有同款 retry idiom，
  拷贝步照抄即可）。

---

## 6. 环境、密钥与部署 bootstrap（一次性）

**GitHub Environments 是 tag→env CD 的承接点**：每个部署目标一个环境（`develop`/`beta`/`production`/
`<product>`），各自携带本目标的 `DEPLOY_HOST`/`DEPLOY_USER`/`DEPLOY_SSH_KEY`(+可选 `_PASSPHRASE`)/
**`DEPLOY_KNOWN_HOSTS`（必填）**/`DEPLOY_DIR`——同一 deploy job 靠 `environment: <route>` 路由到正确主机。

- **`DEPLOY_KNOWN_HOSTS` 必填**：复合动作 `tailnet-ssh-connect` 对空 known_hosts **fail-closed**（拒绝
  `ssh-keyscan` TOFU 回落，防 MITM），故此键非可选。bootstrap 时从可信网络 `ssh-keyscan -p <port> <host>`
  采集后存入环境 secret。
- **键名权威 = `DEPLOY_DIR`**（`vxture-arda` 实现用 `DEPLOY_REPO_DIR` 是历史偏差，见其仓整改线）。

- **环境保护必须配**：生产/产品环境**加 Required reviewers**——这才是 tag→env 安全的关键；
  **零保护 = tag 一推就直接部署、不停等审批**（varda 首上线教训）。agent 有 repo admin 时**可用
  `gh api --method PUT repos/{o}/{r}/environments/{env}`（body `{"reviewers":[{"type":"User","id":<uid>}]}`）
  配 reviewers**，不必让 owner 点 UI 设置；但**部署本身的 Approve 仍是 owner 手点**（[[feedback_production_approval_gate]]，agent 只触发不自审）。
- **`DEPLOY_DIR` 必须是精确的 stack 目录**（含 compose + `.env.*` 的**那一层**）——差一级（如
  `/srv/md0/varda` vs `/srv/md0/varda/deploy`）→ 镜像能拉、但 compose 找不到 env_file 失败（varda 教训）。
  workflow 用 `${DEPLOY_DIR:-<已验证默认>}` 回落。
- **迁仓/新仓：repo/env 级 secrets 不继承**——`DEPLOY_*`（env 级）与 `NAMESPACE`（repo 级）**不会带到新仓**，
  必须在新仓/新环境**重建**（varda "runbook 标已设、实际新仓为空、scp 报 no SSH key" 教训）。**org 级共享凭证
  （ACR/tailscale/npm）在 org 配一次、把新仓加入共享名单即可，不必逐仓重建**（§3 层级）。迁移前先 SSH 目标主机
  核实 stack_root/env 文件/ACR 登录在位。
- **ACR**：`registry`/`namespace` 为 repo `vars.*`（公开标识），`username`/`password` 为 secret；
  **namespace 按实际 ACR 取**（如 `vx-platform`，非想当然的 `vxture`——build/deploy 都从
  `vars.ALIYUN_ACR_NAMESPACE` 读，勿硬编码；错 namespace = pull access denied / repository does not exist）。

**生产 DB 运维走 `db-init.yml`**（workflow_dispatch）：`confirm=yes` + `expected_sha` 钉版本
（防浮动 ref 跑到旧 seed）+ `environment: production` 审批门 + tailnet + `DEPLOY_HOST_TAILNET`。
常规部署链**不跑 migration/seed**，DB 结构/数据变更是独立授权动作。

**已批准维护操作（周期性 DB 维护，第三类，2026-07-28 起，回应 `vxture-atlas` liaison platform#164）**：
db-init 覆盖"结构设计变更"（每次人工 `confirm`+审批），常规部署链覆盖"应用行为"，两者之间还有
第三类——**结构不变、幂等、按时钟而非按人的主动性触发**的维护操作（分区滚动、过期分区清理、
vacuum/analyze）。强套 db-init 的"每次人工审批"，实际后果是"半年一次的手动提醒"：忘记即静默
失效（分区滚动没跟上 → 写入落入 `DEFAULT` 分区，不报错，只是保留策略悄悄失效）——这正是
`vxture-atlas`（`reqlog` 月分区）实测撞到的情况。

- **批准粒度下沉到操作集合，而非每次执行**：维护函数作为具名幂等 SQL 函数落
  `deploy/database/ddl/incr/*`（仍在 DDL 单一权威范围内），**批准发生在合入 main 的 PR review**——
  这一步就是 db-init 审批的等价物；一旦合入，函数即进入白名单，后续执行不再需要人逐次按审批键。
- **执行通道 = `db-maintenance.yml`**（复用 db-init 已有的 tailnet + `DEPLOY_HOST_TAILNET` 连接机制，
  不新开通道）：定时触发（cron，按维护周期，如月度）+ 支持 `workflow_dispatch` 手动补跑；
  **只能调用白名单里的具名函数**（workflow 输入是函数名枚举，不接受任意 SQL 文本或自由参数）——
  这是与 db-init 的关键区别：db-init 执行"这次人批准的这段 SQL"，db-maintenance 执行"早就批准过的、
  参数固定的函数"。
- **必须留痕**：每次执行写审计记录（同 db-init 审计模式：谁/何时/跑了哪个函数/结果），失败必须
  可观测（如 `vxture-atlas` TD-018 的 `/readyz` 剩余 runway 探针模式，让维护节奏靠信号驱动而非记忆）。
- **适用边界**：仅限结构不变的幂等运维（分区滚动/过期清理/vacuum/analyze 类）；任何改表结构、
  加列、改约束的操作，即使"看起来常规"，仍必须走 db-init——结构设计变更的审批门不能被这条新
  通道绕过。

---

## 7. 数据层（若仓库自带独立 DB）

- **DDL 单一权威** = 手写 `deploy/database/ddl/*.sql`（`apply.sh` clean-baseline，非 prisma migrate）。
- **值域权威** = `@vxture/shared`；guardrail 校 DDL CHECK == @shared（新增可写列/值须同步）。
- **最小权限服务角色** + **列锁**（`98_column_locks`：REVOKE 整表 UPDATE + GRANT 可写列白名单，锚点列
  id/单号锁死）；**新增可写列必须同步白名单**，否则服务写会 permission denied。
- **活库增量**：`ddl/apply` 是 create-once（不 ALTER 已存在表），增量列用幂等
  `ADD COLUMN IF NOT EXISTS` 内嵌 seed，让 db-init `seed` 在活库自足；`docker exec` 改库须带 `-i`。

---

## 8. 护栏（guardrails，CI 强制）

按仓库形态启用：design-system、data-architecture（DDL 铁律）、catalog-domains（DDL==@shared）、
seed 幂等、package boundaries、container-healthcheck（Next standalone 须 `0.0.0.0`）、secret-scan、
env-audit（部署包/运行态模板契约）。护栏是**仓库级**，本地 `pnpm lint` 不一定覆盖——新增 CSS/DDL/seed
必跑对应 guardrail。

---

## 9. 依赖安全（SCA 漏洞门）

**CI `audit` job = osv-scanner 硬阻断门**，扫 `pnpm-lock.yaml` 全依赖树 vs OSV 漏洞库，是 `main` 的
required status check（发现新漏洞即 fail 拦合并）。

- **用 pinned 二进制**（照 gitleaks 模式下 `osv-scanner_linux_amd64`，`OSV_SCANNER_VERSION` 单点升级），
  不用第三方 action（免 license/供应链顾虑）。**取代** npm quick-audit（端点已下线，HTTP 410 假绿）。
- **命令必须带 `--config=.osv-scanner.toml`**——扫 `--lockfile` 时 osv-scanner **不自动发现**根 config，
  漏了 `--config` 忽略清单不生效。
- **整顿方法（清基线）**：先按 finding 查 OSV 修复版 vs npm latest 分类 →
  - **直接依赖**：抬 `package.json` caret floor 到修复版（诚实声明安全下限）。
  - **纯传递依赖**：根 `pnpm.overrides`；跨多 major 用 `pkg@1`/`pkg@5` 选择器分别定。
  - **peer-only 依赖**：caret override 会被 pnpm **静默忽略**（反报自己 override unmet），须**精确版 pin**。
- **残留忽略**（不可修 / 强升有害）：`.osv-scanner.toml` 用 **`[[PackageOverrides]]` 按 name+version 精确
  `ignore=true` + `reason`**，**不用** `[[IgnoredVulns]]` 按 GHSA 全局忽略（会伏掉其它版本的同 CVE 回归）。
  典型残留 = dev-server-only 传递漏洞（不进生产、强升破坏上游）。
- **新漏洞政策**：**修**（升级 / override）或 **带 reason 的 PackageOverrides 记名接受**，
  **绝不放宽此门**（不加 `continue-on-error`、不从 required 移除）。

---

## 10. 仓库骨架与文档分类（全栈产品仓模板）

新建 / 迁入产品仓照 `vxture-arda`（+`vxture-karda`）骨架，避免每仓现搓：

- **根配置**：`.editorconfig` · `.gitattributes` · `.npmrc` · `.gitignore` · `.gitleaks.toml` ·
  `.env.example` · `CLAUDE.md`（AI 协作纲领）· `README.md` · `docker-compose.yml`。
- **目录**：`.github/`（`workflows/` + `actions/` 复合动作）· `configs/` · `deploy/`
  （compose / scripts / database / nginx / worker-NN…）· `docs/` · `scripts/` + 产品源码目录
  （`portals/` / `services/` / `agent-server/` 等按形态）。
- **`docs/` 编号分类**（详见 [`docs-taxonomy.md`](./070-docs-taxonomy.md)，跨仓一致）——顶层十进制分段：
  `00-meta` · **`10-standards`**（全栈规范，基础层居首）· `20-specs` · `30-design` ·
  `40-implementation` · `50-deployment` · `60-operations` · `70-workplan` · `80-liaison` · `90-memory`。
- **元规则（铁律）**：**编号 = 正式文件（永久）；无编号 = 临时（定位即待删），概莫能外**（连 `00-index` 也不破例）。
  **编号预留空位、不连续**（目录=十位段、文件=十位跳、域文档=百位段内十位跳）；类型寄存器 `ADR-`/`TD-` append-only 保号。
  由 `lint:docs-numbering` 护栏强制。
- **域文档命名** `{kind}_{domain}_{NNN}_{slug}`（`kind`∈data/design/ops，`NNN` 段义 1xx 架构/2xx schema/3xx 实施）；
  **域码用全词**（platform/identity/commerce/…，见 taxonomy §5）。
- **跨仓联络渠道（2026-07-27 起，`80-liaison` 停止新增文件）**：产品仓之间的对接沟通（回函/约定/
  同步/请求）改用 **GitHub Issues**，不再新建 `80-liaison/NN-YYMMDDHHmm-slug.md`——md 信件这条渠道
  有两个实测过的真实缺陷：①一封信寄错仓，没有轻量纠正手段，只能再写一封信道歉重发；
  ②信件写完但"暂存本仓未正式发出"没有强制状态，容易在草稿态卡住导致对方基于过期假设行动
  （均是本仓与 karda/atlas 对接过程中的真实事故，非假设风险）。GitHub Issues 原生解决这两点：
  寄错仓可直接 **transfer** 到正确仓库（同组织内）；开出即时可见，无"草稿未发"的中间态；
  **close/reopen** 天然对应"回函收尾/重新打开"，取代信件里手写"某函已闭环"的做法。
  **创建原则：需要哪个仓库修改/回应，issue 就开在哪个仓库内**（不是发起方仓库,是承接需求、需要
  动手的那一方——例如 karda 需要 atlas 改端点,issue 开在 `vxture-atlas`,不开在发起需求的
  `vxture-karda`）；统一打 `liaison` 标签,与该仓其它 issue（bug/feature）区分；跨仓引用用
  GitHub 原生 `org/repo#N` 语法，不再发明文件编号地址。**既有 `80-liaison/*.md` 保留作历史归档,
  不追溯迁移、不删除,按各仓节奏陆续退役（不再新增,存量自然沉淀为历史记录）**；本条对遵循本标准
  的所有产品仓同样适用（不是本仓专属约定）。

---

## 11. 整顿检查清单

- [ ] `main` 唯一长期分支；gitflow 三分支 / 晋升 / `PROMOTION_*` / `deploy-production.yml` 已清。
- [ ] `main-ruleset` 已 apply（required checks + push 前 PR + 禁 force-push + 线性历史）。
- [ ] `docker-build`/`deploy` = tag→env；raw tag、wait-for-build、registry 同区、逐服务 recreate 全到位。
- [ ] **稳健 CD 构件**：`tailnet-ssh-connect` 复合动作 · `@v4+ping`（或 v3+retry 退避）· 原生 ssh+rsync staging ·
      拉 sha-tag · login 多端点 fallback · bootstrap `.env` · VERSION 溯源。
- [ ] 敏感信息四层检测（push protection + gitleaks CI + pre-commit + `.gitleaks.toml`）就位；**仓公开（开发阶段）**；无误标开源残留。
- [ ] 依赖 SCA 门：`audit` = osv-scanner（pinned 二进制 + `--config`）硬阻断 + required；基线已 triage 清零，残留经 `.osv-scanner.toml` 逐版本记名接受。
- [ ] secret/variable **分类正确**、**层级正确**（org/repo/env）、无死值/重复。
- [ ] 跨仓联络：新对接沟通走 GitHub Issues（`liaison` 标签），不再新建 `80-liaison/*.md`；既有信件保留归档不删除。
- [ ] **每部署目标一个 Environment**，各带 `DEPLOY_*` 且 **`DEPLOY_DIR` 精确**；生产/产品环境 **Required reviewers 已配**。
- [ ] **迁仓已在新仓重建全部 secrets**（不继承）；ACR `namespace` 从 `vars` 取（非硬编码）；迁移前 SSH 核实目标主机 stack_root/env/ACR 登录在位。
- [ ] 生产 DB 走 `db-init` + `expected_sha` + 审批；常规部署链不跑 migration/seed。
- [ ] （有分区表等周期性维护需求）走 `db-maintenance.yml` 白名单函数，不是裸等人工提醒；
      失败/临近过期需可观测（如 `/readyz` 报剩余 runway）。
- [ ] （有 DB）DDL 单一权威 + @shared 值域 + 最小权限/列锁 + 活库增量幂等 + 护栏。
- [ ] 部署 profile 选对（domestic ACR+tailnet / overseas GHCR+公网）。
- [ ] **仓库骨架 + `docs/` 编号分类**对齐模板。
- [ ] **无静默标准偏离**：暂不可满足的条款均已三步登记（实现处标注 + TD 记名 + 回报平台），且带回收条件。
