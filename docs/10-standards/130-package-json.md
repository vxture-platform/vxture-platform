# package.json 规范

**版本**: 1.0.0 | **更新**: 2026-05-15

本文档定义 Vxture monorepo 中所有包的 `package.json` 必填字段、脚本约定、版本锁定和依赖分类规则。
AI 工具在新建或修改任何包时必须遵守本规范。

---

## 1. 包类型分类

| 类型              | 目录                                                                                           | 构建工具   | 输出格式               |
| ----------------- | ---------------------------------------------------------------------------------------------- | ---------- | ---------------------- |
| Library           | `packages/shared/`, `packages/core/`, `packages/ai/`, `packages/platform/`, `packages/design/` | tsup       | ESM + CJS 双格式       |
| BFF               | `bff/*`                                                                                        | esbuild    | `dist/main.cjs`（CJS） |
| Agent Server      | `agent-server/*`                                                                               | esbuild    | `dist/main.cjs`（CJS） |
| Portal            | `portals/*`, `agent-studio/*`, `business/*`                                                    | next build | N/A（Next.js 应用）    |
| Service（部署态） | `services/*/*`（已实现）                                                                       | esbuild    | `dist/main.cjs`（CJS） |
| Service（占位态） | `services/*/*`（未实现）                                                                       | —          | 源码直引               |

---

## 2. 必填字段（所有包）

| 字段          | 规则                                     |
| ------------- | ---------------------------------------- |
| `name`        | `@vxture/{group}-{name}` 格式，见第 3 节 |
| `version`     | SemVer，遵循第 4 节版本策略              |
| `description` | 一行英文（或中英文）描述                 |
| `private`     | 必须为 `true`（防止意外 publish）        |
| `engines`     | `{ "node": ">=22.0.0" }`                 |

> 根 `package.json`（`name: "vxture"`）和 `packages/core/database`（纯脚本包）可省略 `exports`/`files`，但其他必填字段不可省略。

---

## 3. 命名规范

遵循 `@vxture/{group}-{name}` 格式：

```
@vxture/shared                    # packages/shared/shared
@vxture/core-{name}               # packages/core/{name}
@vxture/model-runtime-client                    # packages/ai/model-runtime-client
@vxture/platform-{name}           # packages/platform/{name}
@vxture/design-system             # packages/design/design-system
@vxture/bff-{name}                # bff/{name}-bff
@vxture/service-{name}            # services/{domain}/{name}
@vxture/agent-server-{name}       # agent-server/{name}
@vxture/agent-studio-{name}       # agent-studio/{name}
@vxture/{portal-name}             # portals/{name}（如 @vxture/website）
```

**唯一例外**：根 `package.json` 的 `name` 为 `"vxture"`，不加 scope。

---

## 4. 版本策略

| 状态        | 版本    | 说明                   |
| ----------- | ------- | ---------------------- |
| 占位/未实现 | `0.1.0` | 有骨架结构但无业务实现 |
| 开发中      | `0.x.y` | 接口尚不稳定           |
| 稳定        | `1.x.y` | 接口稳定，有消费者     |

**禁止使用 `0.0.0`**：使工具链无法区分已发布包与未初始化包。

---

## 5. Library 包模板

适用于 `packages/` 下的所有共享库（shared、core、ai、platform、design）。

```json
{
  "name": "@vxture/core-xxx",
  "version": "1.0.0",
  "description": "一行描述",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.mjs",
      "require": "./dist/index.cjs"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "rimraf dist && tsup",
    "type-check": "tsc --noEmit"
  },
  "devDependencies": {
    "rimraf": "^6.0.1",
    "tsup": "^8.5.1",
    "typescript": "^5.9.3"
  },
  "engines": { "node": ">=22.0.0" }
}
```

**框架依赖（NestJS/React）**：放 `peerDependencies`，同时在 `devDependencies` 中重复声明（供本地构建和测试使用）。不放 `dependencies`。

---

## 6. BFF 包模板

适用于 `bff/*`。

```json
{
  "name": "@vxture/bff-xxx",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "一行描述",
  "scripts": {
    "build": "pnpm -w build:backend-deps && esbuild src/main.ts --bundle --platform=node --format=cjs --target=node22 --outfile=dist/main.cjs --tsconfig=tsconfig.json --external:@nestjs/websockets/socket-module --external:@nestjs/microservices --external:@nestjs/microservices/microservices-module",
    "dev": "pnpm run build && node dist/main.cjs",
    "start": "node dist/main.cjs",
    "type-check": "tsc --noEmit",
    "lint": "eslint src",
    "lint:fix": "eslint --fix src"
  },
  "engines": { "node": ">=22.0.0" }
}
```

