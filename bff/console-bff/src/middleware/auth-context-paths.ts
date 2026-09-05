/**
 * Paths that carry only the authenticated-user context and deliberately skip
 * tenant + permission resolution.
 *
 * TenantMiddleware and PermissionMiddleware both key off this single set. Keeping
 * it as one source of truth preserves the invariant PermissionMiddleware relies
 * on: any /api/* request that reaches PermissionMiddleware with a user has, by
 * then, already had its tenant resolved (or been 401/403-gated) by
 * TenantMiddleware — which is why capabilities can be derived from
 * `req.tenant` without re-resolving the org. Two drifting copies could break
 * that invariant silently.
 *
 * 切换活跃租户不在这里:它走 `/auth/switch-tenant`(顶层跳转 → IdP 静默重授权,
 * identity/080 §2.8),在 api/* 中间件链之外。此前列着一条早已退役的
 * `/api/auth/tenant/switch`,前端一直 POST 到一个不存在的路由——切换从未生效。
 */
export const AUTH_CONTEXT_ONLY_PATHS = new Set([
  // 接受邀请发生在**进入**受邀租户之前:接受人当前活跃的是别的租户(常见是自己的
  // 个人租户),甚至还没有任何租户;这两条只认登录态,租户由邀请 token 决定。
  "/api/iam/invitations/lookup",
  "/api/iam/invitations/accept",
]);
