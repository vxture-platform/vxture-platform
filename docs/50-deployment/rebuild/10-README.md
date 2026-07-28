# 重建 runbook：gitflow → main 主干 + tag 触发 CD（org 级模板）

> 适用：vxture-platform 首先落地；Arda / Umbra 后续套同一模板（三者当前都是 gitflow）。
> **vxture-platform 已按本模板落地（2026-07-15），是参照实现**——`deploy.yml` 模板已"毕业"为运行态
> `.github/workflows/deploy.yml`（并按 [`../standards/repo-governance-standard.md`](../../10-standards/140-repo-governance-standard.md)
> 加固：raw image tag / deploy 等 docker-build / registry 同区 / 逐服务重建），其它仓从 vxture-platform 拷贝。
> `main-ruleset.json` 仍是模板，待**首次导入代码之后**再 apply（见 §4 落地时机）。

## 1. 分支/发布模型（trunk-based）

- 唯一长期分支 `main`；短生命特性分支 → PR → squash 合并。
- CI 跑在 PR 与 push main 上。
- **部署只由 tag 触发**，前缀决定环境（环境与 tag 策略已在 vxture-platform 配好）：

| tag 形态          | 环境         | 门控                             |
| ----------------- | ------------ | -------------------------------- |
| `dev-YYYYMMDD.N`  | `develop`    | 仅 `dev-*` tag 可部署            |
| `beta-YYYYMMDD.N` | `beta`       | 仅 `beta-*` tag 可部署           |
| `vX.Y.Z`          | `production` | 仅 `v*.*.*` tag + **必需审批人** |

- 弃用 gitflow 全套：`develop`/`beta`/`main` 三分支、`branch-promotion.yml`、`PROMOTION_TOKEN`/`PROMOTION_ACTOR`、`deploy-production.yml`（改由本 tag→env 流替代）。

## 2. 凭证引用图（新 workflow 只引用这些规范名）

**org 级（共享，可见性保持 `all` —— 各仓库陆续开发，按需自然纳入，不收紧）**

- 变量：`vars.ALIYUN_ACR_REGISTRY`、`vars.ALIYUN_ACR_NAMESPACE`、`vars.TAILSCALE_OAUTH_CLIENT_TAG`（=`tag:promotion`）、`vars.VXTURE_NPM_REGISTRY`
- 密钥：`secrets.ALIYUN_ACR_USERNAME`、`secrets.ALIYUN_ACR_PASSWORD`、`secrets.ALIYUN_ACR_INTERNAL_HOST`（内网 VPC 拉取端点，可选、缺省回退公网）、`secrets.SONAR_TOKEN`、`secrets.TAILSCALE_OAUTH_CLIENT_ID`、`secrets.TAILSCALE_OAUTH_CLIENT_SECRET`、`secrets.TAILSCALE_AUTHKEY`、`secrets.NODE_AUTH_TOKEN`

**环境级（develop / beta / production 各一份）**

- 密钥：`secrets.DEPLOY_HOST`、`secrets.DEPLOY_USER`、`secrets.DEPLOY_SSH_KEY`、`secrets.DEPLOY_SSH_PASSPHRASE`
- 变量：`vars.CF_TURNSTILE_ADMIN_SITE_KEY`、`vars.CF_TURNSTILE_TENANT_SITE_KEY`（前端 site key，公开）

> `SONAR_TOKEN`、`ALIYUN_ACR_INTERNAL_HOST` 已录 org（2026-07-14，secret / visibility all）。org 共享凭证集齐。

**镜像仓库 = 按部署地理双仓**（owner 澄清 2026-07-14）：

- **ACR = 主** —— domestic / tailnet 栈（platform→worker-01、varda→worker-02、多数产品），内网 ACR。vxture-platform 的 deploy.yml 即此。
- **GHCR = umbra 专用** —— umbra 部署机在**海外**（worker-04/Vultr，**不在 tailnet**），用全球可达 GHCR（Aliyun ACR 对海外主机不合适）。`DEPLOY_GHCR_TOKEN/USERNAME` **保留**，仅 umbra 域内用（非 org 共享）。

**凭证方针**（owner 决 2026-07-14）：不迁旧密钥值，按需重给；泄露过的凭证（Anthropic key、两套钉钉）在**源头控制台 revoke**（我无接入），需要时再签发新值。

**弃用命名**：`TS_OAUTH_*`（→ 用 org `TAILSCALE_OAUTH_*`）、`VX_WORKER_01_*`（→ 并入环境级 `DEPLOY_*`，环境即区分维度）、`PROMOTION_*`。

## 3. 文件改动清单（重建时）

