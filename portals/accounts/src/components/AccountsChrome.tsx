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
import { AccountsUserMenu, type AccountsMenuUser } from "./AccountsUserMenu";
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
    document.cookie = `NEXT_LOCALE=${value}; Path=/; Max-Age=31536000; SameSite=Lax`;
    router.refresh();
  }
  return (
    <>
      <div className="accounts-background-art" aria-hidden="true">
        <svg
          focusable="false"
          viewBox="0 0 1600 650"
          preserveAspectRatio="xMidYMax slice"
          fill="none"
        >
          <defs>
            <linearGradient
              id="accounts-bg-ribbon-front"
              x1="130"
              y1="280"
              x2="650"
              y2="600"
              gradientUnits="userSpaceOnUse"
            >
              <stop stopColor="var(--card)" stopOpacity=".8" />
              <stop
                offset=".35"
                stopColor="var(--primary)"
                stopOpacity=".075"
              />
              <stop offset=".65" stopColor="var(--info)" stopOpacity=".095" />
              <stop offset="1" stopColor="var(--card)" stopOpacity=".65" />
            </linearGradient>
            <linearGradient
              id="accounts-bg-ribbon-back"
              x1="180"
              y1="570"
              x2="580"
              y2="250"
              gradientUnits="userSpaceOnUse"
            >
              <stop stopColor="var(--primary)" stopOpacity=".04" />
              <stop offset=".48" stopColor="var(--primary)" stopOpacity=".11" />
              <stop offset="1" stopColor="var(--info)" stopOpacity=".03" />
            </linearGradient>
            <linearGradient
              id="accounts-bg-rim"
              x1="140"
              y1="270"
              x2="680"
              y2="600"
              gradientUnits="userSpaceOnUse"
            >
              <stop stopColor="var(--primary)" stopOpacity=".03" />
              <stop offset=".35" stopColor="var(--primary)" stopOpacity=".22" />
              <stop offset=".65" stopColor="var(--info)" stopOpacity=".14" />
              <stop offset="1" stopColor="var(--primary)" stopOpacity="0" />
            </linearGradient>
            <radialGradient id="accounts-bg-aura">
              <stop stopColor="var(--primary)" stopOpacity=".11" />
              <stop offset="1" stopColor="var(--primary)" stopOpacity="0" />
            </radialGradient>
            <linearGradient
              id="accounts-bg-trail"
              x1="0"
              y1="630"
              x2="1600"
              y2="380"
              gradientUnits="userSpaceOnUse"
            >
              <stop stopColor="var(--primary)" stopOpacity="0" />
              <stop offset=".32" stopColor="var(--primary)" stopOpacity=".1" />
              <stop offset=".7" stopColor="var(--info)" stopOpacity=".075" />
              <stop offset="1" stopColor="var(--primary)" stopOpacity="0" />
            </linearGradient>
            <filter id="accounts-bg-soft">
              <feGaussianBlur stdDeviation="16" />
            </filter>
            <linearGradient
              id="accounts-bg-work-flow"
              x1="0"
              y1="850"
              x2="1400"
              y2="540"
              gradientUnits="userSpaceOnUse"
            >
              <stop stopColor="var(--primary)" stopOpacity="0" />
              <stop offset=".3" stopColor="var(--primary)" stopOpacity=".16" />
              <stop offset=".6" stopColor="var(--info)" stopOpacity=".12" />
              <stop offset="1" stopColor="var(--primary)" stopOpacity="0" />
            </linearGradient>
            <linearGradient
              id="accounts-bg-work-edge"
              x1="200"
              y1="650"
              x2="980"
              y2="850"
              gradientUnits="userSpaceOnUse"
            >
              <stop stopColor="var(--primary)" stopOpacity=".05" />
              <stop offset=".4" stopColor="var(--primary)" stopOpacity=".4" />
              <stop offset="1" stopColor="var(--info)" stopOpacity="0" />
            </linearGradient>
          </defs>

          <g transform="translate(0 -400)">
            <g opacity=".55">
              <path
                d="M-200 990C100 1020 260 715 610 698S1080 810 1410 520L1750 470C1300 1030 995 840 650 785S120 1170-200 1090Z"
                fill="url(#accounts-bg-work-flow)"
              />
              <path
                d="M-200 990C100 1020 260 715 610 698S1080 810 1410 520"
                stroke="url(#accounts-bg-work-edge)"
                strokeWidth="1.2"
              />
              <path
                d="M-100 1040C210 1060 330 792 670 766S1130 870 1510 550"
                stroke="url(#accounts-bg-work-edge)"
                strokeWidth=".7"
                opacity=".5"
              />
            </g>
          </g>
          <g
            fill="none"
            stroke="var(--primary)"
            strokeWidth=".9"
            strokeOpacity=".2"
          >
            <path d="M640 438L700 403L760 438L700 473Z" />
            <path d="M650 438L700 409L750 438L700 467Z" strokeOpacity=".1" />
          </g>
          <g transform="translate(300 255)" opacity=".65">
            <defs>
              <linearGradient
                id="accounts-bg-device-glass"
                x1="0"
                y1="0"
                x2="1"
                y2="1"
              >
                <stop stopColor="var(--card)" stopOpacity=".85" />
                <stop offset="1" stopColor="var(--primary)" stopOpacity=".07" />
              </linearGradient>
              <linearGradient
                id="accounts-bg-device-line"
                x1="0"
                y1="0"
                x2="1"
                y2="1"
              >
                <stop stopColor="var(--primary)" stopOpacity=".22" />
                <stop offset="1" stopColor="var(--info)" stopOpacity=".09" />
              </linearGradient>
            </defs>
            <g transform="matrix(.94 .12 -.22 .88 0 0)">
              <rect
                x="12"
                y="12"
                width="250"
                height="160"
                rx="12"
                fill="url(#accounts-bg-device-glass)"
                stroke="url(#accounts-bg-device-line)"
                strokeWidth="1.8"
              />
              <rect
                x="24"
                y="25"
                width="226"
                height="133"
                rx="5"
                stroke="url(#accounts-bg-device-line)"
                strokeWidth=".8"
              />
              <path
                d="M-8 180H282L264 194H12Z"
                fill="url(#accounts-bg-device-glass)"
                stroke="url(#accounts-bg-device-line)"
                strokeWidth="1.2"
              />
              <path
                d="M108 181H166L162 185H112Z"
                fill="var(--primary)"
                fillOpacity=".07"
              />
              <circle
                cx="137"
                cy="86"
                r="22"
                stroke="url(#accounts-bg-device-line)"
              />
              <circle
                cx="137"
                cy="79"
                r="6"
                stroke="url(#accounts-bg-device-line)"
              />
              <path
                d="M126 98C126 86 148 86 148 98"
                stroke="url(#accounts-bg-device-line)"
              />
            </g>
            <path
              d="M244 179C286 178 277 106 315 105M165 214C205 247 305 245 346 212"
              stroke="url(#accounts-bg-device-line)"
              strokeWidth="1.2"
              strokeDasharray="3 6"
            />
            <g transform="matrix(.94 .12 -.22 .88 285 68)">
              <rect
                width="112"
                height="152"
                rx="11"
                fill="url(#accounts-bg-device-glass)"
                stroke="url(#accounts-bg-device-line)"
                strokeWidth="1.5"
              />
              <rect
                x="9"
                y="12"
                width="94"
                height="124"
                rx="4"
                stroke="url(#accounts-bg-device-line)"
                strokeWidth=".7"
              />
              <circle
                cx="56"
                cy="143"
                r="2"
                fill="var(--primary)"
                fillOpacity=".15"
              />
              <path
                d="M41 68L52 79L73 56"
                stroke="url(#accounts-bg-device-line)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </g>
            <g transform="matrix(.94 .12 -.22 .88 245 157)">
              <rect
                width="60"
                height="108"
                rx="10"
                fill="url(#accounts-bg-device-glass)"
                stroke="url(#accounts-bg-device-line)"
                strokeWidth="1.5"
              />
              <rect
                x="5"
                y="6"
                width="50"
                height="95"
                rx="6"
                stroke="url(#accounts-bg-device-line)"
                strokeWidth=".65"
              />
              <path
                d="M23 11H37M22 92H38M20 49L28 57L42 41"
                stroke="url(#accounts-bg-device-line)"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </g>
            <circle
              cx="267"
              cy="125"
              r="4"
              fill="var(--primary)"
              fillOpacity=".1"
            />
          </g>
        </svg>
      </div>
      <header className={`accounts-header accounts-header-${layout}`}>
        <div className="accounts-header-inner">
          {navigation}
          <Link
            href="/"
            className="accounts-brand"
            aria-label="Vxture Accounts"
          >
            {/* The approved brand asset is served by this portal. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/vxture-logo-icon.svg"
              alt=""
              width={28}
              height={28}
            />
            <span>
              {brandLabel === "Vxture Accounts" ? (
                <>
                  <span className="accounts-brand-name">Vxture</span>
                  <span className="accounts-brand-product"> Accounts</span>
                </>
              ) : (
                brandLabel
              )}
            </span>
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
              <Button
                variant="ghost"
                size="icon-md"
                aria-label={t("help")}
                title={t("help")}
                className="text-muted-foreground hover:text-foreground"
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
          </div>
        </div>
      </header>
    </>
  );
}

/** Keep legal navigation outside the scrolling page content. */
export function AccountsFooter({
  layout = "public",
}: {
  layout?: AccountsChromeLayout;
}) {
  const t = useTranslations("accountsUi");
  const website = process.env.NEXT_PUBLIC_WEBSITE_URL || "https://vxture.com";
  return (
    <footer className={`accounts-footer accounts-footer-${layout}`}>
      <div className="accounts-footer-inner">
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
      </div>
    </footer>
  );
}
