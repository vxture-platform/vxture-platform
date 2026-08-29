# 人机验证换国内可达供应商 · 方案与工作量评估

> **状态**（2026-08-29）：**立项评估，未开工。** 结论在 §6，工作量在 §5。
> **起因**：2026-08-29 上线 v0.26.0 后，owner 的家用笔记本在 admin / opera 登录面上人机验证报错，
> 开 VPN 即正常；同一台机器在 website 登录面**不开 VPN 也能过**。
> **前提要写实**：这一次**没有复现「国内直连 Cloudflare 不可达」**——租户面 widget 在国内直连下过了。
> 所以本立项的依据不是「已确认故障」，是 §1 的一般性风险，加上 §2 那个**现在还测不到**的判据。

## 0. 一句话

平台的登录/注册面（accounts）用 Cloudflare Turnstile 做人机验证，脚本与挑战都出境打
`challenges.cloudflare.com`；站本身直连阿里云。本文评估把租户面换成阿里云验证码 2.0 的
改动面、分批与代价，并先立一条度量，让「要不要换」由数字决定而不是由一次偶发决定。

## 1. 为什么值得评估（一般性风险）

| 事实                                                                                                                  | 出处                                                                       |
| --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 五个公开面都**不走** Cloudflare 代理：响应头 `Server: nginx`、无 `CF-RAY`，直连 39.103.62.17                          | 2026-08-29 实测；`06-subdomain-dns.md` 写的「Proxied」与实况不符，另案订正 |
| 只有人机验证这一件事出境：`challenges.cloudflare.com` 是 Cloudflare 边缘节点（实测 CF-RAY NRT）                       | 同上                                                                       |
| Cloudflare 在中国大陆没有节点（企业版 China Network 除外），国内直连质量不受保证                                      | Cloudflare 公开资料                                                        |
| 登录表单对 widget 有 **12 秒**宽限：没拿到 token 就客户端降级提交；服务端仍强制校验 → `401 human_verification_failed` | `portals/accounts/src/components/OidcLoginForm.tsx`                        |

这意味着：**国内用户遇到出境抖动时，症状是"验证失败"而不是"页面打不开"**——它和「机器人被拦」在服务端长得一模一样，今天没有任何地方能把两者分开（§2）。

**一个必须先纠正的取向**：不要用「把域名挂到 Cloudflare 代理」来解决——那会让整个站变成今天 Turnstile 的样子（导到海外 PoP），而不是让 Turnstile 变成今天站的样子。

## 2. 现状的盲点：失败原因没有落点

| 层                   | 现状                                                                                                                         | 后果                                                                                           |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 服务端两个 guard     | `catch {} → 401 human_verification_failed`（`operator-login-guard.service.ts:64-73`、`tenant-login-guard.service.ts:31-40`） | Cloudflare 回的 `error-codes`、是 hostname-mismatch 还是 action-mismatch，**不进日志不进响应** |
| 前端 `AuthTurnstile` | `onError(errorCode)` 只置 `turnstileFailed=true`，六位错误码丢弃                                                             | 用户看到的永远是「请先完成人机验证」                                                           |
| 12 秒降级            | 降级后提交、被服务端拒                                                                                                       | 「网络慢」与「被判机器人」不可区分                                                             |

**所以第一批不是换供应商，是让这件事可度量**——否则换完也不知道换对没有。

## 3. 目标形态：按面可切换的双供应商

不拆 Turnstile，加一个供应商开关，**回滚是一次 env 翻转**：

```
CAPTCHA_PROVIDER_TENANT = turnstile | aliyun | off
CAPTCHA_PROVIDER_ADMIN  = turnstile | aliyun | off
```