| 动作        | 文件                                                                                                        | 说明                                                                                |
| ----------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 拷贝        | 从 vxture-platform `.github/workflows/deploy.yml`（参照实现，已加固）复制                                   | tag→env 部署（模板已毕业为运行态，不再放 docs/50-deployment/rebuild/workflows/）    |
| 保留+改触发 | `.github/workflows/ci.yml`                                                                                  | 触发改为 `pull_request: [main]` + `push: [main]`，去掉 develop/beta                 |
| 保留+改触发 | `.github/workflows/docker-build.yml`                                                                        | 触发改为 `push: tags: [dev-*, beta-*, v*.*.*]`，镜像 tag = `${{ github.ref_name }}` |
| 保留        | `.github/workflows/secret-scan.yml`                                                                         | 已就位，无需改                                                                      |
| 删除        | `branch-promotion.yml`、`deploy-production.yml`、`pr-checks.yml` 里的 `enforce-branch-flow`（gitflow 校验） | 主干无晋升/分支流                                                                   |

## 4. 落地时机（关键：ruleset 不能先加）

空仓直接加限制性 ruleset 会**挡住首次代码导入**（要求 PR 但无 base 分支）。正确顺序：

1. 清理后的干净树 `git init` → `git branch -M main` → 首推 vxture-platform（建立 `main`）。
2. 首推后跑一次 CI，让 `quality-gate/build/test-coverage/audit/gitleaks` 等 check 至少产生一次（ruleset 的 required checks 按名匹配，产生过更稳）。
3. **此时**再 apply `main-ruleset.json`：
   ```bash
   gh api -X POST repos/vxture/vxture-platform/rulesets --input docs/50-deployment/rebuild/main-ruleset.json
   ```
4. 环境级密钥按 §2 注入（develop/beta 先行，production 转 private 后再录）。
5. 打 `dev-*` tag 验证 develop 部署链路 → `beta-*` → 最后 `v*.*.*` 走生产审批。

## 5. org 级复用（两套部署 profile）

`main-ruleset.json` 三仓同款套用；`deploy.yml` 分两套 profile：

- **domestic profile（ACR + tailnet）** —— vxture-platform、Arda：直接套用本模板（ACR 拉镜像 + tailscale join + 内网 SSH），差异只在环境级 `DEPLOY_*`（各自部署机）与前端 site key。
- **overseas profile（GHCR + 公网）** —— **Umbra**（worker-04，不在 tailnet）：**去掉 tailscale join 步骤**、镜像换 **GHCR**（`DEPLOY_GHCR_*`）、直连公网 SSH。

org 级共享凭证（ACR/tailscale/npm）按需共用无需重录；GHCR 凭证仅 umbra。迁移各仓库同样遵守 §4 时机。

## 6. 开放决策（模板里已留默认值/TODO）

- ruleset 的 `required_approving_review_count`：vxture-platform 单人 = `0`（自审自合，靠 checks 把关）；Arda/Umbra 若多人改 `1`。
- ~~`bypass_actors`：默认给仓库 admin 紧急 bypass，防单人自锁~~ **已定（2026-07-28 收紧）**：`bypass_actors` 清空，admin 无条件绕过撤销，一律走 PR + required checks，不留自锁应急口子。
- ~~GHCR vs ACR~~ **已定**：ACR 主（domestic/tailnet）+ GHCR 专供 umbra（海外），双仓按地理分（§2/§5）。
- ~~varda 归属~~ **已定**：varda 收敛进 vxture-platform，不单独建仓（见 §7）。

## 7. varda 归属与部署（owner 决 2026-07-14，含架构判定）

**判定：横向内嵌助手 = 共享（varda 一份，收敛进 vxture-platform）；纵向行业智能体 = 各自独立产品仓库（vx-Agent-\*）。不按产品复制 varda。**

- varda 是**平台级内嵌助手**（三段式，per 产品经权益开关放开，如 arda 的 `varda.enabled/readonly`），与平台的身份/权益/console 外壳/@vxture 核心包深耦合 → 归 vxture-platform，不单独建仓（跨仓契约成本 > 独立收益）。
- 需要"专属智能体"的场景由既有 **vx-Agent-\***（Anlan/Forge/Raven/XuanZhen）承接——那是"智能体即产品"的独立纵向应用，各自建仓。
- 部署：varda 目标机 = worker-02，与平台（worker-01）不同 → 在 vxture-platform 内走**独立 `varda` 环境 + `varda-*` tag**（自有发布节奏，不被平台整体发布拖累）；`VARDA_DEPLOY_*` 落该环境的环境级密钥。deploy.yml 的 tag→env case 增加 `varda-*) env=varda`。
