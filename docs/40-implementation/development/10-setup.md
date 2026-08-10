# 本地开发环境启动指南

> 更新：2026-08-10（上一版 2026-05-14 已失效：它指向不存在的 `docker/dev.compose.yml`、用 prisma migrate 建库、端口是废止的 3NNX 一套）

---

## 前置条件

| 工具           | 版本要求                 | 说明                                  |
| -------------- | ------------------------ | ------------------------------------- |
| Node.js        | 见 `.node-version`       | 推荐 nvm 管理                         |
| pnpm           | 见 `packageManager` 字段 | `npm install -g pnpm`                 |
| Docker Desktop | ≥ 4.x                    | 只跑 PostgreSQL + Redis，应用不进容器 |
| Git            | ≥ 2.40                   |                                       |

不需要 psql 客户端：所有 SQL 都在 db 容器内执行。

---

## 一次性初始化

```bash
pnpm install                      # 1. 依赖（pnpm workspace 自动链接本地包）
cp .env.example .env.local        # 2. 环境变量，按需填
pnpm db:local:all                 # 3. 起库 + 建表 + seed + 校验（见下）
```

`db:local:all` = `up` → `ddl --reset` → `secrets` → `signing-key` → `seed` → `verify`，每步也可以单独跑：

| 命令                    | 做什么                                                                             |
| ----------------------- | ---------------------------------------------------------------------------------- |
| `pnpm db:local:up`      | 起 `vx-platform-postgres-db-dev`(5433) + `vx-platform-redis-db-dev`(6379)          |
| `pnpm db:local:ddl`     | 按文件名顺序 apply `deploy/database/ddl/*.sql`（**与生产同一套 DDL**）+ 打基线指纹 |
| `pnpm db:local:reset`   | 先 DROP 19 个 schema 再 apply（本地专用，数据全丢，需 `CONFIRM_RESET=yes`）        |
| `pnpm db:local:secrets` | 生成本地 OIDC client secret + bcrypt hash 写进 `.env.local`（见下）                |
| `pnpm db:local:seed`    | catalog + sample seed（与生产同一份 `deploy/database/seed/`）                      |
| `pnpm db:local:verify`  | 跑 `baseline-assertions.sql`——**与生产同一份断言，本地应当全绿**                   |
| `pnpm db:local:status`  | 容器状态 + schema 计数                                                             |
| `pnpm db:local:down`    | 停容器（数据留在 `deploy/dev/data/`，已 gitignore）                                |

**`signing-key` 这步也不能跳**：公钥进 `appoidc.signing_keys`（`/oidc/jwks` 就是读它），私钥只在 env。库里没有 → `/oidc/jwks` 直接 500，登录无从谈起；库里有而 env 对不上 → auth-bff 用一个 kid 签、JWKS 公布另一个 kid，RP 一律 `kid not found`，看起来像 RP 坏了。

**`secrets` 这步不能跳**：四个门户是四个 confidential OIDC client，IdP 要用 `client_secret_hash` 校验换票。没有它，登录会在 token exchange 处以 `invalid_client` 失败——而现象是"登录跳回来就没了"，不会有任何一层报错。生成的明文按客户端分别落 `OIDC_CLIENT_SECRET_{WEBSITE,CONSOLE,ADMIN,OPERA,UMBRA}`：四个 RP 共用一个 `OIDC_CLIENT_SECRET` 变量的话，只有一个客户端能换票成功，另外三个静默失败。

`verify` 跑的是生产那份基线断言（schema 集合、表数、DDL 指纹、seed 底线、super_admin 全授），**本地跑出来应当是 PASSED**；跑不过说明本地库确实和目标态不一致，不要当成"本地本来就这样"。

**为什么不是 prisma migrate**：2026-07-02 的 B15 cutover 之后，平台库的唯一权威建库路径是 `deploy/database/ddl/`（clean-baseline 模型），生产就是这么建的。本地用另一条路径建出来的库，证明不了任何关于生产的事。Prisma 仍用于生成 client（`pnpm -F @vxture/core-database db:generate`），不再用于建表。

---

## 端口

**本地端口 = 代码内默认值 = 生产容器内口**，一套数。权威 = [`10-port-allocation.md`](../ai/10-port-allocation.md)。

