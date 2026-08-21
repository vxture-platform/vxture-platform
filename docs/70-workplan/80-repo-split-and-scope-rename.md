# 拆仓 + 作用域改名 + 新仓配置分层（2026-08-21 立项）

> owner 2026-08-21 裁定：**改名**（`@vxture/shared` → `@vxture-platform/shared`）、**拆仓**（设计三包留旧仓独立开发）、**新仓 secrets/environments 已配**（名称由 owner 调整过）。
> 本文是这三件事的整体分析与任务规划。**先立分层判据，再逐项裁定，最后排任务。**

---

## 0. 先立分层判据

后面所有裁定都从这三条推出来，不逐条重复理由。

**判据一：secret 还是 variable，看「泄露是否有害」，不看「重不重要」。**
ACR 命名空间、证书域名、Turnstile **site** key（本就发给浏览器）都是公开值 →
variable。SSH 私钥、ACR 口令、DNS API token → secret。
把非机密值放进 secret 的代价不是"更安全"，是**日志里被打码、排障时看不见**。

**判据二：放哪一层，看「变化的边界」。**

| 层         | 判据                                 | 例                                                            |
| ---------- | ------------------------------------ | ------------------------------------------------------------- |
| **组织层** | 跨仓共享、与具体仓无关               | ACR 凭据、Sonar token、Tailscale OAuth、GitHub Packages token |
| **仓库层** | 该仓特有、与部署环境无关             | ACR namespace、Turnstile site key、证书域名、`ADMIN_BASE_URL` |
| **环境层** | 随环境（production/beta/…）而变      | 部署主机、SSH 凭据、部署路径                                  |
| **代码层** | 非敏感且单环境固定，改了要走 PR 评审 | compose 里的公网域名                                          |

**判据三：零引用的凭据是负债，不是备份。** 它不会让任何东西更能跑，只会扩大
泄露面，且在轮换清单里制造噪音。仓内已有技术债条目记着这件事
（`docs/60-operations/10-tech-debt.md` §926，本文的清理动作可结清它）。

---

## 1. 现状盘点（已实测，非推断）

### 1.1 两个组织的供给不对称

|                  | `vxture`（旧）                                                                                  | `vxture-platform`（新） |
| ---------------- | ----------------------------------------------------------------------------------------------- | ----------------------- |
| 组织层 secrets   | **12 个**（ACR ×2、Sonar、Tailscale ×3、`NODE_AUTH_TOKEN`、`DEPLOY_WORKER02_*` ×6）             | **0**                   |
| 组织层 variables | **4 个**（ACR_REGISTRY / ACR_INTERNAL_HOST / TAILSCALE_OAUTH_CLIENT_TAG / VXTURE_NPM_REGISTRY） | **0**                   |
| 仓库层 secrets   | 1（CLOUDFLARE_DNS_API_TOKEN）                                                                   | 7                       |
| 仓库层 variables | 7                                                                                               | 10                      |
| environments     | production / beta / develop / varda                                                             | production              |

**旧仓一直靠组织层供给**——这是它的 workflow 能跑而 repo 层几乎为空的原因。
新组织层是空的，你把全部配到了仓库层。**现在能跑，但把跨仓共享项钉死在了单仓**。

### 1.2 workflow 实际引用（唯一权威）

`secrets.*` 11 个 · `vars.*` 12 个。逐项比对结果见 §2。

---

## 2. 问题（1）：是否都需要

### 2.1 会直接导致失败的两项

| 项                                         | 判定                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **缺 `vars.TAILSCALE_OAUTH_CLIENT_TAG`**   | **阻断**。`deploy.yml:102` 把它传给 tailscale action 的 `tags`；OAuth 客户端**必须**带 tag，为空则入不了 tailnet → SSH 连不上 → 部署失败。旧仓在组织层有（`tag:promotion`），新组织没有。                                                                                                                                  |
| **4 个部署 secret 名字与 workflow 不一致** | **阻断**。workflow 取 `DEPLOY_HOST_TAILNET` / `DEPLOY_USER` / `DEPLOY_SSH_KEY` / `DEPLOY_SSH_PASSPHRASE`；新仓叫 `DEPLOY_HOST_TAILNET_IP` / `DEPLOY_HOST_USER` / `DEPLOY_HOST_SSH_KEY` / `DEPLOY_HOST_SSH_KEY_PASSPHRASE`。**取不到的 secret 在 GitHub Actions 里是空串，不是报错**——表现为 SSH 连接失败，而不是"缺配置"。 |

