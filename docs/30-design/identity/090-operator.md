# Identity Operator 安全（identity 板块 · 详细层 · workforce realm）

> 🧭 架构层见 [`identity-platform-architecture.md`](./040-architecture.md) §7（workforce realm 概览）。本文 = operator 身份安全（MFA / 隔离 / 审计）的详细层权威 reference。
> 平台数据模型权威 = [data_platform_100_architecture.md] + [-schema.md]（operator 身份域字段级 = **b §14 admin.operator\_\***，本文不重述 DDL）。

> 版本 v1.0（2026-06-23）。运营控制面 `y.vxture.com` 的 operator 身份与登录安全 **权威设计**。
> **本文取代并收编**（吸纳优点后删除原件）：
>
> - `docs/Operator-Identity-Security-Design-V2.md`（V2 思路稿 → 正式化为本文）
> - `admin-access-security-design.md`（根目录，三层 mTLS+OTP 草案）
> - `docs/30-design/identity-operator-access-security.md`（v1.0，WebAuthn-first + mTLS 路线，已被 V2 决策推翻）
> - `docs/30-design/identity-sso-p2-admin.md`（operator realm RP 详细设计 → 仍有效部分并入本文 §3/§4/§5/§9）
>   **对齐（不取代）**：`identity-platform-decisions.md`（IdP 北极星）、`identity-platform-rp-integration.md`（RP 模板）、`identity-platform-access-topology.md`（cookie/SLO）、`data_platform_100_architecture.md`（平台数据架构：约束/铁律/§3.4 域概览）、`data_platform_200_schema.md`（**字段级权威**：operator 身份域 = §14 admin.operator\_\*）。
>   依据：行业基线（NIST 800-63B / OWASP ASVS L3 高权限 MFA）+ 本仓实现真相核查。

---

## 0. 设计原则（三条）

1. **operator 是独立控制面身份域**，与租户（tenant）身份**完全隔离**：schema / 表 / 账号 / 生命周期 / RBAC 五维隔离，无外键、无交叉、无 SSO 串味。
2. **不反转现有架构**：OIDC IdP（`accounts` 集中签发）+ admin-bff 作 OIDC RP + RS256 token + `vx_sid_op` host-only 中央会话 + `admin.*` 两级 RBAC **全部保留**。本文只做两件事：**(a) 把 MFA/恢复码作为 operator 安全层增量嵌入登录流程；(b) 把 operator 数据模型一次性重整干净**。
3. **安全与便捷并重**：默认 TOTP（成熟、不依赖短信/邮箱、零额外硬件），高权限进阶 WebAuthn（抗钓鱼、Windows Hello/Touch ID 比输码更便捷），恢复码兜底。**不引入 mTLS/设备证书**（V2 决策，见 §2.4）。

---

## 1. operator 硬隔离（架构红线，沿用并强化）

operator 与 tenant_user 是两套完全隔离账号。三重硬隔离（并入 p2-admin §1）：

- **realm=operator**：`iam.oidc_client(client_id=admin).realm=operator` → IdP 认证 `admin.operator_account`（**非** `identity.users`）；`sub=opr_{id}`；`userType=operator`。
- **中央会话 `vx_sid_op`**：由 IdP（`accounts.vxture.com`）签发，**host-only、绝不 `.vxture.com`**（红线）。operator 登录不会静默带入任何租户应用。
- **RP 会话 `__Host-vx_rp_session`**：在 admin host，独立于 console/website。
- **三重结构性拦截**：`sub` 空间（`opr_` vs `usr_`）+ `aud=admin`（单值）+ `userType=operator`——operator token 拿到任何租户 RP 校验**结构性被拒**，反之亦然。
- **数据隔离不变量**：`admin.operator_*` 与 `identity.*` / `iam.role|permission` **无任何外键**；operator 永不经 iam 租户权限；operator 的会话/刷新/验证码/登录记录**不得**落在 `identity.*`（修复现网泄漏，见 §7.2）。

---

## 2. 安全模型（V2 决策）

### 2.1 因子模型

| 层                        | 因子                                                                              | 形态                                                    |
| ------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------- |
| 首因子（必有其一）        | `email`+password / `phone`+password / `username`+password / email-OTP / phone-OTP | 凭据或动态码                                            |
| 第二因子（MFA，策略门控） | **TOTP（默认推荐）** / **WebAuthn·Passkey（高权限进阶）**                         | Authenticator App / Windows Hello·Touch ID·Security Key |
| 救援                      | **Recovery Code**                                                                 | 一次性恢复码（设备丢失/迁移/紧急）                      |

