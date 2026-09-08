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

1. **legacy**：`x-vxture-internal-auth: ${AUTH_INTERNAL_TOKEN}`（platform.env 共享键；arda 现行）；
2. **S2S bearer**（product_210 T1/T2）：`Authorization: Bearer <token>`，`aud=vxture`、`act.sub`=调用方产品码；经 `S2sTokenVerifier` 以 IdP JWKS（`${AUTH_BFF_URL}/oidc/jwks`，kid 缓存）验签——**签名私钥不出 auth-bff**（D13 凭证分权）。

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
- 运营待办告警（#231，`OpsTodoAlertJob`，owner 2026-09-08 定档）：`OPS_TODO_ALERT_INTERVAL_MS`（默认 5min）/ `OPS_TODO_ALERT_MIN_AGE_MINUTES`（默认 15）/ `ADMIN_BASE_URL`（邮件深链，未配则不带链接）。**只发邮件**，收件人 = `admin.operator_account` 里 `status=active` 且 `email_verified` 的账号；每单 4h 静默窗口（投递失败退避 15min），窗口与去重依据都落在 `support.notification_logs`。告警两类订单态（`pending_verify` / `paid`）+ 自愈放弃一条；「部分收款尾款挂账」不告警（在等客户，不在等运营）。站内暂不可用——`support.inbox_messages` 是租户表，运营不是租户。**有待办却一个可达运营账号都没有时本轮记作业失败**（在 opera「任务调度」里显红），因为那正是「通知发不出去且没人知道」的状态。
- 作业健康告警（#231 第二段，`JobHealthAlertJob`，owner 2026-09-08 定「失败 + 静默」）：`JOB_HEALTH_ALERT_INTERVAL_MS`（默认 5min）/ `OPERA_BASE_URL`（深链到 opera「任务调度」）。扫 `provisioning.background_jobs` 两种坏法——`failed`（上一轮出错，至少留下 `last_error`）与 **`stalled`**（那一行干脆不再前进：`run_count` 不涨、`failure_count` 也不涨，看上去和「最近没事干」一模一样，此前没有任何东西盯着）。静默阈值 `max(3 × interval_ms, 5min)`，进程启动 10 分钟内不判（`@Interval` 要过满一个周期才首次触发）。判定不看 `status`，所以「卡在某一轮出不来」的 `running` 也算静默。**边界**：本作业能报自己上一轮的失败，但报不了自己的静默（死了就没有下一轮）——那一层要靠外部探针。无人可达时只记 error 日志、不抛，否则它会把自己变成下一轮的告警对象。
