---
title: 租户 console 权限配置体系
category: design
updated: 2026-09-04
---

# 租户 console 权限配置体系（identity 板块 · 详细层）

> 🧭 架构层见 [`040-architecture.md`](./040-architecture.md)；两级 RBAC 执行的通用约定见 [`060-authorization.md`](./060-authorization.md)；`access.*` 三表字段级权威见 [`data_identity_200_schema.md`](../data_identity_200_schema.md) §6。本文 = 这套约定在**租户 console** 上的落地：目录长什么样、码怎么派生、谁在哪里执行、怎么防漂移。

**版本**：1.0.0 · **日期**：2026-09-04（批 0a，console 模块优化批次 0）
**范围**：`deploy/database/seed` · `@vxture/core-utils` · `console-bff` · `portals/console` · `service-organization`

---

## 1. 为什么要补这一层

2026-08-21 的「P0 分权」把 console 的能力从「有租户全给」改成按治理角色派生，但派生靠 console-bff 里一张手写映射表（4 个治理码 → 12 个 console 私有 capability），于是：

- `member` / `readonly` / `guest` 三个角色的治理码皆空，在 console 里**完全无法区分**；
- 除 iam 写侧与企业认证外，console-bff **没有任何路由检查能力**：导航过滤是唯一的门，敲 URL 即达；
- 前端 capability 词汇（`tenant.user.manage`）与库里的权限码（`tenant.member.manage`）是两套，谁也对不上谁；
- `access.permissions` 建成了「控制台菜单树模式」（parent_id / perm_type / route_path），却只灌了 9 个扁平治理码，seed 注释写着「等租户 console 菜单建起来再接线」。

本文把这四件事一次收口：**目录树灌满、读侧码补齐、能力 = 权限码本身、每条路由与每个页面按同一套码执行**。

---

## 2. 三处定义，一个权威

| 处                                                                                           | 角色                                       | 为什么必须存在                                                                        |
| -------------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------- |
| `access.permissions` / `access.role_permissions`（DB）                                       | **运行时权威**：成员实际持有哪些码由它回答 | GovernanceService 回查的就是它                                                        |
| `deploy/database/seed/seed-catalog.mjs`（`PERMISSIONS` / `TENANT_MENU_TREE` / `ROLE_PERMS`） | 新库灌库                                   | 幂等 seed；存量库由迁移 `2026-09-10-access-console-permission-catalog.sql` 写同样内容 |
| `@vxture/core-utils` `tenant-permissions.ts`                                                 | 代码侧镜像：前端与 BFF 引用的常量与类型    | JS 与 TS 互不能 import；identity/060 §7「前端不得硬编码权限 code」                    |

三处由 `scripts/guardrails/check-tenant-permission-catalog.mjs` 逐码比对（操作码集合、菜单树的码序/路由/挂靠、console 导航的 href 与 capability、迁移覆盖），漂移即 CI 红。

---

## 3. 操作码目录（tenant scope）

| 码                          | 分组     | 挂在哪一页 | 语义                                                         |
| --------------------------- | -------- | ---------- | ------------------------------------------------------------ |
| `tenant.member.read`        | member   | 成员管理   | 看成员目录（无 `member.manage` 者邮箱/手机号打码）           |
| `tenant.member.manage`      | member   | 成员管理   | 邀请 / 添加 / 停用 / 重置密码 / 解除关联 / 邀请台账          |
| `tenant.role.assign`        | security | 成员管理   | 改成员角色                                                   |
| `tenant.workspace.manage`   | settings | 系统设置   | 工作空间管理（本期不开放自建，码保留）                       |
| `tenant.settings.manage`    | settings | 组织信息   | 租户资料 / Logo / 本地化 / 企业认证提交                      |
| `tenant.delete`             | security | 系统设置   | 注销租户（决策 3 批二待裁定，码保留）                        |
| `tenant.billing.read`       | billing  | 产品订阅   | 看订阅 / 订单 / 账单 / 发票记录 / 卡券 / 加油包订单          |
| `tenant.billing.manage`     | billing  | 产品订阅   | 下单 / 取消订单 / 退订 / 自动续费 / 申请退款 / 升级折抵      |
| `tenant.payment.manage`     | billing  | 产品订阅   | 申报付款（订阅单与加油包单）/ 加油包下单与取消               |
| `tenant.invoice.manage`     | billing  | 账单管理   | 申请发票 / 抬头簿增删改与设默认                              |
| `tenant.quota.read`         | quota    | 配额管理   | 配额 / 用量 / Credits 余额 / 当前套餐名                      |
| `tenant.audit.read`         | audit    | 审计日志   | 租户审计台账                                                 |
| `tenant.model.read`         | model    | 模型接入   | `/atlas`；**批 7（2026-09-05）起授予 owner**，其余角色不持有 |
| `workspace.member.manage`   | member   | —（根）    | 工作空间级，console 暂无页面                                 |
| `workspace.role.assign`     | security | —（根）    | 同上                                                         |
| `workspace.settings.manage` | settings | —（根）    | 同上                                                         |

**蕴含规则（唯一一条）**：`{scope}.{resource}.manage` 蕴含同资源的 `.read`（`capabilitySatisfies`）。不做别的蕴含：`member.manage` 不含 `role.assign`；`payment.manage` 不含 `billing.read`（付款经办人若要看订单列表，需同时授 `billing.read`——owner 天然全有）。

### 3.1 自助页（不需要任何码）

个人信息 / 安全设置 / 通知偏好 / 站内消息 / 数据总览 / 待办 / 租户信息（个人）/ 组织信息（只读）/ 系统设置（页面本身；转让所有权按 owner 身份判，不走码）。BFF 侧对应 `@SelfScope()`。

---

## 4. 菜单树

