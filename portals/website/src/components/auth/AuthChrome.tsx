/**
 * AuthChrome.tsx - website 认证面（set-nickname）的页眉 / 页脚。
 * @package @vxture/website
 *
 * 原先转发 design-system 的 AuthChromeHeader / AuthChromeFooter；那一族随
 * owner 2026-08-18 判迁出 DS（DS 只收通用、无业务含义的件），归 accounts，
 * 而门户间禁互引。这里用 DS 通用件（ShellBrand / ShellLocaleSwitcher /
 * ShellThemeToggle / ShellLegalFooter）就地组装同一副页眉页脚——版式与
 * accounts 认证面同款。
 */
"use client";

import { useLocale, useTranslations } from "next-intl";
import {
  ShellBrand,
  ShellLegalFooter,
  ShellLocaleSwitcher,
  ShellThemeToggle,
  useTheme,
} from "@vxture/design-system";
import {
  setGlobalLocalePreference,
  setGlobalThemePreference,
} from "@vxture/platform-browser";
import { HEADER_DATA } from "@/data/layout/header.data";
import { usePathname, useRouter } from "@/lib/i18n/navigation";
import type { Locale, Theme } from "@vxture-platform/shared";

export function AuthHeader() {
  const t = useTranslations("layout.header");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();

  return (
    <header className="w-full px-lg py-md">
      <div className="mx-auto flex w-full max-w-page-xl items-center justify-between gap-md">
        <ShellBrand
          href={HEADER_DATA.logo.href}
          logoSrc={HEADER_DATA.logo.image}
          logoAlt={t(HEADER_DATA.logo.altKey)}
          label={t(HEADER_DATA.logo.labelKey)}
        />

        <div className="flex items-center gap-xs">
          <ShellLocaleSwitcher
            currentLocale={locale}
            buttonLabel={t("language.title")}
            panelLabel={t("language.title")}
            onLocaleChange={(next) => {
              const nextLocale = next as Locale;
              setGlobalLocalePreference(nextLocale);
              router.replace(pathname, { locale: nextLocale });
            }}
          />
          <ShellThemeToggle
            currentTheme={theme}
            lightLabel={t("theme.light")}
            darkLabel={t("theme.dark")}
            onThemeChange={(nextTheme) => {
              setTheme(nextTheme);
              setGlobalThemePreference(nextTheme as Theme);
            }}
          />
        </div>
      </div>
    </header>
  );
}

export function AuthFooter() {
  const t = useTranslations("layout.footer");

  return (
    <ShellLegalFooter
      copyright={t("copyright.text")}
      links={[
        { href: "/legal/terms", label: t("legal.terms") },
        { href: "/legal/privacy", label: t("legal.privacy") },
        { href: "/legal/cookies", label: t("legal.cookies") },
      ]}
    />
  );
}
