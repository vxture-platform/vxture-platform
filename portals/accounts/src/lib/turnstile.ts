/**
 * turnstile.ts — 前端这一半的 Turnstile 开关。
 *
 * ── 补的是哪个洞 ──
 * 服务端有 `CF_TURNSTILE_ENABLED`，关掉它之后 auth-bff 不再校验 turnstile_token；
 * 但**前端并不看这个开关**——它只看 site key 在不在，于是本机把服务端关了，登录页
 * 照样渲染那个人机验证控件，还得去点一下。开关只拄了一半。
 *
 * 这里把另一半补上：`NEXT_PUBLIC_CF_TURNSTILE_ENABLED=false` 时前端直接当没有
 * site key，控件不渲染、也不往请求里塞 token（服务端本来就不校验，塞了也没人看）。
 *
 * ── 对生产没有影响 ──
 * 缺省是**开**：变量没设、或设成任何非 `"false"` 的值，行为与从前一字不差。
 * CI 的 docker build 不注入这个变量，镜像里它就是 undefined → 开。
 * 只有本机 `.env.local` 显式写 `false` 才关。
 *
 * ── 为什么不是「本机把 site key 留空」就完了 ──
 * 那样做等于用「配置缺失」表达「功能关闭」，两者在别处是要分开的：site key 缺失
 * 是**配错了**（生产出现就该修），而关闭是**有意的**。用一个显式开关说出意图，
 * 日后谁看见空 key 都还能判断那是不是故障。
 */

/** `"false"` 才算关；未设 / 其它值一律为开，生产因此不受影响。 */
const CLIENT_ENABLED =
  (process.env.NEXT_PUBLIC_CF_TURNSTILE_ENABLED ?? "true")
    .trim()
    .toLowerCase() !== "false";

/** 租户（客户）面的 site key。 */
const TENANT_SITE_KEY =
  process.env.NEXT_PUBLIC_CF_TURNSTILE_TENANT_SITE_KEY ?? "";

/**
 * 运营面的 site key。
 *
 * 变量名用 `SITE_ID` 是刻意的（见 docs/30-design/identity/010-auth.md §317）：
 * 避免公开的构建变量被误认成 secret。CI 两个名字都注入，这里两个都认，
 * 谁先有值用谁——只认一个的话，换注入方式时会静默变成「没有 key」。
 */
const OPERATOR_SITE_KEY =
  process.env.NEXT_PUBLIC_CF_TURNSTILE_ADMIN_SITE_KEY ||
  process.env.NEXT_PUBLIC_CF_TURNSTILE_ADMIN_SITE_ID ||
  "";

/**
 * 当前面要用的 site key；返回空串表示**不渲染控件**。
 *
 * 调用方不必各自判开关——两处调用点各写一遍 `enabled && key` 就是下一个
 * 「只拄一半」的开始。
 */
export function turnstileSiteKey(surface: "tenant" | "operator"): string {
  if (!CLIENT_ENABLED) return "";
  return surface === "operator" ? OPERATOR_SITE_KEY : TENANT_SITE_KEY;
}

/** 本次提交要不要带 turnstile token。关掉时不带——服务端也不校验。 */
export function turnstileRequired(surface: "tenant" | "operator"): boolean {
  return turnstileSiteKey(surface) !== "";
}