**因子组合规则**：

- `Required` 的 operator **必须**完成"首因子 + 第二因子"，即便首因子是 email/phone-OTP 也必须再过一个 MFA。
- **`password + TOTP`** 为默认强组合；**高权限账号（root/security operator）强制 WebAuthn**（不接受仅 TOTP）。
- **短信不作唯一 MFA**（V2 §8，SIM-swap/短信劫持风险）；phone-OTP 只能当首因子或备用通道。

### 2.2 MFA 策略引擎（V2 §5）

三态：`Disabled` / `Optional` / `Required`。**生效策略取最严**：

```
effective_policy = max( 平台默认(admin.setting: operator.mfa.policy),
                        角色下限(operator_role.mfa_min_level),
                        个人覆盖(operator_mfa.policy) )
```

- `Required` 但**未注册** → 下次登录**强制注册仪式**（enroll-on-login，绑定在 mfa_pending 上下文内完成）。
- `Optional` 未注册 → 放行 + 引导绑定。
- `Disabled` → 仅首因子（仅限低敏运营角色，默认不建议）。
- **便捷性杠杆（可选，Phase 3）**：`trusted device 记住 N 天`——有界 TTL + 可吊销；**高权限账号不适用**。

### 2.3 会话与高危 step-up

- `vx_sid_op` host-only；**短 TTL**：idle ≤ 30min / abs ≤ 8h（高于租户的安全要求）。
- **高危操作 step-up**：最高危路由（如改运营权限、批量租户操作、密钥/支付相关）要求**重认证第二因子**（WebAuthn 优先）。
- operator **SLO**（back-channel logout）与租户登出**互不影响**（沿用现网）。
- token/会话记 **`amr`/`acr`**（如 `amr=["pwd","otp"]`），为 step-up 与审计提供依据。

### 2.4 刻意取舍（V2 §8 + 反绕过补偿）

- **不采用 mTLS / Cloudflare Access 作为 operator 登录层**：增加设备管理成本、影响运营移动办公便利性、不适合 SaaS 控制面入口（V2 §8）。
  - **残余风险**：控制面成为"纯身份保护 + 公网暴露"，失去网络/设备纵深层。
  - **补偿控制（必做）**：① 高权限 `Required` + 强制 WebAuthn（抗钓鱼）；② 短会话 + 高危 step-up；③ 独立 operator 审计 + 异常登录告警（§6）；④ 保留 `OperatorLoginGuard`（IP+账号限流）+ 运营面 Turnstile；⑤ 可选轻量网络层（Cloudflare WAF/限流，**非** mTLS）。
  - **cf-access 全部残留已彻底移除**（中间件 / `cfaccess` OIDC 客户端 / env / guardrail / 部署手册）：mTLS/Cf-Access 是很远期需求，届时按本节重新引入，当前不留任何残留。
- **不采用短信唯一 MFA**（SIM-swap）。
- **不联邦第三方 IdP**（operator 不接 Google/飞书等；身份留 vxture IdP）。

---

## 3. 认证流程（嵌 MFA 的两步状态机，不反转 RP）

### 3.1 现状（一行）

`oidc.service.completeOperatorLogin`：消费 `login_challenge` → 校验密码 → **立即**建 `vx_sid_op` + 发 auth code → `{redirectTo}`。**仅密码、无第二因子**。

### 3.2 目标：两步状态机

```
Step1  POST /oidc/authorize/login        (首因子: password | email-OTP | phone-OTP)
  消费 login_challenge（内容快照转存）
  → 校验首因子（凭据 / 动态码）
  → 解析 effective MFA policy（§2.2）
  ├─ 无需 MFA → 建会话 + 发 code → { redirectTo }                ← 与今天一致
  └─ 需 MFA → 写 mfa_pending（Redis 短时）
              → { status:"mfa_required", mfaToken, methods:[...], enrollRequired }

Step2  POST /oidc/authorize/mfa/verify    (第二因子: totp | webauthn | recovery)
  载 mfa_pending(mfaToken)（缺失/过期 → 400 mfa_session_expired）
  → 校验第二因子
  ├─ 成功 → 删 mfa_pending；建 vx_sid_op(amr=[factor1,factor2]) + 发 code → { redirectTo }
  └─ 失败 → attempts++；超限锁定（写 operator_login_attempt）

注册仪式（enrollRequired=true 时，绑定在 mfa_pending 上下文内）：
  POST /oidc/authorize/mfa/enroll/totp      → 返回 base32 secret + otpauth URI（二维码）；首个 TOTP 码确认后启用
  POST /oidc/authorize/mfa/enroll/webauthn  → challenge → attestation 验证 → 存 operator_webauthn_credential
  注册成功后一次性下发 Recovery Code（仅展示一次）
```

