/**
 * MfaEnrollment.tsx - shared authenticator enrollment presentation.
 * @package @vxture/accounts
 * @layer Presentation
 * @category component
 * @author AI-Generated
 * @date 2026-11-08
 */
"use client";
import { useTranslations } from "next-intl";

import { TotpQrCode } from "./TotpQrCode";
import { VerificationCodeInput } from "./VerificationCodeInput";

interface MfaEnrollmentProps {
  readonly secret: string;
  readonly otpauthUri: string;
  readonly code: string;
  readonly onChange: (code: string) => void;
  readonly disabled?: boolean;
  readonly error?: string | undefined;
}

/**
 * Display server-issued enrollment material without owning either realm's policy.
 * @param props - Live enrollment material and controlled confirmation code.
 * @returns The reusable enrollment body for login and account management.
 */
export function MfaEnrollment({
  secret,
  otpauthUri,
  code,
  onChange,
  disabled,
  error,
}: MfaEnrollmentProps) {
  const formText = useTranslations("accountsForms");
  return (
    <div className="accounts-mfa-enrollment">
      <p className="text-body-sm text-muted-foreground">
        {formText("scan_with_your_authenticator")}
      </p>
      {otpauthUri ? (
        <TotpQrCode value={otpauthUri} />
      ) : (
        <p role="status">{formText("generating_qr_code")}</p>
      )}
      {secret ? (
        <div className="accounts-mfa-secret">
          <p>{formText("unable_to_scan")}</p>
          <code className="break-all font-mono select-all">{secret}</code>
        </div>
      ) : null}
      <VerificationCodeInput
        name="totp_code"
        label={formText("authenticator_code")}
        value={code}
        onChange={onChange}
        disabled={disabled || !otpauthUri}
        error={error}
      />
    </div>
  );
}
