/**
 * page.tsx - /reset-password?token=… (set a new password)
 * @package @vxture/accounts
 *
 * Landing page for the emailed reset link. Reads the one-time token and renders
 * the new-password form; a missing token means the link was malformed/opened out
 * of band — show a friendly notice instead of a broken form.
 */
import { getTranslations } from "next-intl/server";
import { AccountsNotice } from "@/components/AuthChrome";
import { ResetPasswordPanel } from "@/components/ResetPasswordPanel";

export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getTranslations("accountsForms");
  const params = await searchParams;
  const token = typeof params.token === "string" ? params.token : "";

  if (!token) {
    return (
      <AccountsNotice
        title={t("invalid_reset_link")}
        description={t("invalid_reset_link_detail")}
      />
    );
  }

  return <ResetPasswordPanel token={token} />;
}
