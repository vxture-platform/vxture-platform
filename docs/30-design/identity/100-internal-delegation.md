# Identity Platform — admin↔IdP 内部委托设计（B9 凭据类写操作）

> 状态：v1 草案 · 2026-07-04 · 待评审（doc-driven，先固化后实施）
> 范围：admin 运营后台对 operator/customer 账号的**凭据类写操作**如何经 IdP（auth-bff）委托，而非 admin-bff 直写库。
> 依据调研：本仓现状（见 §1 事实）；关联 [`identity-platform-operator.md`](./090-operator.md) §2.3 step-up、[`identity-platform-access-topology.md`](./110-access-topology.md)、[`data_admin_200_schema.md`](../data_admin_200_schema.md)、[`data_identity_200_schema.md`](../data_identity_200_schema.md)。
> 上游背景：admin 应用补齐 [`../product/platform/admin/admin-app-completion-plan.md`](../../20-specs/000-platform/admin/10-admin-app-completion-plan.md) B9。

## 0. 定位

admin 侧「平台用户(operator)/账号(customer) 管理」的动作按钮当前全 `disabled`。其中**凭据类**（密码、MFA、账号启停/解锁、会话吊销）**绝不能由 admin-bff 直写库**——凭据由 IdP 拥有（哈希策略、加密、会话失效、防锁死），直写会绕过策略并破坏 realm 边界。本设计定义这些操作经 IdP 内部端点委托的模型、端点目录、安全约束与分期。非凭据类写（角色/状态元数据、roles/permissions CRUD）不在委托范围，走 admin-bff 直写库（可 PREPARE 验证），单列于 §2。

## 1. 现状事实（调研）

- **唯一现存内部端点**：`POST /internal/operator/stepup/totp`（`bff/auth-bff/src/routers/operator-stepup.router.ts`，类级 `InternalAuthGuard`）。全仓仅此一个 `/internal/*`。
- **委托 plumbing 已成型**（B9 直接复用为模板）：
  - admin-bff `OperatorStepUpService`（`bff/admin-bff/src/auth/operator-stepup.service.ts`）：`fetch(${idpBaseUrl}/internal/...)` + header `x-vxture-internal-auth: AUTH_INTERNAL_TOKEN`；`idpBaseUrl = OIDC_BACKCHANNEL_ISSUER ?? AUTH_BFF_URL`（容器内网 `http://vx-auth-bff:3081`，**绝不走公开 issuer** `accounts.vxture.com`）；未配置 fail-closed。
  - auth-bff `InternalAuthGuard`（`bff/auth-bff/src/authn/internal-auth.guard.ts`）：`x-vxture-internal-auth` 与 `AUTH_INTERNAL_TOKEN` `timingSafeEqual`；未配置/不匹配 401。
  - `AUTH_INTERNAL_TOKEN` = 共享密钥（`deploy/secrets/platform.env`），compose 同一 env_file 注入 auth-bff 与 admin-bff。
- **凭据存储（realm 硬隔离，无跨 realm FK）**：
  - operator：`admin.operator_credential.password_hash`(Argon2id)、`admin.operator_mfa.totp_secret`(AES-256-GCM，key=`OPERATOR_TOTP_ENC_KEY`)、`admin.operator_recovery_code`(哈希)、`admin.operator_webauthn_credential`、`admin.operator_refresh_token`(含 `revokeSession()` 无端点)。会话中央表 `session.auth_sessions`(realm=`workforce`, sub 前缀 `opr_`)。
  - customer：`credential.user_credentials.password_hash`(Argon2id)、`account.users.status` + `account.users.account_login_disabled`、`session.{auth_sessions,refresh_tokens,password_reset_tokens,login_attempts}`。customer 侧**无 MFA 实现**。
- **关键缺口**：
  - operator 密码 **连 repository 方法都没有**（`pg-operator.repository` 只有 `authenticateOperator`，无 set/reset）；operator 账号 create/enable/disable/unlock/MFA代客重置/会话代客吊销 **全链路缺失**（admin-bff `platform-admins.router` 只读）。
  - customer 密码重置仅**自助邮件链接**（`/auth/forgot-password`+`/auth/reset-password`）与**租户内 owner 代客**（console-bff `resetMemberPassword`，共享 service 直写、不经 IdP 内部端点）；**平台 operator 代客无任何路径**。`account.users.status` 无 setStatus service。
