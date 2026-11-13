/**
 * Login entry bound to the server-owned identity realm.
 * @package @vxture/accounts
 * @layer Presentation
 * @category component
 * @author AI-Generated
 * @date 2026-11-06
 */
"use client";
import { useTranslations } from "next-intl";

import { useEffect, useRef, useState } from "react";
import { Button } from "@vxture/design-system";
import { accountsRequest } from "@/api/customer-self";
import { fetchLoginContext, SessionExpiredError } from "@/api/oidc";
import { AccountsNotice } from "./AuthChrome";
import { OidcLoginForm } from "./OidcLoginForm";

type Realm = "customer" | "workforce";
type State =
  | { kind: "loading" }
  | { kind: "ready"; realm: Realm }
  | { kind: "error"; message: string; retryable: boolean };

// ============================================================================
// Entry verification
// ============================================================================

/**
 * Validate the challenge before showing credentials for either identity domain.
 * @param props - Challenge and the realm represented by the current route.
 * @returns A realm-specific login form or a recoverable status notice.
 */
export function LoginEntry({
  loginChallenge,
  entryRealm,
}: {
  readonly loginChallenge: string;
  readonly entryRealm: Realm;
}) {
  const formText = useTranslations("accountsForms");
  const latestText = useRef(formText);
  latestText.current = formText;
  const [state, setState] = useState<State>({ kind: "loading" });
  const [retry, setRetry] = useState(0);
  const [challenge, setChallenge] = useState(loginChallenge);

  useEffect(() => {
    let active = true;
    setState({ kind: "loading" });
    void (async () => {
      if (challenge) return fetchLoginContext(challenge);
      const intent = await accountsRequest<{ loginChallenge: string }>(
        "/oidc/accounts/login-context",
        {
          method: "POST",
          body: JSON.stringify({ realm: entryRealm }),
        },
      );
      if (!active) return { realm: entryRealm };
      setChallenge(intent.loginChallenge);
      return fetchLoginContext(intent.loginChallenge);
    })()
      .then(({ realm }) => {
        if (!active) return;
        if (realm !== entryRealm) {
          const path = realm === "workforce" ? "/workforce/login" : "/login";
          window.location.replace(
            `${path}?login_challenge=${encodeURIComponent(challenge)}`,
          );
          return;
        }
        setState({ kind: "ready", realm });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setState({
          kind: "error",
          message:
            error instanceof Error
              ? error.message
              : latestText.current("unable_to_load_sign_in_context"),
          retryable: !(error instanceof SessionExpiredError),
        });
      });
    return () => {
      active = false;
    };
    // Translation changes must not unmount an active login or MFA ceremony.
  }, [challenge, entryRealm, retry]);

  if (state.kind === "ready") {
    return (
      <OidcLoginForm
        loginChallenge={challenge}
        realm={state.realm}
        standalone={!loginChallenge}
      />
    );
  }
  if (state.kind === "error") {
    return (
      <AccountsNotice
        title={formText("unable_to_sign_in")}
        description={state.message}
        action={
          state.retryable ? (
            <Button
              size="action"
              onClick={() => setRetry((value) => value + 1)}
            >
              {formText("retry")}
            </Button>
          ) : (
            <Button size="action" asChild>
              <a
                href={
                  entryRealm === "workforce" ? "/workforce/login" : "/login"
                }
              >
                {formText("sign_in_again")}
              </a>
            </Button>
          )
        }
      />
    );
  }
  return (
    <AccountsNotice
      tone="neutral"
      title={formText("checking_sign_in_context")}
      description={formText("please_wait")}
    />
  );
}
