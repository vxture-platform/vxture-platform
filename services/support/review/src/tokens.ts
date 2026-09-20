/**
 * 本服务自己的连接池令牌。
 *
 * 不复用 service-ticket 的 `SUPPORT_PG_POOL`:两个包各自 register 自己的池,
 * 令牌撞名会让后注册的那个静默覆盖前一个(同一个 Nest 容器里 provide 同名 token)。
 */
export const REVIEW_PG_POOL = "REVIEW_PG_POOL";