- **前端占位**：`PlatformUsersPage`（新建/查看/调整角色/停用启用 全 disabled）、`AccountsPage`（新建/查看/重置密码/停用恢复/解除锁定 全 disabled）。

## 2. 操作分类：直写 vs 委托

| 操作                                                                           | 归属         | 机制                               | 备注                                  |
| ------------------------------------------------------------------------------ | ------------ | ---------------------------------- | ------------------------------------- |
| operator 角色调整 (`operator_account.role_id`)                                 | admin-bff 库 | 直写（PREPARE）                    | 非凭据；step-up gated                 |
| operator 展示/元数据编辑 (display_name/email/phone/remark/sort)                | admin-bff 库 | 直写                               | 邮箱/手机改动**不改凭据**，仅联系字段 |
| admin-roles / admin-permissions CRUD (`operator_role*`/`operator_permission*`) | admin-bff 库 | 直写（PREPARE）                    | 纯 RBAC 元数据；audit + step-up       |
| account 展示字段（非登录相关）                                                 | admin-bff 库 | 直写                               | 只读为主                              |
| **operator 账号创建**（含初始凭据/邀请）                                       | **IdP**      | 委托 `/internal/operator/accounts` | 见 §6 凭据下发                        |
| **operator 重置密码**                                                          | **IdP**      | 委托                               | + 吊销全部会话                        |
| **operator 停用/启用**                                                         | **IdP**      | 委托                               | 停用即吊销会话；防锁死                |
| **operator 解锁**（登录锁定）                                                  | **IdP**      | 委托                               | 清限流/锁定态                         |
| **operator MFA 代客重置**（TOTP/WebAuthn/恢复码）                              | **IdP**      | 委托                               | 高危，强 step-up                      |
| **operator 强制下线**（会话/刷新令牌吊销）                                     | **IdP**      | 委托                               | 复用 `revokeSession`                  |
| **customer 代客重置密码**                                                      | **IdP**      | 委托 `/internal/customer/accounts` | 见 §6；合规敏感                       |
| **customer 停用/启用/解锁** (`account.users.status`)                           | **IdP**      | 委托                               | 停用即吊销会话                        |

**铁律 7（realm 隔离）**：`/internal/operator/*` 只碰 `admin.*`/workforce 会话；`/internal/customer/*` 只碰 `account.*`/`credential.*`/customer 会话。actor 恒为 operator（来自 admin-bff RP 会话），但**目标 realm 由端点前缀锁定**，端点必须拒绝跨 realm 目标 id。

## 3. 委托机制（复用既有范式）

```
admin 前端 ──(cookie 会话)──▶ admin-bff router（能力守卫 + step-up 守卫）
   admin-bff *Delegation Service*  ──POST ${AUTH_BFF_URL}/internal/{operator,customer}/…
        header x-vxture-internal-auth: AUTH_INTERNAL_TOKEN（容器内网，绝不公开 issuer）
   ▼
auth-bff /internal/… router（@UseGuards(InternalAuthGuard)）
   → 归属 realm 的 service（新增方法）写 credential/status/session
   → 返回结果（如一次性重置令牌，见 §6），绝不回明文密码给浏览器直显除非 §6 决策允许
```

- actor（operatorId）、reason、目标 id **由 admin-bff 从 RP 会话+请求体传入**，浏览器不得直接指定 actor。
- fail-closed：token/URL 未配置 → 503/401，不降级为直写。
- 新增 admin-bff 服务仿 `OperatorStepUpService`（同 idpBaseUrl/token/错误语义）：`OperatorAdminService`（operator 面）、`CustomerAdminService`（customer 面）。

## 4. 内部端点目录（auth-bff，均 `InternalAuthGuard`）

**现有**：`POST /internal/operator/stepup/totp`（保留）。

**新增 · operator realm**（`admin.*`）：
| 端点 | 作用 | 写 | 归属 service |
|---|---|---|---|
| `POST /internal/operator/accounts` | 创建 operator（username/role/联系方式 + 初始凭据下发 §6） | operator_account(+credential) | 新 OperatorProvisioningService |
| `POST /internal/operator/accounts/:id/reset-password` | 重置密码 + 吊销会话 | operator_credential + refresh_token | 新 setOperatorPassword |
| `POST /internal/operator/accounts/:id/disable` | 停用 + 吊销会话（防锁死） | operator_account.status + 会话 | — |
| `POST /internal/operator/accounts/:id/enable` | 启用 | operator_account.status | — |
| `POST /internal/operator/accounts/:id/unlock` | 清登录锁定/限流 | login guard state | OperatorLoginGuard |
| `POST /internal/operator/accounts/:id/mfa/reset` | 代客重置 TOTP/WebAuthn/恢复码 | operator_mfa/webauthn/recovery | OperatorMfaService/Webauthn |
| `POST /internal/operator/accounts/:id/sessions/revoke` | 强制下线 | refresh_token/auth_sessions | OperatorRefreshTokenRepository |

