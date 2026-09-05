# Console 租户工作台产品规格

> 版本：1.1.0 | 更新：2026-09-05（批 8 文档收口）
> 技术实现：[`docs/40-implementation/packages/portals/20-console.md`](../../../40-implementation/packages/portals/20-console.md)
> BFF：[`docs/40-implementation/packages/bff/40-console.md`](../../../40-implementation/packages/bff/40-console.md)

---

## 定位

Console（`console.vxture.com`）是面向**租户管理员**的工作台，承担租户日常运营管理。

| 角色（固定目录） | 典型操作                                                          |
| ---------------- | ----------------------------------------------------------------- |
| owner            | 全权：下单 / 付款 / 发票、成员与角色、租户信息与认证、转让 / 注销 |
| manager          | 管理成员与角色、租户资料；看订阅 / 账单 / 配额 / 审计，不下单     |
| member           | 用产品：成员目录、配额与用量                                      |
| readonly         | 内部全域只读                                                      |
| guest            | 外部受限：只有自助页（账号信息 / 通知 / 待办与消息）              |

JWT `userType = tenant_user`，`authScope = tenant_console`。角色矩阵的权威源见 [`identity/070`](../../../30-design/identity/070-tenant-console-permission-catalog.md)。

---

## 功能模块清单

| 路由                          | 功能                                                                                                                   | BFF Router          | 状态      |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------- | --------- |
| `/`                           | 仪表板（租户概览）                                                                                                     | tenant-context      | ✅ 已完成 |
| `/members`                    | 成员管理（邀请、移除、角色分配）                                                                                       | iam                 | ✅ 已完成 |
| `/invitations`                | 邀请管理（待接受 / 已过期）                                                                                            | iam                 | ✅ 已完成 |
| `/roles`                      | 角色管理（自定义角色、权限分配）                                                                                       | iam                 | ✅ 已完成 |
| `/subscription`               | 订阅管理（当前套餐、升级入口）                                                                                         | subscription        | ✅ 已完成 |
| `/billing`                    | 账单与用量（账单列表、用量明细）                                                                                       | billing             | ✅ 已完成 |
| `/quotas`                     | 配额管理（底池 / 加油包 / 用量）                                                                                       | quota               | ✅ 已完成 |
| `/quotas/addon-pay/[orderNo]` | 加油包付款                                                                                                             | quota               | ✅ 已完成 |
| `/usage`                      | 用量分析（按周期补零的趋势）                                                                                           | usage               | ✅ 已完成 |
| `/vouchers`                   | 我的卡券                                                                                                               | promotion           | ✅ 已完成 |
| `/subscribe`                  | 订阅下单（先看价格再登录；折抵 / 周期）                                                                                | subscription        | ✅ 已完成 |
| `/subscribe/pay/[orderId]`    | 订单付款（静态码 + 自申报，30 分钟 / 2 天时效）                                                                        | subscription        | ✅ 已完成 |
| `/atlas`                      | 模型接入（可用模型 · 产品权益 · 配额 · 用量；`tenant.model.read`，批 7 起授予 owner）                                  | atlas               | ✅ 已完成 |
| `/profile`                    | 账号信息（设计见 `21-account-page-design.md`：身份卡 · 基本信息 · 个人偏好 · 安全设置 · 三方登录 · 危险操作/删除账号） | me                  | ✅ 已完成 |
| `/security`                   | 并入 `/profile?panel=sessions`（跳转，展开活跃会话）                                                                   | me                  | ✅ 已完成 |
| `/tenant`                     | 租户信息（设计见 `20-tenant-page-design.md`：身份卡 · 基本信息 · 联系人 · 默认区域 · 租户策略 · 危险操作）             | tenant-context / me | ✅ 已完成 |
| `/tenant/verification`        | 企业认证（状态 · 当前信息 · 申请 / 重提 · 历史；组织租户）                                                             | verification        | ✅ 已完成 |
| `/notifications`              | 通知设置（接收偏好）                                                                                                   | me                  | ✅ 已完成 |
| `/inbox`                      | 待办与消息（待办派生 + 站内消息合并入口，2026-09-04）                                                                  | inbox               | ✅ 已完成 |
| `/audit-logs`                 | 审计日志（服务端分页 + 动作筛选，`tenant.audit.read`）                                                                 | audit               | ✅ 已完成 |
| `/accept-invitation`          | 接受邀请（`?token=`，租户由 token 决定）                                                                               | iam                 | ✅ 已完成 |
| `/profile/verification`       | 个人实名（骨架，KYC 流程未接线，决策 4a 后置）                                                                         | verification        | ○ 占位    |
| `/organization/verification`  | 并入 `/tenant/verification`（跳转）                                                                                    | verification        | ✅ 已完成 |
| `/organization`               | 并入 `/tenant` 租户信息（跳转）                                                                                        | tenant-context      | ✅ 已完成 |
| `/personal-tenant`            | 并入 `/tenant` 租户信息（跳转）                                                                                        | tenant-context      | ✅ 已完成 |
| `/settings`                   | 并入 `/tenant` 租户信息（策略卡 + 危险操作；跳转）                                                                     | tenant-context      | ✅ 已完成 |
| `/tenant-settings`            | 并入 `/tenant` 租户信息（跳转）                                                                                        | tenant-context      | ✅ 已完成 |
| `/todos`                      | 并入 `/inbox` 待办与消息（保留跳转 `?filter=todo`）                                                                    | —                   | ✅ 已完成 |

---

## 租户模型

Console 对应租户体系中的**租户工作台层**：

```
一个用户账号（account）
  └── 可属于多个租户（tenant）
        └── 每个租户内有独立角色（owner / manager / member / readonly / guest）
```

- 个人租户（`personal`）：只有一个用户的组织租户，与组织租户同结构（批 5c）；可在 `/tenant` 转为组织租户（不可回退，不换号）
- 组织租户（`organization`）：可邀请多名成员；企业认证在 `/tenant/verification`，改名即作废原认证

详见 [`docs/30-design/tenant.md`](../../../30-design/identity/030-tenant.md)。

---

## 订阅与配额

Console 展示租户当前订阅状态（套餐、有效期、功能开关）和 AI 模型配额使用情况。

- 订阅入口：`/subscription` → `/subscribe` 下单 → `/subscribe/pay/[orderId]` 付款（静态码 + 客户自申报，无第三方回调；见 T05）
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
| T05  | 支付为静态码 + 客户自申报，未接第三方支付回调                                                                                   | P0     |
| T10  | billing / subscription / members / roles 等模块接口联通待全面验证                                                               | P1     |
| —    | ~~`/todos` 页面与 admin `/ops-todos` 的关系待明确~~ 已明确：console 待办为租户侧派生视图（并入 `/inbox`），与运营队列不共数据源 | —      |
