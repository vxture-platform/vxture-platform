/**
 * page.tsx - /reset-password?token=… (set a new password)
 * @package @vxture/accounts
 *
 * Landing page for the emailed reset link. Reads the one-time token and renders
 * the new-password form; a missing token means the link was malformed/opened out
 * of band — show a friendly notice instead of a broken form.
 */
import { AccountsNotice } from "@/components/AuthChrome";
import { ResetPasswordPanel } from "@/components/ResetPasswordPanel";

export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({
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
        description="链接可能已过期或已被使用。重置链接 15 分钟内有效，且只能用一次。"
      />
    );
  }

  return <ResetPasswordPanel token={token} />;
}
