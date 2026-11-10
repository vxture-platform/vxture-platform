/**
 * page.tsx - /operator/reset-password?token=… (set a new operator password)
 * @package @vxture/accounts
 *
 * Landing page for the admin-issued operator reset link. Reads the one-time
 * token and renders the new-password form; a missing token means the link was
 * malformed/opened out of band — show a friendly notice instead of a broken form.
 */
import { getTranslations } from "next-intl/server";
import { AccountsNotice } from "@/components/AuthChrome";
import { OperatorResetPasswordPanel } from "@/components/OperatorResetPasswordPanel";

export const dynamic = "force-dynamic";

export default async function OperatorResetPasswordPage({
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
        description={t("invalid_operator_reset_detail")}
      />
    );
  }

  return <OperatorResetPasswordPanel token={token} />;
}
