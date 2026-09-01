/**
 * account-center.ts — URL of the identity-layer operator account center (Phase B).
 * @package @vxture/arche
 *
 * 运营者账户自助(改邮箱/通行密钥等)收敛到身份层 accounts 门户的 /account 单点;arche
 * 只出跳转入口。accounts 是公开登录门户(accounts.vxture.com,非内部主机),故 prod 默认
 * 直接用它,dev 指本地 3080;可被 NEXT_PUBLIC_ACCOUNTS_URL 覆盖。同源 vx_sid_op 会话
 * 让运营者到那边即已认证(与登录同一中心会话)。
 */
const ACCOUNTS_BASE = (
  process.env.NEXT_PUBLIC_ACCOUNTS_URL ??
  (process.env.NODE_ENV === "production"
    ? "https://accounts.vxture.com"
    : "http://localhost:3080")
)
  .trim()
  .replace(/\/+$/, "");

/** The operator account center (个人信息 / 账户中心) in the accounts portal. */
export function operatorAccountCenterUrl(): string {
  return `${ACCOUNTS_BASE}/account`;
}
