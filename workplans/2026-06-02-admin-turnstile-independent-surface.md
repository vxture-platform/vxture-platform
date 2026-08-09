# Admin Cloudflare Turnstile 独立验证计划

> 状态：active（代码已接入，等待 Cloudflare / GitHub Secret / VXTURE_DEPLOY_HOST 生产配置）
> 创建：2026-06-02
> 类型：延后处理的小任务 / 安全域完善

## 背景

当前 website / console 的租户端登录已经接入 Cloudflare Turnstile tenant surface。admin 登录仍使用自建拖动滑块，不具备 Cloudflare 服务端 token 校验、hostname 校验和独立风险统计能力。

admin 属于平台运营安全域，不应复用 tenant 端 Turnstile key。需要在同一个 Cloudflare 账号下新建 admin 专用 Turnstile Widget。

## 目标

- admin 登录改为使用 Cloudflare Turnstile 原生验证。
- admin 使用独立 site key / secret key。
- admin 验证只允许 `y.vxture.com`。
- 移除或停用自建拖动滑块，避免两套人机验证并存。

## 非目标

- 不复用 tenant Turnstile 配置。
- 不改变 admin operator 账号体系、Cookie、JWT 签发逻辑。

## 待办

- [ ] Cloudflare 创建 admin 专用 Turnstile Widget。
- [ ] GitHub Secret 补充 `CF_TURNSTILE_ADMIN_SITE_KEY`。
- [ ] VXTURE_DEPLOY_HOST `.env.admin-bff` 生产环境补充 `CF_TURNSTILE_ADMIN_SECRET_KEY`。
- [x] `.env.admin-bff.example` 补充 `CF_TURNSTILE_ADMIN_SECRET_KEY`。
- [x] 补充 `CF_TURNSTILE_ADMIN_ALLOWED_HOSTNAMES=y.vxture.com` 模板。
- [x] admin 登录页接入 `AuthTurnstile`。
- [x] admin 登录请求提交 Turnstile token。
- [x] admin 短信验证码发送/登录请求提交 Turnstile token。
- [x] 服务端在 admin 登录前校验 admin Turnstile token。
- [x] 服务端在 admin 短信验证码发送/登录前校验 admin Turnstile token。
- [x] 删除或停用 `AdminCaptchaOverlay` 自建滑块。
- [x] 更新长期认证设计文档中的 admin Turnstile 状态。

## 验收标准

- admin 登录页显示 Cloudflare 原生验证框。
- 未提交或提交无效 Turnstile token 时，admin 登录被拒绝。
- website / console tenant 登录不受 admin key 影响。
- tenant key 轮换不影响 admin，admin key 轮换不影响 tenant。
- build、type-check、登录 API 验证通过。

## 完成后的沉淀

- 代码：admin 登录页、相关 BFF 校验和环境变量。
- docs：更新 `docs/30-design/auth.md` 与部署环境变量说明。
- workplans：确认完成后，本文件可删除或短期保留到发布验证完成。
