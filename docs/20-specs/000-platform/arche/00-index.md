# Arche 治理平台规格

> 版本：1.1.0 | 更新：2026-09-15
> 权威来源：`portals/arche/src/config/navigation.ts`（侧栏）、`deploy/database/seed/seed-catalog.mjs`（`OPERATOR_PLANE_DOMAINS` / `OPERATOR_PERMISSIONS` / `MENU_TREE`）。本文件记录判据与边界，代码与 seed 为准。

---

## 一、定位

三个运营平台都服务**平台运营人员**（不是租户、不是用户），按操作人群与信任等级分立：

| 平台  | 人群     | 管什么                                                             |
| ----- | -------- | ------------------------------------------------------------------ |
| admin | 商业运营 | 租户、账号、产品与套餐、订阅交易、财务、客户服务、模型计价与策略   |
| opera | 技术运维 | 模型供给（Atlas）、能力注册（Runos）、产品接入、运行监控、维护窗口 |
| arche | 平台治理 | 三个平台的运营账号、角色与权限，登录会话，审计与风控合规，平台配置 |

arche 的信任等级最高、操作频率最低，物理独立成面，落实职责分离与审计独立性。

## 二、功能板块

| 板块     | 页面     | 路由                 | 页面码                         | 操作码                                      |
| -------- | -------- | -------------------- | ------------------------------ | ------------------------------------------- |
| 概览     | 治理总览 | `/`                  | `arche.menu.overview`          | —（进得了平台即可见；各块按对应页的码给数） |
| 身份权限 | 平台用户 | `/admins`            | `arche.menu.platform_admin`    | `operator:account.manage`                   |
| 身份权限 | 平台角色 | `/roles`             | `arche.menu.platform_role`     | `operator:role.manage`                      |
| 身份权限 | 权限策略 | `/permissions`       | `arche.menu.permission_policy` | （读写均由 `operator:role.manage` 把门）    |
| 身份权限 | 在线会话 | `/sessions`          | `arche.menu.online_session`    | `operator:session.read`                     |
| 安全审计 | 审计日志 | `/audit-logs`        | `arche.menu.audit_log`         | `audit:log.read`                            |
| 安全审计 | 登录记录 | `/sign-in-logs`      | `arche.menu.sign_in_log`       | `audit:sign_in_log.read`                    |
| 安全审计 | 风险记录 | `/risk-records`      | `arche.menu.risk_record`       | `risk:record.read` / `.manage`              |
| 安全审计 | 合规事件 | `/compliance-events` | `arche.menu.compliance_event`  | `compliance:event.read` / `.manage`         |
| 系统配置 | 参数配置 | `/system-parameters` | `arche.menu.system_parameter`  | `config:parameter.read` / `.manage`         |
| 系统配置 | 开关控制 | `/feature-toggles`   | `arche.menu.feature_toggle`    | `config:feature_flag.read` / `.manage`      |
| 通知审计 | 发送记录 | `/notification-logs` | `arche.menu.notification_log`  | `audit:notification_log.read`               |

「个人信息」（`/me`）是本人只读自视，入口在用户菜单，不进权限树。

### 2026-09-14 梳理的结论

- **删除**：「系统设置」`/settings` 从未有过真页面（占位页写着「待 PR② 迁移」），它对应的权限由「参数配置」承担——页面、侧栏、总览卡片与顶栏齿轮一并删掉。顶栏的「帮助」按钮点了什么都不发生，同批删掉。
- **补齐**：
  - 治理总览接真数据：在用账号、在线会话、今日操作、待审阅高风险、待处理合规事件、已启用开关、24 小时投递失败。每一块按它自己那一页的能力码给，缺席的块就是无权查看（不显示成 0）。
  - 登录与会话：在线会话与登录记录（含失败、锁定）。强制下线复用平台用户的写口，不开第二条写路径。
  - 权限策略显示每个操作码是否需要二次验证（平台持有的策略，只读）；平台角色显示 MFA 下限。
  - 平台角色的创建人一律关联到真实账号：预置角色是 `systemadmin`，`operator_role.created_by` 改为 NOT NULL。
  - 侧栏、搜索与总览入口只列本人持有页面码的页面。
- **未做，需要另行决定**：
  - 审计与日志的保留期：没有清理作业作支撑，只加一个参数会是一张看起来能改、实际什么都不连的表单。
  - 三个 BFF 仍共用一个数据库账号（`platform.env` 的 `DATABASE_URL`）。按平台拆服务角色要在生产上新建角色与密钥。

### 2026-09-15 拆分「登录与会话」

