/**
 * Accounts authentication chrome and result composition.
 * @package @vxture/accounts
 * @layer Presentation
 * @category component
 * @author AI-Generated
 * @date 2026-11-07
 */
"use client";
import type { ReactNode } from "react";
import { AccountsHeader, AccountsFooter } from "./AccountsChrome";
import {
  AuthLoginTemplate,
  AuthResultPanel,
  type AuthResultTone,
  type AuthVisualConfig,
} from "./auth/AuthLogin";

export const AUTH_BRAND_LABEL = "Vxture Accounts";
export const AUTH_BRAND_LOGO = "/brand/vxture-logo-icon.svg";
export const AUTH_COPYRIGHT_OWNER = "Vxture Studio";
export const ACCOUNTS_AUTH_VISUAL: AuthVisualConfig = {};

/** Render the shared Accounts header for every authentication scene. */
export function AccountsAuthHeader({
  brandLabel = AUTH_BRAND_LABEL,
}: { readonly brandLabel?: ReactNode; readonly brandLogoSrc?: string } = {}) {
  return <AccountsHeader brandLabel={brandLabel} />;
}
/** Render the same legal footer as the account center. */
export function AccountsAuthFooter() {
  return <AccountsFooter />;
}

/** Render an authentication outcome without extra navigation. */
export function AccountsNotice({
  tone = "danger",
  title,
  description,
  action,
}: {
  readonly tone?: AuthResultTone;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly action?: ReactNode;
}) {
  return (
    <AuthLoginTemplate
      header={<AccountsAuthHeader />}
      footer={<AccountsAuthFooter />}
      layout="single"
      useLoginLayout={false}
    >
      <AuthResultPanel
        tone={tone}
        title={title}
        description={description}
        action={action}
      />
    </AuthLoginTemplate>
  );
}
