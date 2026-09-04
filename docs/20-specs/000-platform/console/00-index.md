# Console 租户工作台产品规格

> 版本：1.0.0 | 更新：2026-05-11
> 技术实现：[`docs/40-implementation/packages/portals/console.md`](../../../40-implementation/packages/portals/20-console.md)
> BFF：[`docs/40-implementation/packages/bff/console.md`](../../../40-implementation/packages/bff/40-console.md)

---

## 定位

Console（`console.vxture.com`）是面向**租户管理员**的工作台，承担租户日常运营管理。

| 用户        | 角色     | 典型操作                               |
| ----------- | -------- | -------------------------------------- |
| 租户 Owner  | 全权管理 | 邀请成员、管理订阅、查看账单、配置权限 |
| 租户 Admin  | 部分管理 | 管理成员、查看配额、调整设置           |
| 租户 Member | 只读     | 查看个人资料和通知                     |

JWT `userType = tenant_user`，`authScope = tenant_console`。Varda 智能助手嵌入 Console（`ConsoleVardaPanel.tsx`）。

---

## 功能模块清单

| 路由               | 功能                                                                           | BFF Router     | 状态      |
| ------------------ | ------------------------------------------------------------------------------ | -------------- | --------- |
| `/`                | 仪表板（租户概览）                                                             | tenant-context | ✅ 已完成 |
| `/members`         | 成员管理（邀请、移除、角色分配）                                               | iam            | ✅ 已完成 |
| `/invitations`     | 邀请管理（待接受 / 已过期）                                                    | iam            | ✅ 已完成 |
| `/roles`           | 角色管理（自定义角色、权限分配）                                               | iam            | ✅ 已完成 |
| `/iam`             | 身份与访问管理（权限总览）                                                     | iam            | ✅ 已完成 |
| `/subscription`    | 订阅管理（当前套餐、升级入口）                                                 | subscription   | ✅ 已完成 |
| `/billing`         | 账单与用量（账单列表、用量明细）                                               | billing        | ✅ 已完成 |
| `/quotas`          | 配额管理（模型 Token 用量）                                                    | subscription   | ✅ 已完成 |
| `/model-platform`  | 模型平台配置（租户级模型访问）                                                 | capabilities   | ✅ 已完成 |
| `/profile`         | 账号信息（身份卡含所属租户、基本信息、安全设置、三方登录、个人偏好）           | me             | ✅ 已完成 |
| `/security`        | 并入 `/profile?panel=sessions`（跳转，展开活跃会话）                           | me             | ✅ 已完成 |
| `/notifications`   | 通知设置（接收偏好）                                                           | me             | ✅ 已完成 |
| `/inbox`           | 待办与消息（待办派生 + 站内消息合并入口，2026-09-04）                          | me             | ✅ 已完成 |
| `/organization`    | 并入 `/tenant` 租户信息(批 5c)                                                 | tenant-context | 🔜 批 5c  |
| `/personal-tenant` | 并入 `/tenant` 租户信息(批 5c 设计定稿 2026-09-05,见 20-tenant-page-design.md) | tenant-context | 🔜 批 5c  |
| `/settings`        | 并入 `/tenant` 租户信息(策略规划中卡 + 危险操作;批 5c)                         | tenant-context | 🔜 批 5c  |
| `/tenant-settings` | 跳转 `/settings` → 批 5c 后跳转 `/tenant`                                      | tenant-context | 🔜 批 5c  |
| `/todos`           | 并入 `/inbox` 待办与消息（保留跳转 `?filter=todo`）                            | —              | ✅ 已完成 |

---

## 租户模型

Console 对应租户体系中的**租户工作台层**：

```
一个用户账号（account）
  └── 可属于多个租户（tenant）
        └── 每个租户内有独立角色（owner / admin / member）
```

- 个人租户（`personal`）：只有自己一个成员，免费试用
- 企业租户（`enterprise`）：可邀请多名成员，需订阅套餐

详见 [`docs/30-design/tenant.md`](../../../30-design/identity/030-tenant.md)。

---

## 订阅与配额

Console 展示租户当前订阅状态（套餐、有效期、功能开关）和 AI 模型配额使用情况。

- 订阅升级入口：`/subscription` → 跳转支付流程（T05 待接入）
- 配额超限提示：`/quotas` 实时显示 Token 用量 vs. 配额
- Feature 开关：由 `subscription.router.ts` 的 capabilities 接口驱动，控制部分功能可见性