**新增 · customer realm**（`account.*`/`credential.*`）：
| 端点 | 作用 | 写 |
|---|---|---|
| `POST /internal/customer/accounts/:id/reset-password` | 代客重置（§6，倾向 reset-link 令牌，不下发明文） | credential.user_credentials + 会话吊销 |
| `POST /internal/customer/accounts/:id/disable` | 停用 + 吊销会话 | account.users.status + 会话 |
| `POST /internal/customer/accounts/:id/enable` | 启用 | account.users.status |
| `POST /internal/customer/accounts/:id/unlock` | 解锁 | 锁定态来源（见开放决策 D3） |

每端点请求体含 `{ actorOperatorId, reason }`（审计用），响应含 `{ ok, ... }`（如 reset 返回一次性令牌/链接或 tempPassword，按 §6）。

## 5. 安全约束

1. **Step-up 强制**：operator 高危凭据写（reset-password / disable / mfa/reset / sessions/revoke / 账号创建 / 对*另一* operator 的任何凭据写）在 admin-bff 侧经 `OperatorStepUpGuard` 门控（复用现有 `/api/operator/step-up/totp`）。customer 代客写同样要求 step-up。
2. **审计**：每次委托成功后 admin-bff 写 `support.audit_logs`（actor_type=operator, actor_id, action='operator.account.reset_password' 等, resource_type/id, result, request_id, reason）。IdP 侧另记安全事件（登录/MFA 域）。
3. **会话失效**：停用 / 重置密码 / MFA 重置 → 吊销目标主体**全部**会话与刷新令牌（operator：`operator_refresh_token`+`auth_sessions`；customer：`session.refresh_tokens`+`auth_sessions`）。
4. **防锁死**：不得停用/删除最后一个在职超管；不得停用自己；operator 解绑 MFA 需保留至少一个可登录第二因子或走恢复流（对齐 operator 文档 anti-lockout）。
5. **Realm 校验**：`/internal/operator/*` 校验目标 id ∈ `admin.operator_account`；`/internal/customer/*` 校验 ∈ `account.users`；越界 404，不泄漏另一 realm 存在性。
6. **能力守卫**：operator 面 `platform.admin.manage`；customer 面 `platform.tenant.manage`（或细分 `platform.account.manage`，见 D4）。

## 6. 凭据下发方式（决策项）

密码重置有两条路，**倾向「一次性重置令牌/链接」，不返回明文**：

- **A（倾向）reset-token**：IdP 生成一次性、短时、单用的重置令牌，写 `session.password_reset_tokens`（customer 复用现表）/ operator 新增等价表；admin 侧拿到「重置链接」交付给用户（或系统发邮件/短信）。admin 后台不接触明文密码。
- **B temp-password**：IdP 生成随机临时密码（强制下次登录改），一次性回显给运营。operator（内部 workforce）可接受；customer 不建议（明文经运营手，合规风险）。

**建议**：operator 用 A 或 B（B 仅内部、显一次、must-change）；customer 一律 A（reset-link，运营不碰明文）。最终由 owner 定（D1）。

## 7. admin-bff 集成

- 新 `OperatorAdminService` / `CustomerAdminService`（仿 `OperatorStepUpService`）。
- `platform-admins.router` 追加 operator 写端点（create/edit(DB)/role(DB)/reset-password/disable/enable/unlock/mfa-reset/force-logout → 凭据类委托）。
- `accounts.router` 追加 customer 写端点（reset-password/disable/enable/unlock → 委托）。
- 非凭据写（角色/元数据/roles-permissions CRUD）走直写库 + PREPARE 验证（与既有 B 批一致）。

## 8. 前端启用

