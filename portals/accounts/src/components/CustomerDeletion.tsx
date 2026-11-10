/**
 * CustomerDeletion.tsx - verified deletion eligibility and recovery.
 * @package @vxture/accounts
 * @layer Presentation
 * @category component
 * @author AI-Generated
 * @date 2026-11-08
 */
"use client";
import { useLocale, useTranslations } from "next-intl";
import { formatDateTime } from "@vxture-platform/shared";
import { useEffect, useState } from "react";
import {
  Banner,
  Button,
  Checkbox,
  DialogForm,
  NativeSelect,
  useToast,
} from "@vxture/design-system";
import { accountsRequest, type CustomerSecurity } from "@/api/customer-self";
import { AccountSection, AccountActions } from "./AccountPrimitives";
import { VerificationCodeInput } from "./VerificationCodeInput";
import { useAccountCompletion } from "./AccountCenterShell";
import { AccountReauthentication } from "./AccountReauthentication";

// ============================================================================
// Account lifecycle
// ============================================================================
interface Item {
  code: string;
  count?: number;
  amount?: string;
  currency?: string;
  names?: string[];
}
interface State {
  status: string;
  canDelete: boolean;
  canRecover: boolean;
  purgeAt: string | null;
  retentionDays: number;
  blockers: Item[];
  confirmations: Item[];
  autoActions: Item[];
}

