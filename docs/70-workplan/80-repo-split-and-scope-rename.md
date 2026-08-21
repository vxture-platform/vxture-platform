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

### 2.4 已确认（owner 2026-08-21）

| 项                               | 结论                                                                                                                                                            |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `secrets.DEPLOY_HOST_PORT`       | **SSH 仍是 22**，ssh-action 默认即 22 → **不接线**。保留该 secret 以备改端口，已在 `deploy.yml` 抬头注明"改端口时在此处补 `port:` 并同步 db-init/cert/alerts"。 |
| `secrets.DEPLOY_HOST_PRIVATE_IP` | **保留**——Aliyun VPC 内网地址，为后续内网路径预留。同样已在抬头注明。                                                                                           |
| environment secret `DEPLOY_DIR`  | **owner 已清理**，保留 variable。§2.2 的裁定已执行。                                                                                                            |
| `DEPLOY_WORKER02_*`（旧组织）    | **后置**，本轮不动。                                                                                                                                            |

### 2.5 可以删的一项

| 项                            | 判定                                                               |
| ----------------------------- | ------------------------------------------------------------------ |
| `vars.IMAGE_PRIMARY_REGISTRY` | **仓内零引用**（全仓检索无命中）。要么删，要么说明它的消费方在哪。 |

### 2.6 组织层归位：**在 free 版 + 私有仓下不可行**（本节修正了初稿的判定）

初稿据 `docs/30-design/product_240_repo-template.md` §6#17 的已裁结论
（"共享凭证属 **org 级**"）判定新仓全配在仓库层是偏离、应当上移。**这个判定错了。**

owner 指出后实测：

|                                         | 可见性      | 组织计划 |
| --------------------------------------- | ----------- | -------- |
| `vxture/vxture-platform`（旧）          | **public**  | free     |
| `vxture-platform/vxture-platform`（新） | **private** | free     |

**GitHub free 版的组织级 secrets / variables 只能供给公开仓。** 旧仓一直能靠组织层
（12 secrets + 4 vars）拿到凭据，正是因为它是公开的——`vxture` 组织下除一个 demo 外
全是公开仓。新仓是私有的，**读不到组织层的任何东西**。

所以：**新仓把共享凭证配在仓库层不是偏离，是唯一可行解。**

**§6#17 有一条没写出来的前置条件**：它成立于"公开仓 或 付费计划"。`vxture-arda`
是公开仓（已核），所以标准把 arda 的 repo 级配置记为偏离是对的；但**下一个私有产品仓
照这条做会做不到**。→ 批 4-1 由"上移"改为"给 §6#17 补上前置条件"。

**本文作者在此处犯的错已回滚**：曾按初稿判定在 `vxture-platform` 组织层建了
`vars.TAILSCALE_OAUTH_CLIENT_TAG`——私有仓根本读不到，等于建了个"看起来配好、
实际不生效"的东西，而它恰恰是 §2.1 的阻断项。已删除；该变量由 owner 配在**仓库层**
（`tag:promotion`，已实测取到值）。

教训与本文 §0 判据三同源，但补了一条：**配置"存在"不等于"可达"——可达性由计划与
仓库可见性决定，而两者都不在仓库代码里。** 这类错误不报错，只表现为"配了但没生效"。

### 2.7 环境密钥命名：现在有三套，需要一次收口

| 来源                           | 命名                                                                                                                                                                                              |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `product_240` §2.2（模板标准） | `DEPLOY_HOST` / `DEPLOY_USER` / `DEPLOY_PORT` / `DEPLOY_SSH_KEY`(+`_PASSPHRASE`) / `DEPLOY_KNOWN_HOSTS` / `DEPLOY_DIR`，db-init 另有 `DEPLOY_HOST_TAILNET`                                        |
| 平台仓原实现                   | `DEPLOY_HOST_TAILNET` / `DEPLOY_USER` / `DEPLOY_SSH_KEY` / `DEPLOY_SSH_PASSPHRASE`                                                                                                                |
| **owner 新命名（本轮采用）**   | `DEPLOY_HOST_TAILNET_IP` / `DEPLOY_HOST_USER` / `DEPLOY_HOST_SSH_KEY` / `DEPLOY_HOST_SSH_KEY_PASSPHRASE` / `DEPLOY_HOST_PORT` / `DEPLOY_HOST_PUBLIC_IP` / `DEPLOY_HOST_PRIVATE_IP` / `DEPLOY_DIR` |

新命名最成体系——**凡与主机有关的一律 `DEPLOY_HOST_*`**，把 tailnet / public / private
三种地址并列；`SSH_KEY_PASSPHRASE` 也比 `SSH_PASSPHRASE` 准确（那是 key 的口令，不是 SSH 的）。
`DEPLOY_DIR` 与标准 §6#1 的已裁结论一致。

