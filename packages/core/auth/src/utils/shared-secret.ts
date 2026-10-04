/**
 * shared-secret.ts - constant-time comparison for a shared-secret header.
 * @package @vxture/core-auth
 *
 * 一个实现、两个消费方（2026-10-04，E5）：auth-bff 的 `InternalAuthGuard`（内部面，
 * `IDP_INTERNAL_TOKEN`）与 platform-api 的 `PlatformAuthGuard`（产品面，`AUTH_INTERNAL_TOKEN`）
 * 此前各自手写一份 `safeEqual`。两个 guard **类仍然分开**——2026-07-12 的 guard-scope 事故
 * 是拆开它们的理由，今天仍成立；这里收口的只是那个纯函数。
 *
 * 这个包里曾有一份「可复用的共享口令 guard」（`InternalAuthGuard` / `resolveInternalAuthToken`
 * / `assertInternalAuth`）：`!==` 比较、非生产硬编码回落值 `"vxture-local-internal-auth"`、
 * 零消费方。`150-security.md` §3.2 已禁止新增共享口令校验——留一个可复用的 guard 是在招人
 * 用它，所以同一个 PR 删了它们，只留这个比较函数。
 *
 * 判据（fail-closed，每一条都有 spec 钉着）：
 *   · expected 为空串 / undefined / null → false（未配置就是关着，不是「任何值都对」）；
 *   · presented 不是字符串 → false（`req.headers[x]` 可能是 `string[]`，不猜第一个）；
 *   · 字节长度不等 → false（`timingSafeEqual` 对不等长会抛，这里先挡；按**字节**比，
 *     不按字符——两个字符数相同的串字节数可以不同）；
 *   · 其余 `timingSafeEqual`。
 *
 * 它**不**读 env、不认任何键名——哪张面读哪把钥匙由调用方决定，并由
 * `scripts/guardrails/check-internal-auth-key-usage.mjs` 钉住。
 */
import { timingSafeEqual } from "node:crypto";

/**
 * Compare a presented shared secret against the configured one in constant time.
 *
 * @param presented - whatever the request carried（header 值，可能不是字符串）
 * @param expected - the configured secret；空 / 未配置一律不匹配
 * @returns true only when both are non-empty strings of equal byte length and equal bytes
 */
export function sharedSecretMatches(
  presented: unknown,
  expected: string | null | undefined,
): boolean {
  if (typeof expected !== "string" || expected.length === 0) return false;
  if (typeof presented !== "string") return false;
  const a = Buffer.from(presented, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
