/**
 * page.tsx — /account (operator self-service account center, Phase B).
 * @package @vxture/accounts
 *
 * 身份层单点的运营者账户中心;admin/opera/arche 的用户弹出面板「个人信息」深链于此
 * (带 `?returnTo=`)。同源 `vx_sid_op` 鉴权在组件内读身份,未登录显示登录提示。
 * `returnTo` 只用于渲染「返回控制台」链接:此处白名单到 *.vxture.com / localhost,
 * 拒绝任意跳转(防钓鱼式开放重定向);真正的登录来源安全由服务端登录流负责。
 */
import { OperatorAccountCenter } from "@/components/OperatorAccountCenter";

export const dynamic = "force-dynamic";

/** Accept a returnTo only if it is an https *.vxture.com URL (or localhost in dev). */
function safeReturnTo(raw: string | string[] | undefined): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  const host = url.hostname;
  const ok =
    (url.protocol === "https:" &&
      (host === "vxture.com" || host.endsWith(".vxture.com"))) ||
    (url.protocol === "http:" &&
      (host === "localhost" || host === "127.0.0.1"));
  return ok ? url.toString() : undefined;
}

export default async function OperatorAccountPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const returnTo = safeReturnTo(params.returnTo);
  return <OperatorAccountCenter {...(returnTo ? { returnTo } : {})} />;
}