| 面      | UI   | BFF              | 面            | UI          | BFF                    |
| ------- | ---- | ---------------- | ------------- | ----------- | ---------------------- |
| website | 3000 | website-bff 3001 | opera         | 3040        | opera-bff 3041         |
| console | 3020 | console-bff 3021 | accounts(IdP) | 3080        | auth-bff 3081          |
| admin   | 3030 | admin-bff 3031   | varda(非面)   | studio 3092 | bff 3090 / server 3091 |

边缘：`gateway-bff 8000`、`platform-api 8080`、`dev-panel 8090`。

同机还跑着兄弟产品的 dev 栈（atlas 3100 / runos 3120 / arda 3230），端口互不重叠——这正是 2026-08-10 重排要解决的问题（此前本地 varda 占 3120，和 runos 撞车）。

---

## 按工作类型启动服务

最省事的方式是开发面板：`pnpm dev:panel`（:8090），它按 tier 顺序拉起服务并做健康探测。手动起也行，**只启动你需要的**：

### 场景 A：改门户（website / console / admin / opera）

```bash
pnpm -F @vxture/bff-auth dev          # 3081，登录必需
pnpm -F @vxture/bff-gateway dev       # 8000
pnpm -F @vxture/accounts dev          # 3080，登录 UI，缺它登录页打不开

pnpm -F @vxture/website dev           # 3000  + pnpm -F @vxture/bff-website dev  # 3001
pnpm -F @vxture/console dev           # 3020  + pnpm -F @vxture/bff-console dev  # 3021
pnpm -F @vxture/admin   dev           # 3030  + pnpm -F @vxture/bff-admin   dev  # 3031
pnpm -F @vxture/opera   dev           # 3040  + pnpm -F @vxture/bff-opera   dev  # 3041
```

### 场景 B：改 Varda

```bash
pnpm -F @vxture/bff-auth dev          # 3081
pnpm -F @vxture/bff-varda dev         # 3090
pnpm -F @vxture/agent-server-varda dev # 3091
pnpm -F @vxture/bff-admin dev         # 3031（Varda 宿主）+ pnpm -F @vxture/admin dev  # 3030
```

### 场景 C：改 auth / 认证流程

```bash
pnpm -F @vxture/bff-auth dev          # 3081，直接 curl / Postman 测
```

### 场景 D：改 Service / Core 层

通常只跑单测：`pnpm -F @vxture/service-iam test:watch`。

---

## 环境变量

`.env.local`（gitignore）从 `.env.example` 复制，关键几项：

```bash
DATABASE_URL=postgresql://vxture:localdev@localhost:5433/platform_main
REDIS_URL=redis://localhost:6379
AUTH_INTERNAL_TOKEN=local-dev-internal-token
AUTH_COOKIE_DOMAIN=localhost
```

库名 `platform_main` 与生产一致（`platform` 是 L0 stack 标识符，不是 product code，见 [`140-repo-governance-standard.md`](../../10-standards/140-repo-governance-standard.md) §4）。端口 5433 而非 5432：本机 atlas dev 栈的 forwarder 已经占了 127.0.0.1:5432。

本地 RP 会话 cookie 必须用裸名（`RP_COOKIE_INSECURE=true`）——`__Host-` 前缀的 cookie 在明文 http 上会被浏览器静默丢弃，表现为"服务端登录成功、浏览器始终未登录"。dev-panel 已自动注入。

第三方登录（钉钉 / 飞书）本地不必配。

---

## 常见问题

**端口冲突**：`netstat -ano | findstr :3081`（Windows）。先确认不是兄弟栈——`docker ps` 看 vx-atlas / vx-runos / vx-arda。

**数据库连不上 / auth-bff 起不来报 `Auth session store unavailable`**：先看 Docker Desktop 是不是没开——那条 503 说的是 Redis 连不上，而 pg 和 redis 都在 Docker 里。

```bash
docker info                 # 守护进程没起的话，先开 Docker Desktop
pnpm db:local:status
docker logs vx-platform-postgres-db-dev
```

**Prisma Client 找不到类型**：`pnpm -F @vxture/core-database db:generate`。

**库脏了**：`CONFIRM_RESET=yes pnpm db:local:reset && pnpm db:local:seed`。

---

## 开发工作流

改代码（Next.js / NestJS 都热重载）→ IDE 实时类型检查 → `pnpm -F <package> test:watch` → 提交前 Husky 跑 ESLint + dep-cruiser 边界检查 → `git commit`（Conventional Commits）。

提交规范见 `docs/10-standards/` 下的 git 工作流文档。
