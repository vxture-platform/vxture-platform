/**
 * Realm-specific account shell using the same DS navigation as Console.
 * @package @vxture/accounts
 * @layer Presentation
 * @category component
 * @author AI-Generated
 * @date 2026-11-07
 */
"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  ShellSidebarFrame,
  ShellSidebarNav,
  Button,
  Icon,
  type ShellNavSection,
} from "@vxture/design-system";
import { AccountsHeader, AccountsFooter } from "./AccountsChrome";

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
  const pathname = usePathname();
  const params = useSearchParams();
  const [collapsed, setCollapsed] = useState(false);
  const [open, setOpen] = useState(false);
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
  return (
    <div className="accounts-viewport">
      <AccountsHeader
        accountHref={href("profile")}
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
      <div className={`accounts-workspace${open ? " accounts-nav-open" : ""}`}>
        {open ? (
          <button
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
      <AccountsFooter />
    </div>
  );
}
