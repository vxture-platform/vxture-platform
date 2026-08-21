/**
 * Header.tsx - 网站全局顶部导航栏
 *
 * Presentation Layer - Component
 *
 * 职责：
 * - 展示网站全局导航栏 UI
 * - 使用 src/data/header.data.ts 获取结构数据
 * - 使用 next-intl 进行翻译
 *
 * @layer Presentation
 * @category Components - Layout
 * @author AI-Generated
 * @date 2026-03-18
 */
"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale as useNextIntlLocale, useTranslations } from "next-intl";
import Image from "next/image";
import {
  ShellFullscreenToggle,
  ShellLocaleSwitcher,
  ShellPanelSlots,
  ShellPreferencePanel,
  ShellThemeToggle,
  ShellUserMenu,
  useTheme,
} from "@vxture/design-system";
import type {
  Density,
  ShellFontSizePreference,
  ShellThemePreference,
} from "@vxture/design-system";
import { HEADER_DATA } from "@/data/layout/header.data";
import { useAuthStore } from "@/stores/auth.store";
import { Link, usePathname, useRouter } from "@/lib/i18n/navigation";
import {
  buildConsoleEntryUrl,
  buildConsoleProfileUrl,
} from "@/lib/console-entry";
import { buildLogoutUrl, buildSwitchUserUrl } from "@/api/auth.api";
import type { UserInfo } from "@/types/auth.types";
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from "@vxture/shared";
import type { Locale } from "@vxture/shared";
import {
  getGuestPreferences,
  setGuestPreferences,
  type ThemePreference,
} from "@/data/user/mock-user-preferences";
import {
  setGlobalDensityPreference,
  setGlobalLocalePreference,
  setGlobalThemePreference,
} from "@vxture/platform-browser";

const PAGE_FULLSCREEN_ID = "page-root-native";

function getDisplayName(user: UserInfo, fallback: string): string {
  return (
    user.displayName?.trim() ||
    user.username?.trim() ||
    user.name?.trim() ||
    fallback
  );
}

/**
 * Strip the China country code (+86 / 86) so Chinese users see the bare 11-digit
 * mobile number. Non-Chinese formats are returned untouched.
 */
function formatPhone(phone: string): string {
  const compact = phone.replace(/[\s-]/g, "");
  const national = compact.replace(/^\+?86/, "");
  if (/^1\d{10}$/.test(national)) return national;
  return phone.trim();
}

function isThemePreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

function isDensity(value: unknown): value is Density {
  return value === "compact" || value === "default" || value === "comfortable";
}

function hasOrganizationVerification(user: UserInfo): boolean {
  return (
    user.organizationVerified === true ||
    Boolean(user.organizationName) ||
    user.tenantType === "company" ||
    user.tenantType === "organization"
  );
}

function hasPersonalVerification(user: UserInfo): boolean {
  if (typeof user.personalVerified === "boolean") {
    return user.personalVerified;
  }

  return !hasOrganizationVerification(user);
}

function HeaderThemeToggle() {
  const t = useTranslations("layout.header.theme");
  const { theme, setTheme } = useTheme();
  const isDark = theme === "dark";
  const nextTheme: ThemePreference = isDark ? "light" : "dark";

  return (
    <ShellThemeToggle
      currentTheme={theme}
      buttonLabel={t("switchTo", { theme: t(nextTheme) })}
      onThemeChange={(value) => {
        setTheme(value);
        setGlobalThemePreference(value);
      }}
    />
  );
}

function HeaderLocaleSelect() {
  const t = useTranslations("layout.header");
  const currentLocale = useNextIntlLocale() as Locale;
  const router = useRouter();
  const pathname = usePathname();
  const locale = SUPPORTED_LOCALES.includes(currentLocale)
    ? currentLocale
    : DEFAULT_LOCALE;

  const handleLocaleChange = (nextLocale: Locale) => {
    setGlobalLocalePreference(nextLocale);
    setGuestPreferences({ locale: nextLocale });
    router.push(pathname, { locale: nextLocale });
  };

  return (
    <ShellLocaleSwitcher
      currentLocale={locale}
      buttonLabel={t("language.title")}
      onLocaleChange={(next) => handleLocaleChange(next as Locale)}
    />
  );
}

