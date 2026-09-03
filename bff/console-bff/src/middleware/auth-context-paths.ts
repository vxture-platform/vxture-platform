/**
 * Paths that carry only the authenticated-user context and deliberately skip
 * tenant + permission resolution (the active-org switch runs before a tenant is
 * established, so it must not require one).
 *
 * TenantMiddleware and PermissionMiddleware both key off this single set. Keeping
 * it as one source of truth preserves the invariant PermissionMiddleware relies
 * on: any /api/* request that reaches PermissionMiddleware with a user has, by
 * then, already had its tenant resolved (or been 401/403-gated) by
 * TenantMiddleware — which is why capabilities can be derived from
 * `req.tenant` without re-resolving the org. Two drifting copies could break
 * that invariant silently.
 */
export const AUTH_CONTEXT_ONLY_PATHS = new Set([
  "/api/auth/tenant/switch",
  // 接受邀请发生在**进入**受邀租户之前:接受人当前活跃的是别的租户(常见是自己的
  // 个人租户),甚至还没有任何租户;这两条只认登录态,租户由邀请 token 决定。
  "/api/iam/invitations/lookup",
  "/api/iam/invitations/accept",
]);
