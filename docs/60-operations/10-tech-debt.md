# 技术债登记表

**版本**: 1.13.1
**更新**: 2026-08-16（**TD-045 交办完成**，发前复核推翻两条登记：atlas `GET /capability/logs` **已由上游自行修好**，但同表 `billed_amount` 是 Omit 漏网的第四个 bigint 列、属潜伏；runos `GET /audit/calls` **仍在且有数据时 100% 复现**。已发 [`vxture-runos#110`](https://github.com/vxture/vxture-runos/issues/110)、[`vxture-atlas#193`](https://github.com/vxture/vxture-atlas/issues/193)（后者并入 Atlas 三个死列）。opera 侧不兜底不变）。此前 2026-08-14（新增 **TD-045**：atlas `GET /capability/logs` 与 runos `GET /audit/calls` 两条端点抛同一句 `TypeError: Do not know how to serialize a BigInt`，opera 运行监控的两块请求级明细全部读不出；缺陷在上游两仓，本仓只交办不兜底，liaison issue 待发。由 opera 目录重构 B3 验收发现）。此前 2026-07-28 晚（**TD-044 销号**：atlas 自主补齐 C2/C3 全部接线（`vxture-atlas#63/64/72/73/74`），架构缺口不复存在；**TD-043 部分销号**：console-bff 半程彻底解决（四个代理方法全切 atlas 新建的 `/tenancy/*` 数据面，两轮铸票 claim 语义 bug 一并修完），varda 半程仍暂缓，故整体状态改"部分 Resolved"。此前同日，atlas 真实实现逐项审计：新增 **TD-044**（atlas 未接入平台 C2/C3，全平台 AI 用量对计量/账单系统不可见，🔴 HIGH——与 TD-008/TD-043 互为前提）。此前同日，atlas 仓拆分 cutover 完成：新增 **TD-043**（平台调用 atlas 无 S2S 鉴权，varda 侧暂缓）；**TD-005/006/007 作废**、**TD-008 范围收窄**（`services/model/platform` 整体退役，实现迁至 `vxture-atlas`）。此前 2026-07-23（**TD-042** 三阶段整改（S2S 改走 C2 + console 权益展示 + 验收）全部完成，已销号）。此前同日：console 权益展示缺口调研衍生 **TD-042**：console-bff quota-usage 端点绕开 C2 契约直查 DB 并重复实现 reset 逻辑。此前 2026-07-16：GitHub Actions workflow 审查衍生两项，均**待全域确认后执行**：**TD-039** 疑似死 CI 凭证审计清理（跨 org 全仓核引用后 revoke）；**TD-040** 变更门控方法论补进 cicd-optimization-playbook。此前 2026-07-14：backlog 对当前架构审计后修正——**TD-010 作废**、**TD-001 改写**、**TD-033 文档 bug 修复**）
**维护人**: 架构组

---

## 机制说明

### 登记 ID

格式：`TD-NNN`（三位数字，从 001 递增，永不复用）。

### 状态值

| 状态          | 含义                       |
| ------------- | -------------------------- |
| `Open`        | 已登记，待处理             |
| `In Progress` | 正在处理中，有负责人       |
| `Resolved`    | 已销号，条目保留作历史记录 |

### 登记模板

在"详情"章节末尾追加新条目：

```
### TD-NNN — [简短标题]

| 字段 | 内容 |
|------|------|
| **分类** | Architecture / Security / Implementation Gap / Design Pending |
| **状态** | Open |
| **登记日期** | YYYY-MM-DD |
| **来源** | 文档路径 / ADR 编号 / 代码注释位置 |

**描述**：问题的具体内容，一到三句话。

**影响**：不解决会带来什么风险或限制。

**解决方向**：计划如何处理，可以是方向性描述。
```

### 销号流程

1. 问题解决后，将 `状态` 改为 `Resolved`
2. 在汇总表中标记该行
3. 在条目末尾追加销号记录：
   ```
   **销号**：YYYY-MM-DD | Commit: `abc1234` | [简要说明]
   ```
4. 条目保留不删除，作为决策历史

---

## 汇总表

| ID                                                                                    | 标题                                                                  | 分类               | 状态          | 优先级                                       |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------ | ------------- | -------------------------------------------- |
| [TD-001](#td-001--bff-层结构待大版本重构)                                             | BFF 层结构待大版本重构                                                | Architecture       | Open          |                                              |
| [TD-002](#td-002--prisma-schema-集中管理待重构)                                       | Prisma schema 集中管理待重构                                          | Architecture       | Resolved      |                                              |
| [TD-003](#td-003--business-bff-认证流程未实现)                                        | Business BFF 认证流程未实现                                           | Implementation Gap | Resolved      |                                              |
| [TD-004](#td-004--会话空闲超时未实现)                                                 | 会话空闲超时未实现                                                    | Implementation Gap | Open          |                                              |
| [TD-005](#td-005--model-platform-流式响应未实现)                                      | Model Platform 流式响应未实现                                         | Implementation Gap | 作废          |                                              |
| [TD-006](#td-006--model-platform-provider-api-key-无轮换机制)                         | Model Platform Provider API Key 无轮换机制                            | Security           | 作废          |                                              |
| [TD-007](#td-007--model-platform-provider-重试--降级未实现)                           | Model Platform Provider 重试 / 降级未实现                             | Implementation Gap | 作废          |                                              |
| [TD-008](#td-008--model-platform-provider-合同价格为占位数据)                         | Model Platform Provider 合同价格为占位数据（范围收窄=commerce 侧）    | Implementation Gap | Open          |                                              |
| [TD-009](#td-009--surface-命名方案待定)                                               | surface 命名方案待定                                                  | Design Pending     | Open          |                                              |
| [TD-010](#td-010--platform-sdk-部分模块计划中未实现)                                  | Platform SDK 部分模块计划中未实现                                     | Implementation Gap | 作废          |                                              |
| [TD-011](#td-011--agent-server-直接读取-process.env-绕过-vxconfigservice)             | agent-server 直接读取 process.env                                     | Security           | Resolved      | 🔴 HIGH                                      |
| [TD-012](#td-012--bff-oauth-provider-凭据未入-core-config-schema)                     | BFF OAuth provider 凭据未入 schema                                    | Security           | Resolved      | 🔴 HIGH                                      |
| [TD-013](#td-013--bff-跨服务-url--cookie-domain-未入-core-config-schema)              | BFF 跨服务 URL / cookie domain 未入 schema                            | Implementation Gap | Resolved      | 🟡 MED                                       |
| [TD-014](#td-014--varda-server-操作配置直读-processenv-无-zod-验证)                   | varda-server 操作配置直读 process.env                                 | Implementation Gap | Resolved      | 🟡 MED                                       |
| [TD-015](#td-015--admin-bff-reporting_ro_database_url-未入-schema)                    | admin-bff REPORTING_RO_DATABASE_URL 未入 schema                       | Implementation Gap | Resolved      | 🟡 MED                                       |
| [TD-016](#td-016--model-runtime-client-model_platform_url-库级-fallback-无-fail-fast) | model-runtime-client MODEL_PLATFORM_URL 库级 fallback                 | Implementation Gap | Resolved      | 🟢 LOW                                       |
| [TD-017](#td-017--平台管理员权限平顶凭据重置无分级)                                   | 平台管理员权限"平顶"，凭据/账号管理无分级                             | Security           | Resolved      | 🔴 P0                                        |
| [TD-018](#td-018--无非-owner-服务角色列级不可变锁无法生效)                            | 无非-owner 服务角色，列级不可变锁无法生效                             | Security           | Resolved      | 🟡 MED                                       |
| [TD-019](#td-019--最后一个-super_admin-存活保护存在并发竞态)                          | 最后一个 super_admin 存活保护存在并发竞态                             | Implementation Gap | Resolved      | 🟢 LOW                                       |
| [TD-020](#td-020--platform_svc-为共享单一角色未按服务域最小权限拆分)                  | platform_svc 为共享单一角色，未按服务/域最小权限拆分                  | Security           | In Progress   | 🟢 LOW                                       |
| [TD-021](#td-021--风险合规维护窗口治理写路径未定义)                                   | 风险/合规/维护窗口治理写路径未定义                                    | Design Pending     | Resolved      |                                              |
| [TD-022](#td-022--tenant-可见运营动态内容无多语言方案)                                | tenant 可见运营动态内容无多语言方案                                   | Design Pending     | Open          | 🟢 LOW                                       |
| [TD-023](#td-023--hotfix-车道无-ci必检结构性缺席)                                     | hotfix 车道无 CI，必检结构性缺席                                      | CI/CD              | Resolved      | 🟡 MED                                       |
| [TD-024](#td-024--nest-di-装配无启动冒烟tscunit-对其失明)                             | Nest DI 装配无启动冒烟，tsc/unit 对其失明                             | CI/CD              | Resolved      | 🟡 MED                                       |
| [TD-025](#td-025--login_attempts-ip_address-多源登录获取不全)                         | login_attempts.ip_address 多源登录获取不全                            | Implementation Gap | Resolved      | 🟡 P2                                        |
| [TD-026](#td-026--admin-bff-verifications-路由被-id-遮蔽实名审核页恒-500)             | admin-bff verifications 路由被 :id 遮蔽，实名审核页恒 500             | Implementation Gap | Resolved      | 🔴 HIGH                                      |
| [TD-027](#td-027--admin-bff-authz-未按域收口legacy-桥--finance-写码缺口)              | admin-bff authz 未按域收口，legacy 桥 + finance 写码缺口              | Security           | Resolved      | 🔴 HIGH（组内最高，见批注）                  |
| [TD-028](#td-028--promotionusage-域无-perm-码commercial-仪表盘借-billingread)         | promotion/usage 域无 perm 码，commercial 仪表盘借 billing.read        | Security           | Open          | 🟢 LOW                                       |
| [TD-029](#td-029--产品目录-solutionsreleasesmodel-policies-无-schema无法去-mock)      | 产品目录 solutions/releases/model-policies 无 schema，无法去 mock     | Design Pending     | Resolved      | 🟢 LOW                                       |
| [TD-030](#td-030--券批次金额面无展示effect-jsonb-按-kind-异构未解析)                  | 券批次金额面无展示，effect JSONB 按 kind 异构未解析                   | Design Pending     | Open          | 🟢 LOW                                       |
| [TD-031](#td-031--c-端账号凭据重置无带外通道)                                         | C 端账号凭据重置无带外通道（社交-only/无验证邮箱语义未定）            | Design Pending     | Open          | 🟢 LOW                                       |
| [TD-032](#td-032--高流量只读板块无服务端分页)                                         | 高流量只读板块无服务端分页，仍全量拉取                                | Implementation Gap | Open          | 🟢 LOW                                       |
| [TD-033](#td-033--租户共享资源策略无配置界面仅运营通道可写)                           | 租户共享资源策略（D8 reserved/shared）无配置界面，仅运营通道可写      | Implementation Gap | Open          | 🟢 LOW                                       |
| [TD-034](#td-034--t1-token-exchange-签发无审计落库)                                   | T1 token exchange 签发无审计落库（product_210 §6 要求，未实现）       | Implementation Gap | Resolved      | 🟡 MED（组内第三，见批注）                   |
| [TD-035](#td-035--s2s-token-身份未绑定到-platform-router-的-workspaceproduct-参数)    | S2S token 身份未绑定到 platform router 的 workspace/product 参数      | Security           | Resolved      | 🟡 MED（组内第二，见批注）                   |
| [TD-036](#td-036--admin-首页总览大面积硬编码-mock-数据)                               | admin 首页总览大面积硬编码 mock 数据                                  | Implementation Gap | Resolved      | 🟡 MED                                       |
| [TD-037](#td-037--无安全重建单个平台服务重载-env-的运维通道)                          | 无安全重建单个平台服务/重载 env 的运维通道（registry+tag 解析陷阱）   | Implementation Gap | Resolved      | 🟡 MED                                       |
| [TD-038](#td-038--platform-env-变更后依赖整栈重建无单键热更或影响面收窄)              | platform.env 变更后依赖整栈重建，无单键热更或影响面收窄               | Architecture       | Open          | 🟢 LOW                                       |
| [TD-039](#td-039--疑似死-ci-凭证待审计清理需全域确认)                                 | 疑似死 CI 凭证待审计清理（需全域确认）                                | Security Hygiene   | Open          | 🟢 LOW                                       |
| [TD-040](#td-040--变更门控方法论未沉淀进-cicd-optimization-playbook)                  | 变更门控方法论未沉淀进 cicd-optimization-playbook                     | Documentation      | Resolved      | 🟢 LOW                                       |
| [TD-041](#td-041--admin-订阅动作写路径绕过-provisioning-派发与-c3-invalidate)         | admin 订阅动作写路径绕过 provisioning 派发与 C3 invalidate            | Architecture       | Open          | 🟡 MED                                       |
| [TD-042](#td-042--console-bff-quota-usage-绕开-c2-契约直查-db-并重复实现-reset-逻辑)  | console-bff quota-usage 绕开 C2 契约，直查 DB 并重复实现 reset 逻辑   | Architecture       | Resolved      | 🟢 LOW                                       |
| [TD-043](#td-043--平台调用-atlas-无-s2s-鉴权能力数据面均裸调用)                       | 平台调用 atlas 无 S2S 鉴权，能力/数据面均裸调用                       | Security           | 部分 Resolved | 🟢 LOW（console-bff 侧已解决，varda 侧暂缓） |
| [TD-044](#td-044--atlas-未接入平台-c2c3全平台-ai-用量对计量账单系统不可见)            | atlas 未接入平台 C2/C3，全平台 AI 用量对计量/账单系统不可见           | Architecture       | Resolved      | 🟢 LOW                                       |
| [TD-045](#td-045--atlas--runos-两侧同一个-bigint-序列化缺陷打掉-opera-两块运行数据面) | atlas / runos 两侧同一个 BigInt 序列化缺陷，打掉 opera 两块运行数据面 | Implementation Gap | Open          | 🟡 MED                                       |

---

## 详情

### TD-001 — BFF 层结构待大版本重构

| 字段         | 内容                                                        |
| ------------ | ----------------------------------------------------------- |
| **分类**     | Architecture                                                |
| **状态**     | Open                                                        |
| **登记日期** | 2026-05-14                                                  |
| **来源**     | `docs/40-implementation/packages/bff/` 各包文档、代码内注释 |

**描述**：各业务型 BFF 内部存在历史遗留结构问题，注释标记为"待大版本重构"。包括 Guard 链路不完整、跨 BFF 公共逻辑重复（如 auth 中间件、tenant 解析）、部分路由层职责混乱。

**影响**：随功能迭代，维护成本持续累积；Guard 不完整可能导致权限校验存在盲点。

**解决方向**：在 BFF 层结构趋稳后，统一提取公共 Guard/Interceptor 到 `packages/core-bff`（待建），按 ADR-004 规范逐个重构业务型 BFF。

**现状复核（2026-07-13，触发于 TD-001~010 批量复核）**：`packages/core-bff` 本身未建，但两个共享基础包在 5 月后自然长出并已被复用——`@vxture/core-auth`（`JwtAuthGuard`/`RolesGuard`/`InternalAuthGuard` 等）与 `@vxture/core-oidc-rp`（`RpAuthService` 等）。`varda-bff`/`console-bff` 的 `auth.middleware.ts` 已收敛到这两个包上，`admin-bff`/`console-bff` 两处中间件结构已高度趋同（均走 `RpAuthService.resolve()` → 校验 `claims.userType` → 查用户）。但 `admin-bff`/`website-bff`/`gateway-bff`/`agent-template-bff` 四个 BFF 仍零引用 `@vxture/core-auth`，各自手写 `auth.middleware.ts` 编排逻辑。**问题本质未变但范围已收窄**：不再是"从零建 core-bff"，而是"把剩余 4 个 BFF 的手写编排收敛到已存在的共享包上"。

**修正（2026-07-14，纳入 platform-api 拆分后的拓扑）**：D13 从 auth-bff/admin-bff 拆出了新 BFF 宿主 `bff/platform-api`（产品面 S2S），上一次复核未列入。**关键：platform-api 的鉴权模型与前面所有 BFF 不同**——它是产品→平台的 S2S 面，走独立的 `authn/platform-auth.guard.ts`（`PlatformAuthGuard`：`AUTH_INTERNAL_TOKEN` 头 + IdP JWKS 验签的 S2S bearer 双凭证），**不是 RP 会话面**。因此本 TD"收敛到 `core-auth`/`RpAuthService`"的方向对 platform-api **不适用**，收敛范围应显式排除它（RP 会话收敛与 S2S 守卫收敛是两类，后者的复用目标是 product_210 token-exchange 面而非 RpAuthService）。**修正后的准确 gap**：`admin-bff`/`website-bff`/`gateway-bff`/`agent-template-bff` 四个 **RP/会话面** BFF 的手写 auth 中间件收敛到 `@vxture/core-auth`；platform-api 的 S2S 守卫不在此列。状态维持 Open。

---

### TD-002 — Prisma schema 集中管理待重构

| 字段         | 内容                                                                |
| ------------ | ------------------------------------------------------------------- |
| **分类**     | Architecture                                                        |
| **状态**     | Resolved                                                            |
| **登记日期** | 2026-05-14                                                          |
| **来源**     | `docs/00-meta/glossary.md` → Prisma 条目；`packages/core-database/` |

**描述**：DDL 集中在 `@vxture/core-database`，当前有 6 个 schema 文件（⚠️ 待大幅重构）。随业务域增长，单包集中管理导致边界模糊，schema 变更影响面过大，迁移方向和拆分粒度尚未确定。

**影响**：schema 变更牵一发动全身；多个 service 共享同一数据库包，职责边界不清晰；重构成本随时间指数级累积。

**解决方向**：按服务域（`identity`、`commerce`、`model_platform` 等）拆分 schema，每个 service 持有自己的 Prisma schema 和 migration history；需配合 database access 层权限边界重构。

**收口（2026-07-13，走了另一条路径，非本条原设计路径）**：核心问题已彻底解决，但不是靠拆分 Prisma 包——权威改为 `deploy/database/ddl/*.sql`（`@vxture/core-database` 现仅做 Prisma Client 生成），已是 **19 个真实 PostgreSQL schema**（`00_schemas.sql` 声明 account/identity/credential/kyc/tenancy/access/appoidc/session/loyalty/metering/billing/provisioning/promotion/product/model/safety/support/admin/sharing），逐 schema 独立编号文件。域边界模糊、变更牵一发动全身两个原始痛点已消除。**唯一未达成的部分**——各 service 拥有独立的 DB 访问权限边界（原方案的后半句）——已有专门条目跟进，见 [TD-020](#td-020--platform_svc-为共享单一角色未按服务域最小权限拆分)（`platform_svc` 单角色横跨 19 个 schema 授权，未按服务最小权限拆分），不在本条重复追踪。`prisma/schema.prisma` 仍是单文件（`multiSchema` 预览特性表达 19 schema），但这是 Prisma Client 生成产物层面的技术选择，不影响已解决的核心问题。

---

### TD-003 — Business BFF 认证流程未实现

| 字段         | 内容                                                                 |
| ------------ | -------------------------------------------------------------------- |
| **分类**     | Implementation Gap                                                   |
| **状态**     | Resolved                                                             |
| **登记日期** | 2026-05-14                                                           |
| **来源**     | `docs/30-design/decisions/001-auth-bff-sole-jwt-issuer.md` §实施范围 |

**描述**：ADR-001 规定 Business BFF（varda-bff、agent-template-bff 以及外部业务 BFF）应读取浏览器已有 Cookie，未登录或 Cookie 无效时 302 跳转 console 登录页。当前仅 Platform BFF 完成实施，Business BFF 的标准认证中间件标注为 `🔲 规划中`。

**影响**：Business BFF 当前缺少规范的未授权跳转保护，认证边界依赖各 BFF 自行处理，一致性无保证。

**解决方向**：为 varda-bff、agent-template-bff 与外部业务 BFF 的 auth 中间件实现：读取 Cookie → JWT 校验 → 无效时 `302 Location: console.vxture.com/login?redirect=<当前URL>`；可提取为 `@vxture/core-bff` 公共中间件复用。

**收口（2026-07-13）**：`varda-bff`（当前唯一已建成的 Business BFF）已有真实生效的认证中间件（`src/middleware/auth.middleware.ts`：读现有 cookie → JWT 校验 → `authScope`/`userType`/`tenantId` 校验 → `AccessTokenRevocationService` 撤销检查），与"规划中"描述不符。与 ADR-001 的唯一差异是返回 401 而非 302 跳转——文件内注释明确记录这是**有意的偏离**（`/varda/*` 走 API 语义而非页面跳转语义），非缺口。`agent-template-bff` 目前 `src/middleware/` 只有 `.gitkeep`，是空脚手架，无代码可言"未实现认证"——待该服务真正立项建设时再开新条目评估，不在此空转追踪。

---

### TD-004 — 会话空闲超时未实现

| 字段         | 内容                                                                     |
| ------------ | ------------------------------------------------------------------------ |
| **分类**     | Implementation Gap                                                       |
| **状态**     | Open                                                                     |
| **登记日期** | 2026-05-14                                                               |
| **来源**     | `docs/30-design/decisions/001-auth-bff-sole-jwt-issuer.md` §会话空闲超时 |

**描述**：ADR-001 规划了 4h 空闲超时机制，基于 Redis 滑动窗口（key: `session:activity:{userId}:{surface}`，TTL 4h，每次认证请求续期）。当前未实现，所有 Platform BFF 认证请求无空闲超时保护，仅靠 access token 15min + refresh token 7d 控制有效期。

**影响**：用户长时间无操作时（如会议、锁屏期间），无人值守终端存在 stolen token 风险。

**解决方向**：在 auth-bff 的 JWT 验证中间件中新增 Redis 滑动窗口检查；配置项 `SESSION_IDLE_TIMEOUT=14400`；Redis 不可用时 fail-open（跳过超时检查，不踢用户）；豁免 `/auth/*` 和 `/health` 端点。

**复核（2026-07-13，TD-001~010 批量复核）**：全仓 grep `session:activity`/`SESSION_IDLE_TIMEOUT`/idle-timeout 相关代码，零命中——描述仍完全准确，未实现。旁证：operator 身份安全加固项目（MFA/TOTP/WebAuthn/step-up/短会话）**刻意未包含**本条描述的空闲超时机制（其"短会话"是另一种会话时长收紧手段，非 Redis 滑动窗口 idle-timeout），且该项目本身仍在未推送分支，未合入 develop。本条对 operator 与普通租户用户均仍是真实缺口，维持 Open，无需改写。

---

### TD-005 — Model Platform 流式响应未实现

| 字段         | 内容                                                |
| ------------ | --------------------------------------------------- |
| **分类**     | Implementation Gap                                  |
| **状态**     | Open                                                |
| **登记日期** | 2026-05-14                                          |
| **来源**     | `docs/30-design/model-platform.md` §11 后续推荐工作 |

**描述**：当前 Model Platform 仅支持同步响应，大模型回复长文本时用户需等待完整响应。varda-bff → browser 层已有 SSE 协议设计，但 gateway → provider 层的 streaming 调用未打通，`ChatRequest.stream: true` 参数当前无效。

**影响**：长回复场景用户体验差（TTFT 高）；大响应体增加 gateway 内存压力；Ruyin 超级智能体产品尤其依赖流式体验。

**解决方向**：在 provider adapter 层实现 streaming API 调用（async iterator / ReadableStream）；gateway HTTP controller 支持 SSE 输出；agent-server 消费 streaming 后经 BFF 转发给 browser，打通完整链路。

**复核 + 范围收窄（2026-07-13，TD-001~010 批量复核）**：`ChatRequest.stream: true` **已非无效参数**——`runtime.controller.ts::chatStream`（真实 SSE 端点，`text/event-stream`）+ `runtime.service.ts::chatStream`（含模型 fallback 迭代）+ `doubao.provider.ts`（真实上游 SSE 解析，OpenAI 兼容协议）+ `varda-bff/chat.router.ts`（把 SSE 流原样中继到浏览器）——Doubao/OpenAI 兼容 provider 一条链路端到端打通且是真实代码，非占位。但 `claude.provider.ts`/`private.provider.ts` 均未覆写 `chatStream`，落到 `base.provider.ts` 的 `throw new Error("... stream chat is not enabled yet")`。**剩余缺口收窄为**：Claude / 私有部署两个 provider 补齐 streaming 适配，而非"从零打通全链路"。维持 Open，解决方向改为仅覆盖这两个 provider。

**作废（2026-07-28）**：`services/model/platform`（本条描述的实现）已随 atlas 仓拆分整体退役，本仓不再持有该实现。剩余缺口是否成立、如何处理，是 `vxture-atlas` 自己的技术债，不在本仓登记范围。

---

### TD-006 — Model Platform Provider API Key 无轮换机制

| 字段         | 内容                                                                               |
| ------------ | ---------------------------------------------------------------------------------- |
| **分类**     | Security                                                                           |
| **状态**     | Open                                                                               |
| **登记日期** | 2026-05-14                                                                         |
| **来源**     | `docs/30-design/model-platform.md` §11 后续推荐工作；§5 `ai_model.api_key_env_var` |

**描述**：Provider API Key 当前通过环境变量注入（数据库只存变量名，Key 不入库）。该方案无 Key 轮换机制：Key 泄露后需停机修改环境变量并重启服务，多环境 Key 管理分散。

**影响**：Key 泄露后响应窗口长；轮换操作需要服务停机；无法审计 Key 使用历史。

**解决方向**：引入 Secret 管理方案（优先考虑 Kubernetes Secrets + RBAC，或 HashiCorp Vault）；gateway 启动时从 Secret Store 拉取 Key，支持定期无感知轮换；保留环境变量方案作为本地开发 fallback。

**复核（2026-07-13，TD-001~010 批量复核）**：运行时行为未变——`runtime.service.ts::resolveApiKey` 仍直读 `process.env[apiKeyEnvVar]`。但 schema 层已有专为本条设计的落地基础：独立 Model Platform DB 的 `key` schema（`key.provider_api_keys`：`encrypted_key bytea` AES-256-GCM 信封加密 + `encryption_key_id` KMS 引用；`key.key_rotation_logs` 追加型轮换审计表），`60_model.sql` 内甚至有硬注释禁止把 Key 存进 `model.model_providers`/`model_price_rules`，明确指向这个 `key` schema。但全仓 grep `provider_api_keys`/`ProviderApiKey` 零命中——无任何应用代码读写这张表。**性质变化**：不再是"需要先做方案设计"，而是"设计已定、schema 已建，只差应用层接线"，具备条件被提上日程。维持 Open。

**作废（2026-07-28）**：`services/model/platform`（本条描述的实现）已随 atlas 仓拆分整体退役,本仓不再持有该实现。provider-keys vault 在 atlas 侧已重建（`key.provider_api_keys`,product_250 M-3）并列入其批D 待接线范围,不在本仓登记范围。

---

### TD-007 — Model Platform Provider 重试 / 降级未实现

| 字段         | 内容                                                |
| ------------ | --------------------------------------------------- |
| **分类**     | Implementation Gap                                  |
| **状态**     | Open                                                |
| **登记日期** | 2026-05-14                                          |
| **来源**     | `docs/30-design/model-platform.md` §11 后续推荐工作 |

**描述**：Provider 调用当前无重试策略，瞬时故障直接返回错误给调用方。无 fallback 路由（如主 Provider 不可用时切换备用 modelCode）。

**影响**：Provider 偶发抖动直接造成用户会话中断；单点 Provider 故障导致全部 AI 功能不可用；SLA 无法保证。

**解决方向**：在 provider adapter 层实现 exponential backoff 重试（最大 3 次，仅对幂等请求）；在 `ai_model` 配置中支持 `fallback_model_code` 字段；可选引入 circuit breaker 避免雪崩。

**复核 + 范围收窄（2026-07-13，TD-001~010 批量复核）**：fallback 路由半部分**已实现且是真实工作代码**——`runtime.service.ts::resolveCandidateModels` 从主模型 `config` 读 `fallbackModelCodes` 数组建候选列表，`chat()`/`chatStream()` 均在 provider 失败时遍历候选并记录 `fallbackAttempt`（字段命名为复数数组而非原方案的单值 `fallback_model_code`，语义一致）。重试半部分**仍完全空白**——全仓 grep `retry|backoff|maxRetries|circuit.?breaker` 在 model platform 代码内零命中，无 exponential backoff、无 circuit breaker。**剩余缺口收窄为**：仅重试与熔断，fallback 路由部分从解决方向中移除（已完成）。维持 Open。

**作废（2026-07-28）**：`services/model/platform`（本条描述的实现）已随 atlas 仓拆分整体退役,本仓不再持有该实现。剩余缺口是否成立、如何处理,是 `vxture-atlas` 自己的技术债,不在本仓登记范围。

---

### TD-008 — Model Platform Provider 合同价格为占位数据

| 字段         | 内容                                                                       |
| ------------ | -------------------------------------------------------------------------- |
| **分类**     | Implementation Gap                                                         |
| **状态**     | Open                                                                       |
| **登记日期** | 2026-05-14                                                                 |
| **来源**     | `docs/30-design/model-platform.md` §10 Phase 1 Seed、§6 Cost And Fee Model |

**描述**：`model_platform.ai_model_cost_rate` 表中的 Provider 成本价格为 seed 文件占位数据，非实际合同价格。商务面向客户的计费规则（超额用量、add-on agent、私有模型部署服务、实施费）也未实现。

**影响**：毛利分析报表和 Provider 结算数据不可信；超额用量无法正确计费；商务决策依赖失准数据。

**解决方向**：商务确认各 Provider 合同单价后替换 seed 数据；在 `commerce` 域实现 overage 计费规则、add-on 定价逻辑和客户账单生成。上生产前完成此项。

**复核（2026-07-13，TD-001~010 批量复核，⚠️ 优先级待定，非常规复核收口）**：现状比原描述更糟——`seed-catalog.mjs` 里 `model.model_price_rules`（表已从原文的 `ai_model_cost_rate` 重命名重构）的 `input_unit_price`/`output_unit_price` 是**字面硬编码 0**，不是"占位数字"而是"零价"；旁边同一 seed 文件对产品目录定价也有"价格=0 待 owner 定价"的注释。commerce 侧有真实的纸面设计——`data_commerce_210_billing.md` 已定义 `item_type='metered_overage'` 账单行算法（按订阅周期窗口聚合 `metering.usage_events`，按 `model_price_rule` 计价），`billing.invoice_items` 的 CHECK 约束已包含 `metered_overage`——但全仓 grep `metered_overage` 零命中，`services/commerce/invoice/src/service/invoice.service.ts` 仅 74 行，只覆盖收据/账单地址，**无任何账单生成或超额计费的实现代码**。本条自己的原文写着"**上生产前完成此项**"，但平台已带真实租户上线一段时间——即当前生产环境的 AI 用量超额费用要么完全不计费、要么计费为零，这是本次复核中唯一发现的、可能有实质商业影响的缺口，与本次批量复核中其余"部分已被后续工作解决"的条目性质不同。**未改动状态与优先级**——是否需要立即处理、还是当前阶段本就不打算商业化超额计费（如仍处于统一定价试用期），是业务判断，不是代码可回答的问题，留给 owner 决定后再定级。

**范围收窄（2026-07-28，services/model/platform 退役）**：`model.model_price_rules` 随 atlas 仓拆分迁到 atlas 自己的库（`/capability/price-rules`，见 `vxture-atlas/docs/20-specs/10-http-surface.md`），本仓不再持有该表。本条剩余缺口收窄为**本仓 commerce 侧**：账单/发票不消费任何用量计价数据、`metered_overage` 账单行生成始终缺失——这半个缺口与"数据在哪个库"无关，本仓仍需实现。若要落地，需先接通 atlas 的 usage-summaries/price-rules 只读接口（S2S）。维持 Open。

---

### TD-014 — varda-server 操作配置直读 process.env 无 Zod 验证

| 字段         | 内容                                                |
| ------------ | --------------------------------------------------- |
| **分类**     | Implementation Gap                                  |
| **状态**     | ✅ Resolved                                         |
| **优先级**   | 🟡 MED                                              |
| **登记日期** | 2026-05-20                                          |
| **解决日期** | 2026-05-28                                          |
| **来源**     | `agent-server/varda/src/chat/chat.service.ts:40-47` |

**描述**：`chat.service.ts` 在模块顶层直接读取三个操作配置变量作为模块级常量：`VARDA_PLATFORM_LLM_TENANT_ID`（LLM 计费追踪用租户 UUID，缺失时静默使用硬编码占位 UUID）、`VARDA_DEFAULT_MODEL_CODE`（默认模型代码，缺失时使用硬编码 doubao 型号）、`VARDA_LLM_AGENT_ID`（LLM agent 过滤器，可选）。三个变量均无 Zod 格式校验，在模块加载时一次性求值，后续无法通过 DI 覆盖，也不参与 `VxConfigModule` 的 fail-fast 验证流程。

**影响**：`VARDA_PLATFORM_LLM_TENANT_ID` 缺失时会使用占位 UUID，计费数据归属混乱；`VARDA_DEFAULT_MODEL_CODE` 未配置时可能引用已停用的模型；变量配置错误在运行时才暴露，无法在启动阶段发现。

**解决方向**：在 `agent-server/varda` 的 NestJS 模块中注册 `VxConfigModule.register({ domains: ['app', 'varda'] })`，新建 `varda.schema.ts` 声明上述三个字段（`VARDA_PLATFORM_LLM_TENANT_ID` 为必填 UUID 格式，`VARDA_DEFAULT_MODEL_CODE` 为必填字符串，`VARDA_LLM_AGENT_ID` 为 optional）；`ChatService` 通过构造函数注入 `VxConfigService` 读取，移除模块级 `const` 直读。

---

### TD-015 — admin-bff REPORTING_RO_DATABASE_URL 未入 schema

| 字段         | 内容                                             |
| ------------ | ------------------------------------------------ |
| **分类**     | Implementation Gap                               |
| **状态**     | ✅ Resolved                                      |
| **优先级**   | 🟡 MED                                           |
| **登记日期** | 2026-05-20                                       |
| **解决日期** | 2026-05-28                                       |
| **来源**     | `bff/admin-bff/src/providers/pools.module.ts:41` |

**描述**：`AdminBffPoolsModule` 为只读报表数据库连接池直接读取 `process.env["REPORTING_RO_DATABASE_URL"]`，该变量未在 `database.schema.ts` 或任何其他 schema 中声明。读写池（`ADMIN_BFF_RW_POOL`）已通过 `VxConfigService.database` 正确注入；只读报表池游离于类型系统之外，缺失时静默降级至主库连接（`makePool(undefined, config.database)`），无 fail-fast 保护。

**影响**：报表查询静默落回主库 RW 连接，高负荷报表查询可能影响主库性能；`REPORTING_RO_DATABASE_URL` 配置错误（如 URL 格式不合法）在启动时不报错，而是在首次数据库操作时抛出运行时异常。

**解决方向**：在 `database.schema.ts` 中新增 `REPORTING_RO_DATABASE_URL: z.string().url().optional()`；`AdminBffPoolsModule` 通过 `VxConfigService.database.REPORTING_RO_DATABASE_URL` 读取，移除直接的 `process.env` 访问。

---

### TD-016 — model-runtime-client MODEL_PLATFORM_URL 库级 fallback 无 fail-fast 保护

| 字段         | 内容                                                    |
| ------------ | ------------------------------------------------------- |
| **分类**     | Implementation Gap                                      |
| **状态**     | ✅ Resolved                                             |
| **优先级**   | 🟢 LOW                                                  |
| **登记日期** | 2026-05-20                                              |
| **解决日期** | 2026-07-05                                              |
| **来源**     | `packages/ai/model-runtime-client/src/llm/client.ts:85` |

**描述**：`ModelRuntimeLLMClient` 构造函数在 `options.gatewayUrl` 未传入时以 `process.env.MODEL_PLATFORM_URL` 作为 fallback。该包是纯库包（无 NestJS DI），只能通过 `process.env` 读取环境变量。问题在于：`MODEL_PLATFORM_URL` 在此处仅做字符串读取，未经 Zod 的 URL 格式校验；而调用方（varda-server `chat.service.ts`）在实例化时总是传入 `options.gatewayUrl`，此 fallback 实际上是一个死代码路径，但可能给未来调用方制造误解，认为不传 gatewayUrl 是安全的。

**影响**：若未来调用方省略 `gatewayUrl` 参数，会在运行时以未经验证的 URL 发起请求；当前影响有限（varda-server 始终传入配置值）。

**解决方向**：移除 `process.env.MODEL_PLATFORM_URL` fallback，改为 `options.gatewayUrl` 为必填项；或在 constructor 中加入 URL 格式断言（`new URL(...)` 抛出则 fail-fast）。优先级低，不阻塞功能。

**修复时更正**：动手核实发现原描述与实况有出入——`chat.service.ts` 实际调用**并未**传入 `modelPlatformUrl`，完全依赖 `process.env.MODEL_PLATFORM_URL` 这条未经校验的路径（并非"死代码路径"，而是当前唯一在用的路径）。修复：① `ModelRuntimeLLMClientOptions.modelPlatformUrl` 改为必填（移除库内 `process.env` 读取）；② varda-server 的 `VxConfigModule` 新注册 `platform` domain，`chat.service.ts` 显式传入已被 Zod 校验的 `config.platform.MODEL_PLATFORM_URL`（`packages/core/config/src/schemas/platform.schema.ts` 早已是 `z.string().url()`）；③ `normalizeModelPlatformUrl` 加 `new URL(...)` 格式断言，非法 URL fail-fast。全仓库排查确认无其他调用点。

**销号**：2026-07-05 | Commit: 见相关提交 | 库改必填参数 + 调用方改走已校验配置 + 加 URL 格式断言，三管齐下同时修复"未校验 fallback"与"实际唯一调用路径也未传参"两个问题。

---

### TD-009 — surface 命名方案待定

| 字段         | 内容                                      |
| ------------ | ----------------------------------------- |
| **分类**     | Design Pending                            |
| **状态**     | Open                                      |
| **登记日期** | 2026-05-14                                |
| **来源**     | `docs/00-meta/glossary.md` → surface 条目 |

**描述**：当前 surface 取值为 `admin` 和 `console`，但 `admin` 与 RBAC 中的角色名重名，语义存在歧义。规划中 surface 将细分为两层（运营管理子域 + 平台自治子域；管理子域 + 应用子域），候选更名方案（如 `admin` → `ops`）尚未决策。

**影响**：命名歧义增加 AI coding 的上下文理解成本；两层 surface 设计未定前，CallerContext 的 `dataScope` 语义在边界场景存在模糊区间。

**解决方向**：在下一版本 surface 两层设计时一并确定命名方案，更新 glossary、ADR-001、CallerContext 类型定义，前后端协调一次性完成重命名（不分步，避免中间态混乱）。

**复核（2026-07-13，TD-001~010 批量复核）**：逐字核实仍完全准确——`varda-bff/src/types/caller-context.types.ts` 的 `VardaSurface = "admin" | "console"` 与同文件内 org 角色注释"`super_admin | admin | owner | member`"仍在同一个 `CallerContext` 对象里撞名；`surface.middleware.ts` 仍硬编码二值 `VALID_SURFACES`，两层 surface 设计未落地。未发生任何变化，维持 Open，不改写。

---

### TD-010 — Platform SDK 部分模块计划中未实现

| 字段         | 内容                                                     |
| ------------ | -------------------------------------------------------- |
| **分类**     | Implementation Gap                                       |
| **状态**     | 作废（Obsolete）                                         |
| **登记日期** | 2026-05-14                                               |
| **来源**     | `docs/40-implementation/packages/` Platform SDK 相关文档 |

**描述**：Platform SDK 中部分模块（地图集成 `amap`、三维可视化 `cesium` 等）标注为"计划中"，尚未实现。当前只有 `@vxture/platform-browser` 一个已实现 SDK，其余模块为占位。

**影响**：依赖这些功能的业务场景（无人机监测、地质灾害分析等）无法开发，需要临时方案兜底或推迟排期。

**解决方向**：随对应业务场景立项时按需开发，遵循 `packages/platform/` 下的包结构规范；不提前实现，避免过度设计。

**复核 + 场景更正（2026-07-13，TD-001~010 批量复核）**：`packages/platform/` 仍只有 `browser/` 是真实实现，`amap/`/`cesium/` 仍是空 `.gitkeep` 占位。但**原文引用的业务场景已过时**：`admin-platform-refinement-plan.md` 记录 C14 去 mock 工作已**明确删除**了包含"无人机/洪涝视频/法务库"的 mock 能力示例数据——即本条引用的"无人机监测/地质灾害分析"场景本身就是被后续工作清理掉的旧 mock 范畴。核对当前真实产品线——Arda/Ontos/Runos/Karda/Terra + Varda 助手，是结构化数据聚合/共享与 AI agent 平台，产品文档中无任何地理空间、测绘、无人机相关的产品方向。

**作废（2026-07-14）**：核实 `amap`/`cesium` 全仓**零消费方**（空 `.gitkeep`，无任何 import），且激励它们的业务场景（无人机/地质灾害）已随 C14 清理、与当前产品线无关。**在当前架构下，"这两个 SDK 占位未实现"不构成技术债**——没有任何东西需要它们，"未实现"= 按当前产品方向本就不该有，而非欠账。按 backlog 保留原则（只留"新架构下仍缺失、只是暂缓"的项），本条不符，改判**作废**。空 `.gitkeep` 占位目录本身可另行清理（非技术债）。若未来出现真实地理空间产品方向，另立新号登记，不复用本号。

---

### TD-011 — agent-server 直接读取 process.env 绕过 VxConfigService

| 字段         | 内容                                                                  |
| ------------ | --------------------------------------------------------------------- |
| **分类**     | Security                                                              |
| **状态**     | ✅ Resolved                                                           |
| **优先级**   | 🔴 HIGH                                                               |
| **登记日期** | 2026-05-20                                                            |
| **解决日期** | 2026-05-20                                                            |
| **来源**     | 历史 Ruyin 实现；P7b 后 Ruyin 代码已迁出到 `vxture/agentstudio-ruyin` |

**描述**：历史 Ruyin 后端在业务代码中直接读取 `process.env.JWT_SECRET` 用于 JWT 验证，完全绕过 `VxConfigService`。该值既无 Zod 校验（长度、格式），也无类型保障，若环境变量缺失则静默得到 `undefined`，JWT 验证会以空 secret 通过或抛出运行时错误。P7b 后 Ruyin 代码已迁出本仓，后续修正由 `vxture/agentstudio-ruyin` 维护。

**影响**：secret 缺失时行为不可预测（可能签发全为空 secret 的 token，构成认证漏洞）；与 `@vxture/core-config` 的 authSchema 验证逻辑脱节，双轨配置无法统一管理。

**解决方向**：迁移前方向是在 Ruyin Agent Server 的 `AppModule` 中注册 `VxConfigModule.register({ domains: ['app', 'auth', 'ai'] })`，注入 `VxConfigService`，用 `configService.auth.JWT_SECRET` 替换直接的 `process.env` 读取。P7b 后该实现由 `vxture/agentstudio-ruyin` 维护。

---

### TD-012 — BFF OAuth provider 凭据未入 core-config schema

| 字段         | 内容                                                                                                           |
| ------------ | -------------------------------------------------------------------------------------------------------------- |
| **分类**     | Security                                                                                                       |
| **状态**     | ✅ Resolved                                                                                                    |
| **优先级**   | 🔴 HIGH                                                                                                        |
| **登记日期** | 2026-05-20                                                                                                     |
| **解决日期** | 2026-05-20                                                                                                     |
| **来源**     | `bff/auth-bff/src/providers/dingtalk.provider.ts:63,68`、`bff/auth-bff/src/providers/feishu.provider.ts:76,80` |

**描述**：DingTalk（`DINGTALK_APP_KEY`、`DINGTALK_APP_SECRET`、`DINGTALK_SUITE_KEY`、`DINGTALK_SUITE_SECRET`）和飞书（`FEISHU_APP_ID`、`FEISHU_APP_SECRET`）的 OAuth 凭据直接通过 `process.env.XXX ?? ""` 读取，缺失时静默降级为空字符串。这些凭据既无 Zod 最小长度校验，也不在任何 `core-config` schema domain 内，启动时不会报错，但 OAuth 回调会以空凭据发起请求，导致第三方 API 静默返回授权失败。

**影响**：OAuth provider 凭据缺失时应用正常启动但登录功能不可用，错误发现滞后；凭据轮换后无法通过配置系统统一验证；安全审计无法覆盖这些字段。

**解决方向**：在 `core-config` 的 `authSchema`（或新建 `oauth.schema.ts`）中注册 OAuth provider 凭据字段，标记为 optional（未启用的 provider 不需要配置）；在 auth-bff 启动时通过 `VxConfigService` 注入，在 provider 实例化时断言所需字段存在。

---

### TD-013 — BFF 跨服务 URL / cookie domain 未入 core-config schema

| 字段         | 内容                                                                                                                                                                   |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **分类**     | Implementation Gap                                                                                                                                                     |
| **状态**     | ✅ Resolved                                                                                                                                                            |
| **优先级**   | 🟡 MED                                                                                                                                                                 |
| **登记日期** | 2026-05-20                                                                                                                                                             |
| **解决日期** | 2026-05-20                                                                                                                                                             |
| **来源**     | `bff/auth-bff/src/routers/oauth.router.ts:68-83`、`bff/auth-bff/src/routers/password-auth.router.ts:143-151`、`bff/admin-bff/src/routers/model-platform.router.ts:233` |

**描述**：以下环境变量在多处路由中直接读取，均未纳入 `core-config` 任何 schema domain：`WEBSITE_BASE_URL`、`CONSOLE_BASE_URL`、`ADMIN_BASE_URL`、`MODEL_PLATFORM_URL`、`COOKIE_DOMAIN_PLATFORM`、`AUTH_COOKIE_DOMAIN`、`COOKIE_DOMAIN_RUYIN`、`RUYIN_COOKIE_DOMAIN`。缺失时以 `?? ""` 静默兜底，Cookie domain 设为空字符串会导致 Cookie 无法在子域间共享，OAuth redirect URL 构造失败等问题。

**影响**：跨服务 URL 和 Cookie domain 配置错误时行为不可预期；无法在启动时 fail-fast；多个 BFF 读取同名变量但无统一约束，环境差异难以排查。

**解决方向**：在 `core-config` 中新增 `platform.schema.ts` domain，注册 `WEBSITE_BASE_URL`、`CONSOLE_BASE_URL`、`ADMIN_BASE_URL`、`MODEL_PLATFORM_URL`、`COOKIE_DOMAIN_*` 等字段（url 类型或 string，各自设合理默认值）；各 BFF 通过 `VxConfigService` 统一读取，移除散落的 `process.env` 直接访问。

---

### TD-017 — 平台管理员权限"平顶"，凭据/账号管理无分级

| 字段         | 内容                                                                                                                                                                                                                                                                                      |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **分类**     | Security                                                                                                                                                                                                                                                                                  |
| **状态**     | ✅ Resolved                                                                                                                                                                                                                                                                               |
| **优先级**   | 🔴 P0                                                                                                                                                                                                                                                                                     |
| **登记日期** | 2026-07-04                                                                                                                                                                                                                                                                                |
| **解决日期** | 2026-07-05                                                                                                                                                                                                                                                                                |
| **来源**     | PR #609 安全评审（B9）；`docs/30-design/identity-platform-internal-delegation.md`；`bff/auth-bff/src/routers/operator-admin-internal.router.ts`（reset-password 回传 `resetLink`）；`bff/admin-bff/src/routers/platform-admins.router.ts`（`assertCanManagePlatformAdmins` 无 rank 门控） |

**描述**：当前 operator（平台管理员）凭据/账号管理为**"平顶"模型**——任何持 `platform.admin.manage` 能力者可对**任意** operator（含更高权限者）执行 重置密码 / 改角色 / 停用 / MFA 重置，无"只能操作不高于自身 rank 的目标"校验。且**重置密码链接（一次性 bearer 令牌）回传给发起 admin 的浏览器**（`PlatformUsersPage` 弹窗显示）——发起 admin 可自行点开链接、设一个自己知道的密码，从而**知悉目标凭据并冒充登录**。

**影响**：若 operator 权限并非互为对等（存在分级），低阶 admin 可借此**提权 / 接管高阶账号**（凭据知悉型接管）；即使平顶，"运营不掌握用户凭据"这一设计属性也被破坏。属认证/授权边界漏洞（P0）。同类更直接路径：P1a 的 `POST :id/role` 允许改任意 operator 角色。owner 已判定为真实漏洞，须按分级模型整改。

**解决方向**（分级模型，owner 决策 2026-07-04）：

1. **重置优先自助发起**——用户本人经**邮件/手机**接收重置，管理员**不得平顶获取**重置链接/密码。
2. **如需管理员发起**——仅允许**高阶 → 低阶**发起，且管理员**全程不得知悉/掌握密码**：重置链接**带外投递至目标本人**（邮件/短信），发起方浏览器不回显链接。
3. 为跨阶凭据/账号操作（重置 / 改角色 / 停用 / MFA 重置）引入 operator **rank/tier 门控**：仅可操作**严格低于自身 rank** 的目标；`platform.admin.manage` 不再等价于"可管理所有人"。

**处置**：2026-07-04 登记，**暂不修改**（先推进 admin 其余收尾）；整改须先定 operator rank/tier 数据模型 + 改造 `platform-admins.router` 授权 + 重置链接投递方式（不回传发起方），并回归安全评审。PR #609 现有实现带此已知 P0 债务合入/部署前需 owner 二次确认。（数据模型前置已随 #610 落 develop：`operator_role.rank` 列 + 7 角色 rank 值 seed + `operator:account.manage` 权限目录。）

**关联范围**：B9 **create-operator（新建 operator）暂缓**——它复用同一 reset-link「平顶」流（管理员会拿到新用户初始设密链接），owner 决定（2026-07-04）**并入本项整改一并实现**（初始设密链接带外投递至新用户本人、不回传发起方），现不单独建，避免再添同源平顶面。`PlatformUsersPage` "新建用户" 保持 disabled。

**整改历程（2026-07-05，b9 分级模型）**：rank 三层门控（权限→rank 严格大于→末位 super_admin 存活）+ reset 带外投递（链接只发目标本人邮箱、发起方仅见脱敏确认）落全部跨 operator 变更端点；`updateAdminMetadata` 补齐 rank gate + before/after 审计（此前唯一漏 gate 的端点，安全评审 finding，Q 方案：保留运营代改联系方式 + 审计兜底）；**§③ verified-contact 主防线落地**（email+phone 对称）——`operator_account.email_verified`/`phone_verified` 持久列，metadata 代改联系方式即置回未验证，reset 带外投递只发 verified 目标（unverified 一律 422 `contact_unverified`），从出口单点收口，不依赖堵住每个改 email/phone 的入口；**§④ 本人自助改联系方式验证**（发码到新地址验证后写入+置 verified，恢复带外投递资格）；**§⑤ create-operator 带外初始设密**（新账号无凭据、完成设密即建立信任=置 verified，创建者不接触链接/密码，同源不再另开平顶面）。三层门控+带外投递+验证闭环端到端验证（throwaway PG 结合三份提交自查）。

**销号**：2026-07-05 | Commit: `8589b722`(rank门控/存活保护/带外重置) `500d88ce`(前端适配) `c5e143e3`(metadata rank gate 修复) `9dac6f49`(verified-contact reset 网关) `45c7c275`(自助验证+create-operator) | 平顶模型→分级模型（权限+rank+存活三层门控）+ 全链带外投递 + verified-contact 主防线，§①-⑤ 全部完成，data_platform_100 §3.2.4 检测器 #5（super_admin 全授自检）已随 seed 落地生效。

---

### TD-018 — 无非-owner 服务角色，列级不可变锁无法生效

| 字段         | 内容                                                                                                                                                                           |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **分类**     | Security                                                                                                                                                                       |
| **状态**     | Resolved（2026-07-05 生产切换完成，见文末销号记录）                                                                                                                            |
| **优先级**   | 🟡 MED                                                                                                                                                                         |
| **登记日期** | 2026-07-04                                                                                                                                                                     |
| **来源**     | `data_platform_100_architecture.md` §2.2.4 铁律八；`deploy/compose.platform.yml`（`POSTGRES_USER: vxture`）；`deploy/secrets/platform.env.example`（`DATABASE_URL=…vxture@…`） |

**描述**：铁律八要求锚点列（`id` / `*_no` / `created_at` / `admin.operator_role.rank` 等）以**列级 `REVOKE UPDATE … GRANT UPDATE(可写列白名单)`** 在 DB 层物理锁死。但 PostgreSQL 列级权限**对表 owner / superuser 无效**，而当前**全部服务以 owner 角色 `vxture` 连库**（`platform_main` 的 `POSTGRES_USER`）。旧 `identity_svc`/`ops_svc`/… 分域服务角色只存在于**已废弃的 prisma baseline**，新 `deploy/database/ddl/` 未建，部署也未使用。故列级锁若现在写入 = 对 owner 无效的摆设；若写对不存在的 `*_svc` = `apply.sh` 报错。

**影响**：锚点列不可变性当前**仅靠应用层自觉 + 命名纪律（不入可写字段集）**，无 DB 层物理兜底；直连库或应用 bug 仍可改写 `id`/`rank`/可视码等锚点。属纵深防御缺失（非当下可利用漏洞，故 MED 非 P0）。

**进展（2026-07-05，`feat/td018-column-lock-roles` 分支）**：owner 决策——先建**共享单一角色 `platform_svc`**（非按服务/域拆分，理由与后续项见 TD-020）+ `reporting_ro` 只读角色（同批补齐 TD-015 遗留的"未配置时静默降级回主库"缺口）；本轮**只做仓库内安全设计**，**不碰生产**（不切实际 `DATABASE_URL`、不动 worker-01）——生产切换是独立待授权的部署动作。已完成并 throwaway PG 端到端验证通过：

- `97_service_roles.sql`：`platform_svc`（全 18 schema 读写）+ `reporting_ro`（全 18 schema 只读）角色 + 授权，`ALTER DEFAULT PRIVILEGES` 覆盖未来新表。
- `98_column_locks.sql`：全部 106 张表逐表 `REVOKE UPDATE` + `GRANT UPDATE(可写列白名单)`，规则化脚本解析 DDL 生成、人工核对（含分区父表 `PARTITION BY` 语法、复合主键裸 `PRIMARY KEY(a,b)` 声明两处脚本 bug 修复）后落库。
- `scripts/guardrails/check-column-locks.mjs`（`pnpm lint:column-locks`）：独立检测器（`check-data-architecture.mjs` 只扫 docs，本检测器扫 ddl 本身），核对列锁与实际表结构逐表一致，冒烟测试确认能抓出"漏 REVOKE"/"锚点列混入 GRANT"两类漂移。设计文档 §3.2.4 检测器 #4 状态由 target-state 转启用。
- throwaway PG 验证：`platform_svc` 写业务列成功、写 4 类锚点列（id/`_no`/`rank`/`created_at`）全部 `permission denied`；`reporting_ro` 只读；owner `vxture` 不受影响（迁移/DDL 仍走 owner）。
- `platform.env.example` 模板加注释说明新角色 + 未来切换指引，**不改当前实际值**（仍为 `vxture`，如实反映现状）。

**剩余（独立部署动作，本轮不做）**：把 5 个平台容器（auth-bff/website-bff/console-bff/admin-bff/model-platform，共用同一份 `platform.env`）的 `DATABASE_URL`/`REPORTING_RO_DATABASE_URL` 从 `vxture`/未配置 切到 `platform_svc`/`reporting_ro`——需在 worker-01 建角色真实密码 + 改 secrets + 重启全部 5 容器，须显式单独授权。

**进展（2026-07-05 二批，`feat/td018-service-role-switch` 分支——生产切换机制落地）**：结构前置已随 reset round-2 自然完成（`apply.sh` 全量含 97/98 进活库，角色已存在、列锁已生效，见 data_platform_320 §9.6-5"TD-018 合流"）。切换机制 = **`platform-app.env` 覆盖层**（否决"直接改 platform.env"——那会把 DDL/seed/verify 的 owner 通道一并切断，28/29 脚本以 owner 写锚点列/建表是刚性需求）：

- `compose.platform.yml`：5 个服务的 `env_file` 在 `platform.env` 之后插入 `/srv/vxture/runtime/secrets/platform-app.env`（compose 后文件覆盖同名键）→ **仅服务容器**的 `DATABASE_URL` 被覆盖为 `platform_svc`，`REPORTING_RO_DATABASE_URL` 一并注入（admin-bff 报表池，TD-015 收口）；db-init/28/29/30 继续读 platform.env 的 owner 连接，零影响。
- `32-provision-service-db-roles.sh`：随机密码 + `ALTER ROLE` + 写 platform-app.env（0600）+ 新凭据连接冒烟；幂等（已存在跳过，`FORCE_ROTATE=yes` 轮换）；只设密码不建角色（角色单一权威在 97 DDL）。
- `platform-app.env.example` 入 `deploy/secrets/`。
- 兼容性核定：98 列锁**只锁 UPDATE**（`REVOKE UPDATE`+白名单 `GRANT UPDATE`），INSERT 不受限——服务显式插 `id`/`created_at` 的常态路径不受影响。
- **执行顺序（关键）**：先在 worker-01 跑 32（生成 platform-app.env）→ 再晋升部署新 compose（若顺序颠倒，compose 引用不存在的 env_file 会使 5 容器全部起不来）。
- 回退：把 platform-app.env 的 URL 改回 owner 值 + recreate 5 容器（分钟级，不必回滚 compose）。

**销号（2026-07-05，生产切换执行完成——PR #619 机制 → #620 develop→beta → worker-01 跑 32 → #621 beta→main → deploy recreate）**，验证证据：

1. 5 容器 recreate 后全 healthy（auth-bff/website-bff/console-bff/admin-bff/model-platform）。
2. `pg_stat_activity` **零服务连接使用 owner**（`platform_svc` 在连；余下 `vxture` 连接均为人工会话——Navicat/psql 稽查）。
3. 列锁实弹：以 `platform_svc` 执行 `UPDATE admin.operator_role SET rank=999` → `permission denied`；同表业务列（`description`）UPDATE 成功——铁律八锚点列不可变自此**物理生效**（此前对 owner 是无效摆设）。
4. owner 通道无损：db-init `action=verify`（经 platform.env owner 连接）baseline audit PASSED。
5. `REPORTING_RO_DATABASE_URL` 注入 admin-bff 报表池（TD-015 静默降级缺口一并收口）。

后续独立项：TD-020（`platform_svc` 最小权限拆分，LOW）仍 Open。

**解决方向**：引入**非-owner 分域服务角色模型**：① 在 `deploy/database/ddl/` 建 `*_svc` 角色 + schema/表 `GRANT USAGE/SELECT/INSERT/UPDATE/DELETE` + 锚点列 `REVOKE/GRANT UPDATE(白名单)`；② 将各服务 `DATABASE_URL` 从 `vxture` 切到对应 `*_svc`（触及 compose/secrets/多服务连库串，属部署基础设施改造）；③ 启用检测器规则 `check-column-locks`（`data_platform_100` §3.2.4 #4，现标 target-state）。须与部署侧协调，按域分批切换。

---

### TD-019 — 最后一个 super_admin 存活保护存在并发竞态

| 字段         | 内容                                                                                                                                                                                                |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **分类**     | Implementation Gap                                                                                                                                                                                  |
| **状态**     | ✅ Resolved                                                                                                                                                                                         |
| **优先级**   | 🟢 LOW                                                                                                                                                                                              |
| **登记日期** | 2026-07-05                                                                                                                                                                                          |
| **解决日期** | 2026-07-05                                                                                                                                                                                          |
| **来源**     | PR #609 安全评审（b9）；`bff/auth-bff/src/routers/operator-admin-internal.router.ts` `assertSuperAdminSurvives`；`bff/admin-bff/src/routers/platform-admins.router.ts` `changeAdminRole` 降级 count |

**描述**：TD-017 分级模型的"末位 super_admin 存活保护"用**非锁 `SELECT count(*)` → 再变更**（读已提交隔离）。两个并发操作分别停用/降级**不同**的 super_admin 时，各自的 count 都可能把对方算作"尚存"，双双通过校验 → 实际活跃 super_admin 降为 0。

**影响**：可用性（系统无活跃 super_admin，须走 break-glass 直连库复活），**非提权**——故 LOW。当前 super_admin 数量少、并发窗口极窄，实际触发概率低。

**解决方向**：把"存活校验 + 变更"收进同一事务并对候选 super_admin 行 `SELECT … FOR UPDATE`（或用 advisory lock / 单条件更新语句）串行化。disable 路径当前跨 IdP 三步非事务，收口须包事务；改动小但需一并调整 repo 层。

**修复**：新增 `PgOperatorRepository.disableOperatorGuarded`（`services/identity/iam`）——存活校验与状态更新收进同一事务，**锁定全量当前活跃 super_admin 行集合**（关键：不排除目标本身，否则两个并发调用各自排除对方后锁集合不相交、仍会双双通过）。`auth-bff` 的 `disable()` 改用该方法，替换原先非事务的 `assertSuperAdminSurvives` + `setOperatorStatus` 两步调用（连带清理 `countActiveSuperAdmins`/`assertSuperAdminSurvives`/相关常量等死代码）。`admin-bff` 的 `changeAdminRole` 降级路径同样加 `FOR UPDATE` 锁（PostgreSQL 行锁跨连接/跨进程生效，两条独立路径的锁集合有重叠即可正确互相串行化，无需共享事务）。

**验证**：真实并发竞态复现（两个独立 pg 连接同时停用两个不同 super_admin）——修复前的逻辑下二者各自会读到"还有 1 个幸存者"从而双双通过；加锁后先到者锁定全集、后到者阻塞直至前者提交，提交后重新可见的存活数正确反映已提交的变更，第二个请求被正确拒绝（`last_super_admin`）。日志证实：B 先拿锁看到 2 个 active 并提交禁用 Y；A 在 B 提交前一直阻塞，之后拿锁只看到 1 个 active（自己），正确拒绝。

**销号**：2026-07-05 | Commit: 见本 PR | 存活校验 + 状态变更收进单事务 + `SELECT...FOR UPDATE` 锁定全量候选集（不排除目标），两条独立变更路径（disable @ auth-bff、changeAdminRole 降级 @ admin-bff）均已加固并通过真实并发复现验证。

---

### TD-020 — platform_svc 为共享单一角色，未按服务/域最小权限拆分

| 字段         | 内容                                                                            |
| ------------ | ------------------------------------------------------------------------------- |
| **分类**     | Security                                                                        |
| **状态**     | Open                                                                            |
| **优先级**   | 🟢 LOW                                                                          |
| **登记日期** | 2026-07-05                                                                      |
| **来源**     | TD-018 落地决策（owner 2026-07-05）；`deploy/database/ddl/97_service_roles.sql` |

**描述**：TD-018 引入非-owner 服务角色时，owner 决策**先建一个共享单一角色 `platform_svc`**（供 auth-bff/website-bff/console-bff/admin-bff(RW)/model-platform 共 5 个进程共用），权限面等同今天的 owner 访问范围（全部 18 schema 读写），**未按服务/域做最小权限隔离**——理由是当前拓扑下 admin-bff 一个进程就横跨几乎全部 schema，精确析出每个 BFF 实际触达的 schema 边界工作量大、误授权风险高，与 TD-018 真正要解决的问题（owner 绕过列级锁）是两类不同的安全改进，不宜合并到一次生产切换里。

**影响**：`platform_svc` 一旦凭据泄露，攻击面等同今天的 owner（全库读写）——TD-018 只堵住了"绕过列级不可变锁"这一具体缺口，**未缩小**"单个服务凭据泄露的横向移动半径"。属纵深防御未完成，非当下新增风险（现状本就是 owner 全权限，TD-020 是"还没做得更好"而非"变得更差"）。

**解决方向**：待 TD-018 的 `platform_svc` 落地并稳定运行后，视需要另立项目：①逐个 BFF 进程/service 包做只读代码路径分析，精确画出每个进程实际触达的 schema/表集合；②按此拆出多个更窄的服务角色（可先按"5 个 BFF 进程"粒度，而非旧 prisma 时代的"6 个业务域"粒度，因二者拓扑已不同——见 TD-018 描述）；③分批切换每个服务的 `DATABASE_URL`，每次只影响一个进程，降低生产风险。这是一个独立的最小权限强化项目，不与 TD-018 的列锁目标混做。

**进展（2026-07-14，In Progress）**：①进程→schema 访问矩阵完成（6 进程，代码路径分析；`safety` schema 零访问、website-bff account 实为 RW=me/profile 写等修正在案）；②6 个按进程角色（`svc_auth_bff`/`svc_admin_bff`/`svc_console_bff`/`svc_website_bff`/`svc_platform_api`/`svc_model_platform`）+ 最小权限授权（只授触达 schema、其内 RW；本轮不精调 R-vs-RW，留后续）落 `97_service_roles.sql`——DO 块按 (role, schema[]) 表逐条 GRANT，幂等 CREATE ROLE。**活库 rolled-back 事务验证过**（6 角色建成、auth_bff 有 appoidc/website_bff 无 billing、ROLLBACK 后零残留）。设计+切换 runbook = `docs/30-design/data_platform_330_service-role-least-privilege.md`。角色随 reseed 建成即在库、无人用、零运行时影响。**待 owner**：per-service DB overlay env 机制（`platform-app-{svc}.env`）+ 逐进程 `DATABASE_URL` 切换（分批窗口，用 33-recreate-service.sh 重建单进程）。platform_svc 全切完后退役。

---

### TD-021 — 风险/合规/维护窗口治理写路径未定义

| 字段         | 内容                                                                                                                                        |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **分类**     | Design Pending                                                                                                                              |
| **状态**     | Resolved（2026-07-05 全链上线，见文末销号记录）                                                                                             |
| **登记日期** | 2026-07-05                                                                                                                                  |
| **来源**     | `docs/20-specs/platform/admin/admin-app-completion-plan.md`；`bff/admin-bff/src/routers/platform-admins.router.ts`（仅 openRiskCount 聚合） |

**描述**：`admin.risk_records`（风险记录）/`admin.compliance_events`（合规事件）/`admin.maintenance_windows`（维护窗口）三张表在 `deploy/database/ddl/80_admin.sql` 中有真实 DDL，但**从未被排进 admin 应用补齐计划（B1–B18）的任何一个批次**，目前只在 `platform-admins.router.ts` 的 `getPlatformOverview` 里被聚合计数（如 `openRiskCount`），没有任何列表/详情/写操作端点。**注意与 `platform-governance.router.ts`（`admin.governance_record`，密钥/任务/审批三类）区分**——后者是该计划 Q1 明确决策"不投机建 schema"、已按设计优雅返回空态，是**正确实现**，不是缺口；本条专指 risk/compliance/maintenance 这三张已建表但零写路径的表。

**影响**：风险记录标记已审阅、合规事件指派处理人/解决、维护窗口创建/更新/取消目前都无法通过 admin 界面完成（若存在则只能直连库操作）。非阻塞——现有功能不依赖这些写路径，只是能力缺口。

**解决方向**：需产品先定义具体字段/工作流（如：风险记录是否需要 reviewer_id+reviewed_at 标记模式？合规事件的处理状态机有哪些状态？维护窗口 CRUD 的权限门槛与是否需要提前通知）。有明确定义后，可参照 `platform-admins.router.ts` 已有模式（能力门控 + 审计日志 + 视情况 `@RequireStepUp`）实施，工作量不大，主要是设计前置。**不投机实现**——按项目"先有依据才动手"纪律，无产品定义前不写字段/工作流。

**进展**：2026-07-05 设计稿已成 → [`docs/20-specs/platform/admin/governance-write-paths.md`](../20-specs/000-platform/admin/30-governance-write-paths.md)（三表工作流/状态机、端点清单、权限映射含新增 `tenant:risk.*`/`compliance:event.*` 四码、GQ1–GQ8 默认决策），owner 审定（v1.1，修订 4 处）后按 G1/G2/G3 实施。

**销号（2026-07-05，全链上线 —— PR #615 合 develop=`30f01951` → 活库 seed 补投 → beta→main 部署）**：

1. G1 后端：3 router（risk-records/compliance-events/maintenance-windows）+ governance.shared + seed 4 码；throwaway PG 22 条 PREPARE 全过 + 三状态机 runtime 实测（升险清 reviewer / assign 转态 / complete 记 actual_end_at / 终态守卫）。
2. G2 前端：3 页面 + 导航 + i18n 两语言 + 17 client 方法；type-check/eslint 绿。
3. G3 部署：活库 `db-init action=seed`（expected_sha pinned）幂等补投 → **37 operator_permission，super_admin 全授 37/37，4 码带 i18n 键（`ops.perm.tenant.risk.read` 等，经 §3.2.5 派生管道）**，baseline audit PASSED（含 C2）→ 代码部署 success，admin/admin-bff healthy 零错误。**先 perm 后代码**的批次顺序按 §6 执行，无 403 窗口。

### TD-022 — tenant 可见运营动态内容无多语言方案

| 字段         | 内容                                                                                  |
| ------------ | ------------------------------------------------------------------------------------- |
| **分类**     | Design Pending                                                                        |
| **状态**     | Open                                                                                  |
| **优先级**   | 🟢 LOW                                                                                |
| **登记日期** | 2026-07-05                                                                            |
| **来源**     | seed 修正线全库 `*_key` 稽查（data_platform_100 §3.2.5 适用面裁定时排除出来的第三类） |

**描述**：`admin.announcements`（title/cta_label/content）与 `admin.maintenance_windows`（title/description/impact_description）是**运营撰写、tenant 可见**的动态内容。`*_key` i18n 机制（键指向前端静态 locale 文件）对它们不适用——运营运行时撰写的内容进不了 locale 文件。当前这两表事实上单语。

**影响**：多语言租户看到的公告/维护通知只有运营撰写时所用的语言。dev 阶段无外部租户，无实际影响；上多语言租户后成为体验缺口。

**解决方向**：内容级多语言——如 `title_i18n`/`content_i18n` jsonb（`{"zh-CN": "...", "en": "..."}`）或子表 per-locale 行，运营后台提供多语输入；读取按租户 locale 取值、缺失回退默认语言。属独立设计项，届时按 [文档驱动实施闭环] 先设计后落地。

---

### TD-023 — hotfix 车道无 CI，必检结构性缺席

| 字段         | 内容                                                         |
| ------------ | ------------------------------------------------------------ |
| **分类**     | CI/CD                                                        |
| **状态**     | Resolved                                                     |
| **优先级**   | 🟡 MED                                                       |
| **登记日期** | 2026-07-06                                                   |
| **来源**     | auth-bff DI 宕机热修（PR #640）——首次真实走 hotfix→main 车道 |

**描述**：`enforce-branch-flow` 允许 `main ← hotfix/*`，但 CI workflow（quality-gate/build/test-coverage）不在 target=main 的 PR 上触发——hotfix PR 只有 branch-flow 一项 check，分支保护的必检**结构性无法满足**，被迫 `--admin` 绕过合并（本次内容有本地 tc+46 单测+真实 boot 验证兜底，但机制上是裸的）。

**解决方向**：CI workflow 的 `pull_request` 触发面扩到 base=main（或专设 hotfix 快速通道 job：build+test 精简集）；hotfix 合并后的 back-flow（main→develop 谱系回灌）流程一并文档化——本次靠"squash 父恰为 develop tip"才能纯 ff 修复，一般情形需要预案。

**实施（2026-07-13）**：选**扩大触发面**而非专设精简通道——`docs/10-standards/git-workflow.md` §1.5 的 required checks 矩阵早已把 `quality-gate`/`build`/`test-coverage`/`audit` 列为 `main` 的必检项，说明这本来就是既定契约，只是 `ci.yml` 没跟上实现；专设精简通道会引入新 job 名，还得同步改 ruleset（本仓改不到，是 GitHub 侧配置），风险更大。`ci.yml` 的 `pull_request.branches` 加入 `main`（`push.branches` 不动——`beta`/`main` 只由 `branch-promotion` workflow 的 fast-forward push 更新，不是普通 push 事件）。**代价**：`beta -> main` 晋升 PR 现在也会触发一次冗余但无害的重跑（该 SHA 已在 `develop` 通过；晋升本身低频、人工触发，可接受，已在 `ci.yml` 注释里写明）。**back-flow 文档化**：`docs/10-standards/git-workflow.md` 新增 §3.3，把此前"完成后补同等修复回 develop"这句抽象承诺具体化为可执行步骤（记录 hotfix commit → 从 develop 开 `fix/*` → cherry-pick → 走标准 `fix/* -> develop` PR 流程 → 随下次常规晋升自然回到 main），并明确禁止 `main -> develop` 或 `sync/*` 直接回灌（绕过质量门禁）。验证：改动仅 workflow 触发面 + 纯文档，无代码路径；`ci.yml` YAML 结构人工核对（无 yaml lint 工具本地可用），随本 PR 的 CI 运行本身即是端到端验证（这是第一个真正命中新触发条件的 PR，虽然 base=develop 非 main，但工作分支侧的 `check`/`build`/`test` 逻辑与 base 无关，行为等价）。

**销号**：2026-07-13 | Commit: 见本 PR | `main` 已纳入 CI 触发面，hotfix→main 车道不再有必检结构性缺口；back-flow 操作步骤已文档化。真正的 hotfix→main PR 验证留待下次真实紧急修复发生时回填。

### TD-024 — Nest DI 装配无启动冒烟，tsc/unit 对其失明

| 字段         | 内容                                                                     |
| ------------ | ------------------------------------------------------------------------ |
| **分类**     | CI/CD                                                                    |
| **状态**     | Resolved                                                                 |
| **优先级**   | 🟡 MED                                                                   |
| **登记日期** | 2026-07-06                                                               |
| **来源**     | PR #637 生产事故：providers 注错模块作用域 → auth-bff 崩溃循环约 40 分钟 |

**描述**：Nest 的模块作用域 DI 在**运行时 bootstrap**才解析；tsc 与 vitest 单测（46 全绿）完全看不见 `UnknownDependenciesException`。#637 把新 provider 只注进扁平 app.module，而消费方 `AuthnService` 在 AuthnModule 注入器内解析 → 全量 CI 绿、部署即崩。热修时的验证手段（本地真实 boot 到 Redis 连接层）证明了正确判据。

**解决方向**：给各 Nest bff/service 加 **boot-smoke**（CI job：假 env 启动进程，断言日志无 `UnknownDependenciesException` 且到达连接阶段，超时即杀），挂进 quality-gate 或 docker-build 前置；或用 `Test.createTestingModule({imports:[AppModule]}).compile()` 编译级冒烟（需 mock 掉 config/连接工厂）。

**进展（2026-07-12，C17，admin 侧落地）**：选**真实 bundle boot** 而非 compile-级冒烟——后者跑的是 ts 源码，看不见 esbuild bundle 特有的隐式构造注入陷阱（[[reference_nestjs_di_esbuild_trap]]），而生产跑的正是 `dist/main.cjs`。落地件：① `bff/admin-bff/src/main.ts` 加 `BOOT_SMOKE=1` 分支（create+init+close+exit 0，不 listen）；② 通用 runner `scripts/guardrails/boot-smoke.mjs`（假但 schema-valid 的 env 从干净环境 spawn bundle，60s 超时杀，非 0 即失败）；③ admin-bff 加 `build:bundle`/`boot-smoke` 脚本；④ `ci.yml` build job 加「Build admin-bff bundle」+「Boot-smoke」两步（docs-only 跳过）。已本地在 **无 .env.local**（镜像 CI）验证 exit 0，且冒烟已实证非 no-op（会因 DATABASE_URL 格式/缺 JWT secret 而 exit 1）。**剩余**：其余 Nest BFF（auth-bff/console-bff/website-bff/varda-bff）各自 main.ts 采纳同款 BOOT_SMOKE 分支后接入同一 runner（各自 env 域不同，逐个落地）——runner 已通用化，故为增量。全部 BFF 覆盖后销号。

**进展（2026-07-13，auth-bff 落地）**：同款 `BOOT_SMOKE=1` 分支 + `build:bundle`/`boot-smoke` 脚本落地，但发现一处与 admin-bff 的真实差异——auth-bff 的 `RedisService.onModuleInit()` **显式 `await connect()` 且连不上就抛 `ServiceUnavailableException`**（刻意的 fail-closed 设计：auth-bff 是中央 session store，没有 Redis 就不该起来），不同于其他 BFF 里 ioredis 客户端非阻塞式构造。**不为过冒烟弱化这条生产正确性**——改为给 runner 加一个受控逃生口：`boot-smoke.mjs` 读取自身进程的 `REDIS_URL`（若设置）覆盖 FAKE_ENV 里那个不可达的默认值；`ci.yml` 的 `build` job 加 `services: redis:7-alpine`（health-checked 的临时容器），仅 auth-bff 的 Boot-smoke 步骤传入 `REDIS_URL: redis://localhost:6379`，其余 BFF 步骤不受影响（本地验证：无覆盖时 auth-bff 冒烟按预期 fail-closed 退出 1；`REDIS_URL` 指向真实本地 Redis 后冒烟通过；admin-bff 冒烟不受影响仍 OK）。auth-bff 全量单测 137 通过、tsc/eslint 干净。**剩余**：console-bff/website-bff/varda-bff。

**进展（2026-07-13，console-bff/website-bff/varda-bff 落地，全部 BFF 覆盖完成）**：console-bff/website-bff 均为 admin-bff 同款非阻塞 Redis 构造（`oidc-rp.module.ts` 里 `lazyConnect: false` 但不 await，不阻塞 boot），直接套用现有 FAKE_ENV 一次通过，无需改动。varda-bff 复现了 auth-bff 同款陷阱——但源头不同：不是自家 `redis/redis.service.ts`（那个是显式 fail-open 设计，注释写明"Redis 不可用时允许请求通过"），而是从 `@vxture/core-auth` 引入的 `AccessTokenRevocationService`（jti 吊销检查的共享实现），其 `onModuleInit()` 同样 `await connect()` 失败即抛 `ServiceUnavailableException`；四个 BFF 里唯独 varda-bff 的 `app.module.ts` 引了这个共享服务，其余三个没有。复用 auth-bff 已建好的 `REDIS_URL` 逃生口机制，varda-bff 的 Boot-smoke 步骤同样传入真实 Redis service container 地址。`ci.yml` build job 新增六步（console/website/varda 各「Build bundle」+「Boot-smoke」）。`scripts/guardrails/boot-smoke.mjs` 头部注释更新为覆盖两个 fail-closed 目标（auth-bff + varda-bff）而非一个。全部本地验证：四个 BFF（含 admin-bff 复验）+两种 Redis 场景（无覆盖/真实覆盖）逐一 boot-smoke 通过；五个 BFF 逐一 tsc/eslint 干净。**全部 5 个 Nest BFF（admin/auth/console/website/varda）覆盖完成，销号**。

**销号**：2026-07-13 | Commit: 见本 PR | 5 个 Nest BFF 全部接入 boot-smoke，两处 fail-closed Redis 场景（auth-bff/varda-bff）均以真实 ephemeral Redis service container 验证，未弱化任何生产安全设计。

---

### TD-025 — login_attempts.ip_address 多源登录获取不全

| 字段         | 内容                                                                  |
| ------------ | --------------------------------------------------------------------- |
| **分类**     | Implementation Gap                                                    |
| **状态**     | Resolved                                                              |
| **优先级**   | 🟡 P2                                                                 |
| **登记日期** | 2026-07-06                                                            |
| **来源**     | 首用户(feishu)登录核验：`session.login_attempts.ip_address='unknown'` |

**描述**：登录流水写路径已就位（#637），但**各登录源的 IP/UA 获取不一致**：密码/手机/邮箱登录经 `oidc.router` 从 `req` 解析 `clientIp/userAgent` 后穿透到 `completeLoginWith*`；**社交登录（feishu 等）的成功记录走 `completeLoginWithUser` 尾部**，IP/UA 未从上游 OAuth 回调链穿透过来，被记为 `unknown`（代码内已注释此限制）。首用户 feishu 登录实测 `ip=unknown`。

**影响**：admin 名册/审计的"最近登录 IP"对社交登录用户为空——风控/异常检测/审计溯源少一维。非阻塞（登录方式与时间仍准确记录）。

**解决方向**：分析**多源登录的 IP/UA 采集路径**统一化——社交回调控制器（`social.controller`）拿到 `req` 时把 `clientIp/userAgent` park 进 challenge/pending-bind 态，`completeLoginWithUser` 从中取回；或在 social 尾部补传。注意 nginx/CF 前置时取 `X-Forwarded-For` 首段（`resolveClientIp` 已有逻辑，复用）。属实现补齐，非设计缺口。

**审计推翻原方案 + 实施收口（2026-07-13）**：动手前先审计全仓所有写 `login_attempts` 的入口 + 所有 IP 解析实现，发现本条自己写的解决方向有误——「取 XFF 首段」在本部署拓扑下**正好是不可信的一段**。nginx（`deploy/nginx/nginx.conf` + `snippets/cloudflare-realip.conf`）已用 Cloudflare 校验过连接方并把 `$remote_addr` 纠正为真实客户端 IP，随后以 `X-Real-IP` 头传出（但全仓零处读取）；`X-Forwarded-For` 走 `$proxy_add_x_forwarded_for`，是**追加**在客户端原有 XFF 之后而非替换——客户端可在到达 Cloudflare 前自行伪造一个"首段"，可信值反而在**末段**。全仓另排查出 4 处独立重复的 IP 解析实现（`oidc.router.ts`/`authn.controller.ts` 两处重复 + `operator-stepup.router.ts` + admin-bff 的 `orders.router.ts`/`subscriptions.router.ts`/`audit-log.ts`），全部读首段，同一类错误。**实施**：新增 `extractClientIp()`（`packages/core/utils/src/utils/http.utils.ts`，导出为 `@vxture/core-utils`），信任链改为 `X-Real-IP → CF-Connecting-IP → X-Forwarded-For 末段 → socket → "unknown"`；上述 6 处（含 blast radius 最大的 `admin-bff/audit-log.ts`，喂 `support.audit_logs.ip_address`，覆盖几乎所有 operator 写操作）统一迁移到共享工具；`social.controller.ts` 的 `callback`/`bindPhone` 两个 handler 补 `@Req()`，真正采到 IP/UA 并穿透 `social-auth.service.ts → oidc.service.ts::completeLoginWithUser`，`login_attempts.ip_address` 不再退化为 `unknown` 字面量。vitest 新增对抗性用例（伪造 XFF 首段场景断言取到末段真实 IP）。`@vxture/core-utils`/`bff-auth`/`bff-admin` 三侧 tsc + vitest + lint 全绿（217 测试通过，7 个跳过为预置的需真实 DB 集成测试，与本改动无关），`pnpm lint:boundaries` 0 违规。PR #764，已合并 develop（`ec6d9ebe`）。

---

### TD-026 — admin-bff verifications 路由被 :id 遮蔽，实名审核页恒 500

| 字段         | 内容                                                                                      |
| ------------ | ----------------------------------------------------------------------------------------- |
| **分类**     | Implementation Gap                                                                        |
| **状态**     | Resolved                                                                                  |
| **优先级**   | 🔴 HIGH                                                                                   |
| **登记日期** | 2026-07-11                                                                                |
| **来源**     | admin 平台全面盘点（admin-platform-refinement-plan §0.2-1）；同版本 Nest 11.1.16 最小复现 |

**描述**：`tenants.router.ts` 中 `@Get(":id")` 声明先于 `@Get("verifications")`，Nest/Express 按声明序匹配 → `GET /api/tenants/verifications` 落入 `getTenant(id="verifications")` → `TENANT_DETAIL_SQL` 的 uuid 比较 22P02 → 500。前端 `readJsonStrict` 抛错且无 catch，`/verifications` 实名认证审核页列表恒空/报错，approve/reject 写端点（三段路径无遮蔽）因列表无数据实际不可达。B3/B10 交付后一直存在，未被任何测试捕获（写路径零测试 + 无 boot-smoke）。

**影响**：租户实名认证审核在 admin 门户完全不可用——KYC 审批只能进库手改；属生产级功能坏死。

**解决方向**：① 静态段路由挪到 `:id` 之前；② `getTenant` 加 `requireUuid` 预校验（异常输入 400 而非 500）；③ 路由声明序回归 spec（源码级扫描全部 router，静态段被参数路由遮蔽即 fail），防整类复发。

**销号**：2026-07-11 | Commit: 见本 PR（feature/admin-platform-refinement C1） | 三项全部落地：verifications 三路由前移 + `getTenant` UUID 预校验 + `route-order.spec.ts` 全 router 遮蔽扫描（41 测试全绿，扫描确认其余 28 个 router 无同类问题）。

---

### TD-027 — admin-bff authz 未按域收口，legacy 桥 + finance 写码缺口

| 字段         | 内容                                                                                    |
| ------------ | --------------------------------------------------------------------------------------- |
| **分类**     | Security                                                                                |
| **状态**     | Resolved                                                                                |
| **优先级**   | 🔴 HIGH（2026-07-13 由 MED 上调——见下方「优先级批注」）                                 |
| **登记日期** | 2026-07-11                                                                              |
| **来源**     | admin 平台全面盘点（admin-platform-refinement-plan §0.2-4）；`auth.service.ts` 桥自注释 |

**描述**：operator RBAC 目录（`seed-catalog.mjs` / data*admin_200 §4）37 码，但 admin-bff 多数业务 router 仍用 `LEGACY_CAPABILITY_BRIDGE` 折算出的 5 个 legacy 平铺串（`platform.tenant/pricing/product/model.manage`、`platform.audit.read`）守卫，未按域收口，导致：① **read/manage 分级失效**——业务 router 读端点统一用 manage 级或 legacy 串闸门，auditor 的 22 个只读授权无法兑现差异化访问；② **守卫域错位**——tickets/orders/billing/accounts 用 `platform.tenant.manage`（应为 `support:ticket.*`/`commerce:order.read`/`user:profile.read`），subscriptions/payments/invoices/commercial 用 `platform.pricing.manage`（应为 commerce 域），角色矩阵与实际可达性双向错位（finance 有 `commerce:subscription.read`却进不了订阅页；operation 有`product:price.manage`反而能执行订阅暂停/取消写）；③ **catalog 缺 finance/commerce 写码**——目录只有`commerce:subscription.read`/`commerce:order.read`/`commerce:refund.execute`，**没有** billing/payment/invoice/subscription 的 \_write* perm 码，故这些财务写路径无法按域正确收口（当前借 `product:price.manage` 兜底）。

**已部分收口（2026-07-11，C4）**：`content:announcement.manage`（发/删公告，堵住任意 operator 越权）、`audit:read`（中央审计读，堵住任意 operator 读 IP/邮箱）两处**真实越权洞**已按正确码收口；清理 `platform.admin.manage` 永假死检查与 `tenant:manage` 孤儿 shim。

**影响**：低权限 operator 的可达性与设计矩阵不符（部分越权、部分误拒）；read/manage 分级形同虚设。C4 后最严重的两个越权洞已堵，剩余为「域错位 + 分级未兑现 + 写码缺口」的一致性债，非即时可利用漏洞。

**解决方向**：① **catalog 设计决策**（需 owner）——是否补 `commerce:billing.manage`/`commerce:payment.manage`/`commerce:subscription.manage` 等 finance 写码（涉及 seed 改 + 生产 reseed + 角色矩阵更新）；② 待写码定案后，逐 router 把守卫迁到三段式正确域 + read/manage 分级（读端点 `.read||.manage`，写端点 `.manage`），**先核角色矩阵后改代码**（TD-021「先 perm 后代码无 403 窗口」教训）；③ 收敛后退役 `LEGACY_CAPABILITY_BRIDGE`。已知风险：admin 门户导航不按 capability 过滤，收口后部分角色会「菜单可见→403」，需配合导航 capability 过滤（另项）。

**进展（2026-07-11，owner 四点裁决→变更集已 commit，待 reseed）**：变更稿 = `docs/20-specs/platform/admin/td-027-finance-authz-codes-proposal.md`；commit `8803ee89`（+`09da60ea` 注释修正）。① 补 10 完整对称码（`commerce:{subscription,billing,invoice,payment}` read/manage + 三危码 `billing.discount`/`invoice.void`/`payment.settle`），seed 37→47、finance 拿全结算链 + auditor 补三读码；② 五财务 router + commercial 守卫迁三段式域码 + read/manage 分级，三危码拆独立 step-up 端点，旧多-action 端点加 fail-fast allow-list（DB 前拒危 action，`billing-action-guard.spec.ts` 4 例回归）；③ `product:price.manage→platform.pricing.manage` 桥退役；`data_admin_200 §4` 同步。45 vitest 全绿。

**部署 runbook（先 perm 后代码，未执行）**：① `git push` 后走生产 reseed（seed 先入 catalog，无路由引用惰性无害）；② **reseed 后核对生产 `operator_permission` 计数 == 47** 再放行路由部署；③ 路由部署后**三角色冒烟**：finance 能进订阅页并操作 / operation 触财务写被拒且 commercial 仪表盘不可见（确认预期非报错）/ 危操作（核销·红冲·减免·线下收款确认）触发 step-up 弹窗；④ reseed 前**知会 operation 干系人「商业化仪表盘将不可见」**（避免权限收窄以线上事故形态被发现）；⑤ 冒烟过后关本条 TD-027 + [[TD-028]] 收尾。导航 capability 过滤仍属另项。

**优先级批注（2026-07-13，与 TD-034/TD-035 一并复核）**：TD-027 从 🟡 MED 上调至 🔴 HIGH，排在本轮复核的三项（TD-027/TD-035/TD-034）最前，理由：①**当前生产就在越权**——`operation` 角色凭 `product:price.manage` 桥错位可直接执行订阅暂停/取消写，是真人 operator 在生产环境的活跃越权，不是理论风险或内部可信调用方的颗粒度问题（对比 TD-035 的调用方目前只有 arda 一家、TD-034 只是取证缺口而非访问控制缺口）；②**修复已就绪**——owner 裁决已拍板、变更集已 commit（`8803ee89`/`09da60ea`）、45 vitest 全绿、部署 runbook 已写好，唯一阻塞是**生产 reseed 这个运维动作还没执行**，不需要额外设计或开发投入，是本轮三项里少见的"随时可关"项。**修正后组内顺序：TD-027（HIGH，待执行 reseed）→ TD-035（MED，S2S 授权颗粒度）→ TD-034（MED，审计取证缺口）**；TD-028/TD-033 维持 🟢 LOW 不变（前者是 TD-027 下游、故意延后建；后者已有安全默认生效，非阻塞）。

**生产 reseed 执行 + 部分冒烟完成（2026-07-13）**：核查发现 `deploy-production` 在 `main` 每次 push 后自动触发、无"等 reseed"人工闸门——TD-027 代码（commit `6e54dbb1`/#729）已随 `83c41a51` 部署上生产约 24 小时，但 catalog 当时仍是 37 码，五个财务路由已挂新域码守卫却无一角色能持有这些码，**推定生产当时对所有角色（含 finance）fail-closed**（容器日志未见实际 403 命中，判断是这段时间没人真去点财务页面，不是"没坏"）。已执行 `SEED_SAMPLE=false` 的 catalog-only reseed，`admin.operator_permission` 37→51（10 项为 TD-027、其余为期间累积的其他批次目录变更，非异常）。**DB 层直接核对 `admin.operator_role_permission`**，结果与设计完全吻合：finance 持有完整结算链（billing/invoice/payment/subscription 的 manage+read、refund.execute、billing.discount）；operation 已失去 `subscription.manage`/`billing.manage`（即原越权洞），只留 `subscription.read`/`order.read`；auditor 持有四个只读码。代码路径确认 `req.capabilities` 由 `platformAuthService.getCapabilities()` **按请求实时查库**（非登录时刻烘进 token），故修复对所有已登录会话立即生效，无需重启/重新登录。**真实 HTTP 三角色冒烟未能完成**：创建 finance/operation 两个临时测试 operator 账号后，纯脚本 OIDC 登录被 Cloudflare Turnstile（人机校验）拦截；改用 Claude in Chrome 真实浏览器驱动，Turnstile 视觉上显示"Success"，但控制台持续报 `onload callback 'onloadTurnstileCallback' ... got 'undefined'`，判断是 CDP 驱动的自动化交互被 Turnstile 静默识别，从未真正把 token 交回页面——点击登录按钮全程不产生任何到 `auth-bff` 的网络请求（服务端日志长时间无新记录可佐证）。过程中发现并修复一个自造 bug：临时账号密码哈希最初用 PowerShell **可展开** here-string 写入，`$argon2id$...` 被当变量插值吞掉，已用不可展开 here-string 改写、DB 内校验字符串完全正确后仍确认此路不通，遂放弃继续追加自动化尝试。两个临时账号已清理（`DELETE FROM admin.operator_account`，credential 级联删除）。**结论**：DB 层角色矩阵 + 代码路径已双重确认修复生效，但**尚未有真人在真实 UI 上点击验证**，也**未通知 operation 干系人**其 commercial 仪表盘可见性已变化——这两项仍是打开状态，建议 owner 后续找一个 2 分钟窗口用真实浏览器登录 finance/operation 测试账号验证一遍再正式关闭本条。

**人工冒烟通过，收口销号（2026-07-13，验证人：owner）**：验证方式为**真实浏览器人工登录**（自动化路径已确认不可行，见上——脚本化 OIDC 与 Claude in Chrome 均被 Cloudflare Turnstile 静默拦截，点击不产生任何到 auth-bff 的网络请求）。分别以 finance / operation 测试账号真人登录，三项冒烟全部通过：① finance 能正常打开订阅页并执行操作；② operation 财务写入被拒（403，符合设计预期），且 commercial 仪表盘不可见；③ 三个危险操作（billing discount / invoice void / payment settlement）均正确触发 step-up 二次验证弹窗。**生产事实**：`admin.operator_permission` 生产 reseed 已完成，37→51（其中 10 项为本 TD 的财务对称码，其余为期间累积的其他批次目录变更）；`operator_role_permission` 生产实测与设计矩阵完全吻合。**operation 干系人通知已发出**（commercial 仪表盘可见性变化，避免以「线上事故」形态被发现）。至此部署 runbook 四步全部完成，本条与下游 [TD-028](#td-028--promotionusage-域无-perm-码commercial-仪表盘借-billingread) 的关联备注已同步更新（TD-028 本身状态与解决方向不变，仍是"不投机建"的独立延后项）。导航 capability 过滤仍属另项，未纳入本 TD 范围。

---

### TD-028 — promotion/usage 域无 perm 码，commercial 仪表盘借 billing.read

| 字段         | 内容                                                                  |
| ------------ | --------------------------------------------------------------------- |
| **分类**     | Security                                                              |
| **状态**     | Open                                                                  |
| **优先级**   | 🟢 LOW                                                                |
| **登记日期** | 2026-07-11                                                            |
| **来源**     | TD-027 落地边界判断（owner 裁决 §2）；`commercial.router.ts` 守卫注释 |

**描述**：operator RBAC 目录无 **promotion 域**（卡券批次/核销配置）与 **usage/metering 域**（用量计量规则/告警）的 perm 码。`commercial.router` 的四个只读仪表盘端点（usage-metering / promotions / promotion-redemptions / overview）跨 metering/promotion/billing 三域，TD-027 硬切时将其归到财务读的最贴近码 `commerce:billing.read`——这是**范围内的将就解**（cross-域仪表盘借单域读码），正解是 dashboard 专码或补齐 promotion/usage 三域读码。

**影响**：① `commercial` 仪表盘的可达性与 `commerce:billing.read` 绑定（operation 无此码→看不到仪表盘，这是 TD-027 有意收窄的预期行为，非本 TD 缺陷）；② 未来若 promotions 页要加**写路径**（批次创建/发码/暂停），或 usage 页要加**计量规则/告警配置**，无对应 perm 码可挂，必再次借码——与 TD-027 修的病根同类。

**解决方向**：待 promotion/usage 出真实运营写需求时，按 TD-027 同款读写对称原则补域码（`promotion:voucher.read/.manage`、`metering:usage.read` / `metering:rule.manage` 等，命名与数据域对齐），并把 commercial 仪表盘从借用的 `commerce:billing.read` 迁到 dashboard 专码或各域精确读码。**不投机建**：无写需求前不预造码（起步最小化）。若 operation 提出「需要看商业化仪表盘」的真实需求，走本 TD 的 dashboard 专码，**不回头授 `commerce:billing.read`**（那是又一次超额授权——授出全部应收明细读权限换一个聚合视图可见）。

**上游关联更新（2026-07-13）**：[TD-027](#td-027--admin-bff-authz-未按域收口legacy-桥--finance-写码缺口) 已人工冒烟验证通过并收口销号，其中「operation 看不到 commercial 仪表盘」的行为已生产实测确认为**符合设计的预期结果**（借用 `commerce:billing.read` 导致的可达性绑定，非 bug），并已通知 operation 干系人。本条状态与解决方向不变——`promotion:voucher.*` / `metering:usage.*` 等专码仍是"不投机建"，等待真实写需求或 operation 正式提出仪表盘可见性诉求后再按上方方向补码。

### TD-029 — 产品目录 solutions/releases/model-policies 无 schema，无法去 mock

| 字段         | 内容                                                                                                  |
| ------------ | ----------------------------------------------------------------------------------------------------- |
| **分类**     | Design Pending                                                                                        |
| **状态**     | Resolved（2026-08-31）                                                                                |
| **优先级**   | 🟢 LOW                                                                                                |
| **登记日期** | 2026-07-12                                                                                            |
| **来源**     | C14 去 mock 摸底（admin 平台完善 P3）；`bff/admin-bff/src/routers/products.router.ts` STILL MOCK 注释 |

**描述**：`products.router` 的 `capabilities` / `agents` 两端点已于 C14 去 mock 接活库（`product.products` 统一目录 + `product_metrics` + `product_webhooks`）。其余四端点——`solutions`（行业解决方案，如洪涝监管/智慧法务）、`service-plans`（solution × tier）、`releases`（发布+定价+版本标签的复合结构）、`model-policies`（模型授权策略）——在 `product` schema 里**无对应表**，仍返回硬编码 mock（时间戳恒 `2026-04-25`）。solutions/releases 是产品目录里尚未定义的建模概念；model-policies 归属 model platform（B11 延后）。

**影响**：admin「产品」板块的解决方案页 / 服务套餐页 / 发布信息 / 模型授权仍展示虚构 demo 数据，与真实 4 产品（ruyin/umbra/runos/arda）目录脱节；运营无法据此做真实决策。去 mock 不是代码机械问题，而是产品目录成熟度问题——无表可接。

**解决方向**：先出**产品目录细化设计**定义 solutions（行业方案聚合模型）与 releases（发布/版本/定价打包模型）的 schema + seed，model-policies 随 B11 Model Platform DB infra 落地；表与 seed 就绪后按 capabilities/agents 同款方式接活库。**不投机建表**：无产品设计前不预造 solution/release 模型（起步最小化 + 先有依据才动手）。owner 2026-07-12 裁定 C14 仅接 capabilities+agents，其余登记本 TD。

**处理记录（2026-08-31，销号）**：owner 2026-08-30 推翻"先不建表"——上线前 admin 产品板块不得再返回内存 mock。设计与实现同车落地，权威文档 [`docs/20-specs/000-platform/admin/70-product-solutions.md`](../20-specs/000-platform/admin/70-product-solutions.md)。要点：① **solutions** 建三表 `product.solutions` / `solution_products` / `solution_plans`（DDL `40_product.sql` + 迁移 `2026-08-31-product-solutions.sql` + 列锁），服务套餐 = 既有 `product.plans` 绑到方案的一个档位，**不另立定价模型**；档位就是五档商业阶梯（与 `plan_components.tier` 同源，`lint:catalog-domains` 新增一组校验），mock 时代的 free/pro/enterprise/custom 废止。方案是运营写出来的内容，无 seed，空表即正确态。② 读端点全部接活库，计数真：订阅数 / 租户数按绑定 plan 从 `metering.subscriptions` 归集，MRR 只计 active 订阅、按订阅所钉版本的同周期价格折月（定义见 spec §4）。③ 写端点六条（create / update / state / products / bind / unbind），RW 池 + 事务 + `support.audit_logs`，状态机与 `product.products` 同形并在 BFF 守卫。④ **releases 不建表**：重定义为"已发布的套餐版本"（一条 = 一个 `plan_versions.status='published'`，产品取 primary 组件），`productRegion` / `allowedAgents` 两字段删除。⑤ **model-policies 退役**：真实策略是 Atlas 的（`GET /api/atlas/policies`），`/model-grants` 页改读它并把"未定义策略"换成真实对账「有授权、无策略」；首页策略覆盖卡随之改口径。⑥ 门户四页重写为可写（DialogForm / 确认框 / toast），文案全部经 `t()`，`ServicePlanDetailPage` 的「适用范围」「售卖提示」两段（手写文案，无来源）删除。

### TD-030 — 券批次金额面无展示，effect JSONB 按 kind 异构未解析

| 字段         | 内容                                                                                           |
| ------------ | ---------------------------------------------------------------------------------------------- |
| **分类**     | Design Pending                                                                                 |
| **状态**     | Open                                                                                           |
| **优先级**   | 🟢 LOW                                                                                         |
| **登记日期** | 2026-07-12                                                                                     |
| **来源**     | C15 commercial 字段治理（admin 平台完善 P3）；`commercial.router.ts` / PromotionsPage C15 注释 |

**描述**：营销板块（promotions/redemptions）此前展示 `originalPrice`/`salePrice`/`usedAmount`（券批次金额）恒为硬编码 0——券模型（`promotion.voucher_batches`）无「原价/现价」概念，券面金额按 kind 存于 `effect` JSONB（整数分，data_commerce_230 §4），核销金额在 `voucher_redemptions.effect_snapshot`。C15 按「无干净统一源→摘除」将这些恒 0 字段从 UI/CSV/汇总移除。真实的券金额面（券面值、已核销减免总额）尚无展示。

**影响**：运营看不到券批次的面值/发放价值/已核销金额聚合，只能看到发放量、核销次数、覆盖租户数等计数维度。redemptions 页的账单减免（`invoices.discount_amount`）仍有展示（真实源），但那是账单口径而非券口径。

**解决方向**：出 effect-schema 感知的券金额投影设计——按 kind（credit_voucher 面值 / recharge_card 金额+赠送 / discount 折扣率或减免额 / redemption/extension 权益）解析 `effect` / `effect_snapshot` JSONB，服务层给出归一化的「券面金额 / 已核销金额」，再在营销台账补展示。**不投机解析**：JSONB 结构按 kind 异构，须先固化 effect schema 契约再解析（避免脆弱的散装取值）。

### TD-031 — C 端账号凭据重置无带外通道

| 字段         | 内容                                                                                 |
| ------------ | ------------------------------------------------------------------------------------ |
| **分类**     | Design Pending                                                                       |
| **状态**     | Open                                                                                 |
| **优先级**   | 🟢 LOW                                                                               |
| **登记日期** | 2026-07-12                                                                           |
| **来源**     | C12 accounts 写路径（admin 平台完善）；owner 裁定凭据重置延后；AccountsPage 置灰按钮 |

**描述**：C12 让运营可停用/恢复/强制下线 C 端账号，但**「重置密码」按钮保持置灰**。C 端用户可能是**社交-only**（无密码，仅飞书/钉钉绑定）或**无验证邮箱**，运营带外重置密码的语义与安全流程未定：给谁发？发到未验证邮箱是否安全？社交-only 账号「重置密码」意味着什么（新建密码凭据 = 新增登录路径，安全影响）？是否需二次确认/审计/通知本人？

**影响**：客户忘记密码且自助找回不可用时（如换手机号 + 邮箱未验证），运营无带外救援手段，只能停用账号；支持工单可能积压此类诉求。

**解决方向**：出专项设计——区分「有密码凭据」vs「社交-only」两态；重置只允许发往**已验证**的锚点（手机/邮箱），社交-only 走「引导用户自助设密」而非运营代设；全程审计 + 通知本人 + 可选 step-up。设计定案后接 C12 同款四层委派（auth-bff internal 端点 + admin-bff 守卫 user:account.manage 或新增 user:account.credential 危码）。**不投机实现**：带外改密是高安全面，须先有设计。

### TD-032 — 高流量只读板块无服务端分页

| 字段         | 内容                                                                        |
| ------------ | --------------------------------------------------------------------------- |
| **分类**     | Implementation Gap                                                          |
| **状态**     | Open                                                                        |
| **优先级**   | 🟢 LOW                                                                      |
| **登记日期** | 2026-07-12                                                                  |
| **来源**     | C13 列表工程化剩余项（admin 平台完善 P2）；各只读 router `limit 500` 全量拉 |

**描述**：C13 收口了错误可观测（readJsonStrict + loadError 态），但**分页仍是纯前端**——高流量只读板块（billing/payments/subscriptions/orders/invoices/accounts/tenants/usage-metering/promotions/redemptions 等）的 router 一律 `limit 500` 一次性拉全量，前端再切页。数据增长后 500 截断会**静默丢尾部记录**，且单次响应体随行数线性膨胀。

**影响**：① 记录超 500 时列表/CSV 导出**悄悄缺尾部数据**（无「已截断」提示，读作「就这些」）；② 大响应体拖慢首屏 + 占带宽；③ 筛选在前端做，命中 500 之外的记录搜不到。

**解决方向**：定义 BFF 分页契约（`limit`/`offset` + `total` COUNT，或 keyset 游标），只读 router 逐个改造为服务端分页，前端 Pagination 接真实 total 与页请求；筛选/排序下推到 SQL。独立重活，建议单独立项按板块优先级（先金融高流量）逐个迁移。当前无「已截断」提示是最误导点，迁移前可先加显式截断标记（低成本止血）。

**实施（2026-07-13，低成本止血）**：服务端分页契约本身仍 Open（未动 router，未改响应体形状——全部 11 个端点仍是裸数组，改 wrapper 对象是破坏性变更，超出此次范围）。落地了文档自己建议的止血措施：前端按 `records.length === 500` 纯客户端推断"命中读取上限"（`portals/admin/src/lib/list-truncation.ts`），命中时在列表页顶部渲染新增的 `@vxture/design-system` `Banner` 组件（`packages/design/design-system/src/components/ui/Banner.tsx` + `components-banner.css`，此前仅有会自动消失的 `Toast`，无常驻提示条组件），提示"可能未展示全部数据，请缩小筛选范围"。11 个端点对应的 11 个页面（tenants/tenant-verifications/subscriptions/usage-metering/promotions/promotion-redemptions/accounts/orders/payments/invoices/billing）逐一接入，含初次加载与写操作后的重新拉取路径。`pnpm lint:design` + 两侧 `tsc --noEmit` + `eslint` + 全量 `next build`（46 路由）均通过。真正的服务端分页契约与迁移仍按上方"解决方向"独立立项。

---

### TD-033 — 租户共享资源策略无配置界面，仅运营通道可写

| 字段         | 内容                                                                                             |
| ------------ | ------------------------------------------------------------------------------------------------ |
| **分类**     | Implementation Gap                                                                               |
| **状态**     | Open                                                                                             |
| **优先级**   | 🟢 LOW                                                                                           |
| **登记日期** | 2026-07-12                                                                                       |
| **来源**     | Arda 对接 D8（product_220 §4.3）+ 回函 02 §2.3 对账；`metering.resource_sharing_policies` 已上产 |

**描述**：D8 落地了 reserved/shared 双池模型——workspace 级 `resource_sharing_policies` 表（空 = 全保留安全默认），决定 `ai.credit` 等 L0 资源的消费候选集（自留池 ∪ 参与共享的池）。**表与引擎（C2 视图 + consume 候选查询）均已生产验证**，但**租户管理员没有任何界面能自己开启/调整共享策略**——策略行目前只能由平台运营通道写入（无 console 面自助配置）。

**影响**：租户想"选定产品互兜闲置额度"（D8 设计的核心卖点之一）时，无自助路径，必须找运营手动写库；多产品/多租户场景下运营侧手动维护成本随规模上升；功能在架构上已完备但产品化未闭环。

**解决方向**：console 面新增"共享策略"配置卡片（workspace 设置域），暴露 `resource_sharing_policies` 的增删；后端复用既有表与 admin-bff 路由模式（同 subscriptions.router 的域权限收口），新增 perm 码（如 `commerce:sharing-policy.manage`）。非阻塞项——`arda-beta-trial`/v1 单产品场景下空策略（全保留）即安全默认，多产品共享是增长期需求，可按优先级排后。

### TD-034 — T1 token exchange 签发无审计落库

| 字段         | 内容                                                                                                                                                                      |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **分类**     | Implementation Gap                                                                                                                                                        |
| **状态**     | Resolved                                                                                                                                                                  |
| **优先级**   | 🟡 MED（组内第三，见 [TD-027](#td-027--admin-bff-authz-未按域收口legacy-桥--finance-写码缺口) 批注——本项是审计/取证缺口，晚于 TD-027 的活跃越权与 TD-035 的访问控制缺口） |
| **登记日期** | 2026-07-12                                                                                                                                                                |
| **来源**     | product_210 §6/§8 T1 实施；`TokenExchangeService`（`bff/auth-bff/src/oidc/`）                                                                                             |

**描述**：product_210 §6 要求"每次 token exchange 记录（调用方 client、模式、上下文、jti），入平台审计（实施随 T1 定表位，倾向复用 `support.audit_logs`）"。T1 已实施签发本体（新 grant_type、D2 铸币校验、claims 组装、签名），**但审计落库未实现**——`TokenExchangeService.exchange()` 成功/失败均不写任何审计记录，仅有 NestJS 默认请求日志。

**未实现原因（非遗漏，是刻意搁置）**：`support.audit_logs` 的 `actor_type` CHECK 只有 `customer|operator|system|api` 四值，`actor_id` 为 `uuid NOT NULL`——T1 的"调用方"是**产品/client**（如 `arda`），既不天然落入四值中任何一个的既有语义，也没有随手可用的 UUID（product.products.id 需要额外一次查询，且"这次签发该记成 system 还是 api"本身是个未决的语义问题）。仓内目前**没有任何代码路径写过 `support.audit_logs`**——没有先例可循、没有既定的 actor 语义映射，此时抢着塞一条大概率语义错配的记录，比不写更糟（错误的审计数据比没有审计数据更难清理）。

**影响**：token-exchange 的调用方身份、模式（OBO/service）、jti 目前只活在签发瞬间和已签发的 token 本身里（token 里带 `jti`，但没有平台侧留档反查）——出安全事件时无法审计"谁在什么时间以什么身份换过什么 token"；T1 §9 D1（300s 短 TTL）部分缓解了滥用窗口，但不能替代审计。

**解决方向**：先定 actor 语义（建议 `actor_type='system'` + 一个平台级固定审计占位 UUID，`resource_type='oidc_token_exchange'`、`resource_id`=jti、`after` JSONB 存 `{caller_product, target_product, mode, workspace_id}`），或者新开一张更贴合"S2S 凭证签发流水"语义的专表（更干净但多一张表）。定案后在 `TokenExchangeService.exchange()` 成功路径尾部补一次异步/best-effort 写入（不阻塞签发本身，写失败不影响已签发的 token——镜像 provisioning enqueue 的 `safeProvisioningHook` best-effort 惯例）。

**实施（2026-07-13，owner 拍板复用 `support.audit_logs`）**：`actor_type='system'` + 平台级固定占位 UUID `00000000-0000-0000-0000-000000000000`——这不是新发明的值，是 `services/model/platform` 已在用的同款"无真实 actor"哨兵（`COMMERCE_SENTINEL_UUID`），本项在 `bff/auth-bff` 侧本地复刻同一字面量以保持跨包一致，未做跨包公共常量抽取（起步阶段最小化，等第三处需要再收敛）。`resource_type='oidc_token_exchange'`、`resource_id`=jti、`after` JSONB = `{caller_product, target_product, mode, workspace_id, org_id}`。**代码改动**：`TokenExchangeService.exchange()` 原先把 jti 完全交给 `OidcKeyService.sign()` 内部生成、自己拿不到——现在显式 `randomUUID()` 生成 jti 并通过 `jwtid` 传入 `sign()`，铸出的 token 与审计记录引用同一个 jti；铸币成功后（返回 accessToken 前）触发 `recordAudit()`，内部 try/catch 包裹，写失败只记日志、不影响已签发的 token（镜像 provisioning `safeProvisioningHook` 的 best-effort 惯例）。**范围确认**：仅成功路径记录（product_210 §8 拍板方向原文如此），失败尝试不落审计——D1 的 300s 短 TTL 已部分兜底滥用窗口。**勘误**：登记时"仓内没有任何代码路径写过 `support.audit_logs`"这句不完全准确——`services/identity/iam/src/repository/pg-operator-audit.repository.ts` 已有 `actor_type='operator'` 的写入先例（operator 登录/MFA 事件），但那是"调用方是真实 operator，有天然 UUID"的场景，与本项"调用方是产品/client，需要 system 占位"的语义缺口不同——先例解决的是"怎么写"，没解决"system 场景填什么 actor_id"，登记时的核心判断（缺 actor 语义）依然成立。验证：新增 2 个专项单测（审计行字段/jti 一致性核对 + 写失败时不影响已签发 token）+ 既有单测按新增 `jwtid`/`pool.query` 调用次数同步更新，auth-bff 全量单测 137 通过 0 失败，tsc/eslint 干净。生产落地=同 TD-035，已合 develop 未晋升 beta/main。

**销号**：2026-07-13 | Commit: 见本 PR | 审计落库已实施并单测覆盖；生产尚待晋升+部署（同 TD-035，非阻塞——当前唯一 S2S 调用方 arda 尚未真实高频使用 T1 token exchange）。

### TD-035 — S2S token 身份未绑定到 platform router 的 workspace/product 参数

| 字段         | 内容                                                                                                                                                                                                                                                            |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **分类**     | Security                                                                                                                                                                                                                                                        |
| **状态**     | Resolved                                                                                                                                                                                                                                                        |
| **优先级**   | 🟡 MED（组内第二，见 [TD-027](#td-027--admin-bff-authz-未按域收口legacy-桥--finance-写码缺口) 批注——先于 TD-034：本项是访问控制缺口，T2 的"可信调用方身份"目标只完成了认证半段，未完成对应授权半段；但晚于 TD-027：调用方目前只有 arda 一家，非活跃的人类越权） |
| **登记日期** | 2026-07-12                                                                                                                                                                                                                                                      |
| **来源**     | T2 实施（product_210 §8）；`PlatformAuthGuard`（`bff/auth-bff/src/authn/platform-auth.guard.ts`）+ `platform-entitlements/usage/sharing.router.ts`                                                                                                              |

> **范围勘误（2026-07-12 code review）**：本项**只指**下面描述的 workspace/product 绑定颗粒度缺口。T2 review 时另抓出两处**真实漏洞已修复**（不属于本项、不再是债务）：①守卫作用域曾过宽——双接受逻辑原写在共享的 `InternalAuthGuard` 上，该类同时保护 operator/account admin-internal 路由（密码重置等，用请求体自报 actor 定权限），已拆出 `PlatformAuthGuard` 专供 3 个 platform router；②OBO 模式未查 `subject_token` 的 `aud`，允许跨产品用户 token 冒领，已加 `aud === callerClientId` 校验。详见 product_210 §8 T2 行。

**描述**：T2 的 `PlatformAuthGuard`（拆分后，见上）双接受——`x-vxture-internal-auth` 共享密钥或 T1 铸造的 `aud=vxture` S2S token，Bearer 分支校验通过后把 `act.sub`（调用方 product_code）挂到 `req.s2sCaller`，`@S2sCaller()` 装饰器供 handler 读取。**但三个 platform router（`platform-entitlements`/`platform-usage`/`platform-sharing`）没有一处真的读取 `s2sCaller` 去做绑定**——`workspace_id`/`product`（或 `products` 批量）仍然是查询串/请求体里调用方自报的裸值，直接信任、直接查库，Bearer 路径和共享密钥路径在"能问谁的数据"这件事上**权限等价**（都是"证明你是可信调用方"，不是"证明你是这个 workspace/product 的合法主体"）。

**影响**：持有任意一个合法 S2S token（哪怕是给别的场景铸的、`act.sub` 是另一个产品）的调用方，理论上仍可查询**任意** `workspace_id`/`product` 组合的 entitlement/usage/可见集——和迁移前的共享密钥模型比，`act.sub` 携带的"可信调用方身份"信息被铸造出来、验证通过，却没有在授权判定里被使用，T2 的"可信调用方身份"目标（product_210 §1 目标①）只完成了认证半段，没完成对应的授权半段。**注**：这不是 T2 引入的新洞——共享密钥模型下这个问题同样成立（任何密钥持有者都能问任意 workspace）——T2 只是让这条缺口第一次有了修补的抓手（`act.sub` 现在可比对），之前想修都没有身份可比对。

**解决方向**：三个 router 在 `s2sCaller` 存在时，把请求声明的 `product`（`platform-usage`/`platform-sharing`）或 `products` 批量集合（`platform-entitlements`）与 `s2sCaller.productCode` 比对，不等则 403；`workspace_id` 维度可选做同 T1 D2 的覆盖校验（复用 `TokenExchangeService.resolveServiceContext` 同款查询,或直接信任 token 里已经过 D2 校验的 `workspace_id`——后者更省一次查询,前提是 router 改成"忽略请求体的 workspace_id,只认 token 里的"）。共享密钥路径（`s2sCaller` 为空）维持现状不动——它是过渡期遗留信任模型，不在本项收紧范围（该密钥本身的退场是 T2 的"退役"后续项）。

**实施（2026-07-13）**：采纳"直接信任 token"路线（更省一次查询）。新增纯函数 `scopeToS2sCaller`（`bff/auth-bff/src/authn/s2s-scope.ts`）：`s2sCaller` 存在时，请求声明的 `workspace_id` 被**忽略**、改用 `s2sCaller.workspaceId`（T1 铸币时已过 D2 覆盖校验，OBO/service 两模式必带此 claim，无需重新查库校验一次）；请求声明的 `product`/`products` 与 `s2sCaller.productCode` 逐一比对，任一不等即 403 `s2s_product_mismatch`；`s2sCaller.workspaceId` 意外为空（理论不可达，T1 两路径铸币时都强制带该 claim）时 403 `s2s_scope_missing_workspace`，**拒绝退化为信任请求值**（fail-closed，不是 fail-open 兜底）。`s2sCaller` 缺席（共享密钥路径）时原样透传请求值，不受影响——按设计不在本项收紧范围。三个 router（`platform-entitlements`/`platform-usage`（`consume`+`gauge`）/`platform-sharing`）改用该函数解出的 `workspaceId` 而非请求原值。验证：6 个新增单测覆盖全部分支（无 caller 透传/覆盖 workspace/product 匹配放行/product 不匹配 403/批量含不匹配 403/token 无 workspace 时 fail-closed）+ auth-bff 全量单测 135 通过 0 失败 + tsc/eslint 干净。`@S2sCaller()` 装饰器 T2 落地时就写好但此前无任何 router 真正读取——这是它第一次被实际使用。

**销号**：2026-07-13 | Commit: 见本 PR | 三个 platform router 的 S2S 授权颗粒度缺口已收口，`scopeToS2sCaller` 单测全绿 + 全量单测/tsc/eslint 干净；共享密钥遗留路径不受影响，其退场仍是 T2"退役"后续项，不在本条范围。

### TD-036 — admin 首页总览大面积硬编码 mock 数据

| 字段         | 内容                                                                                                                                     |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **分类**     | Implementation Gap                                                                                                                       |
| **状态**     | Resolved                                                                                                                                 |
| **优先级**   | 🟡 MED                                                                                                                                   |
| **登记日期** | 2026-07-13                                                                                                                               |
| **来源**     | 用户抽查"概览页是不是都是 mock 数据"，全量核对 `portals/admin/src/app/(admin)/page.tsx`（`AdminOverviewPage`，路由 `/`，导航"运营总览"） |

**描述**：admin 首页（不同于已去 mock 的 `/commerce-overview` 商业总览、`/platform` 平台总览——这两个此前已核实全活库）大面积返回前端模块级硬编码常量，从未走真实 API：

- **"平台核心态势"4 张脉冲卡**（活跃客户/订阅收入/模型调用/平台稳定性）——`overviewSnapshots`（`page.tsx:126-791`），按周期取常量，无 fetch。
- **"经营指标"9 张 KPI 卡**（客户生命周期/订阅生命周期/收入验证三组）——同一 `overviewSnapshots` + `customerLifecycleSnapshots`(`:840-897`) + `subscriptionLifecycleSnapshots`(`:899-962`) + `revenueValidationSnapshots`(`:964-1033`)，均为硬编码字面量。
- **"服务与工单"7 张卡**（工单统计 4 项+服务评价 3 项）——`serviceMetricsFor()`(`:1367-1404`) 按周期系数缩放硬编码基数 `326/248/54/24`；`ratingMetricsFor()`(`:1406-1436`) 读硬编码 `ratingSnapshots`(`:829-838`)。从未调用任何工单/评价接口。
- **"模型技能"里 Token 消耗**——`stableTokenFallback()`(`:1271-1279`) 用哈希算法编造一个"看起来稳定"的假数字，因为没有任何后端服务往 `AiModel.config` 写过 `periodTokens`/`tokenCalls` 这类字段。
- **"产品供给"板块**表面上是 fetch 驱动（`fetchProductReleases`/`fetchProductSolutions`），但背后调的正是 TD-029 已登记的 `products.router.ts` mock 端点（`listProductReleases`/`listProductSolutions`，无 `product` schema 表支撑）；前端还在此基础上**叠加了第二层独立编造**——`productOperations`（`page.tsx:793-812`，硬编码 `vxture-console-cn 846 单/ruyin-cn 724/ruyin-intl 118`）+ tier 拆分用任意权重系数（0.82/1.05/1.25，`:2525-2559`）二次加工，双重虚构。
- **"服务监控"**——`fetchDevServices()` 打的是本地开发工具面板 `localhost:8090/api/services`，不是生产监控系统；接不到时掉回硬编码 `{total:12, healthy:11, abnormal:1, availability:92}`（`fallbackServiceRows`，`:2673-2682`）。
- **"策略覆盖"**部分真（`modelGrants` 来自 Prisma `modelGrant.findMany`）部分假（`modelPolicies` 复用 TD-029 同款 mock 端点）。

**影响**：admin 首页是运营人员登录后第一眼看到的页面，展示的租户规模、订阅收入、工单数、服务评价、Token 消耗等关键运营数字全部是假的（部分是硬编码常量，部分是哈希伪造），容易被当真实数据误用于汇报或决策；且与已去 mock 的 `/commerce-overview`、`/platform` 两个"总览"页并存，用户体验上无法区分哪个总览可信。

**解决方向**：逐指标核实是否有真实表可查（多数有——`tenancy.tenants`/`metering.subscriptions`/`billing.payments`/`billing.invoices`/`support.tickets`/`account.users` 等在 `commercial.router.ts`/`platform-admins.router.ts` 的现有 `getOverview()` 里已有同类聚合查询可复用同款模式）；有真实表的字段接活库，**没有真实表支撑的字段（平台稳定性/Token 消耗/服务评价/服务监控/产品供给排行）不得继续编造数字**，应移除展示或明确标注"数据源待建设"，参照 `platform-governance.router.ts` 已有的"诚实空态"先例（`skills.router.ts` 当时是同款空桩，已于 2026-08-30 退役——admin「技能市场」改为 Runos 能力目录的只读视图，见 `bff/admin-bff/src/routers/runos.router.ts`），而不是留一个看起来精确实则虚构的数。产品供给板块本身受 TD-029 同一阻塞（无 schema），至少应去掉前端二次虚构的 `productOperations`/tier 权重加工，不再在已知 mock 之上再加一层假。

**实施（2026-07-13）**：新增 `GET /api/platform-admins/dashboard-overview?period=...`（`bff/admin-bff/src/routers/platform-admins.router.ts`），单条 scalar-subquery 聚合查询（复用 `commercial.router.ts`/`platform-admins.router.ts` 现有 `getOverview()` 同款风格），服务端按 period 计算真实时间窗（`recent30`/`month`/`quarter`/`year` 各自的 since+环比 prevSince/prevUntil；`total` 无下界）。**接活库的字段**：租户/用户规模+新增（`tenancy.tenants`/`account.users`）、订阅规模/试用中/新增/试用转付费/续费队列健康（`metering.subscriptions`/`subscription_histories`/`subscription_renewals`）、收入规模/累计/环比、待收/逾期账单（`billing.payments`/`billing.invoices`）、工单四态统计（`support.tickets`）。SQL 已用只读连接直接跑过生产库验证（语法、字段与 join 均通过，返回值为当前活库真实计数，非造假）。**保留卡片位置改空态的字段**（无对应表，不编造数字，文案统一"数据源待建设"）：平台稳定性、Token 消耗/模型调用量、服务评价/产品评价/SLA、服务监控（`fetchDevServices` 只连本地开发面板，生产不可达）、私域大客户、收入质量（名义/实际收入区分无来源）。**产品供给排行**（`productRankings.productTop/solutionTop/tierTop`）整体清空为空态——`productTop` 是纯前端二次编造（`productOperations` 硬编码数组），`solutionTop`/`tierTop` 除了复用 TD-029 已知 mock 端点外还叠了一层 tier 权重系数（0.82/1.05/1.25）编造，两层都不属于"待 TD-029 排期修"的范围，直接清除。TD-029 本身管辖的 4 张 KPI 摘要卡（产品能力/方案组合/套餐层级/供给异常）**未改动**——owner 已裁定保留 mock+显式注释，不在本条重新裁定。前端新增每周期缓存（`overviewByPeriod`）应对 4 个独立周期切换器（global/business/product/model/service）可能各选不同周期的情形。验证：`tsc --noEmit`（bff+portal 双侧）干净、`eslint` 干净、`pnpm lint:boundaries` 干净、`next build` 全量成功（46 路由含 `/` 正常产出）、admin-bff boot-smoke 通过、admin-bff 既有单测 70/70 通过（1 个套件因本地未构建的无关 workspace 包 `@vxture/service-subscription` import 失败，与本次改动无关，CI 会先 `build:backend-deps`）。

**销号**：2026-07-13 | Commit: 见本 PR | admin 首页 6 类真实可查指标已接活库，5 类无表支撑指标（+产品供给排行二次虚构层）已改为诚实空态，不再编造运营数字；TD-029 管辖范围未动。

### TD-037 — 无安全重建单个平台服务/重载 env 的运维通道

| 字段         | 内容                                                                                                                                                           |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **分类**     | Implementation Gap                                                                                                                                             |
| **状态**     | Resolved                                                                                                                                                       |
| **登记日期** | 2026-07-14                                                                                                                                                     |
| **来源**     | AUTH_INTERNAL_TOKEN 轮换实操（cutover 窗口）连踩两坑；`deploy/compose.platform.yml` 镜像插值默认值 + `deploy/scripts/30-deploy-platform-stack.sh` L37/L108-115 |

**描述**：需要"只重建某个/某些平台服务以重载其 env（不走全量部署）"时，在 worker-01 直接 `cd /srv/vxture/deploy && docker compose up -d <svc>` 会连踩两个陷阱，且第二个有拆容器风险：

1. **registry 默认值陷阱**：`compose.platform.yml` 用 `${VX_IMAGE_REGISTRY:-ghcr.io}`，但生产实际跑阿里云 ACR（`crpi-…aliyuncs.com/vxture`），registry/namespace/tag 三变量存在 `/srv/vxture/runtime/.env`（部署脚本经 `read_compose_env` 读取），**不在 compose 目录**。裸跑 compose → 解析成 `ghcr.io/vxture-platform/…:latest` → 私有仓 `denied` 拉取失败。
2. **tag 注入陷阱**：`VX_IMAGE_TAG` 由晋升流水线注入具体 `sha-xxxxxxx`，`runtime/.env` 里是 `latest`，而本地并无 `:latest` 镜像 → 即便 registry 对了也拉不到；`--force-recreate` 在拉取失败前可能已停掉在跑的容器 → **单服务重建反而致其下线**。

轮换时的可行绕法 = `set -a; . /srv/vxture/runtime/.env; set +a; docker compose -f compose.platform.yml up -d --pull never --no-deps <svc...>`（source 带全三变量 + `--pull never` 用本地在跑镜像 + `--no-deps` 不牵连 db/redis）。此法有效但纯口传，无脚本、无文档，下次换人必再踩。

**影响**：任何"改 secret/env 后只想重载受影响服务"的运维（token 轮换、密钥更新、单服务配置修正）都缺安全通道；错误命令有生产容器下线风险；纯记忆传承，团队不可复制。属运维安全缺口。

**解决方向**：提供 `deploy/scripts/` 下的 `recreate-service.sh <svc...>` 助手——内部 `source runtime/.env`、把每个目标服务的 `VX_IMAGE_TAG` 钉到其**当前在跑容器的实际 tag**（`docker inspect` 取，而非 env 的 latest）、强制 `--pull never --no-deps`、并前置校验目标镜像本地存在（不存在则拒绝而非拆容器）。或退一步先写一页"重载单服务 env"运维文档固化上述绕法。与 [[reference_deploy_host_ops]] 同域。

**销号**：2026-07-14 | Commit: 见本 PR | 新增 `deploy/scripts/33-recreate-service.sh`：`source runtime/.env` 取 registry/namespace；tag **逐服务从在跑容器 `docker inspect` 取真实值**（`latest` 就钉 `latest`、`sha-xxx` 就钉 sha，两种情况都对——实测确认平台侧在跑 tag 为阿里云 ACR `:latest`，sha-tag 是 arda/worker-02 那侧的情形，脚本对两者通用）；多服务时校验 tag 一致（防混批）；**前置校验目标镜像本地存在，不存在即拒绝**（在任何 docker 动作前挡住，绝不 `--force-recreate` 拆掉在跑容器再拉取失败致其下线）；`--pull never --no-deps` 只动目标、不牵连 pg/redis；重建后逐容器等 healthy。参数校验拒绝有状态服务（postgres/redis）与未知服务。有状态服务与配置文件路径均可 env 覆盖（`RUNTIME_DIR`/`COMPOSE_DIR`）便于测试。**worker-01 实弹验证**：website 重建成功（StartedAt 前后变化、健康、全栈 13 容器不受牵连）；无参 usage / 非法服务 / 缺文件三类拒绝路径均先于任何 docker 动作触发。部署包 `deploy/scripts` 整目录同步（deploy-production L113/150），随部署自动就位 `/srv/vxture/deploy/scripts/`。[[reference_deploy_host_ops]] 已记正解绕法，本脚本将其固化。

### TD-038 — platform.env 变更后依赖整栈重建，无单键热更或影响面收窄

| 字段         | 内容                                                                                                               |
| ------------ | ------------------------------------------------------------------------------------------------------------------ |
| **分类**     | Architecture                                                                                                       |
| **状态**     | Open                                                                                                               |
| **登记日期** | 2026-07-14                                                                                                         |
| **来源**     | AUTH_INTERNAL_TOKEN 轮换（cutover 窗口）；`deploy/compose.platform.yml` 六服务共享 `secrets/platform.env` env_file |

**描述**：`secrets/platform.env` 的五个共享键（DATABASE_URL/REDIS_URL/JWT×2/AUTH_INTERNAL_TOKEN）由 6 个平台服务经 `env_file` 注入。任一键轮换 = 6 个容器（auth/admin/console/website-bff + model-platform + platform-api）全部 `--force-recreate` 才能加载新值——`docker restart` 不重读 env_file，无热更机制。轮换期间守卫只认单值、无双值并行窗口，故必有一段跨服务 401 窗口（本次靠 arda 缓冲重试吸收，但任何直连内部调用方都会短暂受影响）。

**影响**：秘钥轮换是整栈重启事件而非单点操作，放大爆炸半径与窗口时长；共享单值无灰度（新旧双认）通道，轮换必然产生短 401 窗口，制约轮换频率与随时性。

**解决方向**：低优先，登记备案。可选方向：①守卫支持双值并行（`AUTH_INTERNAL_TOKEN` + `AUTH_INTERNAL_TOKEN_NEXT`，轮换期间双认，切换后退役旧值）消除 401 窗口；②秘钥面接入支持热重载的 secret 源（如挂载文件 + 进程 SIGHUP 重读）避免整栈重启；③按 [[project_arda_integration]] D13 已完成的宿主拆分思路，进一步收窄哪些服务真正需要 AUTH_INTERNAL_TOKEN（platform-api 是发/收方，console/website-bff 是否仍需可复核，缩小共享面）。当前整栈重建可接受（14 容器、~90s、内存无忧），不阻塞，故列 LOW。

### TD-039 — 疑似死 CI 凭证待审计清理（需全域确认）

| 字段         | 内容                                                                                  |
| ------------ | ------------------------------------------------------------------------------------- |
| **分类**     | Security Hygiene                                                                      |
| **状态**     | **已全域确认（2026-08-21）** — 四项中仅一项属实                                       |
| **登记日期** | 2026-07-16                                                                            |
| **来源**     | GitHub Actions workflow 全面审查（本轮）；主干模式迁移后 gitflow 遗留 secret/variable |

**描述**：主干模式（trunk-based）迁移弃用 gitflow 后，若干旧 secret/variable 可能已零引用：`PROMOTION_TOKEN`/`PROMOTION_ACTOR`（branch-promotion.yml 已废）、`TAILSCALE_AUTHKEY`（若已改用 OAuth client）、`NODE_AUTH_TOKEN`/`VXTURE_NPM_REGISTRY`（包发布/私有 registry 路径变更后）。这些属"泄露即危害或扩大攻击面的死凭证"，与 [[reference_repo_governance_standard]] §3"定期审计死值/重复"一致。

**影响**：零引用的存活凭证只增攻击面、无收益；且散落 org/repo/environment 三级不易辨。属安全卫生缺口，非功能缺陷。

**解决方向 → 已执行全域确认（2026-08-21，platform 拆仓收尾批 4）**：按本条要求跨 `vxture` 组织全部 19 个仓逐一解出 workflow 内容并 grep（不止本仓）。**结论与本条原本的判断相反——四项里只有一项真是死凭据**：

| 项                                    | 原判       | 实测                                                                               | 处置                               |
| ------------------------------------- | ---------- | ---------------------------------------------------------------------------------- | ---------------------------------- |
| `TAILSCALE_AUTHKEY`                   | 疑似零引用 | **全组织零引用**（已改用 OAuth client）                                            | **可删**，待 owner 在控制台 revoke |
| `VXTURE_NPM_REGISTRY`                 | 疑似零引用 | **5 个产品仓在用**（arda / karda / umbra / vxtpl / yucer 的 `build.yml`，各 2 处） | **保留**                           |
| `NODE_AUTH_TOKEN`                     | 疑似零引用 | **平台仓拆仓后成为必需品**；2026-08-21 曾因过期导致 CI 全线 401，owner 已轮换      | **保留**，且需纳入轮换周期         |
| `PROMOTION_TOKEN` / `PROMOTION_ACTOR` | 已废       | 两组织均已不存在                                                                   | **无需动作**                       |

另核 `DEPLOY_WORKER02_*`（6 个，visibility=selected）：**授权给 5 个仓且在用**（vx-agent-anlan / forge / raven / xuanzhen、vxture-arda），**保留**。

**这一轮最值得记的不是清掉了什么，是差点清错什么。** 本条把四项并列为「可能已零引用」，而实测下来三项都在用——其中 `NODE_AUTH_TOKEN` 不仅在用，还在同一天因过期打断了整条 CI。若按「疑似即清」执行，会连带打断五个产品仓的 CD。本条自己写的「有疑则保留 + 需 owner 拍板」是对的，值得作为同类清理的默认姿势。

### TD-040 — 变更门控方法论未沉淀进 cicd-optimization-playbook

| 字段         | 内容                                                                                        |
| ------------ | ------------------------------------------------------------------------------------------- |
| **分类**     | Documentation                                                                               |
| **状态**     | Resolved（2026-07-21，PR #103）                                                             |
| **登记日期** | 2026-07-16                                                                                  |
| **来源**     | GitHub Actions workflow 审查（本轮）；`ci.yml` build/test 变更门控 + `classify-changes.mjs` |

**描述**：本轮把 CI 的 build/test 从无条件全量改为**变更门控**（`classify-changes.mjs` 按 pnpm workspace 传递依赖算出 `affected_images`，build/test 只处理受影响组件），显著降耗；但该方法论（allow-list 默认 SKIP 安全性、传递依赖推导、docs-only 轻量路径、affected_images 复用 docker-build 同款规则）尚未沉淀进 [`docs/10-standards/cicd-optimization-playbook.md`](../10-standards/010-cicd-optimization-playbook.md)，其它仓无法照做。

**影响**：可迁移的提效方法论停留在本仓实现里，[[reference_repo_governance_standard]] 的"CI 提效"一环缺文档支撑，跨仓复用需逐仓逆向。属文档缺口。

**解决方向**：把变更门控模式补进 `cicd-optimization-playbook.md`（触发门控/最小重建/覆盖缺口章节）。低风险纯文档，但**与全域整顿节奏对齐后再统一补**（避免文档与其它仓落地节奏脱节），故随 TD-039 一并列"待全域确认"批次。

**销号（2026-07-21，PR #103）**：挂起条件"与全域整顿节奏对齐"已成立（template/arda 正照标准重构、template 批 1 复制 CI/CD 套件），方法论以 **playbook 手法 F** 落地 `010-cicd-optimization-playbook.md` §3（step 级门控/依赖图推导 watch-paths/fail-open 兜底/docs-only 轻量通道/单一规则源/分类器自测六要点 + 实测验收清单）。TD-039（死凭证审计）不受影响，仍待全域确认。

### TD-041 — admin 订阅动作写路径绕过 provisioning 派发与 C3 invalidate

| 字段         | 内容                                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------ |
| **分类**     | Architecture                                                                                           |
| **状态**     | Open                                                                                                   |
| **登记日期** | 2026-07-21                                                                                             |
| **来源**     | product_320 §8#5（明记"同类 provisioning 旁路 → tech-debt 登记"）；平台配套任务线全量对账审计（T4-10） |

**描述**：admin-bff `subscriptions.router.ts` 的 `runSubscriptionAction`（`POST :id/actions`，renew/suspend/resume/cancel）在事务内裸 SQL 直改 `metering.subscriptions`（`SELECT … FOR UPDATE` → UPDATE status/auto_renew/end_at → append `subscription_histories`），**不经订阅服务主路径**——既不派发 provisioning webhook（如 resume: suspended→active 不触发产品侧恢复指令），也不推 C3 invalidate（产品端 entitlement 缓存要等 TTL 自然过期才看到新状态）。与 §7 主单路径（下单/确认→provisioning 派发→invalidate）行为不一致。

**影响**：运营在 admin 执行订阅动作后，产品侧感知滞后（缓存 TTL 内旧门控继续生效）且 provisioning 状态机可能与订阅状态脱节（suspend/resume 无对应 webhook 事件）。低频运营操作、TTL 短（秒级 invalidate 缺失退化为短 TTL 缓存），故 MED 非 HIGH。

**解决方向**：订阅动作改走（或复用）subscription 服务的状态变更入口，统一带出 provisioning 派发 + C3 invalidate；或最小修——在 `runSubscriptionAction` 提交后补发 invalidate 与（需要时）provisioning 事件。修复时同步核对 renew 的 `end_at` 延长是否需要 webhook 通知产品侧。

---

### TD-042 — console-bff quota-usage 绕开 C2 契约，直查 DB 并重复实现 reset 逻辑

| 字段         | 内容                                                                                                  |
| ------------ | ----------------------------------------------------------------------------------------------------- |
| **分类**     | Architecture                                                                                          |
| **状态**     | ✅ Resolved                                                                                           |
| **登记日期** | 2026-07-23                                                                                            |
| **解决日期** | 2026-07-23                                                                                            |
| **来源**     | console 权益展示缺口调研；`bff/console-bff/src/routers/subscription.router.ts`（`quotaNeedsReset()`） |

**描述**：console-bff 的 `GET /api/subscription/quota-usage` 端点（`SubscriptionPage.tsx` 消费）未调用平台权威的 C2 `GET /platform/entitlements`（`bff/platform-api/src/platform/platform-entitlements.service.ts` + `entitlement-view.ts`），而是自己直查 `metering.quota_pools`（`QUOTA_POOL_SQL`），并自写了一份 `quotaNeedsReset()`——该函数的注释自己承认"Same period-floor comparison as platform-api's entitlement-view"，即明知逻辑与 `entitlement-view.ts::needsReset()` 应保持一致，却各写一份。当前该端点只覆盖 `storage.bytes`/`ai.credit` 两个 WS 级平台指标，未展示任何 tier/limits/bundled/status 等产品级销售轴信息（该部分是纯空白，非本条技术债范围，另见 console 权益展示页 workplan）。

**影响**：reset 判定逻辑（UTC 日/月周期边界）存在两处独立实现，C2 引擎一侧的规则变化（如未来调整 reset 边界语义、新增 reset_period 取值）不会自动同步到 console-bff，属逻辑漂移风险；此外该端点仍是直查 DB 而非走契约化的 S2S 接口，与 `admin-bff → platform-api`（`AUTH_INTERNAL_TOKEN` S2S 模式，见 `bff/admin-bff/src/providers/commerce-services.provider.ts`）已验证的先例不一致。

**解决方向**：console-bff 改为通过 S2S 调用 C2 `GET /platform/entitlements`（复用 `AUTH_INTERNAL_TOKEN` S2S 调用模式），退役自写的 DB 直查与 `quotaNeedsReset()`；随该改造一并补上产品级 tier/limits/bundled/status 的 console 展示（见 workplan）。

**销号（2026-07-23）**：`workplans/console-entitlement-display.md` 三阶段全部完成。验收方法：①代码级审查确认 console-bff 侧（`getEntitlements`/`sumQuotaPools`）对 C2 返回值只做逐字段直传/求和聚合，不存在任何独立 tier/limits/reset 再推导逻辑；②上游合并算法既有单测 `entitlement-view.spec.ts` 27/27 通过（含 product_220 §2 primary+bundled 共存例、needsReset day/month 边界）；③全仓 grep 确认 `needsReset`/`quotaNeedsReset` 仅 `entitlement-view.ts` 一处实现，`console-bff` 侧零残留。真实多租户浏览器冒烟留给部署后由 owner 视需要验证，不阻塞本条销号（本条追踪的是"重复实现"技术债，已消除）。

**进展（2026-07-23，阶段1完成，见 `workplans/console-entitlement-display.md`）**：console-bff 新增 `PlatformEntitlementsClient`，`quota-usage` 端点已完全改走 C2 响应聚合（`sumQuotaPools()`），`QUOTA_POOL_SQL`/`quotaNeedsReset()` 已删除——重复实现的根因已消除。新增 `GET /api/subscription/entitlements` 暴露 tier/status/bundled/limits。**进展（2026-07-23，阶段2完成）**：console 前端 `SubscriptionPage.tsx` overview tab 新增 "Current entitlements" 区块（`DataTable`），消费阶段1新增的 `GET /api/subscription/entitlements`，展示每产品 tier/status（六值+null 直接透传，不折叠）/bundled/limits。`console-bff.ts` 新增 `fetchEntitlements()`。

---

### TD-043 — 平台调用 atlas 无 S2S 鉴权，能力/数据面均裸调用

| 字段         | 内容                                                                                              |
| ------------ | ------------------------------------------------------------------------------------------------- |
| **分类**     | Security                                                                                          |
| **状态**     | Open                                                                                              |
| **登记日期** | 2026-07-28                                                                                        |
| **来源**     | atlas 路径改名排查（随手发现）；`vxture-atlas/docs/20-specs/10-http-surface.md`（权威鉴权要求表） |

**描述**：atlas 的能力面（`/capability/*`）与数据面（`/v1/*`）均要求调用方带 `S2sAuthGuard` 校验的 RS256 `aud=atlas` bearer token（`vxture-atlas/docs/20-specs/10-http-surface.md`）。本仓两处调用方完全不带任何鉴权头：`bff/console-bff/src/routers/model-platform.router.ts`（2026-07-29 改名 `atlas.router.ts`，`modelPlatformRequest()` 同期改名 `atlasRequest()`，零 headers）、`packages/ai/model-runtime-client/src/llm/client.ts`（agent-server/varda 聊天用，`chat`/`chatStream` 均零 headers）。平台已有现成的 `tool:{target}` scope client-credentials 换票机制（`bff/auth-bff/src/oidc/token-exchange.service.ts`，product_210 §3/D3），两处调用方均未接入。

**影响**：若 atlas 严格执行该守卫（已确认：严格执行），这两条链路的请求会被拒绝（401/403），而不只是路径改名前的 404——console-bff 侧影响租户可见模型/授权/配额/用量展示；model-runtime-client 侧影响 varda 聊天。

**解决方向**：两处调用方接入 `tool:atlas` scope 的 S2S 换票（参考 `bff/auth-bff/src/oidc/token-exchange.service.ts` 的 client-credentials 铸币路径，而非 console-bff 现有的 `AUTH_INTERNAL_TOKEN` 静态密钥模式——那套只适用于平台内部同信任域服务，atlas 是外部仓、不同信任域，必须走签名 OIDC token）。`model-runtime-client` 本身无 NestJS DI（TD-016 同款约束），token 需由调用方（agent-server/varda）注入，类似 `modelPlatformUrl` 现有的显式传参模式。

**暂缓（2026-07-28，owner 拍板）**：varda 本身按拆库计划将部署在 worker-02，当前部署形态本就过渡中——**varda 侧暂缓处理，保留页面/功能入口，后端鉴权接线搁置**，随 worker-02 部署一并解决，不单独立项抢跑。console-bff 侧未获得同样的暂缓，维持 Open、按正常优先级排期。

**console-bff 侧已解决（2026-07-28，PR#163=`12203f31`）**：接线过程中发现一个共享基础设施的契约缺口——`token-exchange.service.ts` 的 OBO/service 两个既有模式都硬性要求 `caller.productCode` 非空，而 console-bff 的 OIDC 客户端是平台级客户端（故意不挂 productCode，跟 website/admin 同类),故原有任何模式都会在 `invalid_client` 被拒,不是简单接线能解决的。修复=新增 `PLATFORM_LEVEL_S2S_CALLERS` 白名单分支（目前仅 `console`)，复用已被 atlas 守卫接受的 `mode:"service"`（未新造 mode 值——atlas 守卫硬编码只认 `obo`/`service`，新起一个值会被拒收且改 atlas 守卫不在本仓写权限内),`act.sub`=调用方自己的 client_id 而非产品码,跳过 D2 覆盖度检查(workspace 合法性由 console-bff 自己的会话中间件保证)。`console-bff` 新增 `S2sExchangeService`（镜像 `admin-bff` 的 `OperatorExchangeService`,去掉 subject_token 改传 workspace_id),`model-platform.router.ts` 4 个方法全部接入,换票失败直接 502(atlas 已确认严格执行守卫,不做"降级裸调"的过渡期兜底)。**本条两个调用方里,console-bff 半程已解决;varda 半程按上条暂缓,维持 Open——本条整体状态不改(以覆盖面较窄的一半为准)**。

**命名空间冲突(2026-07-28,atlas 侧发现,`vxture-atlas#66` 讨论)**:PR#163 落地后 atlas 指出一个真实碰撞——atlas 自己的 `#52`(product_250 M-1 batch B atlas 半,对应本仓平台半=PR#151)要求 `/capability/*` 只认 `scope="mgmt:atlas"`(operator 身份),但 console-bff 现在用 `scope="tool:atlas"` 调同一批路由,若 atlas 照 `#52` 原样实现会把 console-bff 全部 401。**根因**:两条独立工作线(本会话内先做的 product_250 M-1、后做的 TD-043)分别把不同身份的调用方指向了同一个命名空间,`/capability/*` 从一开始就该是纯 operator 面——本仓 `product_250` M-1 文档原文即写明 `scope=mgmt:{aud}` 与 `tool:{aud}` "结构性互斥",console-bff 撞上 `/capability/*` 是这条设计意图的一次实际违反,不是巧合。**resolution(已在 issue 上确认)**:atlas 新建 3 个 `/v1/*` 租户读接口(`grants`/`quotas`/`usage-summaries`,`tool:atlas`+token 内 `workspace_id`,仿既有 `/v1/models?tenantId=` 先例),建好后 console-bff 的 4 个代理方法切过去,`/capability/*` 随后收紧为纯 `mgmt:atlas`。**本仓待办**:atlas 新路由上线后,`model-platform.router.ts` 需要一次跟进 PR(已登记本地任务,阻塞中,等 atlas 那边 ping)。

**owner 待办(2026-07-28,atlas 阻塞项,非本仓可执行)**:atlas 选定 atlas→platform 方向用共享密钥路径(T1 会撞 D2 覆盖度检查,因 atlas 售卖目录仍是占位骨架)。需要 owner 把 `AUTH_INTERNAL_TOKEN` 转运给 atlas 作为 `PLATFORM_INTERNAL_AUTH_TOKEN`(参照 provider-keys 先例走独立受限 env 文件,不进 CI)。atlas 原话:"this is the one item on my critical path that I cannot do myself"——TD-016(C2 客户端)卡在这个凭证上,是当前 atlas 侧最大的单点阻塞。**更新(同日晚些时候)**:atlas 自己的 TD-016 已标记"partially closed"——C2 客户端(`PlatformEntitlementClient`)已存在并对真实 quota_pools 耗尽状态能做出拒绝判定,隐含凭证转运已经完成;本仓未见到显式转运动作的记录,若后续发现凭证并未真正到位,此判断需要撤回重查。**console-bff 侧命名空间冲突已彻底解决**:atlas 建了 `/tenancy/*` 数据面(`vxture-atlas#70`+`#74`,scope 从 S2S token 的 `org_id`/`workspace_id` claim 解析、调用方声明不了),补齐了 `model-platform.router.ts` 全部四个代理方法的对应物。本仓已全量切换(`vxture-platform#174`=`4a030bde`——`listModels`;`#175`=`e44bedaf`——`listGrants`/`quotas`/`usage`,含前端 `model-platform` 页面重写,三个响应形状从"数组"变成"单个信封对象"且语义完全不同:quotas 从订阅周期记录变成 tier/bundled/limits/pools/status 信封、usage 从计费口径变成 atlas 自己 reqlog 口径)。铸票claim 语义也一并修过两轮真实 bug:`#169`=`bd6d946f` 修 workspace_id/org_id 语义(误把 tenant/org id 当 workspace id 传),`#171`=`66b45843` 补 tenant_id claim(personal 类租户此前完全无租户身份,回应 atlas 亲自开的 `platform#170`)。**console-bff 半程本条彻底解决**;varda 半程仍按 owner 拍板暂缓,随 worker-02 部署一并处理,是本条状态改"部分 Resolved"而非"Resolved"的唯一原因。**尚未端到端验证**:atlas v0.1.15 已确认部署成功(2026-07-28,production deployment state=success),等 atlas 自己用真实租户会话验证后回报,`vxture-atlas#52`(锁死 `/capability/*` 为纯 `mgmt:atlas`)排在其后。

### TD-044 — atlas 未接入平台 C2/C3，全平台 AI 用量对计量/账单系统不可见

| 字段         | 内容                                                                                                                                                                                                                                |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **分类**     | Architecture                                                                                                                                                                                                                        |
| **状态**     | Open                                                                                                                                                                                                                                |
| **登记日期** | 2026-07-28                                                                                                                                                                                                                          |
| **来源**     | atlas 真实实现审计（用户提供逐项实证表）+ 既有设计核对：`product_200_integration.md` §4.1/§6、`product_210_tool-protocol.md` §4/§6、`docs/30-design/data_commerce_200_metering.md`、`vxture-atlas/docs/20-specs/10-http-surface.md` |

**描述**：`product_200_integration.md` §6 产品×通道适用矩阵明确 Atlas 行标注 **"C3 consume 上行 ✔（唯一推理计量入口）"**、备注"Model Platform 只读配额 gate 特权照旧"；`41-atlas-integration-topology.md`（旧版）称"Atlas 是唯一计量入口，karda 不重复上报模型 token 消耗"。即设计上全平台 AI 推理用量（含 karda/varda/L3 agent 经 atlas 路由的调用）唯一入口是 atlas 调平台 `POST /usage/consume`，配额裁决权威在平台 `metering.quota_pools`，atlas 自己只做只读 gate。

实测两层缺口叠加：①atlas 自己这层——`recordUsage()` 只打一条 warn 直接返回 null，AI 专属详细运营历史（旧版 `40-model-platform.md` 曾设计过的 `commerce.tenant_usage_event`：tenant+application+user+token(used/input/output)+model_code+latency+request_id 等字段）**没有落地到 atlas 自己的库**；②atlas→platform 这层——全仓 grep 未发现任何调用 `/usage/consume` 或平台 C2 `/platform/entitlements` 的代码，**C2 权益客户端根本不存在**。两层都空，不是"调用失败"是"压根没写"。

**影响**：`metering.usage_events` 里 AI 相关行数应为零——任何挂了 AI 配额组件的套餐，配额从未被真实扣减（对应实证表"配额 activeQuotas: 0 → fail-open 放行"）；TD-008 记录的 commerce 超额计费缺口在当前状态下**无论如何实现都拿不到任何 AI 用量数据可算**，二者互为前提。即使 TD-043（S2S 鉴权）修好，atlas 也没有代码去调用任何 C2/C3 端点，鉴权修好本身不产生任何效果——两条债相邻但独立，均需处理才能打通。

**解决方向**：atlas 侧需要（均属外部仓改动，按边界走 issue 交办，platform 不代做）——① 实现 AI 专属详细用量表（落 atlas 自己的库，不进平台 `metering` schema，粒度不匹配：平台账本是 workspace×product×metric_key 级别，没有 user/model/token 明细维度，这是刻意设计不是疏漏）；② 每次推理成功后调平台 `POST /usage/consume` 上报聚合量（product_200 §4.1 契约，需先有 TD-043 的 S2S token）；③ 入口强制求值补上 entitlement 半程（`grant ∧ entitlement` 公式当前只有 grant 落地，需接平台 `GET /platform/entitlements`）；④ 自己本地的 quota fail-open 逻辑与恒空的 `/capability/usage-summaries` 表建议随①②③退役，改为读平台 C2 返回值做只读展示，不再自行维护平行状态。

**更新（2026-07-28 同日，Resolved）**：atlas 自主完成了①②③全部三项——`vxture-atlas#63/#64`（AI 专属明细表 `reqlog.request_records`/`error_records` 落地，即①，且比这里假设的还完整：月分区+失败路径也记）、`#73`（TD-017 part2，C3 `POST /usage/consume` 上报调用方，即②）、`#72`（TD-016，C2 `PlatformEntitlementClient`，即③，配额门第一次能真正拒绝）。④（本地 stub 退役）也一并处理：`vxture-atlas#74` 把恒空的 `tenant_subscription_quotas` 镜像表彻底停用，新 `/tenancy/quotas` 直接读 C2 信封而不是本地镜像。**本条描述的架构缺口（atlas 完全没接入平台 C2/C3）已不复存在，标记 Resolved**。唯一仍预期的状态是"配额显示 uncovered"——这不是新缺口，是 atlas 售卖目录仍是未发布草稿的必然结果（`status` 字段已能区分"未覆盖"与"连不上平台"，见 `vxture-atlas#74` 设计），目录一旦发布会自动变成 `covered`，无需任何一侧再改代码。

**atlas 侧独立复核确认（2026-07-28，`vxture-atlas` PR #63，`docs/30-design/210-usage-metering-and-history.md`）**：atlas 侧同步做了对称分析，结论一致且补齐了本条①的具体落点——AI 专属明细表**已经部署**，不是待建：`reqlog.request_records`（DDL 已上线、按月分区、Prisma 已建模），字段= 归属维度（`tenant_id`/`workspace_id`/`product_id`/`user_id`/`application_id`/`agent_id`/`feature_id`）+ atlas 领域事实（`model_code`/`provider_code`/`input_tokens`/`output_tokens`/`latency_ms`/`usage_type`/`status`）+ 对账关联（`billed_metric_key`/`billed_amount`/`usage_event_id`/`request_id`，**不建跨仓 FK**，靠 `request_id`/`usage_event_id` 松关联——`usage_event_id IS NULL` 即为"consume 未落地"的天然对账信号）。两条决定性理由与本条描述吻合：user 维度只能在 atlas（平台 `usage_events` 故意不设 `user_id`，成本中心是 workspace 不是人）；atlas 挂了不能拖垮计费内核（故两库间零 FK）。

atlas 侧登记的对应 TD（供交叉核对，非本仓 TD 编号，不可与本仓号混用）：**TD-017**（atlas 两边都不写，karda 真实流量已跑但零记录且不可补录——事件从未被捕获，是既成损失非待办）；**TD-016**（C2 权益客户端不存在，PLATFORM_API_URL 零处读取——atlas 自陈这是 fail-open 从"临时降级"变成"永久常态"的真正原因，与本条第②③点对应）；**TD-018**（`reqlog` 分区只建到 2027-01，之后落 DEFAULT 分区、drop 式留存静默失效——现因零写入而休眠，TD-017 一旦修复即开始计时，是 atlas 自己的运维项，不影响本仓）；**TD-019**（已修：`atlas.parse` 已从能力清单摘除，对应本仓实证表"`/v1/parse` 零实现"一项，不再是缺口而是诚实下架）。

**结论：本条①的"实现"改为"接线"**——目标表已存在，缺的只是写入代码（atlas 侧原话）。本条其余判断（②③④）与本仓 metering 设计的关系不变，无需修改。

---

### TD-045 — atlas / runos 两侧同一个 BigInt 序列化缺陷，打掉 opera 两块运行数据面

| 字段         | 内容                                                                                                                         |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| **分类**     | Implementation Gap（**缺陷在上游仓，本仓只承担交办与跟踪**）                                                                 |
| **状态**     | Open                                                                                                                         |
| **登记日期** | 2026-08-14                                                                                                                   |
| **来源**     | opera 目录重构 B3 验收（`docs/70-workplan/20-opera-ia-restructure.md` B3「验收时发现的上游缺陷」）；证据为两个容器的运行日志 |

**描述**：`vx-atlas-app-dev` 与 `vx-runos-app-dev` 两个容器的日志里出现**同一句**未捕获异常：

```
ERROR [ExceptionsHandler] TypeError: Do not know how to serialize a BigInt
    at _ExpressAdapter.reply (/app/dist/main.cjs:…)
```

命中的端点各一条：

| 上游  | 端点                   | opera 侧落点                                 |
| ----- | ---------------------- | -------------------------------------------- |
| atlas | `GET /capability/logs` | 运行监控 · 调用日志 → 「Atlas 请求日志」分区 |
| runos | `GET /audit/calls`     | 运行监控 · 调用日志 → 「Runos 能力调用」分区 |

两边都是 NestJS + Prisma。Prisma 把 PostgreSQL 的 `bigint` 映射成 JS `BigInt`，而 `JSON.stringify`
对 `BigInt` 抛 `TypeError`——序列化发生在 Nest 的 `ExpressAdapter.reply` 里，**在任何 handler 之后**，
所以业务逻辑全部跑完、查询也成功了，只在写响应那一刻 500。命中的必然是这两条流独有的
大整数列（Token 计数、延迟、累计计数器之类），同上游的其它端点因为不返回这类列而完全正常
（实测 `runos GET /audit/mgmt-events` 与 `GET /audit/outcomes` 均 200）。

**与本次重构无关的两条证据**：① atlas 那条落在 opera 本批**完全没有改动**的原有分区上；
② runos 那条一直存在，只是此前藏在「审计」页的非默认流后面，B3 把 `calls` 提到默认位置才暴露。

**影响**：opera 的运行监控面**两块都读不出数据**——排障时最需要的请求级明细（谁调的、多慢、
错在哪一类）恰好是拿不到的那部分。同时这两条端点对任何消费方都不可用，不止 opera：
只要响应里带那几列，调用方拿到的一律是 500 而不是数据。

**解决方向**：**在上游修，opera 侧不做兜底**。序列化兜底（前端容错、BFF 侧改写响应）等于替上游
把类型错误吞掉，吞掉之后没有任何东西会提醒它还坏着——与 TD-044 里「fail-open 从临时降级
变成永久常态」是同一种失效。上游两侧的修法相同，二选一：Prisma 侧把这些列读成 `Number`
（值域安全时）或 `string`；或注册全局 `BigInt.prototype.toJSON`。修好之前 opera 页面照常展示
「读取失败」并保留重试——**入口不藏**，理由同 `AtlasChangeTable` 文件头那段：藏起来意味着
门户要自己维护一份「上游修好了没有」的判断，而那份判断只会漂移且没人会提醒它漂了。

**去向**：2026-08-16 owner 逐条授权后发出。**发前逐条复核，三条登记里有两条与实际不符**
——拿过期结论开 issue 会让上游花时间去证伪一个已经修好的东西。

| 端点                         | 复核结果                                                                                                                                                                                                                                                                                                           | issue                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| atlas `GET /capability/logs` | **已被上游自行修掉**：`observability.service.ts` 的 `LogSearchResultRow` 把 token 三列 Omit 掉、`tokenCount()` 转 `Number`，容器日志里 `serialize a BigInt` 出现 **0** 次。**但**同表有**四**个 bigint 列，`billed_amount` 漏在 Omit 之外——全库 0/1882 有值故今天点不着，属**潜伏**                                | 并入 [`vxture-atlas#193`](https://github.com/vxture/vxture-atlas/issues/193) |
| runos `GET /audit/calls`     | **仍在，且有数据时 100% 复现**：`listCapabilityCalls` 是裸 `findMany`，不选列不转换；`audit.capability_call` 的四个 bigint 列在开发库 **1161 行全部非空**。同模块 `mgmt-events` / `outcomes` 返回 200 是因为查的是没有 bigint 列的另两张表——当初据此误判「只有 calls 坏」，真实判据是**返回行里有没有非空 bigint** | [`vxture-runos#110`](https://github.com/vxture/vxture-runos/issues/110)      |

**状态**：Open —— 等上游。**opera 侧不兜底**的判断不变：序列化是上游的契约面，在 BFF 里
打补丁等于让每个消费方各自维护一份，且上游修好之后没人会记得删。