**要点**：

- **`mfa_pending`** = Redis 键 `rp:operator:mfa_pending:{token}` = `{ operatorId, challengeSnapshot(clientId/redirectUri/scope/state/codeChallenge/nonce), factor1Method, attempts, exp≈300s }`。原 `login_challenge` 在 Step1 消费后把内容存入快照，Step2 用快照完成 authorize 发 code。
- **admin-bff RP 侧零改动**：最终仍是收到 `code` 走 `/auth/callback`，回调逻辑不变——这正是"不反转架构"。
- **端点**（对齐现有 `oidc.router` 命名）：`/oidc/authorize/login`（扩 operator 的 email/phone-OTP 分支）、`/oidc/authorize/mfa/verify`、`/oidc/authorize/mfa/enroll/{totp,webauthn}`。
- 登录 UI：accounts `OidcLoginForm` 的 operator 分支增加"第二步 MFA"组件 + 注册仪式页；`login_challenge`/realm 流程不变。

### 3.3 时序

```
admin /login → admin-bff /auth/login → IdP /oidc/authorize (realm=operator)
  → 无会话 → login_challenge → accounts /login?realm=operator
  → [Step1] 首因子 POST /oidc/authorize/login
       ├─ 无 MFA → redirectTo=callback?code ─────────────────────┐
       └─ 需 MFA → mfa_required → [Step2] /oidc/authorize/mfa/verify → redirectTo=callback?code ┐
  → admin-bff /auth/callback?code → 交换 token → set __Host-vx_rp_session → admin ✓
```

---

## 4. 授权（回查 `admin.*`，与 iam 零交叉）

并入 p2-admin §4：

- **token 只放粗粒度 `operator_role`**（`admin.operator_role.code`）；**细粒度回查**：admin-bff 用 `sub` 查 `admin.operator_role_permission` 裁定（capability 守卫 `platform.tenant.manage` / `platform.admin.manage` 等）。
- **`admin.*` 与 `iam.*` 完全隔离**：两套 RBAC 表、无外键、无交叉。
- **中间件链**（admin-bff，operator 分支）：
  ```
  读 __Host-vx_rp_session → 载 operator RP 会话 → operator access_token
    验签 + aud==admin + userType==operator（否则 401）
    account_status==active
    组装 AuthUser{ sub(opr_), userType=operator, dataScope=global, operator_role }
    高危守卫：@RequireCapability(...) 回查 admin.operator_role_permission；最高危 → step-up
  ```

### operator access_token claims（并入 p2-admin §2，子集，无租户语义）

```json
{
  "iss": "https://accounts.vxture.com",
  "aud": "admin", // 单值
  "sub": "opr_<operator_account.id>",
  "userType": "operator",
  "dataScope": "global",
  "account_status": "active",
  "sid": "<vx_sid_op 关联会话>",
  "amr": ["pwd", "otp"], // 本次认证方法（新增；step-up/审计用）
  "operator_role": "super_admin" // 粗粒度；细粒度回查
  // ✗ 无 active_org / active_tenant / entitlement
}
```

---

## 5. 审计与检测（独立于租户）

并入 admin-access §5 + operator-access §L5：

- **operator 全链路独立审计**：登录成败、MFA 注册/校验、敏感操作、权限变更。
- **落点**：复用 `support.audit_log`，以 **`actor_type=operator`** 逻辑隔离（已按月分区、保留 ≥2 年、已有基础设施），记录 `actor_id / ip / user_agent / request_id / action / target / result / metadata`。
- **异常检测（Phase 3）**：登录失败峰值、异地/新设备登录、MFA 连续失败 → 告警。

---

## 6. 数据模型（完整重设计）★

> 范围：**operator 身份域**（账号/凭据/MFA/会话/审计/RBAC），在 `data_platform_100_architecture.md` 锁定的 schema 架构内，全部归 **`admin` schema**。不动 tenant（`identity`）/iam/commerce/product/model。

### 6.1 放置与命名

