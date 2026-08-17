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

`db:local:all` = `up` → `ddl --reset` → `secrets` → `signing-key` → `sample-user` → `seed` → `verify`，每步也可以单独跑：

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

**`sample-user` 这步不能跳**：没有 `SAMPLE_USER_PASSWORD_HASH`，seed 会**整段跳过样例用户**——生产如此是对的，本地如此等于库里 0 租户 / 0 workspace / 0 用户，凡是要 workspace 的东西全都测不了：console、权益、`/usage/consume`、service-mode 换票，而且各自以各自的方式失败，没有一个会说"这里没有租户"。本地账号 = `zhangsan` / `Dev@2026`（口令是公开的、只在本地；生产那道 `NODE_ENV=production` 拒绝默认口令的门没有动）。

**`signing-key` 这步也不能跳**：公钥进 `appoidc.signing_keys`（`/oidc/jwks` 就是读它），私钥只在 env。库里没有 → `/oidc/jwks` 直接 500，登录无从谈起；库里有而 env 对不上 → auth-bff 用一个 kid 签、JWKS 公布另一个 kid，RP 一律 `kid not found`，看起来像 RP 坏了。

**`secrets` 这步不能跳**：四个门户是四个 confidential OIDC client，IdP 要用 `client_secret_hash` 校验换票。没有它，登录会在 token exchange 处以 `invalid_client` 失败——而现象是"登录跳回来就没了"，不会有任何一层报错。生成的明文按客户端分别落 `OIDC_CLIENT_SECRET_{WEBSITE,CONSOLE,ADMIN,OPERA,UMBRA}`：四个 RP 共用一个 `OIDC_CLIENT_SECRET` 变量的话，只有一个客户端能换票成功，另外三个静默失败。

`verify` 跑的是生产那份基线断言（schema 集合、表数、DDL 指纹、seed 底线、super_admin 全授），**本地跑出来应当是 PASSED**；跑不过说明本地库确实和目标态不一致，不要当成"本地本来就这样"。

**为什么不是 prisma migrate**：2026-07-02 的 B15 cutover 之后，平台库的唯一权威建库路径是 `deploy/database/ddl/`（clean-baseline 模型），生产就是这么建的。本地用另一条路径建出来的库，证明不了任何关于生产的事。Prisma 仍用于生成 client（`pnpm -F @vxture/core-database db:generate`），不再用于建表。

---

## 端口

**本地端口 = 代码内默认值 = 生产容器内口**，一套数。

端口取号唯一源 = [端口登记表](https://claude.ai/code/artifact/0f44735a-c6bc-4881-a440-3446a2411a5f)；**本仓文档不再保存端口数值**，下面的启动命令也不再标注端口——要查号去登记表，或直接读代码里的回退默认值（`process.env.X_PORT ?? NNNN`）。

同机还跑着兄弟产品的 dev 栈（atlas / runos / arda），端口互不重叠——这正是 2026-08-10 重排要解决的问题（此前本地 varda 和 runos 撞车）。

---

## 按工作类型启动服务

最省事的方式是开发面板：`pnpm dev:panel`，它按 tier 顺序拉起服务并做健康探测。手动起也行，**只启动你需要的**：

### 场景 A：改门户（website / console / admin / opera）

```bash
pnpm -F @vxture/bff-auth dev  # 登录必需
pnpm -F @vxture/bff-gateway dev
pnpm -F @vxture/accounts dev  # 登录 UI，缺它登录页打不开

# 门户与它的 BFF 成对起，只起你要改的那一对：
pnpm -F @vxture/website dev   &&  pnpm -F @vxture/bff-website dev
pnpm -F @vxture/console dev   &&  pnpm -F @vxture/bff-console dev
pnpm -F @vxture/admin   dev   &&  pnpm -F @vxture/bff-admin   dev
pnpm -F @vxture/opera   dev   &&  pnpm -F @vxture/bff-opera   dev
```

### 场景 B：改 Varda

```bash
pnpm -F @vxture/bff-auth dev
pnpm -F @vxture/bff-varda dev
pnpm -F @vxture/agent-server-varda dev
pnpm -F @vxture/bff-admin dev         # Varda 宿主
pnpm -F @vxture/admin dev
```

### 场景 C：改 auth / 认证流程

```bash
pnpm -F @vxture/bff-auth dev  # 直接 curl / Postman 测
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

本地 RP 会话 cookie 必须用裸名（`RP_COOKIE_INSECURE=true`）——`__Host-` 前缀的 cookie 在明文 http 上会被浏览器静默丢弃，表现为"服务端登录成功、浏览器始终未登录"。auth-bff 自己的中心会话 cookie 同理，用 `IDP_COOKIE_INSECURE=true`。dev-panel 已自动注入两者。

第三方登录（钉钉 / 飞书）本地不必配。

---

## 测试数据（独立脚本，**不在部署链路里**）

`db:local:all` 建出来的是一个干净的、与生产同形的基线：一个身份、一个 workspace。要看列表页、筛选、分页、计数卡在**有量**的时候成不成立，另外灌：

```bash
pnpm fixtures:status          # 现在库里有多少测试数据
pnpm fixtures:inject          # demo + bulk（按依赖顺序）
pnpm fixtures:inject demo     # 只要状态矩阵：每个枚举至少一行
pnpm fixtures:inject bulk     # 只要量：主干 + 叶子表各上百行
CONFIRM_PURGE=yes pnpm fixtures:purge
```

**为什么是独立脚本**：灌测试数据是人做的决定，不是建库的副作用。它不接进 `db-init`、不接进 `deploy.yml`、也不接进 `db:local:all`。

**幂等**：所有 fixture 行的 id 由行号确定性算出，落在各自的 UUID 段——catalog `a000` / demo `b000` / bulk `c000`，互不重叠。所以重复灌只补缺行，而 purge 是"删掉某个段"，catalog 永远不会被误伤。

**purge 删不干净，这是设计**：`metering.usage_events`、`subscription_histories`、`billing.transactions`、`support.audit_logs` 等是**append-only 账本**，DDL 里有触发器直接拒绝 DELETE；被它们引用的行（users / tenants / workspaces / subscriptions）也就跟着删不掉。purge 会把这些逐条列出来，而不是打个勾了事。要彻底清干净只有一条路——**重建，而不是删除**：

```bash
CONFIRM_RESET=yes pnpm db:local:reset && pnpm db:local:seed
```

---

## 接口浏览（`/docs`）

每个 BFF 在**非生产**环境挂了 Swagger UI，起了服务直接开：

| 服务                      | 地址                         |
| ------------------------- | ---------------------------- |
| auth-bff                  | `http://localhost:3081/docs` |
| website-bff / console-bff | `:3001/docs` · `:3021/docs`  |
| admin-bff / opera-bff     | `:3031/docs` · `:3041/docs`  |
| platform-api              | `:8080/docs`                 |

路由和方法是从 Nest 的装饰器直接生成的，**不会和代码漂移**——这是它相对手写契约文档的全部意义。请求/响应的字段形状只在 DTO 带了 `@ApiProperty` 的地方出现，那部分是增量补的，不影响现在就能用。

**生产不开 `/docs`**：把全部端点、参数结构、错误码公开给未认证访问者，等于我们自己发布一份攻击面地图。

**`platform-api` 例外地在所有环境提供 `/openapi.json`**（不是 UI，是机器读的规格）：它的消费方是别的产品仓而不是浏览器，surface 本来就只在 tailnet 内。产品仓照着规格生成客户端，就不会再把字段名从散文文档里抄错（liaison #226 把 `workspace_id` 抄成了 `active_workspace`）。

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
