# @vxture/service-mail

> 架构层参考：[`docs/30-design/architecture/04-service-layer.md`](../../../30-design/architecture/04-service-layer.md)

---

## 包信息

| 项     | 值                            |
| ------ | ----------------------------- |
| 包名   | `@vxture/service-mail`        |
| 路径   | `services/notification/mail/` |
| @layer | `Domain`                      |
| 框架   | NestJS                        |

## 职责

邮件发送服务：验证码邮件、密码重置邮件。SMTP 发送（阿里云 DirectMail）+ Redis 限流。

## 目录结构

```
src/
├── module/         ← MailModule（NestJS）
├── service/        ← MailService（发送逻辑）+ VerifyCodeService（验证码 + 限流）
├── providers/      ← SmtpMailProvider / ConsoleMailProvider（开发 fallback）
├── constants/      ← 限流参数、模板 key
└── types/          ← 邮件类型定义
```

## 关键实现

- `SmtpMailProvider`：Nodemailer，端口 465 SSL，发送失败自动重试 1 次
- `ConsoleMailProvider`：开发环境 fallback，console.log 替代真实发送
- `VerifyCodeService`：6 位验证码，Redis TTL 10 分钟，限流（1次/分钟·5次/小时·10次/天）
- 当前支持两类模板：验证码 / 密码重置

## 依赖约束

```typescript
✅ @vxture/core-mail / @vxture/core-config / @vxture/shared
✅ ioredis（限流）
❌ 其他 @vxture/service-*
```

## 环境变量

生产环境由 `/srv/vxture/runtime/secrets/platform-mail.env` 统一注入到实际发送邮件的 BFF，服务专属 `.env.<service>` 不再保存 `SMTP_*`。

```
SMTP_HOST=smtpdm.aliyun.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=no-reply@<mail-host>
SMTP_PASS=（阿里云控制台生成）
SMTP_FROM="Vxture Studio <no-reply@<mail-host>>"
```

## 消费方

- `bff/auth-bff`：密码重置邮件
- `bff/website-bff`：`POST /api/send-code` 和 `POST /api/verify-code`