- **schema**：`admin`（`data_platform_200_schema.md` §14：运营账号 + 平台治理）。**不新建 `operator` schema**（避免偏离锁定的 8-schema 图）。
- **命名**：operator 身份域表统一 **`operator_` 前缀**（在 `admin` schema 内与平台治理表 setting/feature*flag/maintenance/announcement/governance_record 区分），遵循 `data_platform_100_architecture.md` §3.2（命名规范）：`id uuid default gen_random_uuid()`、`{entity}_id` 外键、`created_at/updated_at/deleted_at timestamptz`、状态用 `varchar(32)`+CHECK（不用 PG ENUM）、`is*\*` 布尔、`idx*/uidx*/chk\_` 索引、`metadata jsonb`。
- **凭据安全**：密码 **Argon2id**（与租户对齐，**消除现网 operator bcrypt 债**）；TOTP secret **加密落库**；恢复码**哈希**单次。

### 6.2 现状债务 → 目标处置

| 现状                                                                                | 问题                                  | 目标                                                                                          |
| ----------------------------------------------------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------- |
| `ops.admin`（密码内联 + `mfa_enabled` 空壳 + `login_failure_count`/`locked_until`） | 凭据与账号耦合；MFA 字段无 backing 表 | 拆 → `operator_account` + `operator_credential` + `operator_mfa`                              |
| operator refresh → `identity.refresh_token`                                         | **跨域泄漏**到租户 schema             | → `admin.operator_refresh_token`                                                              |
| operator 登录失败 → `identity.login_attempt`                                        | **跨域泄漏**                          | → `admin.operator_login_attempt`                                                              |
| operator 验证码 → `identity.user_verification`                                      | **跨域泄漏**                          | → `admin.operator_verification`                                                               |
| operator 中央会话 仅 Redis（`vx_sid_op`）                                           | 无 DB 镜像（无法列举/强制下线）       | Phase 1 维持 Redis；Phase 3 可加 `admin.operator_session`（**不**用 `identity.auth_session`） |
| operator 审计落点不明                                                               | `identity.audit_event` 是租户的       | → `support.audit_log`(`actor_type=operator`)                                                  |
| `ops.role/permission/role_permission`                                               | 命名未体现 operator 域                | 重命名 → `operator_role/operator_permission/operator_role_permission`                         |

### 6.3 字段级规格 → 见权威

> operator 身份域全部表（账号 / 凭据 / MFA / WebAuthn 凭据 / 恢复码 / 验证码 / 登录尝试 / 刷新令牌 / operator*role\*・operator_session）的\*\*字段级权威 = b `data_platform_200_schema.md` §14（admin.operator*\*）\*\*；表清单与域概览见 a `data_platform_100_architecture.md` §3.4；落地/迁移处置见 c `data_platform_300_migration.md`。本文不再重述列 / 索引 / 触发器 DDL。
>
> **域归属对齐**：operator\_\* 已归 **admin** 域（b §14）。本设计早期规划将其置于 `admin` schema（见 §6.1/§6.2 的重整与去债思路），最终 schema 归属与字段级规格以 b 为准。

### 6.4 隔离不变量 → 见权威

> operator 身份域与 `identity.*` / `iam.role|permission` 的**零外键隔离不变量**、共享基础设施（`iam.oidc_client(admin, realm=operator)` / `iam.signing_key` 对 operator 账号无 FK）、审计落点（`support.audit_log(actor_type=operator)`）等字段级约束见 b §14。核心隔离红线亦见本文 §1（架构红线）。

### 6.5 seed（幂等，统一进 `deploy/database/seed/seed-catalog.mjs`）

> **RBAC 初始化数据权威 = [`data_admin_200_schema.md`](../data_admin_200_schema.md) §4**（七预置角色 + rank 值 + perm_code 三段式目录 + role→perm 映射 + super_admin 显式全授 + 两系统账号）。本节只列安全侧要点，不复制目录。

- `operator_role`（7 角色 + `rank`）+ `operator_permission`（三段式目录，`gen_random_uuid`+`on conflict perm_code`）+ `operator_role_permission`。**super_admin 显式全授**（无硬编码旁路，缺则自锁 403；seed 运行时自检 super_admin 映射数==perm 全集）。
- 预建两账号（哨兵 UUID 锚点）：`systemadmin`（`sys_config`/`disabled`，元锚点不登录，无凭据）+ `superadmin`（`super_admin`/`active`，`is_system=true`）+ `operator_credential`（Argon2id，`force_password_change`）+ `operator_mfa`（首登强制注册：policy 由平台默认/角色下限决定）。
- 平台默认 MFA 策略 → `admin.settings`（`config_key=operator.mfa.policy`）。
- 幂等双机制（唯一自然键+on conflict 普适；哨兵 UUID 仅锚点行）见 `data_admin_200` §4.0。

