/**
 * Completion receipt for an operation that revoked the account session.
 * @package @vxture/accounts
 * @layer Presentation
 * @category component
 * @author AI-Generated
 * @date 2026-11-10
 */
"use client";
import { useTranslations } from "next-intl";
import { Button } from "@vxture/design-system";
import { AuthResultPanel } from "./auth/AuthLogin";

/** Render only a receipt; revoked profile data and navigation stay unmounted. */
export function AccountReauthentication({
  deletion = false,
}: {
  deletion?: boolean;
}) {
  const t = useTranslations("accountsForms");
  return (
    <div className="accounts-auth">
      <AuthResultPanel
        tone="success"
        title={t(deletion ? "deletion_requested" : "done_please_sign_in_again")}
        description={
          deletion
            ? t(
                "you_have_been_signed_out_sign_in_within_the_retention_period_to_cancel",
              )
            : undefined
        }
        action={
          <Button onClick={() => window.location.replace("/login")}>
            {t("sign_in_again")}
          </Button>
        }
      />
    </div>
  );
}