- `class-transformer/storage` 需作为 esbuild external：`--external:class-transformer/storage`
- `dev` 脚本为 build-then-run 模式（无热重载），是当前阶段的合理选择
- **禁止**：`"lint": "echo \"No lint yet\""` — 要么配置 ESLint，要么不声明 lint script

---

## 7. Agent Server 包模板

与 BFF 模板相同，额外说明：

- `name` 必须为 `@vxture/agent-server-{name}`
- 若有 Prisma 数据库，增加：
  ```json
  "prisma:generate": "prisma generate --schema=prisma/schema.prisma",
  "prisma:migrate": "prisma migrate deploy --schema=prisma/schema.prisma"
  ```

---

## 8. Portal 包模板

适用于 `portals/*`, `agent-studio/*`。

```json
{
  "name": "@vxture/website",
  "version": "1.x.x",
  "private": true,
  "type": "module",
  "description": "一行描述",
  "scripts": {
    "dev": "next dev --turbo -p {PORT}",
    "build": "next build",
    "start": "next start -p {PORT}",
    "lint": "eslint .",
    "type-check": "tsc --noEmit",
    "clean": "rimraf .next"
  },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "typescript": "^5.9.3"
  },
  "engines": { "node": ">=22.0.0" }
}
```

---

## 9. Service 包模板

### 9a. 部署态 Service（已实现）

```json
{
  "name": "@vxture/service-xxx",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "一行描述",
  "scripts": {
    "build": "esbuild ...",
    "dev": "pnpm run build && node dist/main.cjs",
    "start": "node dist/main.cjs",
    "type-check": "tsc --noEmit"
  },
  "engines": { "node": ">=22.0.0" }
}
```

### 9b. 占位态 Service（接口已声明，实现未完成）

```json
{
  "name": "@vxture/service-xxx",
  "version": "0.1.0",
  "private": true,
  "description": "一行描述",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "type-check": "tsc --noEmit"
  },
  "engines": { "node": ">=22.0.0" }
}
```

**占位服务规则**：

- 无 `build` / `dev` script（直到正式实现）
- 禁止 `echo "Build for ..."` 作为 script 值
- `version` 从 `0.1.0` 开始，不用 `0.0.0`

---

## 10. 锁定版本表

以下依赖在全项目范围内必须使用统一版本约束：

| 包                     | 版本约束   | 用途                                      |
| ---------------------- | ---------- | ----------------------------------------- |
| `typescript`           | `^5.9.3`   | 编译器                                    |
| `@nestjs/*`            | `^11.0.0`  | 所有 NestJS 包保持同 major                |
| `@prisma/client`       | `^6.0.0`   | ORM 客户端（用 `^` 范围，禁止 exact pin） |
| `prisma`               | `^6.0.0`   | devDependencies CLI                       |
| `esbuild`              | `^0.27.4`  | BFF / Service 打包                        |
| `tsup`                 | `^8.5.1`   | Library 打包                              |
| `rimraf`               | `^6.0.1`   | 清理工具                                  |
| `reflect-metadata`     | `^0.2.0`   | NestJS DI 元数据                          |
| `class-validator`      | `^0.14.0`  | DTO 校验                                  |
| `class-transformer`    | `^0.5.1`   | DTO 转换                                  |
| `ioredis`              | `^5.0.0`   | Redis 客户端                              |
| `express`              | `^4.22.1`  | HTTP 服务器（NestJS 底层）                |
| `cookie-parser`        | `^1.4.7`   | Cookie 解析中间件                         |
| `zod`                  | `^3.24.0`  | Schema 校验                               |
| `axios`                | `^1.7.0`   | HTTP 客户端                               |
| `next`                 | `^15.5.6`  | Portal 框架                               |
| `react` / `react-dom`  | `^19.2.0`  | React 运行时                              |
| `@types/node`          | `^24.0.0`  | Node.js 类型（匹配 engines 最低版本）     |
| `@types/express`       | `^4.17.21` | Express 4 类型                            |
| `@types/cookie-parser` | `^1.4.7`   | cookie-parser 类型                        |

---

## 11. 依赖分类规则

| 字段               | 放什么                                                    |
| ------------------ | --------------------------------------------------------- |
| `dependencies`     | 运行时必需（含 `workspace:*` 内部包）                     |
| `devDependencies`  | 仅构建/测试需要（tsc, eslint, tsup, esbuild, `@types/*`） |
| `peerDependencies` | Library 包的框架依赖（NestJS, React 等）                  |