**裁定：以 owner 新命名为准，并回写 `product_240` §2.2**——否则后续每个照模板建的产品仓
都会拿到旧名，而平台仓自己用另一套。回写排在批 4（不阻断）。

### 2.8 顺带发现的安全缺口：SSH 未做 known_hosts 固定

模板标准要求复合动作 `tailnet-ssh-connect` 带 **`DEPLOY_KNOWN_HOSTS` fail-closed**。
平台仓 `.github/actions/` 下**只有 `setup-node-pnpm`**，deploy 直接用
`appleboy/ssh-action` + `scp-action`，**不传 known_hosts**——即不校验主机指纹。

风险等级：中。攻击面限于 tailnet 内部（SSH 本就不对公网开放），但"信任任意应答的主机"
与标准的 fail-closed 要求相悖。**不阻断本轮**，单列为批 4 的一项。

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

| #   | 任务                                                                                                  | 状态              |
| --- | ----------------------------------------------------------------------------------------------------- | ----------------- |
| 0-1 | 新组织补 `vars.TAILSCALE_OAUTH_CLIENT_TAG` = `tag:promotion`（**组织层**，按 §6#17 已裁）             | ✅ **已做**       |
| 0-2 | 四个 workflow（deploy / db-init / deploy-cert / platform-alerts）共 **28 处**引用对齐 `DEPLOY_HOST_*` | ✅ **已做**       |
| 0-3 | 删 production 环境里重复的 **secret** `DEPLOY_DIR`（保留 variable）                                   | ✅ **owner 已做** |
| 0-4 | SSH 端口 = 22 → 不接线；`DEPLOY_HOST_PORT` / `DEPLOY_HOST_PRIVATE_IP` 保留并在 `deploy.yml` 抬头注明  | ✅ **已做**       |
| 0-5 | 新仓跑一次部署演练，验证整条链路                                                                      | ⏳ 待做           |

> **0-2 原本有个陷阱，已用过渡回退化解**：改完之后 `deploy.yml` 在**旧仓**会跑不通
> （旧仓 production 环境仍是旧名），而生产目前正从旧仓发版。
>
> 处理方式是把引用写成 `${{ secrets.新名 || secrets.旧名 }}`——**缺失的 secret 在
> Actions 里求值为空串（falsy）**，所以 `||` 会自动落到还在的那一个，两个仓在切换期
> 都能部署。**移除条件**已写进 `deploy.yml` 抬头：发版通道确认切到新仓、旧仓不再承担
> 部署之后，把 `|| secrets.DEPLOY_*` 一并删掉——留着不出错，但会让"哪个名字是权威"
> 一直有两个答案。

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

| #   | 任务                                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------ |
| 4-1 | ~~上移组织层~~ **作废**（free + 私有仓不可行，见 §2.6）。改为：给 `product_240` §6#17 补「公开仓 或 付费计划」的前置条件 |
| 4-2 | 删 `vars.IMAGE_PRIMARY_REGISTRY`（零引用），或说明消费方                                                                 |
| 4-3 | 删旧组织的 `TAILSCALE_AUTHKEY`；`VXTURE_NPM_REGISTRY` 接线或删                                                           |
| 4-4 | 确认 `DEPLOY_WORKER02_*` 的授权仓后处置                                                                                  |
| 4-5 | `deploy/README` 补一句：公网域名是代码层常量                                                                             |
| 4-6 | 结清技术债 §926                                                                                                          |
| 4-7 | 回写 `product_240` §2.2 的环境密钥命名为 `DEPLOY_HOST_*`（见 §2.7），否则后续产品仓继续拿旧名                            |
| 4-8 | 补 `DEPLOY_KNOWN_HOSTS` fail-closed（见 §2.8）——标准要求，平台仓当前不校验主机指纹                                       |
| 4-9 | 移除四个 workflow 里的过渡回退 `secrets.新名 或 旧名`（发版切到新仓之后）                                                |

---

## 5. 待 owner 的剩余项

三件已答复（见 §2.4）：SSH 端口 22、`DEPLOY_HOST_PRIVATE_IP` 保留（Aliyun 内网）、
旧组织 `DEPLOY_WORKER02_*` 后置。**批 0 因此已完成 4/5**。

仍需裁定：

1. **批 3-4 的跨仓联络 issue 往哪儿放**——旧仓有 20 余条未关的 atlas / runos / yucer / arda
   联络 issue，属平台不属设计。迁到新仓，还是就地关闭并在新仓重开？
2. **发版通道何时切到新仓**——决定批 0-5 的演练时点，也决定批 4-9 何时移除过渡回退。
