/**
 * 本服务自己的连接池令牌。
 *
 * 不复用别的服务包的池令牌：同一个 Nest 容器里 provide 同名 token，后注册的会
 * **静默覆盖**前一个（service-notice 的 `NOTICE_PG_POOL` 单列正是为此）。
 */
export const OPS_TODOS_PG_POOL = "OPS_TODOS_PG_POOL";