新名字**更好**（统一 `DEPLOY_HOST_*` 前缀、`SSH_KEY_PASSPHRASE` 比 `SSH_PASSPHRASE` 准确），
所以**改 workflow 对齐新名，不要把 secret 改回旧名**。

### 2.2 分层错位一项

| 项                                  | 判定                                                                                                                                                                                                      |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **environment secret `DEPLOY_DIR`** | **删**。它与同环境的 variable `DEPLOY_DIR` 同名重复，而 workflow 取的是 `vars.DEPLOY_DIR`（`deploy.yml:131`）——那个 secret 从未被读到。部署路径不是机密（判据一），放 secret 只会让排障时看不见真实路径。 |

### 2.3 目前零引用，但**不该删**的两项

| 项                              | 判定                                                                                                                                                                                                                             |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `secrets.NODE_AUTH_TOKEN`       | **保留并接线**。当前 `secrets.NODE_AUTH_TOKEN` 在 workflow 里零引用（publish 流水线用的是 `secrets.GITHUB_TOKEN`）。但**拆仓后它是必需品**：门户要从 GitHub Packages 装 `@vxture/design-*`。你提前建了是对的，缺的是 §4 的接线。 |
| `secrets.DEPLOY_HOST_PUBLIC_IP` | **保留**。旧仓 `deploy.yml:8` 明确写着「留作手工运维兜底，CI 不用」。属于有意的零引用，应在文档里标注而不是清掉。                                                                                                                |

### 2.4 需要你确认的两项

| 项                               | 要确认什么                                                                                                                                           |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `secrets.DEPLOY_HOST_PORT`       | 当前 workflow **不传 port**，ssh action 默认 22。**如果你把 SSH 端口改了，不接线就连不上**；如果仍是 22，这一项是冗余的。→ 需要你回答端口是不是 22。 |
| `secrets.DEPLOY_HOST_PRIVATE_IP` | 当前零引用。部署走 tailnet IP。这一项是为 VPC 内网路径预留，还是可以删？                                                                             |

### 2.5 可以删的一项

| 项                            | 判定                                                               |
| ----------------------------- | ------------------------------------------------------------------ |
| `vars.IMAGE_PRIMARY_REGISTRY` | **仓内零引用**（全仓检索无命中）。要么删，要么说明它的消费方在哪。 |

### 2.6 应当上移到组织层的五项

`ALIYUN_ACR_USERNAME` / `ALIYUN_ACR_PASSWORD` / `TAILSCALE_OAUTH_CLIENT_ID` /
`TAILSCALE_OAUTH_CLIENT_SECRET` / `SONAR_TOKEN`，以及 variable
`ALIYUN_ACR_REGISTRY` / `ALIYUN_ACR_INTERNAL_HOST` / `TAILSCALE_OAUTH_CLIENT_TAG`。

理由（判据二）：这些与"哪个仓"无关，只与"哪个组织"有关。留在仓库层的代价在
**第二个仓出现时**才显现——凭据要复制一份，轮换要记得改两处，而漏改的那一处
不会报错，只会在某次部署时安静地失败。`vxture-platform` 组织将来至少还会有
一个仓（若干产品仓已在规划），所以这个成本一定会到。

**这一项不阻断当前部署**，可以排在改名与拆仓之后做。

---

## 3. 问题（2）：仓库里的硬编码

### 3.1 拆仓的真正阻断点：**没有 `.npmrc`，CI 也不配 registry 鉴权**

- 仓根**没有 `.npmrc`**。
- `.github/actions/setup-node-pnpm/action.yml` 只做 `pnpm install --frozen-lockfile`，
  **不配 registry、不配 scope、不注入 token**。
- `deploy/docker/Dockerfile.nestjs` / `Dockerfile.nextjs` 在**镜像内**跑
  `pnpm install --frozen-lockfile`，同样没有任何 registry 鉴权。

