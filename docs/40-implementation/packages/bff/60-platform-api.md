# @vxture/bff-platform-api

> 架构层参考：[`docs/30-design/architecture/05-bff-layer.md`](../../../30-design/architecture/05-bff-layer.md)

---

## 包信息

| 项     | 值                         |
| ------ | -------------------------- |
| 包名   | `@vxture/bff-platform-api` |
| 路径   | `bff/platform-api/`        |
| @layer | `Application`              |
| 框架   | NestJS                     |

| 服务对象 | 产品侧 S2S（arda 为首个消费方），非浏览器 |

## 职责

产品面 S2S 宿主（product_310 D13，2026-07-13 自 auth-bff/admin-bff 拆出）：

- **C2 读面**：`GET /platform/entitlements`（权益视图）+ `GET /platform/sharing/visible-set`（可见集）；
- **C3 写面**：`POST /usage/consume`（瀑布扣减）+ `PUT /usage/gauge`（水位快照）；
- **commerce 后台作业**：provisioning webhook 派发（`ProvisioningDispatchJob`）、sharing 到期扫描、trial 到期扫描（自 admin-bff 迁入；引擎模块自持连接池，跨实例 DB 租约防叠加）。

拆分后分工：auth-bff = 纯身份（OIDC/authn/operator），admin-bff = 运营治理面，platform-api = commerce 单一宿主。

**接入路径**：产品侧经 nginx 内网别名 `http://<worker-01-tailnet-ip>:8080`（Tailscale 接口绑定，`deploy/nginx/sites-enabled/platform-internal.conf` 路由 `/platform/*`、`/usage/*`），公网 nginx 不路由这些前缀（边界对称）。

## 鉴权

三个业务端点统一走 `PlatformAuthGuard` 双凭证（迁移期并行，任一满足）：

1. **legacy**：`x-vxture-internal-auth: ${AUTH_INTERNAL_TOKEN}`（platform.env 共享键；arda 现行）。2026-10-04 起这把钥匙**只**开本宿主的产品面：auth-bff 的 `/internal/*` 内部面改认 `IDP_INTERNAL_TOKEN`（只注入 auth/admin/arche/opera 四个容器），产品手里的值开不了运营管理面；反过来新键也开不了这里——`platform-auth.guard.spec.ts` 钉着「头带 IDP 值 → 401」；
2. **S2S bearer**（product_210 T1/T2）：`Authorization: Bearer <token>`，`aud=vxture`、`act.sub`=调用方产品码；经 `S2sTokenVerifier` 以 IdP JWKS（`${AUTH_BFF_URL}/oidc/jwks`，kid 缓存）验签——**签名私钥不出 auth-bff**（D13 凭证分权）。

口令比较用 `@vxture/core-auth` 的 `sharedSecretMatches`（与 auth-bff 的 `InternalAuthGuard` 同一个实现：fail-closed、字节长度、`timingSafeEqual`；guard 类仍分开）。

**E6 指标：谁还在走旧凭据（2026-10-04）**。四个 router 在 `scopeToS2sCaller` 之后、`s2sCaller` 为空（= 旧头进来）时调 `LegacyAuthUsageService.record({ route, productCode })`（`src/platform/legacy-auth-usage.service.ts`）：进程内 Map 聚合、每 60s 一次 HINCRBY 到 Redis hash `<REDIS_KEY_PREFIX>integration:legacy-auth:<YYYY-MM>`（UTC 月），field `<route>|<product>`，route ∈ `entitlements` / `usage.consume` / `usage.gauge` / `sharing.visible-set` / `provisioning.ack`，product = 请求自报的产品码（旧头没有身份，归因同 C2 信号），键 TTL 90 天；每 (route, product) 每小时至多一行日志 `legacy internal-auth: route=… product=… n=…`。永不改响应、永不抛；Redis 坏了一个 streak 一条 warn。opera-bff `GET /api/products/:id/integration-signals` 回 `legacyAuth {month, byRoute}`，门户在 C2 那行下显示「本月仍有 n 次调用走旧的共享凭据」——E3a（产品面停收旧头）那天看这个数。有界、对**整个月**成立（2026-10-04 评审修正：第一版的上限判据是 pending Map 的 size，而它每分钟清一次，等于只对一个 60s 批次成立）：形状不对的产品码（`src/platform/product-code.ts` 的 `isProductCode`，与 entitlements / usage / sharing 同一条正则；`provisioning/ack` 的 `product` 也过它，不过 → 400 `invalid_product`）归 `<route>|__other__`；每月至多 512 个带名 field，判据是不随 flush 清空的本月 `seen` 集合，第 513 个新名字起归 `<route>|__other__`，本月已有名字的 field 继续按名计，首次溢出 warn 一行/月。`__other__` 在 opera-bff 里不归任何产品、产品页看不见——溢出的那个月，产品页上的 0 要先对照 platform-api 日志里有没有 `product=__other__`。进程退出：`main.ts` 开了 `app.enableShutdownHooks()`（整仓唯一一处），SIGTERM → `onModuleDestroy` 停表、写最后一批并等它落地（≤ 2s）再断开；容器里 node 是 PID 1、没有 init，**没有 handler 的 SIGTERM 会被内核直接忽略**（本机 docker 实测：旧 bundle 收到 SIGTERM 30s 不退、hash 为空；新 bundle 写回 `provisioning.ack|karda 1`、TTL 90 天、进程自然退出），所以此前每次 recreate 都是等 `stop_grace_period` 后被 SIGKILL、整批丢掉。看不见：`intent=reserve` 走旧头被 `deny` 的调用（在发射点之前 403）；等不到 2s 的 Redis；SIGKILL。

