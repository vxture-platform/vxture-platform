/**
 * page.tsx - /operator/reset-password?token=… (set a new operator password)
 * @package @vxture/accounts
 *
 * Landing page for the admin-issued operator reset link. Reads the one-time
 * token and renders the new-password form; a missing token means the link was
 * malformed/opened out of band — show a friendly notice instead of a broken form.
 */
import { AccountsNotice } from "@/components/AuthChrome";
import { OperatorResetPasswordPanel } from "@/components/OperatorResetPasswordPanel";

export const dynamic = "force-dynamic";

export default async function OperatorResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const token = typeof params.token === "string" ? params.token : "";

  if (!token) {
    return (
      <AccountsNotice
        title="重置链接无效"
        description="链接可能已过期或已被使用。请联系管理员重新生成一条。"
      />
    );
  }

  return <OperatorResetPasswordPanel token={token} />;
}
