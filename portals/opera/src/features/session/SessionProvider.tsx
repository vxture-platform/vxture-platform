"use client";

/* Capability Console session bootstrap. Defense-in-depth only: in production
 * the nginx auth_request gate already guarantees no page is served without an
 * RP session (hardening "any path, no content unauthenticated"), so this
 * provider mainly hydrates operator identity for the header; the redirect
 * branch matters in dev (no edge gate) and on session expiry while the tab
 * stays open. All URLs are same-origin relative — the real hostname never
 * enters the bundle. */

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export interface OperatorIdentity {
  sub: string;
  displayName: string;
  role: string;
}

type SessionStatus = "loading" | "ready" | "anonymous";

interface SessionContextValue {
  operator: OperatorIdentity | null;
  status: SessionStatus;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue>({
  operator: null,
  status: "loading",
  signOut: async () => undefined,
});

export function buildLoginUrl(returnTo: string): string {
  return `/auth/login?returnTo=${encodeURIComponent(returnTo)}`;
}

function toIdentity(claims: Record<string, unknown>): OperatorIdentity {
  const pick = (k: string): string =>
    typeof claims[k] === "string" ? (claims[k] as string) : "";
  return {
    sub: pick("sub"),
    displayName:
      pick("name") || pick("preferred_username") || pick("sub") || "Operator",
    role: pick("operator_role"),
  };
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [operator, setOperator] = useState<OperatorIdentity | null>(null);
  const [status, setStatus] = useState<SessionStatus>("loading");

  useEffect(() => {
    let active = true;
    fetch("/auth/session", { credentials: "include", cache: "no-store" })
      .then(async (res) => {
        if (!active) return;
        if (res.ok) {
          const body = (await res.json()) as {
            claims?: Record<string, unknown>;
          };
          setOperator(toIdentity(body.claims ?? {}));
          setStatus("ready");
          return;
        }
        setStatus("anonymous");
        if (res.status === 401 || res.status === 403) {
          window.location.replace(buildLoginUrl(window.location.href));
        }
      })
      .catch(() => {
        if (active) setStatus("anonymous");
      });
    return () => {
      active = false;
    };
  }, []);

  async function signOut() {
    try {
      await fetch("/auth/logout", { method: "POST", credentials: "include" });
    } catch {
      /* local sign-out stays resilient if the BFF is unreachable */
    }
    window.location.replace(buildLoginUrl(window.location.origin + "/"));
  }

  return (
    <SessionContext.Provider value={{ operator, status, signOut }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useOperatorSession() {
  return useContext(SessionContext);
}