/** Use server eligibility and operation-bound proof for every lifecycle mutation. */
export function CustomerDeletion({
  security,
}: {
  security: CustomerSecurity | null;
}) {
  const locale = useLocale();
  const beginCompletion = useAccountCompletion();
  const formText = useTranslations("accountsForms");
  const { toast } = useToast();
  const LABELS: Record<string, string> = {
    org_owner: formText("transfer_or_close_the_organizations_you_own_first"),
    unpaid_bills: formText("outstanding_bills_remain"),
    paid_balance: formText("a_paid_balance_remains"),
    refund_in_progress: formText("refunds_are_still_in_progress"),
    receipt_in_progress: formText("invoices_are_still_being_processed"),
    pending_order_with_payment: formText(
      "some_payments_are_still_being_processed",
    ),
    active_subscription: formText("current_subscriptions_will_end"),
    gifted_balance: formText("promotional_balance_will_expire"),
    cancel_pending_orders: formText("cancel_unpaid_orders"),
    leave_organizations: formText("leave_joined_organizations"),
    revoke_sessions: formText("sign_out_all_devices"),
    unbind_identities: formText("disconnect_linked_accounts"),
    revoke_invitations: formText("revoke_invitations"),
    delete_personal_tenant: formText("delete_personal_workspace"),
  };
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [challenge, setChallenge] = useState("");
  const [code, setCode] = useState("");
  const [verified, setVerified] = useState(false);
  const [method, setMethod] = useState("phone");
  const [done, setDone] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [revision, setRevision] = useState(0);
  const base = "/oidc/customer/self/deletion";
  useEffect(() => {
    const controller = new AbortController();
    accountsRequest<State>(base, { signal: controller.signal })
      .then(setState)
      .catch((e: unknown) => {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : formText("unable_to_load"));
      });
    return () => controller.abort();
  }, [revision, formText]);
  const recovery = state?.status === "deleting";
  const allowed = Boolean(
    security && (recovery ? state?.canRecover : state?.canDelete),
  );
  async function run() {
    if (!allowed || busy || (!recovery && !accepted)) return;
    setBusy(true);
    setError("");
    try {
      if (!challenge) {
        const result = await accountsRequest<{ challengeId: string }>(
          `${base}/${recovery ? "recovery/" : ""}challenges`,
          { method: "POST", body: JSON.stringify({ method }) },
        );
        setChallenge(result.challengeId);
      } else if (!verified) {
        await accountsRequest(
          `${base}/${recovery ? "recovery/" : ""}challenges/${challenge}/verify`,
          { method: "POST", body: JSON.stringify({ code }) },
        );
        setVerified(true);
        setCode("");
      } else {
        const completion = recovery ? null : beginCompletion();
        try {
          await accountsRequest(recovery ? `${base}/cancel` : base, {
            method: "POST",
            body: JSON.stringify({
              challengeId: challenge,
              acknowledged: accepted,
            }),
          });
          if (completion)
            completion.complete(<AccountReauthentication deletion />);
          else {
            setDone(true);
            toast({
              tone: "success",
              title: formText("deletion_cancelled_your_account_is_restored"),
            });
          }
        } catch (error) {
          completion?.cancel();
          throw error;
        }
      }
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : formText("unable_to_complete_this_action"),
      );
    } finally {
      setBusy(false);
    }
  }
  const items = (list: Item[]) => (
    <ul className="accounts-lifecycle-items">
      {list.map((item) => (
        <li key={item.code}>
          {LABELS[item.code] ?? item.code}
          {item.count ? `（${item.count}）` : ""}
          {item.amount ? ` · ${item.amount} ${item.currency ?? ""}` : ""}
          {item.names?.length ? ` · ${item.names.join("、")}` : ""}
        </li>
      ))}
    </ul>
  );
  return (
    <AccountSection
      title={
        recovery ? formText("deletion_request") : formText("delete_account")
      }
      icon="warning"
      tone={recovery ? "default" : "danger"}
    >
      {done ? (
        <Banner
          tone="success"
          title={
            recovery
              ? formText("deletion_cancelled_your_account_is_restored")
              : formText("deletion_requested")
          }
          description={
            recovery
              ? undefined
              : formText(
                  "you_have_been_signed_out_sign_in_within_the_retention_period_to_cancel",
                )
          }
        />
      ) : (
        <div className="accounts-settings-form">
          {state ? (
            <>
              {recovery ? (
                <p className="text-body-sm text-muted-foreground">
                  {formText("scheduled_permanent_deletion")}
                  {state.purgeAt ? formatDateTime(state.purgeAt, locale) : "—"}
                </p>
              ) : (
                <p className="text-body-sm text-muted-foreground">
                  {formText("retention_notice", { days: state.retentionDays })}
                </p>
              )}
              {state.blockers.length ? (
                <div>
                  <p className="text-body-sm">
                    {formText("items_requiring_action")}
                  </p>
                  {items(state.blockers)}
                </div>
              ) : null}
              {!recovery && state.confirmations.length
                ? items(state.confirmations)
                : null}
              {!recovery && state.autoActions.length
                ? items(state.autoActions)
                : null}
              {allowed ? (
                <>
                  {!recovery ? (
                    <label className="flex items-start gap-sm text-body-sm">
                      <Checkbox
                        checked={accepted}
                        onCheckedChange={(value) => setAccepted(value === true)}
                        disabled={busy || Boolean(challenge)}
                      />
                      {formText(
                        "i_understand_the_consequences_and_confirm_this_request",
                      )}
                    </label>
                  ) : null}
                  {!challenge ? (
                    <NativeSelect
                      aria-label={formText("verification_method")}
                      value={method}
                      onChange={(e) => setMethod(e.target.value)}
                      disabled={busy}
                    >
                      <option value="phone" disabled={!security?.phoneVerified}>
                        {formText("sms_code")}
                      </option>
                      <option value="email" disabled={!security?.emailVerified}>
                        {formText("email_code")}
                      </option>
                    </NativeSelect>
                  ) : !verified ? (
                    <VerificationCodeInput
                      name="deletion_code"
                      label={formText("verification_code")}
                      value={code}
                      onChange={setCode}
                      disabled={busy}
                    />
                  ) : (
                    <p className="text-body-sm">
                      {formText("identity_verified")}
                    </p>
                  )}
                  <AccountActions>
                    <Button
                      variant="default"
                      disabled={
                        busy ||
                        (!recovery && !accepted) ||
                        (Boolean(challenge) && !verified && code.length !== 6)
                      }
                      onClick={() => {
                        if (!recovery && verified) {
                          setError("");
                          setConfirmOpen(true);
                        } else void run();
                      }}
                    >
                      {busy
                        ? formText("processing")
                        : !challenge
                          ? formText("send_code")
                          : !verified
                            ? formText("verify")
                            : recovery
                              ? formText("cancel_deletion")
                              : formText("confirm_account_deletion")}
                    </Button>
                  </AccountActions>
                </>
              ) : null}
            </>
          ) : (
            <p role="status">{formText("loading_account_status")}</p>
          )}
          {error && !confirmOpen ? (
            <>
              <Banner tone="danger" title={error} />
              <Button
                variant="ghost"
                onClick={() => {
                  setError("");
                  setRevision((v) => v + 1);
                  setChallenge("");
                  setVerified(false);
                }}
              >
                {formText("start_again")}
              </Button>
            </>
          ) : null}
        </div>
      )}
      <DialogForm
        size="sm"
        open={confirmOpen}
        onOpenChange={(next) => {
          if (!busy) setConfirmOpen(next);
        }}
        title={formText("confirm_account_deletion")}
        description={formText("retention_notice", {
          days: state?.retentionDays ?? 30,
        })}
        danger
        submitting={busy}
        submitDisabled={!allowed || !accepted || !verified}
        submitLabel={formText("confirm_account_deletion")}
        cancelLabel={formText("cancel")}
        pendingLabel={formText("processing")}
        onSubmit={(event) => {
          event.preventDefault();
          if (verified) void run();
        }}
      >
        <p className="text-body-sm">{formText("deletion_final_consequence")}</p>
        {error ? <Banner tone="danger" title={error} /> : null}
      </DialogForm>
    </AccountSection>
  );
}