- `PlatformUsersPage`：启用 新建（DialogForm→create）/ 查看详情 / 调整角色（DB）/ 停用启用 / 重置密码 / MFA 重置 / 强制下线；重置密码 UX 按 §6（显临时密码或「重置链接已生成/已发送」）。
- `AccountsPage`：启用 查看详情 / 重置密码（§6 A）/ 停用恢复 / 解除锁定。
- 复用 announcements/verifications 的 DialogForm + Toast + step-up 触发（若无 step-up 会话先弹 TOTP）。

## 9. 分期与验收

- **P1 operator 面**（admin-bff 主管 operator，最刚需）：新建/重置密码/停用启用/解锁/MFA重置/强制下线 + 前端。含新建 operator 密码 repository 方法（当前完全缺）。
- **P2 customer 面**（代客，合规更敏感）：reset-password(A)/disable/enable/unlock + 前端。可能需合规评审。
- **并行（无 IdP 依赖）**：admin-roles/permissions CRUD + operator 角色/元数据编辑（直写库 + PREPARE）。
- **验收**：内部端点经 InternalAuthGuard（无 token 401）；step-up 未满足 403；停用/重置后目标会话立即失效；审计落 `support.audit_logs`；realm 越界 404；防锁死断言生效。部署前置 env：`AUTH_INTERNAL_TOKEN`（已有）、operator 密码 hasher/临时凭据配置。

## 10. 决策（owner 已拍板 2026-07-04）

- **D6 范围 = P1 仅 operator**。customer 代客（P2）延后（运营发起重置他人密码合规更敏感，另评审）。
- **D1 凭据下发 = 重置链接/令牌，不下发明文**。admin 后台绝不接触明文/临时密码；重置生成一次性短时单用令牌 → 交付重置链接（或系统发送）。
- **D2 operator 密码基础设施** = 新建 `setOperatorPassword`（Argon2id，复用 `services/identity/account` 同款 hasher 或等价）+ operator 重置令牌**存 Redis**（短时/单用，仿 OIDC state 存储，避免 DDL/迁移；不新建表）。
- **D3 解锁语义**（operator 面）= `unlock` 清 `OperatorLoginGuard` 的 IP/账号限流与锁定态（不引入新表）。
- **D4 能力** = 沿用 `platform.admin.manage`（不新增能力）。
- **D5 审计** = 双写：admin-bff 写 `support.audit_logs`（操作审计），IdP 写自身安全事件。

## 11. P1 实施计划（operator 面）

分三层、按可独立验证的子步推进；auth-bff 属安全关键服务，改动谨慎 + 建议安全评审。

**P1a · 非凭据（admin-bff 直写库，无 IdP 依赖，可先落 + PREPARE 验）**

- `platform-admins.router` 追加：operator 角色调整（`operator_account.role_id`，复合→`access.roles` 语义校验）、元数据编辑（display_name/email/phone/remark/sort）、启用/停用的**元数据位**（`operator_account.status`——但停用还需 IdP 吊销会话，见 P1b）。
- `admin-roles` / `admin-permissions` router 追加 CRUD（`operator_role*` / `operator_permission*`）：create/edit/copy/toggle/delete、权限 create/edit/toggle；step-up gated；修正 `permissionSource()` 恒 'system' 假实现。
- 全部 step-up 门控 + `support.audit_logs`；SQL 全 PREPARE 验证。

**P1b · 凭据委托（auth-bff 新内部端点 + admin-bff 委托 service）**

- auth-bff：`OperatorInternalRouter`（`@UseGuards(InternalAuthGuard)`）暴露 `/internal/operator/accounts` 系列（§4）；底层新建 `setOperatorPassword`（`pg-operator.repository`）、operator 重置令牌（Redis）、`create`/`disable`/`enable`/`unlock`/`mfa/reset`/`sessions/revoke`（复用 `OperatorRefreshTokenRepository.revokeSession`/`OperatorMfaService`/`OperatorLoginGuard`）。停用/重置即吊销全部会话；防锁死（末位超管/自停）。
- admin-bff：`OperatorAdminService`（仿 `OperatorStepUpService`）；`platform-admins.router` 凭据类端点委托 + step-up + 审计。
- **测试**：内部端点单测（无 token 401、realm 越界 404、防锁死、会话失效）；建议安全评审后再上。

**P1c · 前端**：`PlatformUsersPage` 启用 新建/查看/调整角色/停用启用/重置密码/MFA重置/强制下线；重置 UX 显「重置链接已生成」（D1）；step-up 未满足先弹 TOTP。`AdminRolesPage`/`AdminPermissionsPage` 启用 CRUD。

