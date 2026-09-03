---
title: 通知系统设计
category: design
updated: 2026-05-10
---

# 通知系统设计

> 🧭 本文无平台数据模型；平台 schema 见 a=[data_platform_100_architecture.md](./data_platform_100_architecture.md)（架构/§3.4）+ b=[data_platform_200_schema.md](./data_platform_200_schema.md)（字段级权威）。本文只述本板块内容（provider/Redis 键/限流/API 路由/env）。

## 架构概览

```
BFF 层
  website-bff  → POST /api/send-code / POST /api/verify-code
  auth-bff     → 手机验证码（登录/注册场景）

Service 层
  service-mail → 邮件发送（验证码 / 密码重置）
  service-sms  → 短信发送（手机验证码）

Infrastructure
  阿里云 SMTP DirectMail  ← service-mail 的发送通道（端口 465 SSL）
  阿里云 Dysmsapi         ← service-sms 的发送通道
  Redis                  ← 验证码存储 + 限流计数
```

---

## 邮件通知（service-mail）

### 提供方

| 提供方                | 适用环境 | 说明                     |
| --------------------- | -------- | ------------------------ |
| `SmtpMailProvider`    | 生产     | Nodemailer，端口 465 SSL |
| `ConsoleMailProvider` | 开发     | 仅打印到控制台，不发送   |

通过环境变量 `MAIL_PROVIDER=smtp|console` 切换（开发默认 `console`）。

### 支持模板

| 模板       | 方法                              | 说明                    |
| ---------- | --------------------------------- | ----------------------- |
| 邮件验证码 | `MailService.sendVerifyCode()`    | 6 位数字，TTL 10 分钟   |
| 密码重置   | `MailService.sendPasswordReset()` | 带重置链接，TTL 15 分钟 |

### Redis 键规范（邮件验证码）

```
vc:code:{email}      ← 验证码本体（TTL 600s）
vc:rl:1m:{email}     ← 1 分钟限流计数（TTL 60s）
vc:rl:1h:{email}     ← 1 小时限流计数（TTL 3600s）
vc:rl:1d:{email}     ← 1 天限流计数（TTL 86400s）
```

代码入口：`services/notification/mail/src/service/verifycode.service.ts`

### 所需环境变量

生产环境的 SMTP 配置统一来自 `/srv/vxture/runtime/secrets/platform-mail.env`，只注入实际发送邮件的 BFF。本地开发真实值放在 `runtime/secrets/platform-mail.env`。

```
SMTP_HOST=smtpdm.aliyun.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=no-reply@<mail-host>
SMTP_PASS=（阿里云控制台生成）
SMTP_FROM="Vxture Studio <no-reply@<mail-host>>"
REDIS_URL=redis://localhost:6379
WEBSITE_BASE_URL=https://vxture.com
```

---

## 短信通知（service-sms）

### 提供方

阿里云 Dysmsapi（`@alicloud/dysmsapi20170525`），固定 endpoint：`dysmsapi.aliyuncs.com`。

### 适用场景

- 手机号登录/注册：6 位验证码，TTL 10 分钟
- `scope` 字段区分业务场景，默认值 `tenant-auth`

### Redis 键规范（短信验证码）

```
svc:code:{scope}:{phone}      ← 验证码本体（TTL 600s）
svc:rl:{scope}:1m:{phone}     ← 1 分钟限流计数（TTL 60s）
svc:rl:{scope}:1h:{phone}     ← 1 小时限流计数（TTL 3600s）
svc:rl:{scope}:1d:{phone}     ← 1 天限流计数（TTL 86400s）
```

代码入口：`services/notification/sms/src/service/phone-code.service.ts`

---

## 统一限流策略

邮件与短信使用相同的三级限流规则：

| 维度   | 限额  | Redis TTL |
| ------ | ----- | --------- |
| 每分钟 | 1 次  | 60s       |
| 每小时 | 5 次  | 3600s     |
| 每天   | 10 次 | 86400s    |

超过任意限额返回 429，不下发验证码，不消耗 SMTP / SMS 配额。

---

## API 路由（已上线）

| 端点                          | BFF         | 说明           |
| ----------------------------- | ----------- | -------------- |
| `POST /api/send-code`         | website-bff | 发送邮件验证码 |
| `POST /api/verify-code`       | website-bff | 校验邮件验证码 |
| `POST /api/phone/send-code`   | console-bff | 发送手机验证码 |
| `POST /api/phone/verify-code` | console-bff | 校验手机验证码 |

---

## 扩展点

| 能力                           | 状态                                       | 说明                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------ | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 订阅 / 账务通知（站内 + 邮件） | **已接入**（product_330 P2-g，2026-09-03） | `@vxture/service-notification` `NotificationDispatcher`：站内落 `support.inbox_messages`（收件人 × 模板 × 业务引用去重），邮件走 `core-mail`（platform-api 同样注入 platform-mail.env），按 `NotificationPreferences` 的 subscription / billing 主题过滤（这两个主题邮件默认开、可关），每次投递记 `support.notification_logs`（治理台「通知审计」从此有真数据）。触发点：`OrderService`（履约 / 续费单 / 退款四阶段）与 `SubscriptionService`（到期前提醒 / 到期）以 setter 注入的 `CustomerNotifier`。模板九个：`subscription.expiring_soon / expired / renewed`、`order.fulfilled / renewal_created`、`refund.requested / approved / rejected / completed`，zh-CN / en-US 按收件人 `user_profiles.language` 渲染（P2-h） |
| 站内消息收件箱                 | **已接入**（P2-g）                         | console 铃铛抽屉 + `/inbox` 页，console-bff `GET/POST /api/me/inbox*`；未读数轮询 60s                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 公告推送（站内 + 邮件）        | **已接入**（P2-h，2026-09-03）             | platform-api `AnnouncementBroadcastJob`：published 且 publish_at 到点的公告 → 按 target_tenant_types / target_plans 圈租户 → 每个租户 owner 一条站内消息（product 主题邮件按偏好，默认关）→ `meta.broadcast_at` 打标；收件人级 inbox 唯一键兜底幂等；公告自带语言不走模板表                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 短信（业务通知）               | **已接入**（P2-i，2026-09-04；待模板报备） | `SmsService.sendTemplate`（阿里云短信服务 Dysmsapi `SendSms`，与验证码的号码认证预置模板不同）；dispatcher 第三通道：该模板配了 `ALIYUN_SMS_TPL_*` 且用户开了 sms 偏好（默认关）且有手机号才发；变量截 20 字、金额去币符；账本记 channel=sms + BizId。模板文案与 env 键见 `deploy/secrets/platform-sms.env.example`——报备通过、填上模板码即生效，不改代码                                                                                                                                                                                                                                                                                                                                                                   |
| Push 通知                      | 二期                                       | APNs / FCM，依赖 App 上线                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

---

## 参考文档

- `docs/00-meta/status.md` → T01（邮件系统）实施状态
- `docs/40-implementation/packages/services/mail.md` — service-mail 包约束
- `docs/40-implementation/packages/services/sms.md` — service-sms 包约束
- `docs/40-implementation/packages/bff/console.md` — phone-auth.router.ts 入口