今天不炸，是因为 `@vxture/*` 全部是 `workspace:*`，一个都不用从 registry 拉。
**拆仓当天，这三处会同时断**：本地 `pnpm install`、CI、Docker 构建都会去 npmjs
找 `@vxture/design-*` 然后 404。GitHub Packages **即便包是公开的也要求鉴权**，
所以这不是"配个 registry 地址"就完事。

Docker 那处最麻烦：token 必须走 `--mount=type=secret`，**不能用 `ARG`**——ARG 会
留在镜像层历史里。

### 3.2 registry 地址内联，而组织层有个零引用的变量

`publish-design-system.yml:113-114,130` 内联了 `https://npm.pkg.github.com`；
组织层却有个从未被引用的 `vars.VXTURE_NPM_REGISTRY`。二选一：接线，或删掉变量。
（GitHub Packages 的地址是固定端点，内联本身没错——错的是留一个假装可配的变量。）

### 3.3 公网域名硬编码：**可接受，但要有裁定**

`deploy/compose.platform.yml` 有 `https://api.vxture.com` / `https://accounts.vxture.com` /
`https://vxture.com`；`deploy/scripts/40-verify-platform-runtime.sh` 与
`51-check-platform-alerts.sh` 里也有若干 `vxture.com` 路径与证书路径。

按判据一/四：**这些是非敏感、单环境固定值，放在代码层是合理的**——改域名本就该走
PR 评审，而不是在 GitHub 设置页里悄悄改掉。**不建议参数化**，但建议在
`deploy/README` 里写一句"公网域名是代码层常量，改域名 = 改这几个文件"，
免得下一个人以为是漏配。

### 3.4 死凭据（结清技术债 §926）

| 项                                    | 位置                                   | 判定                                                           |
| ------------------------------------- | -------------------------------------- | -------------------------------------------------------------- |
| `TAILSCALE_AUTHKEY`                   | `vxture` 组织，visibility=all          | 全仓零引用（已改用 OAuth client）→ **删**                      |
| `VXTURE_NPM_REGISTRY`                 | `vxture` 组织                          | 零引用 → 删或接线（见 3.2）                                    |
| `PROMOTION_TOKEN` / `PROMOTION_ACTOR` | 技术债条目提到                         | 两组织均已不存在，条目可关闭该项                               |
| `DEPLOY_WORKER02_*`（6 个）           | `vxture` 组织，visibility=**selected** | 本仓零引用。visibility 是 selected，需确认授权给了哪些仓再决定 |

---

## 4. 问题（3）：任务规划

按**依赖顺序**排，不按重要性。每批都能独立验证。

### 批 0 — 让新仓真的能部署（阻断项，最先做）

| #   | 任务                                                                                                                                         | 类型              |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| 0-1 | 新组织补 `vars.TAILSCALE_OAUTH_CLIENT_TAG`（值同旧组织，`tag:promotion`）                                                                    | **owner 配置**    |
| 0-2 | 改 `deploy.yml` 对齐新 secret 名（`DEPLOY_HOST_TAILNET_IP` / `DEPLOY_HOST_USER` / `DEPLOY_HOST_SSH_KEY` / `DEPLOY_HOST_SSH_KEY_PASSPHRASE`） | 代码              |
| 0-3 | 删 production 环境里重复的 **secret** `DEPLOY_DIR`（保留 variable）                                                                          | **owner 配置**    |
| 0-4 | 确认 SSH 端口；非 22 则 `deploy.yml` 增加 `port: ${{ secrets.DEPLOY_HOST_PORT }}`                                                            | **需 owner 回答** |
| 0-5 | 新仓跑一次 `dev-*` tag 部署演练，验证整条链路                                                                                                | 验证              |

> **0-2 有个陷阱**：改完之后 `deploy.yml` 在**旧仓**就跑不通了（旧仓 secret 还是旧名）。
> 所以 0-2 与"发版从哪个仓走"必须同一批切换，不能各改各的。

### 批 1 — `@vxture/shared` → `@vxture-platform/shared`

**为什么是必须而不是可选**：GitHub Packages 要求 **scope 必须等于发包组织**。
shared 归平台、要从新组织发，scope 就必须是 `@vxture-platform`。

**范围**：156 个文件引用它，其中 21 个 `package.json`。