function HeaderFullscreenToggle() {
  return (
    <ShellFullscreenToggle
      targetId={PAGE_FULLSCREEN_ID}
      enterLabel="显示器全屏"
      exitLabel="退出显示器全屏"
    />
  );
}

function HeaderQuickTools() {
  return (
    <div className="flex items-center gap-1">
      <HeaderThemeToggle />
      <HeaderLocaleSelect />
      <HeaderFullscreenToggle />
    </div>
  );
}

function UserMenu({
  user,
  locale,
  disabled,
  onSwitchUser,
  onSignOut,
}: {
  user: UserInfo;
  locale: string;
  disabled: boolean;
  onSwitchUser: () => Promise<void>;
  onSignOut: () => Promise<void>;
}) {
  const t = useTranslations("layout.header.userMenu");
  const router = useRouter();
  const pathname = usePathname();
  const { theme, setTheme, density, setDensity, fontSize, setFontSize } =
    useTheme();

  const initialPrefs = useMemo(() => getGuestPreferences(), []);
  const [themePref, setThemePrefState] = useState<ThemePreference>(
    isThemePreference(initialPrefs.theme)
      ? initialPrefs.theme
      : isThemePreference(theme)
        ? theme
        : "system",
  );
  const [selectedDensity, setSelectedDensity] = useState<Density>(
    isDensity(initialPrefs.density) ? initialPrefs.density : density,
  );
  const [selectedLocale, setSelectedLocale] = useState<Locale>(
    (initialPrefs.locale as Locale | undefined) ||
      (locale as Locale) ||
      DEFAULT_LOCALE,
  );

  useEffect(() => {
    setSelectedLocale(locale as Locale);
  }, [locale]);

  const displayName = getDisplayName(user, t("unnamed"));
  const rawPhone = user?.phone?.trim() ?? "";
  const userPhone = rawPhone ? formatPhone(rawPhone) : "";
  const userEmail = user?.email?.trim() ?? "";
  const verified =
    hasPersonalVerification(user) || hasOrganizationVerification(user);
  const avatarSrc = user?.picture?.trim() || undefined;

  const setLangPref = (next: Locale) => {
    setSelectedLocale(next);
    setGuestPreferences({ locale: next });
    setGlobalLocalePreference(next);
    router.push(pathname, { locale: next });
  };
  const setThemePref = (next: ShellThemePreference) => {
    setThemePrefState(next as ThemePreference);
    setTheme(next);
    setGuestPreferences({ theme: next as ThemePreference });
    setGlobalThemePreference(next as ThemePreference);
  };
  const setDensityPref = (next: Density) => {
    setSelectedDensity(next);
    setDensity(next);
    setGuestPreferences({ density: next });
    setGlobalDensityPreference(next);
  };

  return (
    <ShellUserMenu
      openLabel={t("open")}
      user={{
        displayName,
        ...(avatarSrc ? { avatarSrc } : {}),
        avatarAlt: displayName,
        // 联系方式两行（owner 2026-08-18 判）：缺失走「名称+值」占位骨架、值
        // 空缺（"手机号："后面空着 = 该补了）；有值只显真值本身，不带名称前缀。
        // 同一行永远不会出现「名称: 真值」的组合。
        uniqueLine: userPhone || t("phonePlaceholder"),
        meta: userEmail || t("emailPlaceholder"),
        ...(verified
          ? {
              statusTag: { label: t("authStatus.verified"), verified: true },
            }
          : {}),
      }}
      extras={
        <ShellPanelSlots
          label={t("slots.title")}
          leadIcon="medal"
          lead="row"
          slots={[
            {
              key: "personal",
              icon: "user",
              label: t("badges.personal"),
              earned: hasPersonalVerification(user),
            },
            {
              key: "organization",
              icon: "buildings",
              label: t("badges.organization"),
              earned: hasOrganizationVerification(user),
            },
            // 等级体系尚未产出真实数据，槽位保留但不点亮——与 console 同判。
            { key: "level", icon: "star", label: t("slots.locked") },
            { key: "slot-4", icon: "medal", label: t("slots.locked") },
          ]}
        />
      }
      links={[
        {
          key: "profile",
          label: t("profileLink"),
          href: buildConsoleProfileUrl(locale),
          icon: "user",
          newTab: true,
        },
      ]}
      settings={
        <ShellPreferencePanel
          locale={selectedLocale}
          localeOptions={[
            { locale: "zh-CN", nativeName: "简体中文" },
            { locale: "en-US", nativeName: "English" },
          ]}
          theme={themePref as ShellThemePreference}
          density={selectedDensity}
          fontSize={fontSize as ShellFontSizePreference}
          labels={{
            title: t("settings.title"),
            themeOptions: {
              system: t("settings.theme.system"),
              light: t("settings.theme.light"),
              dark: t("settings.theme.dark"),
            },
            densityOptions: {
              compact: t("settings.density.compact"),
              default: t("settings.density.default"),
              comfortable: t("settings.density.comfortable"),
            },
            fontSizeOptions: {
              small: t("settings.fontSize.small"),
              default: t("settings.fontSize.default"),
              large: t("settings.fontSize.large"),
            },
          }}
          onLocaleChange={(next) => setLangPref(next as Locale)}
          onThemeChange={setThemePref}
          onDensityChange={setDensityPref}
          onFontSizeChange={setFontSize}
        />
      }
      actions={[
        {
          key: "switch-user",
          label: t("switchUser"),
          icon: "user-switch",
          disabled,
          onClick: onSwitchUser,
        },
        {
          key: "sign-out",
          label: t("signOut"),
          icon: "sign-out",
          danger: true,
          disabled,
          onClick: onSignOut,
        },
      ]}
    />
  );
}

