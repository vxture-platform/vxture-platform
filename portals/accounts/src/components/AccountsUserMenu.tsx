/**
 * Realm-bound identity panel without application or subscription information.
 * @package @vxture/accounts
 * @layer Presentation
 * @category component
 * @author AI-Generated
 * @date 2026-11-09
 */
"use client";

import { PhoneNumber } from "@vxture/design-system";
import { formatPhoneForDisplay } from "@vxture/core-utils/phone";
import { useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  Popover,
  PopoverTrigger,
  ShellPanelContent,
  ShellPanelHeader,
  ShellPanelRow,
  ShellPanelSection,
  StatusBadge,
} from "@vxture/design-system";

// ============================================================================
// Identity projection
// ============================================================================

export interface AccountsMenuUser {
  identityKey: string;
  displayName: string;
  account: string;
  avatarSrc?: string | undefined;
  phone?: string | null;
  email?: string | null;
}

// ============================================================================
// Shared account panel
// ============================================================================

/**
 * Render the authenticated identity and only its account-level actions.
 * @param props - The current realm's identity and profile destination.
 * @returns A keyboard-accessible avatar popover.
 */
export function AccountsUserMenu({
  user,
  realm,
  profileHref,
}: {
  user: AccountsMenuUser;
  realm: "customer" | "workforce";
  profileHref: string;
}) {
  const t = useTranslations("accountsUi.userMenu");
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const keyboardOpening = useRef(false);
  const content = useRef<HTMLDivElement>(null);
  const initial =
    Array.from(user.displayName.trim())[0]?.toLocaleUpperCase() || "?";
  const phone = user.phone ? formatPhoneForDisplay(user.phone) : null;
  const avatar = (
    <Avatar key={user.avatarSrc || "default"} className="size-icon-xl">
      {user.avatarSrc ? (
        <AvatarImage src={user.avatarSrc} alt={user.displayName} />
      ) : null}
      <AvatarFallback delayMs={0}>{initial}</AvatarFallback>
    </Avatar>
  );

  function signOut() {
    if (leaving) return;
    setLeaving(true);
    // A top-level navigation carries the IdP's SameSite=Lax session cookie.
    const base =
      process.env.NEXT_PUBLIC_OIDC_API_BASE ?? "http://localhost:3081";
    const destination = new URL(
      `${base}/oidc/end_session`,
      window.location.origin,
    );
    destination.searchParams.set("client_id", `accounts-self:${realm}`);
    window.location.assign(destination.toString());
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon-md"
          className="size-icon-xl rounded-full p-0"
          aria-label={t("open")}
          title={t("open")}
          onClick={(event) => {
            keyboardOpening.current = event.detail === 0;
          }}
        >
          {avatar}
        </Button>
      </PopoverTrigger>
      <ShellPanelContent
        ref={content}
        align="end"
        sideOffset={10}
        className="accounts-user-panel"
        aria-label={t("open")}
        onOpenAutoFocus={() => {
          // Preserve pointer focus while allowing keyboard entry into the portal.
          if (keyboardOpening.current)
            content.current?.querySelector<HTMLAnchorElement>("a")?.focus();
        }}
      >
        <ShellPanelHeader
          avatarSrc={user.avatarSrc}
          avatarAlt={user.displayName}
          avatarFallback={initial}
          title={user.displayName}
          titleAside={
            <StatusBadge tone="neutral">{t("realNameUnverified")}</StatusBadge>
          }
          metaRows={[
            {
              key: "phone",
              content: phone ? (
                <PhoneNumber {...phone} />
              ) : user.phone === null ? (
                t("phoneNotBound")
              ) : (
                t("contactUnavailable")
              ),
            },
            {
              key: "email",
              content:
                user.email ||
                (user.email === null
                  ? t("emailNotBound")
                  : t("contactUnavailable")),
            },
          ]}
        />
        <ShellPanelSection>
          <ShellPanelRow
            icon="user"
            label={t("profile")}
            href={profileHref}
            linkComponent={Link}
            onClick={() => setOpen(false)}
          />
          <ShellPanelRow
            icon="sign-out"
            label={leaving ? t("signingOut") : t("signOut")}
            danger
            disabled={leaving}
            chevron={false}
            onClick={signOut}
          />
        </ShellPanelSection>
      </ShellPanelContent>
    </Popover>
  );
}
