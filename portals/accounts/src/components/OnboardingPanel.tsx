/**
 * OnboardingPanel.tsx - minimal account completion with server-owned verification facts.
 * @package @vxture/accounts
 * @layer Presentation
 * @category component
 * @author AI-Generated
 * @date 2026-11-08
 */
"use client";
import { useTranslations } from "next-intl";

import { useEffect, useState, type FormEvent } from "react";
import { Banner, Button, Input, StatusBadge } from "@vxture/design-system";
import { AuthLoginTemplate } from "./auth/AuthLogin";
import { AccountsAuthFooter, AccountsAuthHeader } from "./AuthChrome";
import {
  fetchOnboardingState,
  submitOnboarding,
  checkOnboardingAccount,
  type OnboardingState,
} from "@/api/oidc";

// ============================================================================
// Account completion
// ============================================================================
const ACCOUNT_RE = /^[A-Za-z][A-Za-z0-9_]{2,23}$/;

/** Complete only the four identity fields; contact proof is never inferred from prefill. */
export function OnboardingPanel() {
  const formText = useTranslations("accountsForms");
  const [initial, setInitial] = useState<OnboardingState | null>(null);
  const [name, setName] = useState("");
  const [account, setAccount] = useState("");
  const [email, setEmail] = useState("");
  const [availability, setAvailability] = useState<
    "idle" | "checking" | "available" | "taken" | "invalid" | "error"
  >("idle");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [availabilityRevision, setAvailabilityRevision] = useState(0);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setError("");
    fetchOnboardingState()
      .then((state) => {
        if (!active) return;
        setInitial(state);
        setName(state.displayName ?? "");
        setEmail(state.email ?? "");
        setAccount(/^_\d+$/.test(state.account) ? "" : state.account);
      })
      .catch((e: unknown) => {
        if (active)
          setError(e instanceof Error ? e.message : formText("unable_to_load"));
      });
    return () => {
      active = false;
    };
  }, [revision, formText]);
  useEffect(() => {
    if (!account.trim()) {
      setAvailability("idle");
      return;
    }
    if (!ACCOUNT_RE.test(account.trim())) {
      setAvailability("invalid");
      return;
    }
    const controller = new AbortController();
    setAvailability("checking");
    const timer = setTimeout(() => {
      checkOnboardingAccount(account.trim(), controller.signal)
        .then((available) => {
          if (!controller.signal.aborted)
            setAvailability(available ? "available" : "taken");
        })
        .catch(() => {
          if (!controller.signal.aborted) setAvailability("error");
        });
    }, 350);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [account, availabilityRevision]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !initial || availability !== "available") return;
    if (!name.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError(formText("enter_your_name_and_a_valid_email"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await submitOnboarding({
        account: account.trim(),
        displayName: name.trim(),
        email: email.trim(),
      });
      window.location.assign(result.redirectTo);
    } catch (e) {
      setError(e instanceof Error ? e.message : formText("unable_to_save"));
      setBusy(false);
    }
  }
  const verifiedEmail = Boolean(
    initial?.emailVerified && email === initial.email,
  );
  const statuses = {
    idle: "",
    checking: formText("checking"),
    available: formText("available"),
    taken: formText("already_taken"),
    invalid: formText(
      "3_24_characters_starting_with_a_letter_letters_numbers_and_underscores",
    ),
    error: formText("unable_to_check_please_try_again"),
  };
  return (
    <AuthLoginTemplate
      header={<AccountsAuthHeader />}
      footer={<AccountsAuthFooter />}
      title={formText("complete_your_account")}
    >
      <form className="accounts-onboarding" onSubmit={submit}>
        <div className="accounts-onboarding-row">
          <label htmlFor="onboarding-name">
            {formText("name")}
            <span className="accounts-required" aria-hidden="true">
              *
            </span>
          </label>
          <div>
            <Input
              id="onboarding-name"
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!initial || busy}
              autoComplete="name"
              required
            />
          </div>
        </div>
        <div className="accounts-onboarding-row">
          <label htmlFor="onboarding-account">
            {formText("account")}
            <span className="accounts-required" aria-hidden="true">
              *
            </span>
          </label>
          <div>
            <div className="accounts-contact-input">
              <Input
                id="onboarding-account"
                value={account}
                onChange={(e) => setAccount(e.target.value)}
                disabled={!initial || busy}
                autoComplete="username"
                maxLength={24}
                required
              />
              {availability === "available" || availability === "checking" ? (
                <StatusBadge
                  tone={availability === "available" ? "success" : "neutral"}
                >
                  {statuses[availability]}
                </StatusBadge>
              ) : null}
            </div>
            {availability !== "available" && availability !== "checking" ? (
              <p role="status" className="text-body-sm text-muted-foreground">
                {statuses[availability]}
              </p>
            ) : null}
            {availability === "error" ? (
              <Button
                type="button"
                variant="link"
                onClick={() => setAvailabilityRevision((value) => value + 1)}
              >
                {formText("retry")}
              </Button>
            ) : null}
          </div>
        </div>
        <div className="accounts-onboarding-row">
          <label htmlFor="onboarding-phone">
            {formText("phone")}
            <span className="accounts-required" aria-hidden="true">
              *
            </span>
          </label>
          <div>
            <div className="accounts-contact-input">
              <Input
                id="onboarding-phone"
                aria-required="true"
                value={initial?.phone ?? ""}
                disabled
              />
              <StatusBadge
                tone={initial?.phoneVerified ? "success" : "neutral"}
              >
                {initial?.phoneVerified
                  ? formText("verified")
                  : formText("unverified")}
              </StatusBadge>
            </div>
            <p className="text-body-sm text-muted-foreground">
              {initial?.phoneVerified
                ? formText("phone_ownership_verified")
                : formText("phone_not_yet_verified")}
            </p>
          </div>
        </div>
        <div className="accounts-onboarding-row">
          <label htmlFor="onboarding-email">
            {formText("email")}
            <span className="accounts-required" aria-hidden="true">
              *
            </span>
          </label>
          <div>
            <div className="accounts-contact-input">
              <Input
                id="onboarding-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={!initial || busy || initial.emailVerified}
                autoComplete="email"
                maxLength={128}
                required
              />
              <StatusBadge tone={verifiedEmail ? "success" : "neutral"}>
                {verifiedEmail ? formText("verified") : formText("unverified")}
              </StatusBadge>
            </div>
            <p className="text-body-sm text-muted-foreground">
              {verifiedEmail
                ? formText("email_ownership_verified")
                : formText("you_can_verify_after_registration")}
            </p>
          </div>
        </div>
        {error ? <Banner tone="danger" title={error} /> : null}
        {!initial && error ? (
          <Button type="button" onClick={() => setRevision((v) => v + 1)}>
            {formText("retry")}
          </Button>
        ) : (
          <Button
            type="submit"
            disabled={!initial || busy || availability !== "available"}
          >
            {busy ? formText("saving") : formText("save_and_continue")}
          </Button>
        )}
      </form>
    </AuthLoginTemplate>
  );
}