**部署前置**：`AUTH_INTERNAL_TOKEN`（已有）；operator hasher/Redis 令牌前缀 env（若需）。

## 11b. P1b 实施细化（grounding 后，2026-07-04）

调研 auth-bff/iam 后对 §11 P1b 的细化，据此分**垂直片**推进（每片 repo→internal 端点→admin-bff 委托→前端，独立验证）：

- **operator 无持久锁定 + 登录限流在内存/进程内**（OperatorLoginGuard 固定窗口、非 Redis/DB、自动过期）；`operator_account.status` 无 CHECK（自由 varchar，用 active/disabled）。→ **「解锁 unlock」对 operator 基本 N/A**（无持久锁，自动过期），本轮不做独立 unlock 端点。
- **operator 密码 reset 走链接（D1）需要一个不存在的「operator 公开重置页/端点」**（customer 有 /auth/forgot-password+/auth/reset-password，operator 无）。→ reset-password 与 create（需初始凭据下发）**延到 P1b-β**，先做无需公开流的操作。
- 会话吊销：`OperatorRefreshTokenRepository.revokeSession(sessionId)` 仅单会话；需新增 `revokeAllForOperator(operatorId)`（`update admin.operator_refresh_token set status='revoked' where operator_id=$1 and status in ('active','rotated')`）。

**P1b 垂直片顺序：**

- **P1b-α（本轮）**：disable / enable（`operator_account.status` + 停用即 revoke-all 会话）+ force-logout（revoke-all）+ mfa-reset（清 operator_mfa/recovery/webauthn，operator 下次登录经既有 enroll-on-login 重新登记）。防锁死：不得停用自己/最后一个在职超管。
- **P1b-β（下一轮，需公开重置流 + 安全评审）**：reset-password（生成一次性 Redis 令牌 + 新建 operator 公开重置页/端点）、create operator（初始凭据经同一重置流）。

## 11c. P1b-β 公开重置流设计（reset-password / create operator）

**已建基元**：`PgOperatorRepository.setOperatorPassword(operatorId, newPassword, {forceChange})`（Argon2id encoded PHC，upsert `admin.operator_credential`，重置 failed_attempts + 清 locked_until；PREPARE 验过）。

**完整流（待实现，一次聚焦推进 + 安全评审）**：

1. **令牌（Redis，D2）**：admin 委托的重置生成一次性、短时（~30min）、单用令牌，存 `{prefix}operator:pwreset:{token}` → `{operatorId}`，仿 `RedisService.storeOidcAuthCode`/`consumeOidcAuthCode`（setex + get-del 单用）。
2. **内部端点**（auth-bff，InternalAuthGuard）：`POST /internal/operator/accounts/:id/reset-password` → realm 校验 + 生成令牌存 Redis + 吊销会话 → 返回 `{ resetToken, expiresIn }`。
3. **admin-bff**：`OperatorAdminService.resetOperatorPassword` → 拿令牌，构造重置**链接**（公开 issuer `https://accounts.vxture.com/operator/reset-password?token=…`），platform-admins `POST :id/reset-password`（step-up + 审计），前端「重置链接已生成」+ 可复制链接（**不下发明文**，D1）。
4. **公开端点**（auth-bff，**无** InternalAuthGuard，限流）：`POST /auth/operator/reset-password { token, newPassword }` → 消费令牌（Redis get-del）+ 密码策略校验 + `setOperatorPassword(forceChange=false)` + 吊销会话。
5. **公开 UI 页**：operator 访问链接 → 重置页（放 `portals/accounts` 公开鉴权外壳，route `/operator/reset-password`）→ 输入新密码 → 调 4。**这是新增的 operator 公开面，需新页 + 路由。**
6. **create operator**：内部 `POST /internal/operator/accounts` → 插 `operator_account`(+role，无凭据) + 走同一令牌流生成「设置密码链接」→ 新 operator 经公开重置页设初始密码。

**为何独立推进**：新增 operator 公开 UI 面 + 公开端点 + 令牌流 + create，是安全关键且带前端页的完整子工程；宜一次聚焦实现 + 安全评审，不宜与其它混。

## 11d. TD-017 分级模型整改（进展，2026-07-05）