---

## 成员与权限

> 2026-09-04 起按**权限目录**（`access.permissions`）门控，不再按角色名硬判。目录、角色矩阵、执行点见
> [`docs/30-design/identity/070-tenant-console-permission-catalog.md`](../../../30-design/identity/070-tenant-console-permission-catalog.md)。

| 页面 / 动作                                                                     | 所需权限码                | owner | manager | member | readonly | guest |
| ------------------------------------------------------------------------------- | ------------------------- | :---: | :-----: | :----: | :------: | :---: |
| 成员管理（目录；无管理码者联系方式打码）                                        | `tenant.member.read`      |   ✔   |    ✔    |   ✔    |    ✔     |   —   |
| 邀请 / 重发 / 撤销 / 添加 / 停用 / 恢复 / 重置密码 / 解除 / 邀请记录            | `tenant.member.manage`    |   ✔   |    ✔    |   —    |    —     |   —   |
| 改成员角色（owner 只能经「转让所有权」；不能改自己）                            | `tenant.role.assign`      |   ✔   |    ✔    |   —    |    —     |   —   |
| 接受邀请 `/accept-invitation?token=`（租户由 token 决定，受邀邮箱须与账号一致） | 登录即可（`@SelfScope`）  |   ✔   |    ✔    |   ✔    |    ✔     |   ✔   |
| 组织资料 / Logo / 企业认证提交                                                  | `tenant.settings.manage`  |   ✔   |    ✔    |   —    |    —     |   —   |
| 产品订阅 / 订单 / 账单 / 卡券（看）                                             | `tenant.billing.read`     |   ✔   |    ✔    |   —    |    ✔     |   —   |
| 下单 / 取消 / 退订 / 自动续费 / 退款申请                                        | `tenant.billing.manage`   |   ✔   |    —    |   —    |    —     |   —   |
| 申报付款 / 加油包购买                                                           | `tenant.payment.manage`   |   ✔   |    —    |   —    |    —     |   —   |
| 申请发票 / 抬头簿                                                               | `tenant.invoice.manage`   |   ✔   |    —    |   —    |    —     |   —   |
| 配额 / 用量                                                                     | `tenant.quota.read`       |   ✔   |    ✔    |   ✔    |    ✔     |   —   |
| 审计日志                                                                        | `tenant.audit.read`       |   ✔   |    ✔    |   —    |    ✔     |   —   |
| 账号信息（含安全设置、三方登录、个人偏好）/ 通知偏好 / 待办与消息 / 总览        | 无（登录即可）            |   ✔   |    ✔    |   ✔    |    ✔     |   ✔   |
| 转让所有权                                                                      | 当前 owner 身份（不走码） |   ✔   |    —    |   —    |    —     |   —   |

角色是全局固定目录（owner / manager / member / readonly / guest），自定义角色未开放；成员的角色指派在成员管理页。缺码时页面显示「没有访问权限」状态（说明所需权限），BFF 同码 403。

---

## Varda 接入点

- 入口组件：`app/[locale]/(console)/ConsoleVardaPanel.tsx`
- Surface：`console`，userType：`tenant_user`
- 状态：⚠️ UI 占位已存在，待 Varda 三端接通（T06）

---

## 多语言支持

| 语言    | 状态      |
| ------- | --------- |
| `zh-CN` | ✅ 主语言 |
| `en-US` | ✅ 已支持 |

路由含 `[locale]` 前缀，由 next-intl 处理语言切换。

---

## 待解决事项

| 编号 | 问题                                                                                                                            | 优先级 |
| ---- | ------------------------------------------------------------------------------------------------------------------------------- | ------ |
| T05  | 订阅升级支付流程未接入第三方支付                                                                                                | P0     |
| T06  | Varda 助手待三端接通                                                                                                            | P1     |
| T10  | billing / subscription / members / roles 等模块接口联通待全面验证                                                               | P1     |
| —    | `iam/` 和 `subscription/` 根级路由用途待确认（可能是历史遗留）                                                                  | P2     |
| —    | ~~`/todos` 页面与 admin `/ops-todos` 的关系待明确~~ 已明确：console 待办为租户侧派生视图（并入 `/inbox`），与运营队列不共数据源 | —      |
