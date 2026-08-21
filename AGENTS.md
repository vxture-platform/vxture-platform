# AGENTS.md — Vxture Monorepo AI 指令入口

> **使用说明**：这是根目录指令文件，适用于所有 AI 编码工具（Claude / Cursor / Copilot 等）。
> 所有 AI 操作必须先读完本文件，
> 再读 [`docs/90-memory/agent.md`](docs/90-memory/10-agent.md)（任务路由入口），
> 再读取目标包目录下的子级 `AGENTS.md`（导航指针）。
> 子级文件只保留导航指针，详细上下文在 `docs/40-implementation/packages/` 体系。根文件规则**全局生效**。

---

## 📎 规范文档引用（强制执行）

执行任何代码任务前，以下三份文档必须遵守：

| 文档             | 内容                                            | 路径                                                                                                           |
| ---------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **注释规范**     | 文件头模板、JSDoc 格式、分区注释、英文注释要求  | `docs/40-implementation/ai/03-coding-comments.md`                                                              |
| **编码规则**     | 包边界约束、层职责、AI 行为规范                 | `docs/40-implementation/ai/01-coding-rules.md`                                                                 |
| **代码风格**     | TypeScript 约定、命名规则、导出风格             | `docs/40-implementation/ai/02-coding-style.md`                                                                 |
| **端口分配**     | 分层分块、取号规则、新 Agent 登记流程           | [端口登记表](https://claude.ai/code/artifact/0f44735a-c6bc-4881-a440-3446a2411a5f)（**唯一源**，仓内不存副本） |
| **BFF 数据访问** | Pool 注入、req.user、auth 委托签发、Schema 速查 | `docs/40-implementation/ai/05-bff-data-access-guide.md`                                                        |

> 三份文档与本文件如有冲突，**以本文件为准**。

---

## 🏗 架构速览

Vxture 是基于 **pnpm workspace monorepo** 的企业 SaaS 平台，TypeScript 5.9.3 / ES2023。

两个产品面：

- **Platform**：`portals/` — 运营后台，面向管理员，迭代慢
<!-- agent 系(agent-studio/agent-server/varda)已迁独立仓 vxture-varda 与 vxture-agent-template(2026-08-18):与平台无关,全部独立。 -->

### 层级 ↔ 目录 ↔ @layer 对照表

| 目录                               | @layer 值        | 变更频率  |
| ---------------------------------- | ---------------- | --------- |
| `portals/*`                        | `Presentation`   | Slow      |
| `bff/*`                            | `Application`    | Medium    |
| `services/*/*`                     | `Domain`         | Slow      |
| `packages/core/*`                  | `Infrastructure` | Very Slow |
| `packages/ai/model-runtime-client` | `Infrastructure` | Medium    |
| `packages/platform/*`              | `Infrastructure` | Low       |
| `packages/shared/*`                | `Shared`         | Very Slow |

> `packages/design/*` 已迁至 [`vxture/vxture-design`](https://github.com/vxture/vxture-design)（2026-08-21）：本仓从 registry 消费 `@vxture/design-*`，不再持有其源码。

### 依赖方向（违反即破坏架构，无例外）

```
portals/*
        │  HTTP only，禁止包引用
        ▼
      bff/*
        │
        ├──────────────────┐
        ▼                  ▼  services/*/*
        │                  │
        ├──────────┬───────┘
        │          ▼
        │      @vxture/model-runtime-client
        │          │
        └──────┬───┘
               ▼
         packages/core/*
               ▼
         packages/shared
```

完整规则见 `docs/30-design/architecture/02-package-boundaries.md`。

---

## 🔒 全局强制规则

### G1 — 操作范围

- 只修改**明确指定**的包或文件
- 不触碰其他包、目录、任何文档文件
- 不删除、不移动 `docs/`、`AGENTS.md`、规范文件

### G2 — 层边界

- 严格遵守上方依赖方向，跨层引用必须注释说明并标注 `// ⚠️ 跨层引用`
- `shared` 和 `core` 层**禁止**引入任何业务逻辑
- 不在低层包中引用高层包

### G3 — TypeScript

- 全项目强制 **strict 模式**，三级 tsconfig 继承结构不可破坏
- 禁止 `any`（必须使用时须注释说明原因）
- 路径别名统一使用 `@vxture/{group}-{name}` 格式
- 所有公共符号通过 `index.ts` 导出，不得绕过

### G4 — 注释语言

- **注释一律英文**，标识符一律英文（2026-06-08 政策变更：注释由中文改为英文；存量中文注释分批迁移；面向用户的字符串属产品文案，不在此规则内）
- 每个新文件必须包含完整文件头（`@package` / `@layer` / `@category` / `@author` / `@date`）
- AI 生成的文件 `@author` 填写 `AI-Generated`
- 超过 80 行的文件必须添加分区注释

### G5 — 破坏性操作保护

- 删除文件、覆盖接口、重构现有逻辑 → **执行前告知，获得确认后才执行**
- 合并已有代码时保留现有逻辑，明确说明变更点，不盲目覆盖

### G6 — 提交与发布确认

- **所有代码提交必须获得用户明确确认**；包括但不限于 `git commit`、`git push`、创建 PR、合并 PR、触发 CI/CD、发布到 beta / production
- 确认只对**当前任务、当前步骤、当前范围**有效，不得沿用历史会话或上一任务中的确认
- 在执行文件修改前，必须先说明将修改的文件、修改目的、影响范围；用户确认后才允许编辑
- 在执行提交 / 推送 / 合并 / 发布前，必须先给出变更摘要、验证结果、目标分支或环境；用户确认后才允许执行
- 只读分析、查看日志、查看仓库状态、本地非破坏性校验可以直接执行，但不得自动升级为修改、提交或发布
- 服务器重置、数据清空、卷删除、环境覆盖、证书变更等高风险操作必须单独确认，且不得与代码提交确认合并

### G7 — 输出质量

- 所有生成代码必须**可直接使用**（Copy-Paste Ready）
- 新增包或模块时提供示例 `import` 语句
- 不生成与当前任务无关的包或功能

---

## 📁 子级 AGENTS.md 索引

进入对应目录工作时，**必须**读取子级文件以获取层专属规则：

所有包的 `AGENTS.md` 已统一改为**导航指针**，完整上下文在 `docs/40-implementation/packages/` 体系：

| 目录                 | 指针目标                                             |
| -------------------- | ---------------------------------------------------- |
| `packages/shared/`   | `docs/40-implementation/packages/shared/00-index.md` |
| `packages/core/`     | `docs/40-implementation/packages/core/{包名}.md`     |
| `packages/platform/` | `docs/40-implementation/packages/sdk/{包名}.md`      |
| `services/*/*`       | `docs/40-implementation/packages/services/{包名}.md` |
| `bff/*`              | `docs/40-implementation/packages/bff/{bff名}.md`     |
| `portals/*`          | `docs/40-implementation/packages/portals/{包名}.md`  |

---

## ✅ 任务完成后的标准输出格式

```
## 变更摘要
- 新增文件：列表
- 修改文件：列表
- 未改动：列表（若有关联文件）

## 做了什么 & 为什么
简洁说明设计决策

## 后续建议（可选）
优化点 / 潜在风险 / 待确认事项
```

---

_版本：2.0.0 | 2026-05-10_
