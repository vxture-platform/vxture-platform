/**
 * Realm-specific account shell using the same DS navigation as Console.
 * @package @vxture/accounts
 * @layer Presentation
 * @category component
 * @author AI-Generated
 * @date 2026-11-07
 */
"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  ShellSidebarFrame,
  ShellSidebarNav,
  Button,
  Banner,
  Icon,
  Skeleton,
  type ShellNavSection,
} from "@vxture/design-system";
import { AccountsHeader, AccountsFooter } from "./AccountsChrome";
import type { AccountsMenuUser } from "./AccountsUserMenu";

// ============================================================================
// Account-session boundary
// ============================================================================

const API_BASE =
  process.env.NEXT_PUBLIC_OIDC_API_BASE ?? "http://localhost:3081";
const WEBSITE_HOME =
  process.env.NEXT_PUBLIC_WEBSITE_URL || "https://vxture.com/";
const SessionExpiredContext = createContext(() => {
  window.location.replace(WEBSITE_HOME);
});
const AccountMenuContext = createContext<(user: AccountsMenuUser) => void>(
  () => {},
);
interface AccountCompletion {
  complete: (view: ReactNode) => void;
  cancel: () => void;
}
const CompletionContext = createContext<() => AccountCompletion>(() => ({
  complete: () => {},
  cancel: () => {},
}));

/**
 * Finish an operation that intentionally revokes its own account session.
 * @returns A bounded-operation lease for presenting a non-account completion result.
 */
export function useAccountCompletion() {
  return useContext(CompletionContext);
}

/**
 * Publish refreshed account data without another identity request.
 * @returns The shell-owned identity update callback.
 */
export function useAccountMenuUpdate() {
  return useContext(AccountMenuContext);
}

/**
 * Leave protected content when an account API confirms the session is absent.
 * @returns The shell-owned handler that clears the entire account surface.
 */
export function useAccountSessionExpired(): () => void {
  return useContext(SessionExpiredContext);
}

// ============================================================================
// Route-owned navigation
// ============================================================================

