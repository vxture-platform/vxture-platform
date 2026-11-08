/**
 * Shared Accounts chrome for authentication and self-service pages.
 * @package @vxture/accounts
 * @layer Presentation
 * @category component
 * @author AI-Generated
 * @date 2026-11-07
 */
"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import {
  Button,
  Icon,
  ShellIconGroup,
  ShellIconButton,
  useTheme,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@vxture/design-system";

// ============================================================================
// Shared header and footer
// ============================================================================

/** Render the stationary brand and utility controls without exposing another realm. */
export function AccountsHeader({
  navigation,
  accountHref,
  brandLabel = "Vxture Accounts",
}: {
  navigation?: ReactNode;
  accountHref?: string;
  brandLabel?: ReactNode;
}) {
  const t = useTranslations("accountsUi");
  const { theme, toggle } = useTheme();
  const locale = useLocale();
  const router = useRouter();
  function changeLocale(value: string) {
    if (value !== "zh-CN" && value !== "en-US") return;
    document.cookie = `NEXT_LOCALE=${value}; Path=/; Max-Age=31536000; SameSite=Lax`;
    router.refresh();
  }
  return (
    <header className="accounts-header">
      {navigation}
      <Link href="/" className="accounts-brand" aria-label="Vxture Accounts">
        {/* The approved brand asset is served by this portal. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/vxture-logo-icon.svg" alt="" width={28} height={28} />
        <span>{brandLabel}</span>
      </Link>
      <div className="accounts-header-end">
        <ShellIconGroup label={t("tools")} className="accounts-tools">
          <ShellIconButton
            label={t("theme")}
            icon={theme === "dark" ? "sun" : "moon"}
            onClick={toggle}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <ShellIconButton label={t("language")} icon="globe" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuRadioGroup
                value={locale}
                onValueChange={changeLocale}
              >
                <DropdownMenuRadioItem value="zh-CN">
                  简体中文
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="en-US">
                  English
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="ghost" size="icon-md" aria-label={t("help")} asChild>
            <a
              href={`${process.env.NEXT_PUBLIC_WEBSITE_URL || "https://vxture.com"}/docs`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Icon name="help" size="sm" />
            </a>
          </Button>
        </ShellIconGroup>
        {accountHref ? (
          <Button
            asChild
            variant="ghost"
            size="icon-md"
            className="accounts-header-avatar"
            aria-label={t("profile")}
          >
            <Link href={accountHref}>
              <Icon name="user" size="sm" />
            </Link>
          </Button>
        ) : null}
      </div>
    </header>
  );
}

/** Keep legal navigation outside the scrolling page content. */
export function AccountsFooter() {
  const t = useTranslations("accountsUi");
  const website = process.env.NEXT_PUBLIC_WEBSITE_URL || "https://vxture.com";
  return (
    <footer className="accounts-footer">
      <span>© {new Date().getFullYear()} Vxture Studio</span>
      <nav aria-label={t("legal")}>
        {(
          [
            ["terms", "/legal/terms"],
            ["privacy", "/legal/privacy"],
            ["copyright", "/legal/copyright"],
          ] as const
        ).map(([key, path]) => (
          <a
            key={key}
            href={`${website}${path}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t(key)}
          </a>
        ))}
      </nav>
    </footer>
  );
}