## 接口契约

契约权威不在本文（本文只是宿主说明）：

- C2/C3 端点形状 = ADR-11 §11.7 + [`docs/20-specs/arda/arda_200_interface.md`](../../../20-specs/210-arda/30-arda_200_interface.md)；
- 三通道标准 = [`docs/30-design/product_200_integration.md`](../../../30-design/product_200_integration.md)；
- 契约收缩（信封 v2）产品侧最终要求 = [`docs/20-specs/arda/arda_300_integration-final.md`](../../../20-specs/210-arda/40-arda_300_integration-final.md) §1。

## 运行环境

- env：`/srv/vxture/runtime/.env.platform-api`（example 登记 + 39-audit-env 规则）；共享五键经 `secrets/platform.env`；DB 走 `platform_svc`（platform-app.env 覆盖层，TD-018 模式）；
- `ARDA_PROVISION_WEBHOOK_SECRET` 随派发作业自 .env.admin-bff 迁入本 env（placeholder-optional，不阻塞部署）；
- 作业节奏：`PROVISION_DISPATCH_INTERVAL_MS`（默认 10s）/ `SHARING_EXPIRY_SWEEP_INTERVAL_MS` / `TRIAL_EXPIRY_SWEEP_INTERVAL_MS` / `ORDER_PAYMENT_SWEEP_INTERVAL_MS` / `SUBSCRIPTION_RENEWAL_SWEEP_INTERVAL_MS`（默认 60s）；
- 公告推送（P2-h，`AnnouncementBroadcastJob`）：`ANNOUNCEMENT_BROADCAST_INTERVAL_MS`（默认 60s）；published 且到点的公告圈租户发站内（+ 按偏好邮件），`meta.broadcast_at` 打标。
- 续费引擎（product_330 P2-c，`SubscriptionRenewalJob`）：`SUBSCRIPTION_RENEW_LEAD_DAYS`（默认 3，到期前多少天开续订单；owner 2026-09-03 由 7 改 3）/ `SUBSCRIPTION_RENEW_GRACE_DAYS`（默认 3，续订单付款宽限）。
- 运营待办告警（#231，`OpsTodoAlertJob`，owner 2026-09-08 定档）：`OPS_TODO_ALERT_INTERVAL_MS`（默认 5min）/ `OPS_TODO_ALERT_MIN_AGE_MINUTES`（默认 15）/ `ADMIN_BASE_URL`（邮件深链，未配则不带链接）。**只发邮件**，收件人 = `admin.operator_account` 里 `status=active` 且 `email_verified` 的账号；每单 4h 静默窗口（投递失败退避 15min），窗口与去重依据都落在 `support.notification_logs`。告警两类订单态（`pending_verify` / `paid`）+ 自愈放弃一条；「部分收款尾款挂账」不告警（在等客户，不在等运营）。站内暂不可用——`support.inbox_messages` 是租户表，运营不是租户。**有待办却一个可达运营账号都没有时本轮记作业失败**（在 opera「任务调度」里显红），因为那正是「通知发不出去且没人知道」的状态。 2026-09-28 起待办不再由本作业自己扫订单：读 `@vxture/service-ops-todos`（与 admin 待办页同一份算法）。**邮件九类**（ALERT_KINDS：confirm_payment / reprovision / refund_audit / refund_execute / refund_processing_stuck / refund_failed / addon_pending_confirm / ticket_sla / maintenance_overdue），停留超过 min age 才发；升档（等待越过本类阈值）的待办另写一条 critical 运营通告，去重键 `{待办 id}:{级数}`，每跨一个阈值倍数一条。**2026-10-04（owner 裁定 3「通告尽量覆盖全」）**：十类有升档阈值，有阈值而邮件半未裁定的类别走 **NOTICE_ONLY_KINDS**（今天只有 verification）——另起一拼 `list`（两拼各 limit 50，避免 amber 行被 rose 挤没），只写通告不发邮件；两拼各自包在 try 里、拼内逐行再包一层（与 `OperatorSignalSweepJob` 同形）：一拼 / 一行坏了另一拼照跑，跑完把失败合成一条抛、心跳记失败；`verification` 那一段 SQL 已从 tenant_base 拆出，只碰 tenancy.\* 与 `kyc.tenant_verifications`（97 已授），**零授权变更**。阈值 env（十二个，页面读 admin-bff 的、本作业读 platform-api 的，两份 example 由 `check-ops-threshold-env-parity` 守逐行相等）：`OPS_ESCALATE_CONFIRM_PAYMENT_HOURS`（4）/ `OPS_ESCALATE_REFUND_AUDIT_HOURS`（24）/ `OPS_ESCALATE_REPROVISION_MINUTES`（30）/ `OPS_ESCALATE_VERIFICATION_DAYS`（3）/ `OPS_ESCALATE_REFUND_EXECUTE_HOURS`（24）/ `OPS_ESCALATE_REFUND_PROCESSING_HOURS`（24，从「成为卡住」即 updated_at + `OPS_REFUND_STUCK_HOURS` 起算）/ `OPS_ESCALATE_REFUND_FAILED_HOURS`（4）/ `OPS_ESCALATE_ADDON_CONFIRM_HOURS`（4，从申报腿起算，未申报不升档）/ `OPS_ESCALATE_TICKET_SLA_HOURS`（4，从首响破约时刻起算）/ `OPS_ESCALATE_MAINTENANCE_OVERDUE_MINUTES`（30）；成熟阈值 `OPS_ORDER_AGING_HOURS`（24）/ `OPS_REFUND_STUCK_HOURS`（4）。六个新默认值是设计提议，owner 可调。每个阈值在自己的单位里最大 20000（`MAX_OPS_TODO_THRESHOLD`，超过按 20000 算，不回兜底）：tail 里阈值按 `$n::int * 86400` 在 int4 里乘成秒，再大整条待办查询就 integer out of range，页面与作业一起倒。待 owner：ticket 的空闲升档（D6）、risk 的升档（D7，需碰 `admin.risk_records`）、`refund_processing_stuck` 今天全仓无写入方（D2：阈值已接好，等写入点或按 webhook_dead 先例摘类）。
- 运营侧信号巡检（2026-09-28 第二批，`OperatorSignalSweepJob`，owner「先把通知、信息、任务、提醒做全做多」）：`OPERATOR_SIGNAL_SWEEP_INTERVAL_MS`（默认 2min）/ `OPERATOR_SIGNAL_SWEEP_LOOKBACK_MINUTES`（默认 30）/ `OPERATOR_SIGNAL_SWEEP_LIMIT`（默认 200，每类每轮）。一个作业两段：① 业务事件 11 类各一条 SQL（注册 / 建组织租户 / 提交认证 / 下单待付款 / 加油包 / 申请开票 / 客户评价 / 优惠核销 / 申请注销 / 关自动续费 / 新工单），② 运营动作一条 SQL 扫 `support.audit_logs` 里白名单内的 42 个动作码（白名单外静默跳过）；两段逐行写 `admin.operator_notices` 的 system 来源通告，去重键 `business_event:{事件码}:{可视码或行 id}` / `operator_action:audit:{审计行 id}`，所以回看窗口重叠、重启重扫都只落成 `inserted: false`。**首轮把回看压到 10 分钟**（重启不重放历史，历史已由 `2026-11-22-backfill-operator-notices.sql` 补过）。两段各自包 try：一段坏不连坐另一段，但跑完必抛 → 心跳记 failed、在 opera「任务调度」显红。读面是逐表 SELECT 的最小授权（7 张表，见 `97_service_roles.sql` 末尾与 data_platform_330 §2）。`risk.flagged` 与审计通告里的运营者真名**有意缺席**：`admin.risk_records` / `admin.operator_account` 被 2026-11-21 那份迁移断言为 0 项权限，见作业与 `audit-event-signals.ts` 头注。
- 作业健康告警（#231 第二段，`JobHealthAlertJob`，owner 2026-09-08 定「失败 + 静默」）：`JOB_HEALTH_ALERT_INTERVAL_MS`（默认 5min）/ `OPERA_BASE_URL`（深链到 opera「任务调度」）。扫 `provisioning.background_jobs` 两种坏法——`failed`（上一轮出错，至少留下 `last_error`）与 **`stalled`**（那一行干脆不再前进：`run_count` 不涨、`failure_count` 也不涨，看上去和「最近没事干」一模一样，此前没有任何东西盯着）。静默阈值 `max(3 × interval_ms, 5min)`，进程启动 10 分钟内不判（`@Interval` 要过满一个周期才首次触发）。判定不看 `status`，所以「卡在某一轮出不来」的 `running` 也算静默。**边界**：本作业能报自己上一轮的失败，但报不了自己的静默（死了就没有下一轮）——那一层要靠外部探针。无人可达时只记 error 日志、不抛，否则它会把自己变成下一轮的告警对象。