- **两个问题，两页**：「现在谁登录着」是身份权限的现状，留在「身份权限 / 在线会话」；「谁在什么时候、从哪儿、登没登成」是历史，归「安全审计 / 登录记录」，另设操作码 `audit:sign_in_log.read`，授给原先持有 `operator:session.read` 的角色。
- **在线的口径改为 IdP 中央会话**（auth-bff `GET /internal/operator/sessions`）。此前按刷新令牌表判在线，owner 本人登录着却不在列表里：刷新令牌链会被并发刷新的重放判定整条吊销，中央会话仍在、静默 SSO 照样放行。平台用户列表的「在线 / 离线」与总览用同一口径；登录服务读不到时显示「—」，不说成离线。
- **会话标识不下发**：sid 就是 IdP 会话 cookie 的值。接口只给 `sessionRef`（sha256 前 32 位），用来标出「当前会话」。
- **强制下线真正下线**：此前只吊销刷新令牌，中央会话还在，门户下一次授权就被静默 SSO 放回来。强制下线、停用、重置 MFA、重置密码现在一并结束中央会话，并给登录过的平台发后端通道登出。
- **异常登录告警此前从未落库**：登录服务写 `result = 'alert'`，而 `support.audit_logs.result` 只收 success / failure / denied，整条被 CHECK 拒掉，提醒邮件也跟着没发。现写 `success`，类别由 action（`AnomalousLogin` / `LoginFailureSpike`）表达；审计日志把这两类显示为「告警」并可单独筛选，登录记录页给 24 小时告警数。

## 三、三个平台的权限隔离

判据写在 `seed-catalog.mjs` 的 `OPERATOR_PLANE_DOMAINS`，守卫 `pnpm lint:operator-planes` 核对 seed、三个 BFF 与三个门户。

1. **三个根同形**：`admin.plane` / `opera.plane` / `arche.plane`，节点码 `{plane}.menu.*`。此前是 `admin.workspace.tenant_ops` 与 `admin.workspace.platform` 两个名字不统一的根，opera 没有根。
2. **一个域只属于一个平台**：

   | 平台  | 域                                                                             |
   | ----- | ------------------------------------------------------------------------------ |
   | admin | `tenant` `user` `commerce` `promotion` `product` `content` `support` `pricing` |
   | opera | `model` `capability` `integration` `ops`                                       |
   | arche | `operator` `audit` `compliance` `risk` `config`                                |

3. **一个 BFF 只检查本平台的码**。两个平台都要的能力各注册一个码（可以重复，不能耦合）：admin 的能力目录读 `product:capability.read`（不再借 opera 的 `capability:runos.read`），admin 顶栏的投递抽屉读 `content:notification_log.read`（不再借 arche 的码），admin 的计价与策略页读 `pricing:model.read`（不再经旧桥借 opera 的 `model:*.manage`）。
4. **平台门**：三个 BFF 的中间件要求本平台根码，没有的 403；会话端点例外，门户据此整屏说明「没有进入本平台的权限」。根码不手配，按「持有子节点必持有祖先」闭包自动授予。
5. **不跨平台引用**：没有跨 BFF、跨门户的 import；admin 不再搜索运营账号、不再链接 opera 的能力注册；opera 删掉了跳往 arche 的「权限管理」页与跳往 admin 的模型授权菜单项。

改名与迁移：`deploy/database/migrations/2026-10-03-operator-three-planes.sql`（id 不变，已有授权随行；原持有者在新码上同样拿到授权）。

## 四、表格约定

全部表格用 DS `DataTable`，约定由件结构性保证：

- 选择列、序号列、操作列（锁列）三者固定 `w-control-3xl`（64px），分别由 `selectedKeys` / `indexStart` / `rowActions` 给出，不自画。
- 首列是标题列，居左，`TableTitleCell` 主副两行；其余列居中（件的默认值）；计数、分数用 `align: "numeric"`。
- 表头一律居中。名称、数字、金额、枚举、时间列标 `sortable`。
- **排序在哪里做**：行全在内存里的表用 `lib/table-sort.ts` 的 `useTableSort`；截在 500 条的表（审计日志、发送记录、风险记录、合规事件、登录记录、在线会话）把 `sort` / `order` 交给 BFF（白名单，`listOrderBy`），页面只持有排序状态——前端在截断段里排是说假话。权限树只在同级之间排，不打散父子关系。
- 长内容精简：说明收进标题列副行，不另占一列；超长值截断并以 `title` 给全文；多值（标签）只摆第一个与总数。
- UUID 不展示：租户名缺失时显示「未知租户」，创建人关联到真实账号。