/** Frame account content without deriving the identity realm from ambient cookies. */
export function AccountCenterShell({
  realm,
  children,
  returnTo,
  section = "overview",
}: {
  realm: "customer" | "workforce";
  children: ReactNode;
  returnTo?: string;
  section?: "overview" | "passkeys";
}) {
  const t = useTranslations("accountsUi");
  const center = useTranslations("accountCenter");
  const pathname = usePathname();
  const params = useSearchParams();
  const [collapsed, setCollapsed] = useState(false);
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState<
    "checking" | "authenticated" | "error" | "expired"
  >("checking");
  const [revision, setRevision] = useState(0);
  const [accountUser, setAccountUser] = useState<AccountsMenuUser | null>(null);
  const [completion, setCompletion] = useState<ReactNode>(null);
  const completionPending = useRef(false);
  const expiryObserved = useRef(false);
  const updateMenu = useCallback((user: AccountsMenuUser) => {
    if (!leaving.current) setAccountUser(user);
  }, []);
  const leaving = useRef(false);
  const expire = useCallback(() => {
    if (leaving.current) return;
    if (completionPending.current) {
      expiryObserved.current = true;
      return;
    }
    leaving.current = true;
    setSession("expired");
    // Replace history so Back cannot restore a signed-out account screen.
    window.location.replace(WEBSITE_HOME);
  }, []);
  const beginCompletion = useCallback((): AccountCompletion => {
    completionPending.current = true;
    return {
      complete: (view) => {
        // A completed revocation retains only its one-time receipt, never the account UI.
        leaving.current = true;
        completionPending.current = false;
        setAccountUser(null);
        setCompletion(view);
      },
      cancel: () => {
        completionPending.current = false;
        if (expiryObserved.current) expire();
      },
    };
  }, [expire]);
  const base = realm === "customer" ? "/account" : "/workforce/account";
  const requested = params.get("section");
  const allowed =
    realm === "customer" ? ["security", "devices", "deletion"] : ["security"];
  const active =
    section === "passkeys"
      ? "passkeys"
      : requested && allowed.includes(requested)
        ? requested
        : "profile";
  function href(key: string) {
    const query = new URLSearchParams();
    if (key !== "profile" && key !== "passkeys") query.set("section", key);
    if (returnTo) query.set("returnTo", returnTo);
    const route = key === "passkeys" ? "/workforce/security/passkeys" : base;
    return query.size ? `${route}?${query}` : route;
  }
  const keys =
    realm === "customer"
      ? (["profile", "security", "devices", "deletion"] as const)
      : (["profile", "security", "passkeys"] as const);
  const symbols = {
    profile: "user",
    security: "shield-check",
    devices: "desktop",
    deletion: "warning",
    passkeys: "key",
  } as const;
  const sections: ShellNavSection[] = [
    {
      title: t("accountManagement"),
      items: keys.map((key) => ({
        href: href(key),
        label: t(key),
        icon: symbols[key],
      })),
    },
  ];
  useEffect(() => {
    const controller = new AbortController();
    let inFlight = false;
    let lastReadAt = 0;
    async function read() {
      if (
        controller.signal.aborted ||
        leaving.current ||
        inFlight ||
        document.visibilityState !== "visible" ||
        Date.now() - lastReadAt < 1500
      )
        return;
      inFlight = true;
      lastReadAt = Date.now();
      try {
        const resource = realm === "customer" ? "customer" : "operator";
        const response = await fetch(`${API_BASE}/oidc/${resource}/self`, {
          credentials: "include",
          cache: "no-store",
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(10000),
          ]),
        });
        if (controller.signal.aborted || leaving.current) return;
        if (response.status === 401) {
          expire();
          return;
        }
        if (!response.ok) throw new Error("account_session_unavailable");
        const data: unknown = await response.json();
        if (!data || typeof data !== "object")
          throw new Error("invalid_account");
        const profile = data as Record<string, unknown>;
        const account =
          realm === "customer" ? profile.account : profile.username;
        if (
          typeof account !== "string" ||
          (realm === "customer" &&
            (profile.realm !== "customer" || typeof profile.id !== "string"))
        )
          throw new Error("invalid_account_realm");
        const identityKey = `${realm}:${realm === "customer" ? profile.id : account}`;
        if (controller.signal.aborted || leaving.current) return;
        setAccountUser((previous) => ({
          ...(previous?.identityKey === identityKey ? previous : {}),
          identityKey,
          account,
          displayName:
            typeof profile.name === "string" && profile.name.trim()
              ? profile.name
              : account,
          ...(realm === "customer"
            ? {
                avatarSrc:
                  typeof profile.avatarHash === "string" && profile.avatarHash
                    ? `${API_BASE}/avatar/usr_${profile.id}?v=${encodeURIComponent(profile.avatarHash)}`
                    : undefined,
              }
            : {
                phone: typeof profile.phone === "string" ? profile.phone : null,
                email: typeof profile.email === "string" ? profile.email : null,
              }),
        }));
        setSession("authenticated");
      } catch {
        if (!controller.signal.aborted && !leaving.current)
          setSession((previous) =>
            previous === "authenticated" ? previous : "error",
          );
      } finally {
        inFlight = false;
      }
    }
    void read();
    const reconcile = () => {
      void read();
    };
    const interval = window.setInterval(reconcile, 300_000);
    window.addEventListener("focus", reconcile);
    window.addEventListener("pageshow", reconcile);
    document.addEventListener("visibilitychange", reconcile);
    return () => {
      controller.abort();
      window.clearInterval(interval);
      window.removeEventListener("focus", reconcile);
      window.removeEventListener("pageshow", reconcile);
      document.removeEventListener("visibilitychange", reconcile);
    };
  }, [realm, pathname, active, revision, expire]);
  useEffect(() => {
    setOpen(false);
  }, [pathname, active]);
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 701px)");
    const closeOnDesktop = () => {
      if (desktop.matches) setOpen(false);
    };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [open]);
  if (completion) {
    return (
      <div className="accounts-viewport">
        <AccountsHeader />
        <main className="accounts-content">{completion}</main>
        <AccountsFooter />
      </div>
    );
  }
  if (session === "expired") return null;
  if (session !== "authenticated") {
    return (
      <div className="accounts-viewport">
        <AccountsHeader layout="account" />
        <main className="accounts-content">
          <div className="accounts-management">
            {session === "checking" ? (
              <div role="status" aria-label={center("loading")}>
                <Skeleton className="h-40 w-full" />
              </div>
            ) : (
              <div className="flex flex-col items-start gap-sm">
                <Banner tone="danger" title={center("loadFailed")} />
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setSession("checking");
                    setRevision((value) => value + 1);
                  }}
                >
                  {center("retry")}
                </Button>
              </div>
            )}
          </div>
        </main>
        <AccountsFooter layout="account" />
      </div>
    );
  }
  return (
    <CompletionContext.Provider value={beginCompletion}>
      <SessionExpiredContext.Provider value={expire}>
        <AccountMenuContext.Provider value={updateMenu}>
          <div className="accounts-viewport">
            <AccountsHeader
              layout="account"
              accountHref={href("profile")}
              accountUser={accountUser}
              realm={realm}
              navigation={
                <Button
                  variant="ghost"
                  size="icon-md"
                  className="accounts-mobile-trigger"
                  aria-label={t(open ? "closeNav" : "openNav")}
                  aria-expanded={open}
                  aria-controls="accounts-sidebar"
                  onClick={() => setOpen((value) => !value)}
                >
                  <Icon name={open ? "x" : "list"} size="sm" />
                </Button>
              }
            />
            <div
              className={`accounts-workspace${open ? " accounts-nav-open" : ""}`}
            >
              {open ? (
                <Button
                  variant="ghost"
                  className="accounts-nav-dismiss"
                  aria-label={t("closeNav")}
                  onClick={() => setOpen(false)}
                />
              ) : null}
              <aside
                id="accounts-sidebar"
                className="accounts-sidebar"
                aria-label={t("navigation")}
              >
                <ShellSidebarFrame mode={collapsed ? "collapsed" : "expanded"}>
                  <ShellSidebarNav
                    sections={sections}
                    collapsed={collapsed}
                    onToggleCollapsed={() => setCollapsed((value) => !value)}
                    isActive={(url) => url === href(active)}
                    storageKeyPrefix={`accounts-${realm}`}
                    linkComponent={Link}
                    labels={{
                      expandNav: t("openNav"),
                      collapseNav: t("closeNav"),
                      expandAllGroups: t("expandGroups"),
                      collapseAllGroups: t("collapseGroups"),
                    }}
                  />
                </ShellSidebarFrame>
              </aside>
              <div
                className="accounts-content"
                inert={open}
                aria-hidden={open || undefined}
                key={`${pathname}-${active}`}
              >
                <div className="accounts-management">{children}</div>
              </div>
            </div>
            <AccountsFooter layout="account" />
          </div>
        </AccountMenuContext.Provider>
      </SessionExpiredContext.Provider>
    </CompletionContext.Provider>
  );
}