---

## 7. 实施相位

> **Phase 0 是其余相位硬前置。** 每相位单独验收、提交前单独确认（G6），走 CI/CD：`feature/identity-platform-operator` → develop → beta → main → VXTURE_DEPLOY_HOST。
> 逐项可落实 + 可验证的任务分解见 **`docs/workplan/identity-platform-implementation.md`**。

| 相位            | 内容                                                                                                | 依据                             |
| --------------- | --------------------------------------------------------------------------------------------------- | -------------------------------- |
| **P0 前置**     | 修 admin-bff bootstrap 死锁（commerce `ProvisioningModule`）+ 登录"二次登录"鲁棒性 bug              | 不修则任何 operator 改动无从部署 |
| **P1 数据模型** | `admin.operator_*` 重建（schema×2 + baseline 迁移 + seed + repo 切换 + 修跨域泄漏）                 | §6                               |
| **P2 MFA 核心** | 两步登录状态机 + **TOTP** + 策略引擎（Disabled/Optional/Required）+ 恢复码 + 登录 UI + amr/独立审计 | §2/§3/§5                         |
| **P3 WebAuthn** | WebAuthn/Passkey 注册+断言 + 凭据管理 UI + 高权限强制                                               | §2.1                             |
| **P4 加固**     | 会话短 TTL + 高危 step-up + 异常检测 + 可选 `operator_session`/trusted-device                       | §2.3/§5                          |

---

## 8. 验收标准

**隔离（核心，并入 p2-admin §8）**

- operator token（`aud=admin`/`userType=operator`/`sub=opr_`）拿到 console/website 校验 → **拒**；tenant token 拿到 admin → **拒**。
- operator 登录后访问 console → **不**静默登录（`vx_sid_op` 不在 `.vxture.com`）。
- operator 授权走 `admin.*` 回查，与 iam 零交叉；operator 登出 ≠ 租户登出。
- 数据校验：`admin.operator_*` 对 `identity.*`/`iam` 无外键；operator 的 refresh/login_attempt/verification **不再**出现在 `identity.*`。

**MFA**

- `Required` operator：首因子通过后必须二因子才建会话；缺/错二因子 → 不发 code。
- `Required` 未注册 → 强制 enroll；TOTP 注册（二维码→首码确认）后下发恢复码（仅一次）。
- 高权限账号仅 TOTP → 被拒，必须 WebAuthn。
- 恢复码单次有效；用尽/丢设备 → 带外重置（另一管理员/DB 置位）。
- MFA 连续失败 → 锁定 + 写 `operator_login_attempt`。
- 浏览器零 OIDC token（仅 `__Host-vx_rp_session`）。

---

## 9. 配置 / 环境变量（admin-bff / auth-bff）

| 变量 / 配置                                                                                         | 说明                                                        |
| --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `OIDC_ISSUER` / `OIDC_CLIENT_ID=admin` / `OIDC_CLIENT_SECRET` / `OIDC_REDIRECT_URI` / `OIDC_SCOPES` | RP 接入（沿用）                                             |
| `admin.setting: operator.mfa.policy`                                                                | 平台默认 MFA 策略（disabled/optional/required）             |
| `operator_role.mfa_min_level`                                                                       | 角色级 MFA 下限                                             |
| TOTP secret 加密密钥                                                                                | secret manager / app key（加密 `operator_mfa.totp_secret`） |
| WebAuthn RP ID / origin                                                                             | = operator 登录面 origin（`accounts.vxture.com`）           |
| 运营面 `TURNSTILE_*`                                                                                | 沿用（反自动化兜底）                                        |

---

## 附. 收编与清理

- **已删除**（吸纳/取舍完成）：`Operator-Identity-Security-Design-V2.md`、`admin-access-security-design.md`、`docs/30-design/identity-operator-access-security.md`、`docs/30-design/identity-sso-p2-admin.md`、`docs/50-deployment/operator-access-cloudflare.md`（mTLS 运维手册，随 Cf-Access 彻底移除）。
- **已更新交叉引用**：`docs/30-design/data_platform_200_schema.md` §14（ops 表清单→operator\_\*）；本文 §6（operator MFA/账号"延后/复用 ops.admin"→"见本文 §6"）。
- **保留不动**：所有 [B] 类 tenant/SSO/RP/topology 文档；[C] 数据模型文档（按上条更新 operator 注脚）。
  </content>
  </invoke>