**`@types/*` 规则**：

- 始终放 `devDependencies`
- Portal 应用必须显式声明 `@types/node: ^24.0.0`
- BFF/Service 可依赖 workspace 根提供的 `@types/node`，但建议显式声明

---

## 12. 禁止事项

| 禁止                                       | 正确做法                                                                                    |
| ------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `version: "0.0.0"`                         | 使用 `0.1.0`                                                                                |
| `echo "..."` 作为 script 实现              | 删除该 script 或真正实现它                                                                  |
| 非 `@vxture/` 命名的内部包                 | 遵循第 3 节命名规范                                                                         |
| Library 包在 `dependencies` 中声明框架依赖 | 放 `peerDependencies`                                                                       |
| 省略 `private: true`                       | 防止意外 publish                                                                            |
| 省略 `engines`                             | 确保 CI 和本地环境一致性                                                                    |
| `@prisma/client` 精确版本（如 `"6.19.3"`） | 使用范围约束（`"^6.0.0"`）                                                                  |
| `license` 字段 / 文件头 `@license` 标记    | 本仓库**非开源**（开发阶段公开但非开源；无 license = all-rights-reserved），不加此字段/标记 |

---

## 10. 工具链版本基线（org 级，2026-08-10 起）

> owner 拍板（2026-08-10）：**新项目就用新的**。回应 `vxture-runos` liaison platform#212 ——
> 该决定原本只活在各产品仓的 `CLAUDE.md` 里，按"先补平台标准、各仓再引用"的治理规则收进本文。

**规则（会长期成立的是这三条，不是下表的数字——数字会往前走）：**

1. **每个组件跟当前最新稳定大版本。** 新建仓一律按最新大版本起步；既有仓按各自节奏跟进，不强制齐步。
2. **"最新可兼容" 只在存在硬生态上限时才压过 "最新绝对"，且上限必须记在施加处**——即写在钉版本的
   那一行旁边，注明被谁卡住、何时复查。没有记录的降级 = 无依据的落后。
3. **`@types/node` 跟 Node **运行时**大版本，不跟 types 包自己的最新大版本**——types 领先于 runtime 时
   会引入运行时不存在的 API 声明，编译过、运行炸。

**决策时点快照（2026-08-10，仅供对照，非冻结值）：**

| 组件       | 基线                | 落点与备注                                                                                   |
| ---------- | ------------------- | -------------------------------------------------------------------------------------------- |
| Node       | 24 LTS              | `.node-version` · `engines.node` · `@types/node ^24`                                         |
| pnpm       | 11                  | `.pnpm-version` · `packageManager`                                                           |
| TypeScript | 6.0.x               | TS 7(native) 被 typescript-eslint peer `>=4.8.4 <6.1.0` 卡住——**上限记在钉版处**，解除后复查 |
| Postgres   | 18                  | 镜像 + 挂载路径 + 初始化探针，见下                                                           |
| Prisma     | 7（driver-adapter） | url 移出 schema，`@prisma/adapter-pg` 进构造函数                                             |

**两项带迁移动作的，标准必须点名（否则各仓各踩一遍）：**

- **pnpm 11 供应链收紧**（两种 profile 都受影响）：① 提交进仓的项目级 `.npmrc` **不再展开环境变量**，
  所以项目 `.npmrc` 只留 scope→registry 映射，**认证移到用户级 / CI `~/.npmrc` / Dockerfile deps 阶段的
  BuildKit secret**（同一层内写入并 `rm`）；② build-script 白名单移到 `pnpm-workspace.yaml` 的 `allowBuilds`。
- **Postgres 18 运维变更**：① 数据卷挂到**父目录**（`/var/lib/postgresql`，不是 `.../data`）——18 镜像
  拒绝 18 之前的布局；② **首次初始化时 `pg_isready` 会说谎**：entrypoint 先起一个临时 server，此时
  `POSTGRES_DB` 还不存在但 `pg_isready` 已返回成功。任何等待就绪的循环必须**对目标库发真查询**
  （`psql -d "$DB" -c 'SELECT 1'`），不能用 `pg_isready`。

**两个 pin 必须一致**：`.node-version`/`.pnpm-version` 与 `engines`/`packageManager` 说的是同一件事，
分歧即偏差。`vxture-platform` 自身当前不达标（`.pnpm-version` 停在 8.15.0，而 `packageManager` 是
10.30.3，基线是 11），已在 platform#212 记名——**参照实现不达标要写出来，不能靠"标准写了"充数**。
