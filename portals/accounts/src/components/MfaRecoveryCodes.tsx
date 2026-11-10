/**
 * MfaRecoveryCodes.tsx - shared one-time recovery code acknowledgment.
 * @package @vxture/accounts
 * @layer Presentation
 * @category component
 * @author AI-Generated
 * @date 2026-11-08
 */
"use client";
import { useTranslations } from "next-intl";

import { useId, useState } from "react";
import { Banner, Button, Checkbox, useToast } from "@vxture/design-system";

interface MfaRecoveryCodesProps {
  readonly codes: readonly string[];
  readonly onContinue: () => void;
  readonly continueLabel?: string;
}

/**
 * Require acknowledgment before dismissing newly issued recovery codes.
 * @param props - Server-issued codes and the continuation owned by the caller.
 * @returns Recovery codes, clipboard feedback and a guarded continuation.
 */
export function MfaRecoveryCodes({
  codes,
  onContinue,
  continueLabel,
}: MfaRecoveryCodesProps) {
  const formText = useTranslations("accountsForms");
  const { toast } = useToast();
  const id = useId();
  const [saved, setSaved] = useState(false);
  const [feedback, setFeedback] = useState("");
  async function copy() {
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      setFeedback("");
      toast({ tone: "success", title: formText("copied") });
    } catch {
      setFeedback(formText("unable_to_copy_save_the_recovery_codes_manually"));
    }
  }
  return (
    <div className="accounts-recovery">
      <p className="text-body-sm text-muted-foreground">
        {formText(
          "save_these_recovery_codes_now_each_code_can_only_be_used_once",
        )}
      </p>
      <ul className="accounts-recovery-codes">
        {codes.map((code) => (
          <li key={code}>
            <code>{code}</code>
          </li>
        ))}
      </ul>
      <Button
        type="button"
        variant="outline"
        disabled={!codes.length}
        onClick={() => void copy()}
      >
        {formText("copy_recovery_codes")}
      </Button>
      {feedback ? <Banner tone="warning" title={feedback} /> : null}
      <div className="flex items-center gap-sm">
        <Checkbox
          id={id}
          checked={saved}
          onCheckedChange={(value) => setSaved(value === true)}
        />
        <label htmlFor={id} className="text-body-sm">
          {formText("i_have_saved_my_recovery_codes")}
        </label>
      </div>
      <Button
        type="button"
        disabled={!saved || !codes.length}
        onClick={onContinue}
      >
        {continueLabel ?? formText("done")}
      </Button>
    </div>
  );
}