**不改的**：其余 36 个工作区包保持 `@vxture/*`。它们是 `private: true`，
scope 纯属内部命名，不受 registry 约束。全量改名要动上千处引用、换取零功能收益，
且会与拆仓同期进行——两个大改动叠在一起，出问题时分不清是谁的。
（若将来要统一，单独立项，且必须在拆仓稳定之后。）

| #   | 任务                                                                         |
| --- | ---------------------------------------------------------------------------- |
| 1-1 | 包自身改名 + `publishConfig` 保持 `npm.pkg.github.com`                       |
| 1-2 | 21 个 `package.json` 的依赖键改名                                            |
| 1-3 | 156 处 import 改名（可脚本化，但必须全量 type-check 验收）                   |
| 1-4 | `publish-design-system.yml` 的 `RELEASE_ORDER` 与 `.npmrc` scope 行同步      |
| 1-5 | 旧包 `@vxture/shared` 在 registry 上**保留不删**（消费方 lockfile 会指向它） |

### 批 2 — 拆仓前置：registry 鉴权（**拆仓前必须全绿**）

| #   | 任务                                                                                                                                                      |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2-1 | 仓根加 `.npmrc`：`@vxture:registry=` + `//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}`                                                              |
| 2-2 | `setup-node-pnpm` 注入 `NODE_AUTH_TOKEN`（组织层 secret）                                                                                                 |
| 2-3 | `Dockerfile.nextjs` / `Dockerfile.nestjs` 用 `--mount=type=secret` 传 token，**禁止 ARG**                                                                 |
| 2-4 | `docker-build.yml` 传递该 build secret                                                                                                                    |
| 2-5 | **验证方式**：在拆仓**之前**，先把设计三包从 `workspace:*` 改成 registry 版本号跑一遍 CI + docker-build。绿了才动拆仓——这样鉴权问题与拆仓问题不会缠在一起 |

### 批 3 — 拆仓执行

搬迁清单已在
[`70-design-system-phase-closeout.md`](./70-design-system-phase-closeout.md) §3 逐条列出
（私有的 design-preview、7 个守卫脚本 + 2 个基线 JSON、11 个 token 管线文件、
9 条 pnpm script、发布流水线、5 份规范文档）。本文不重复。

| #   | 任务                                                                                                         |
| --- | ------------------------------------------------------------------------------------------------------------ |
| 3-1 | 旧仓瘦身为 design 仓（按上述清单保留，其余删）                                                               |
| 3-2 | 新仓删除 `packages/design/*`，改为 registry 依赖                                                             |
| 3-3 | `packages/platform/browser` 对 `@vxture/design-tokens` 的直接依赖改为 registry 依赖                          |
| 3-4 | 旧仓的 issue 台账处置：跨仓联络 issue（atlas/runos/yucer/arda 那 20 余条）**与设计无关**，需迁到新仓或另立仓 |

> **3-4 容易漏**：旧仓现有 20 余条未关的跨仓联络 issue，它们属于平台不属于设计。
> 拆仓时若不处置，它们会留在一个即将变成 design 仓的地方。

### 批 4 — 分层归位与死凭据清理（不阻断，最后做）

| #   | 任务                                                                    |
| --- | ----------------------------------------------------------------------- |
| 4-1 | 5 个 secret + 3 个 variable 从新仓仓库层上移到 `vxture-platform` 组织层 |
| 4-2 | 删 `vars.IMAGE_PRIMARY_REGISTRY`（零引用），或说明消费方                |
| 4-3 | 删旧组织的 `TAILSCALE_AUTHKEY`；`VXTURE_NPM_REGISTRY` 接线或删          |
| 4-4 | 确认 `DEPLOY_WORKER02_*` 的授权仓后处置                                 |
| 4-5 | `deploy/README` 补一句：公网域名是代码层常量                            |
| 4-6 | 结清技术债 §926                                                         |

---

## 5. 需要 owner 回答的三件

1. **SSH 端口是不是 22**（决定 0-4 做不做）
2. **`DEPLOY_HOST_PRIVATE_IP` 是预留还是可删**
3. **`DEPLOY_WORKER02_*` 授权给了哪些仓**（决定 4-4）

另有一件需要裁定：**批 3-4 的跨仓联络 issue 往哪儿放**——迁到新仓，还是就地关闭并在新仓重开。