原平顶模型（任何 `platform.admin.manage` 持有者可管任意 operator + 重置链接回传发起方）判定为漏洞（TD-017，owner 2026-07-04）。**整改已实施（b9）**：

1. **能力收紧**：operator 管理能力迁三段式 `operator:account.manage`/`operator:role.manage`，seed 中**仅 super_admin 持有**（`admin` 及以下无）；16 处 fail-open 守卫改 fail-closed。
2. **rank 三层门控**：跨 operator 变更（reset/改角色/停用/启用/force-logout/mfa-reset/metadata 编辑）一律 `actor.rank > target.rank`（两端从 DB 复算，非客户端），平级拒（super_admin 互操作禁）；role-change 双 rank（现角色 + 新角色）；末位 super_admin 存活保护（409）。
3. **带外投递**：reset 一次性链接只邮寄**目标本人 email**，发起方仅得脱敏确认（`deliveredTo`），不回显链接；无 email → 422。
4. **审计**：metadata 编辑补 before/after，联系方式变更可归因。

**收尾残留 → 见 §11e**：带外投递仍信任 `operator_account.email/phone`，而这两字段可被高阶发起方经 metadata 改写（rank 门控允许 100>80，但改后即篡改投递目标）→ 凭据知悉接管低阶账号的残留（TD-017 §③）。根治 = verified-contact 主防线。

## 11e. TD-017 收尾：verified-contact 主防线（③，email + phone 对称）

**思路**：不去堵"每一个能改 email/phone 的入口"（脆、易漏），而在**带外投递出口单点收口**——只向**已验证**的联系方式投递，且任何非本人验证的写入即令其失效。email 与 phone 对称（皆为登录标识 + 找回通道；`admin.operator_verification.target_type ∈ {email,phone}` 基础设施已在）。

**数据模型**：`admin.operator_account` 加 `email_verified boolean NOT NULL DEFAULT false` + `phone_verified boolean NOT NULL DEFAULT false`。seed `superadmin` 两者置 `true`（种子账号联系方式可信）。

**信任状态机（email/phone 各一份，同构）**：

- `verified=false` → **不得**作为带外投递（reset / 初始设密）目标。
- `verified=true` → 可作投递目标。
- **置 false 的触发**：经 admin `updateAdminMetadata` 写 email/phone（运营代改）→ 对应 verified 归零。即"运营可帮改联系方式（保留需求），但改后须本人验证方可恢复带外资格"——保留需求 + 封风险口。
- **置 true 的唯一路径**：**本人自助改联系方式发码验证**（登录态，发码到*新*地址，输码通过 → 写入新值 + verified=true）。

**带外投递 gate**：`reset-password` 内部端点投递前，email 通道要求 `email_verified=true`，否则拒（`contact_unverified`）；短信通道（未来）要求 `phone_verified`。当前 reset 仅 email 通道。

**create-operator 的信任建立（区别于 reset）**：新建 operator 时创建者填的 email 尚未验证——初始设密链接**发到该 email**视为"待建立信任的初始通道"是可接受的：新账号无凭据、无接管价值，且"能收到链接并完成设密"本身即证明该 email 属本人 → 完成初始设密时置 `email_verified=true`。对比 reset（已有账号、可能被篡改 email）**必须预先 verified**。若创建者填了攻击者邮箱，那是 super_admin 在造自己的傀儡账号（其固有能力，rank+审计覆盖），非 verified 机制职责。

**自助验证流程（auth-bff，RP 会话鉴权，非 InternalAuthGuard）**：operator 账户设置"改邮箱/手机" → `start`（发码到新地址，`operator_verification` target=新值/type=email·phone/purpose=contact_change）→ `verify`（校验 → 写入新值 + verified=true）。

**前端**：operator 账户设置页发码验证 UI；admin PlatformUsersPage 显示 email/phone 的 verified 标记 + metadata 改他人联系方式后提示"已置未验证，本人验证后方可用于密码找回"。

**分片**（每片独立验证）：① DDL+seed verified 列 → ② metadata 写 email/phone 置 false → ③ reset 带外 verified gate → ④ operator 自助改联系方式发码验证（repo+端点+前端）→ ⑤ create-operator 带外初始设密（完成即 verified）。①②③即封死残留风险口；④让改过联系方式者能恢复带外资格；⑤补齐 create。

## 12. 待续（P2）

customer 代客（reset-password[A]/disable/enable/unlock + AccountsPage），合规评审后另起。
