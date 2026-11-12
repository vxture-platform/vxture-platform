/**
 * Shared Accounts chrome for authentication and self-service pages.
 * @package @vxture/accounts
 * @layer Presentation
 * @category component
 * @author AI-Generated
 * @date 2026-11-07
 */
"use client";

import { LOCALE_CONFIGS, SUPPORTED_LOCALES } from "@vxture-platform/shared";
import type { ReactNode } from "react";
import { AccountsUserMenu, type AccountsMenuUser } from "./AccountsUserMenu";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { setAccountsLocale } from "@/lib/locale-preference";
import {
  Button,
  Icon,
  ShellIconGroup,
  ShellBrand,
  ShellHeader,
  ShellFooter,
  ShellHeaderActions,
  ShellIconButton,
  useTheme,
  ShellLocaleSwitcher,
} from "@vxture/design-system";

// ============================================================================
// Shared header and footer
// ============================================================================

type AccountsChromeLayout = "public" | "account";

/** Render the stationary brand and utility controls without exposing another realm. */
export function AccountsHeader({
  navigation,
  accountHref,
  accountUser,
  realm,
  brandLabel = "Vxture Accounts",
  layout = "public",
}: {
  navigation?: ReactNode;
  accountHref?: string;
  accountUser?: AccountsMenuUser | null;
  realm?: "customer" | "workforce";
  brandLabel?: ReactNode;
  layout?: AccountsChromeLayout;
}) {
  const t = useTranslations("accountsUi");
  const { theme, toggle } = useTheme();
  const locale = useLocale();
  const router = useRouter();
  function changeLocale(value: string) {
    if (value !== "zh-CN" && value !== "en-US") return;
    setAccountsLocale(value);
    router.refresh();
  }
  return (
    <>
      <ShellHeader
        height={layout === "account" ? "lg" : "xl"}
        surface="transparent"
        layout={layout === "public" ? "centered" : "full"}
        className={`accounts-header accounts-header-${layout}`}
        leading={
          <>
            {navigation}
            <ShellBrand
              href="/"
              logoSrc="/brand/vxture-logo-icon.svg"
              label={
                brandLabel === "Vxture Accounts" ? (
                  <>
                    <span className="text-primary-text">Vxture</span>
                    <span className="hidden sm:inline"> Accounts</span>
                  </>
                ) : (
                  brandLabel
                )
              }
            />
          </>
        }
        trailing={
          <ShellHeaderActions>
            <ShellIconGroup label={t("tools")}>
              <ShellIconButton
                label={t("theme")}
                icon={theme === "dark" ? "sun" : "moon"}
                onClick={toggle}
              />
              <ShellLocaleSwitcher
                currentLocale={locale}
                options={SUPPORTED_LOCALES.map((code) => LOCALE_CONFIGS[code])}
                buttonLabel={t("language")}
                panelLabel={t("language")}
                onLocaleChange={changeLocale}
              />
              <Button
                variant="ghost"
                size="icon-md"
                className="size-icon-xl shrink-0 p-0 text-muted-foreground hover:text-foreground"
                aria-label={t("help")}
                title={t("help")}
                asChild
              >
                <a
                  href={`${process.env.NEXT_PUBLIC_WEBSITE_URL || "https://vxture.com"}/docs`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Icon name="help" size="sm" />
                </a>
              </Button>
            </ShellIconGroup>
            {accountHref && accountUser && realm ? (
              <AccountsUserMenu
                user={accountUser}
                realm={realm}
                profileHref={accountHref}
              />
            ) : null}
          </ShellHeaderActions>
        }
      />
    </>
  );
}

/** Keep legal navigation outside the scrolling page content. */
export function AccountsFooter({
  layout = "public",
}: {
  layout?: AccountsChromeLayout;
}) {
  const locale = useLocale();
  const t = useTranslations("accountsUi");
  const website = process.env.NEXT_PUBLIC_WEBSITE_URL || "https://vxture.com";
  return (
    <ShellFooter
      layout={layout === "public" ? "centered" : "full"}
      legal={{
        copyright: {
          href: `${website}/${locale}/legal/copyright`,
          label: t("copyright"),
          year: new Date().getFullYear(),
          owner: "Vxture Studio",
        },
        terms: { href: `${website}/${locale}/legal/terms`, label: t("terms") },
        privacy: {
          href: `${website}/${locale}/legal/privacy`,
          label: t("privacy"),
        },
        navigationLabel: t("legal"),
      }}
    />
  );
}