/**
 * Header 组件
 *
 * 主题颜色说明：
 * - Light 模式：背景为浅蓝色，文字统一用 DS text token，
 *   与其他 section 保持一致；滚动前后颜色不变
 * - Dark 模式：背景为深灰色，文字统一用 DS text token，
 *   与其他 section 保持一致
 * - 不使用 useTheme() 做 className 拼接，避免 SSR hydration mismatch
 */
export default function Header() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [hasMounted, setHasMounted] = useState(false);
  const t = useTranslations("layout.header");
  const locale = useNextIntlLocale();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const isLoading = useAuthStore((state) => state.isLoading);
  const user = useAuthStore((state) => state.user);
  const consoleUrl = buildConsoleEntryUrl(locale);

  // ----------------------------------------------------------------------------
  // 监听滚动
  // ----------------------------------------------------------------------------

  useEffect(() => {
    setHasMounted(true);

    const handleScroll = () => {
      setIsScrolled(window.scrollY > 50);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // RP-initiated single-logout: top-level navigate to the website-bff entry, which
  // kills the central session (vx_sid) at the IdP, back-channel-logs-out every RP
  // (console included), then lands on the unified accounts post-logout page. Both
  // must end the central session first — under SSO a local-only logout would be
  // silently re-established. identity-platform-access-topology.md §5.
  // - Switch user → /auth/switch → accounts login form (sign in as someone else).
  // - Sign out    → /auth/logout → vxture.com home (website is a HOME client).
  const handleSwitchUser = async () => {
    window.location.assign(buildSwitchUserUrl());
  };
  const handleSignOut = async () => {
    window.location.assign(buildLogoutUrl());
  };

  // ----------------------------------------------------------------------------
  // 渲染
  // ----------------------------------------------------------------------------

  // 禁止渲染：如果内容被禁用，不渲染
  if (!HEADER_DATA.enabled) {
    return null;
  }

  const guestActions = HEADER_DATA.actions;
  const consoleLabel = t("actions.console");
  const isSessionSettling =
    !hasMounted || (isLoading && !isAuthenticated && !user);

  return (
    <header
      className={`fixed w-full top-0 z-50 transition-all duration-300 ${
        isScrolled
          ? "bg-vx-brand-50/80 dark:bg-vx-gray-800/80 backdrop-blur-md shadow-lg"
          : "bg-transparent"
      }`}
    >
      <div className="max-w-7xl xl:max-w-screen-2xl 2xl:max-w-400 mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Logo */}
          <Link
            href={HEADER_DATA.logo.href}
            aria-label={t(HEADER_DATA.logo.labelKey)}
            className="shrink-0 flex items-center space-x-2 rounded-md transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vx-ring-strong focus-visible:ring-offset-2 focus-visible:ring-offset-transparent"
          >
            <Image
              src={HEADER_DATA.logo.image}
              alt={t(HEADER_DATA.logo.altKey)}
              width={24}
              height={24}
              className="object-contain"
            />
            {/* 品牌字标走 font-brand（Funnel Display）——原挂的 .logo-text 类
             * 全仓无定义，一直以默认正文字体渲染。 */}
            <h1 className="font-brand text-2xl font-semibold text-vx-gray-800 dark:text-vx-text-secondary">
              {t(HEADER_DATA.logo.labelKey)}
            </h1>
          </Link>

          {/* Navigation */}
          <nav className="hidden md:flex space-x-8">
            {HEADER_DATA.nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="transition-colors duration-300 text-vx-gray-800 dark:text-vx-text-secondary font-medium hover:text-vx-info dark:hover:text-vx-info"
              >
                {t(item.labelKey)}
              </Link>
            ))}
          </nav>

          {/* 工具栏：访客设置 / CTA / 登录用户入口 */}
          <div className="flex items-center gap-4">
            <HeaderQuickTools />

            {/* 已登录：进入控制台 + 用户菜单 */}
            {isAuthenticated ? (
              <>
                <a
                  href={consoleUrl}
                  title={consoleLabel}
                  className="text-sm font-medium text-vx-gray-700 transition-colors duration-200 hover:text-vx-primary focus-visible:outline-none dark:text-vx-text-secondary dark:hover:text-vx-brand-300"
                >
                  {consoleLabel}
                </a>
                {user ? (
                  <UserMenu
                    user={user}
                    locale={locale}
                    disabled={isLoading}
                    onSwitchUser={handleSwitchUser}
                    onSignOut={handleSignOut}
                  />
                ) : null}
              </>
            ) : (
              /* 访客 CTA：会话稳定期保留占位（invisible）防止布局跳动 */
              <div
                className={`flex items-center gap-2 ${isSessionSettling ? "invisible" : ""}`}
                aria-hidden={isSessionSettling ? "true" : undefined}
              >
                {guestActions.map((action) => (
                  <Link
                    // 用 labelKey 而不是 href 做键：注册与登录当前都指向
                    // /signin（同一个入口页的两个 CTA），拿 href 当键会撞成
                    // 同一个 key，React 报重复键并可能丢掉其中一个按钮。
                    key={action.labelKey}
                    href={action.href}
                    className={
                      action.variant === "secondary"
                        ? "w-20 px-4 py-2 rounded-lg transition-all duration-300 text-center text-vx-gray-700 dark:text-vx-text-secondary font-semibold hover:text-vx-gray-900 dark:hover:text-vx-white"
                        : "w-28 px-6 py-2 bg-linear-to-r from-vx-info-500 to-vx-brand-600 text-vx-white rounded-lg hover:from-vx-info-600 hover:to-vx-brand-700 transition-all duration-300 shadow-lg hover:shadow-xl text-center"
                    }
                  >
                    {t(action.labelKey)}
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