`access.permissions` 的 menu 层与 console 侧栏（`portals/console/src/config/navigation.ts`）同构：

```
L1 板块  tenant.menu.{workspace | account_tenant | members_permissions | subscription_billing | advanced_settings | platform}
L2 页面  tenant.menu.{overview, todos, profile, personal_tenant, organization, members, roles, invitations,
                     subscription, billing, vouchers, quotas, usage, settings, inbox, notifications, audit_logs, security, atlas}
L3 操作  §3 的 13 个 tenant.* 码，各挂在它实际作用的那一页下（一码一页）
```

与 admin 的一处**刻意不同**：console 前端按**操作码**（如 `tenant.billing.read`）门控页面与导航，不按菜单码；菜单行只承载层级（角色页的权限树、未来的策略页），**不进 `role_permissions`**。理由：console 页面本来就以「能看这类数据」为门，读侧码即页面门，再造一层菜单授权只会多一处要同步的东西。

---

## 5. 角色矩阵（tenant scope）

| 码               | owner | manager | member | readonly | guest |
| ---------------- | :---: | :-----: | :----: | :------: | :---: |
| member.read      |   ✔   |    ✔    |   ✔    |    ✔     |   —   |
| member.manage    |   ✔   |    ✔    |   —    |    —     |   —   |
| role.assign      |   ✔   |    ✔    |   —    |    —     |   —   |
| workspace.manage |   ✔   |    ✔    |   —    |    —     |   —   |
| settings.manage  |   ✔   |    ✔    |   —    |    —     |   —   |
| delete           |   ✔   |    —    |   —    |    —     |   —   |
| billing.read     |   ✔   |    ✔    |   —    |    ✔     |   —   |
| billing.manage   |   ✔   |    —    |   —    |    —     |   —   |
| payment.manage   |   ✔   |    —    |   —    |    —     |   —   |
| invoice.manage   |   ✔   |    —    |   —    |    —     |   —   |
| quota.read       |   ✔   |    ✔    |   ✔    |    ✔     |   —   |
| audit.read       |   ✔   |    ✔    |   —    |    ✔     |   —   |
| model.read       |   —   |    —    |   —    |    —     |   —   |

角色定位不变（data_identity_200 §6.4）：manager 管人管设置、**不碰钱**（可看订阅账单，不能付款退订）；readonly = 内部全域只读；member = 用产品的人（看同事与额度）；guest = 外部受限（只有自助页）。个人租户的唯一成员是 owner。`tenant:owner` 另含全部 `workspace.*`。

---

## 6. 执行点

| 层       | 机制                                                                                                                                                                                           |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 派生     | `SessionAggregator.capabilitiesFor` = `GovernanceService.getEffectivePermissions` 原样（只认目录里登记过的码），`(tenant,user)` 60s 缓存；改角色 / 转让所有权即时作废                          |
| BFF 路由 | 每条路由声明 `@Public()` / `@SelfScope()` / `@RequireCapability(...anyOf)`（类级定默认、方法级覆盖）；全局 `CapabilityGuard` 求值，**漏标 = 403**；`check-bff-route-policies` 在 lint 期抓漏标 |
| BFF 分支 | `holdsAnyCapability(req, codes)` 按持有的码裁剪响应（成员目录联系方式打码；全局搜索按码决定检索哪几类）                                                                                        |
| 前端导航 | `navigation.ts` 每项 `capability` = 操作码；`selectVisibleDomains` 三级过滤                                                                                                                    |
| 前端页面 | `app/**/page.tsx` 用 `<CapabilityGate capability=…>` 包住需要码的页面，缺码画「没有访问权限」状态（说明所需权限、给回总览的路），不再让页面去打注定 403 的请求                                 |
| 前端动作 | 页面内按 `hasCapability` 隐藏 / 禁用落锤按钮（邀请、改资料、申请发票、购买加油包、退订、申报付款、申请退款…），禁用时给出原因                                                                  |

判定函数只有一份：`@vxture/core-utils` 的 `capabilitySatisfies` / `hasCapability` / `hasAnyCapability`，BFF 与前端都从它取。

---

## 7. 加一个码要改哪里

1. `seed-catalog.mjs`：`PERMISSIONS` 加行、挂进 `TENANT_MENU_TREE` 某页、`ROLE_PERMS` 给角色；
2. 新增一份**幂等**迁移，对存量库写同样内容（insert … on conflict do nothing + 挂靠 update + 授权 insert）；
3. `@vxture/core-utils` `tenant-permissions.ts`：码、类别、树；
4. `rolesPage.perm.<code_>` 双语词条（角色页与「没有访问权限」状态共用）；
5. 需要它的路由打 `@RequireCapability`，页面 / 动作按它门控。

守卫会在第 1 / 3 步不一致、或迁移没提到新码时报错。

---

## 8. 边界与待办

- **自定义角色**：仍是全局固定目录（data_identity_200 §6.1 说明），iam 三条写路由继续恒 400；开放需先加 `roles.tenant_id`。
- **`tenant.model.read` 只授 owner**（批 7，2026-09-05）：`/atlas` 页整改完成——授权表换成产品权益（tenant↔product，#129 指明的正确来源）。manager 及以下看配额与用量即可，那两处走 `tenant.quota.read`；`/api/atlas/quotas` 也在批 7 从 `model.read` 降到 `quota.read`（外壳用量卡每页都调它，此前对所有人 403、被吞成「不可用」）。
- **`workspace.*` 挂在根上**：console 没有工作空间页（决策 2a 本期不开放自建）。
- **两 realm 码形**：customer realm 仍是点分 `{scope}.{resource}.{action}`，与运营 realm 的冒号约定统一列为后续待办（data_identity_200 §6.4 原话）。