- `off` 只允许运营面（已有按 IP 失败限流 + MFA），租户面禁止 `off`（公开注册面必须有机器人防护）——由 `audit-env` 守卫钉死。
- 服务端：`core/auth` 从 `TurnstileVerifier` 抽出 `CaptchaVerifier` 接口，`verify({token, remoteIp, expectedAction}) → void | throw CaptchaVerificationError(reason, providerCode)`；两个 guard 只认接口。
- 前端：accounts 按面读 `NEXT_PUBLIC_CAPTCHA_PROVIDER_{TENANT,ADMIN}`（构建期烤入，与 site key 同一机制），渲染 `AuthTurnstile` 或 `AuthAliyunCaptcha`，两者对外同一契约 `onToken / onExpire / onError(code)`。

## 4. 阿里云验证码 2.0 接入形态（已核对官方文档）

**服务端**（[HTTPS 原生调用](https://help.aliyun.com/zh/captcha/captcha2-0/use-cases/server-api-access)）：

| 项          | 值                                                                                                                                                    |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 端点        | `captcha.cn-shanghai.aliyuncs.com`，POST，`application/x-www-form-urlencoded`                                                                         |
| 版本 / 动作 | `x-acs-version: 2023-03-05` · `x-acs-action: VerifyIntelligentCaptcha`                                                                                |
| 签名        | ACS3-HMAC-SHA256（`Authorization` / `x-acs-date` / `x-acs-signature-nonce` / `x-acs-content-sha256`）                                                 |
| 入参        | `CaptchaVerifyParam`（必填，**原样透传不可改**）· `SceneId`（多场景时建议带）                                                                         |
| 出参        | `Result.VerifyResult`（bool）· `Result.VerifyCode`（`T001` 通过；`F001`–`F020` 各类失败——**这正是 §2 要的原因码**）                                   |
| 约束        | 同一笔验证只允许提交一次（天然幂等）；V3 架构下行为验证与业务提交须在 90 秒内                                                                         |
| 权限        | RAM 动作 `yundun-afs:VerifyIntelligentCaptcha`（文档给的是 `AliyunYundunAFSFullAccess`，**建议单独 RAM 用户 + 最小策略**，不复用 SMS 那把 AccessKey） |

**客户端**（[Web/H5 V3 架构](https://help.aliyun.com/zh/captcha/captcha2-0/user-guide/new-architecture-for-web-and-h5-client-access)）：

| 项       | 值                                                                                                                           |
| -------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 全局配置 | `window.AliyunCaptchaConfig = { region: "cn", prefix: "<控制台身份标>" }`，**在脚本之前**                                    |
| 脚本     | `https://o.alicdn.com/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js`，**必须动态加载**（文档明令，否则不更新且有安全风险） |
| 初始化   | `initAliyunCaptcha({ SceneId, mode: "popup"                                                                                  | "embed", element, button, success(captchaVerifyParam), fail, getInstance, slideStyle, language, timeout })` |
| 实例     | `show()` / `hide()` / `startTracelessVerification()`（无痕验证仅 popup）                                                     |
| CSP      | 放行 `o.alicdn.com`、`*.aliyuncs.com`（accounts 的 `next.config.js` 现有 CSP 只放行 Cloudflare）                             |

与 Turnstile 的形态差异要在组件层吸收：Turnstile 是「渲染即自动出 token」，阿里云 V3 是「用户点触发元素 → 弹窗/内嵌验证 → `success` 回调给参数」。所以 `AuthAliyunCaptcha` 要把登录按钮本身当 `button`，验证通过后再提交表单——**表单提交时序会变**，这是前端里最大的一块。

## 5. 改动面与工作量

全仓触及 Turnstile 的文件 30 个（`git ls-files | xargs grep -li turnstile`），按批：

| 批                            | 内容                                                                                                                                                                                                                                                                                                                   | 文件                                                                                                 | 估算                         |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------- |
| **B0 度量**（先做，独立可发） | 两个 guard 记 `warn` 日志：surface、reason、providerCode（**不记 token**）；`AuthTurnstile.onError` 把 errorCode 透到表单文案；12 秒降级单独计数。加一个 Prometheus 计数 `captcha_verification_failed_total{surface,reason}`                                                                                           | `operator-login-guard` · `tenant-login-guard` · `turnstile.verifier` · `OidcLoginForm` · `AuthLogin` | **0.5 天**                   |
| B1 服务端抽象                 | `core/auth`：`CaptchaVerifier` 接口 + `AliyunCaptchaVerifier`（ACS3 签名手写约 120 行，或引 `@alicloud/captcha20230305` + `@alicloud/openapi-client` 两个依赖——**建议手写**，签名算法稳定、少两个依赖树）；按面选供应商；单测含反向验证（改坏签名/篡改参数必须红）                                                     | `packages/core/auth/src/captcha/*`（新）· 两个 guard · `.env.auth-bff.example` · `audit-env` 两份    | **1 天**                     |
| B2 前端                       | `AuthAliyunCaptcha` 组件（动态加载、`AliyunCaptchaConfig`、`success` → token）；`OidcLoginForm` / `BindPhonePanel` 按面切换；提交时序改为「验证通过再提交」；CSP；`Dockerfile.nextjs` / `docker-build.yml` 加 `NEXT_PUBLIC_CAPTCHA_PROVIDER_*` 与 `NEXT_PUBLIC_ALIYUN_CAPTCHA_{PREFIX,SCENE_ID_TENANT,SCENE_ID_ADMIN}` | `accounts` 6 个文件 · `Dockerfile.nextjs` · `docker-build.yml` · `images.mjs`                        | **1.5 天**                   |
| B3 控制台与凭据               | 开通验证码 2.0；建 2 个场景（租户登录/注册、运营登录）；RAM 用户 + 最小策略；`platform-captcha.env` 新 secret 文件（与 mail/sms 同一分层）；`51-check-platform-alerts` 补探测                                                                                                                                          | 阿里云控制台 · `deploy/` 4 个文件                                                                    | **0.5 天**                   |
| B4 联调与切换                 | dev-panel 起栈走通两个面；生产先切 `ADMIN=aliyun` 观察一周（运营面影响面小、且有限流+MFA 兜底）；再切 `TENANT`；Turnstile 配置保留一个发布周期作回滚                                                                                                                                                                   | —                                                                                                    | **1 天**（含观察，不含等待） |
| B5 收尾                       | 订正 `06-subdomain-dns.md` 的 Proxied 假话；`07-checklist` §1.4 加新 env；本文改状态                                                                                                                                                                                                                                   | docs 3 个                                                                                            | 0.5 天                       |

**合计约 5 个工程日**，其中 B0 半天可以**今天就发**，且不管最终换不换都值。

## 6. 结论与建议顺序

1. **先做 B0**——半天，独立 PR，独立发版。它让 §2 的盲点消失：一周之后按 `captcha_verification_failed_total{surface,reason}` 能直接回答「国内用户到底有没有在这上面掉」。
2. **B1–B3 可以并行准备**，但**切换（B4）等 B0 的数字**：若一周内租户面的失败里 Cloudflare 侧原因（`timeout-or-duplicate` / 12 秒降级 / 脚本加载失败）占比可忽略，就不切租户面，只把运营面按 owner 裁定处理；若不可忽略，按 B4 顺序切。
3. **运营面单独裁定**（与本立项解耦）：已有按 IP 失败限流 + MFA，Turnstile 在这一面的边际价值低；`off` / `aliyun` / 保持，三选一由 owner 定，不阻塞租户面。

## 7. 不在本立项内

- 把站挂到 Cloudflare 代理（理由见 §1 末）。
- 换 Cloudflare 企业版 China Network（价格量级不匹配当前阶段）。
- 腾讯 / 极验：平台的 RDS、Tair、SMS 已全在阿里云，凭据与账单体系现成，不为选型多开一家。

## 参考

- [服务端接入（HTTPS 原生调用）](https://help.aliyun.com/zh/captcha/captcha2-0/use-cases/server-api-access)
- [Web/H5 客户端 V3 架构接入](https://help.aliyun.com/zh/captcha/captcha2-0/user-guide/new-architecture-for-web-and-h5-client-access)
- [快速开始](https://help.aliyun.com/zh/captcha/captcha2-0/user-guide/quick-start)
