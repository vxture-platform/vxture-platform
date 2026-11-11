"use client";

/**
 * Fixed workspace header built with the same DS chrome as Console.
 * @package @vxture/workbench
 * @layer Presentation
 * @category component
 * @author AI-Generated
 * @date 2026-11-05
 */
import { withLocalePreference } from "@vxture/platform-browser";
import { useWorkLocale, LOCALE_OPTIONS } from "../../lib/locale";
import Link from "next/link";
import Image from "next/image";
import { useSyncExternalStore } from "react";
import {
  ShellBrand,
  ShellIconButton,
  ShellIconGroup,
  ShellPreferencePanel,
  ShellPanelSlots,
  ShellUserMenu,
  ShellFullscreenToggle,
  ShellLocaleSwitcher,
  useTheme,
} from "@vxture/design-system";
import type { WorkData, WorkRuntime } from "../../lib/contracts";
import { authNavigation } from "../../lib/navigation";
import { buildConsoleEntry } from "../../lib/console-entry";
import { accountPhone } from "../../lib/presentation";
import { ScopeMenu } from "./ScopeMenu";

// ============================================================================
// Presentation composition
// ============================================================================
const subscribeHydration = (): (() => void) => () => undefined;
const ACCOUNTS_BASE = (
  process.env.NEXT_PUBLIC_ACCOUNTS_URL ??
  (process.env.NODE_ENV === "production"
    ? "https://accounts.vxture.com"
    : "http://localhost:3080")
)
  .trim()
  .replace(/\/+$/, "");

/**
 * Render one coordinated tool group and the account menu.
 * @param props - Current identity, route and help action.
 * @returns Fixed-height authenticated or login header chrome.
 */
export function WorkHeader({
  data,
  apps,
  runtime,
  onHelp,
  onNotifications,
  pending = false,
}: {
  data: WorkData | null;
  apps: boolean;
  runtime: WorkRuntime;
  onHelp: () => void;
  onNotifications: () => void;
  pending?: boolean;
}): React.JSX.Element {
  const { locale, t, changeLocale } = useWorkLocale();
  const theme = useTheme();
  // Browser-stored theme preferences must not change the first hydration tree.
  const hydrated = useSyncExternalStore(
    subscribeHydration,
    () => true,
    () => false,
  );
  const consoleLink = (path: string): string =>
    data
      ? buildConsoleEntry(data, runtime.consoleUrl, path, locale)
      : runtime.consoleUrl;
  const openConsole = (path: string): void => {
    window.open(consoleLink(path), "_blank", "noopener,noreferrer");
  };
  return (
    <header
      className={`work-header ${data || pending ? "" : "work-header-public"}`}
    >
      <div className="work-header-leading">
        {data || pending ? (
          <ShellBrand
            href="/"
            className="work-brand"
            logoSrc="/brand/vxture-mark.png"
            label={
              <>
                <span className="text-primary-text">Ruyin</span> Work
              </>
            }
          />
        ) : (
          <div className="vx-brand-lockup work-brand">
            <Image
              src="/brand/vxture-mark.png"
              width={24}
              height={24}
              alt=""
              className="vx-brand-mark"
              draggable={false}
              unoptimized
            />
            <span className="vx-brand-name">
              <span className="text-primary-text">Ruyin</span> Work
            </span>
            <span className="vx-brand-local-name">BUSINESS WORKSPACE</span>
          </div>
        )}
        {data && <ScopeMenu data={data} runtime={runtime} />}
      </div>
      {(data || pending) && (
        <nav className="work-nav" aria-label={t("主导航")}>
          <Link href="/" aria-current={!apps ? "page" : undefined}>
            {t("首页")}
          </Link>
          <Link href="/apps" aria-current={apps ? "page" : undefined}>
            {t("应用中心")}
          </Link>
        </nav>
      )}
      <div className="work-header-tools">
        <ShellIconGroup
          label={
            data || pending
              ? t("显示、通知、帮助与控制台")
              : t("主题、语言、全屏与主站")
          }
        >
          <ShellIconButton
            icon={hydrated && theme.theme === "dark" ? "sun" : "moon"}
            label={t("切换主题")}
            onClick={theme.toggle}
          />
          {data && (
            <ShellIconButton
              icon="bell"
              label={t("工作通知")}
              onClick={onNotifications}
            />
          )}
          {!data && !pending && (
            <>
              <ShellLocaleSwitcher
                currentLocale={locale}
                options={LOCALE_OPTIONS}
                buttonLabel={t("语言")}
                panelLabel={t("选择语言")}
                onLocaleChange={changeLocale}
              />
              <ShellFullscreenToggle
                targetId="workbench-root"
                enterLabel={t("全屏显示")}
                exitLabel={t("退出全屏")}
              />
              <ShellIconButton
                icon="home"
                label={t("VXTURE 主站（新标签页）")}
                onClick={() =>
                  window.open(
                    withLocalePreference(
                      new URL(`/${locale}`, runtime.websiteUrl).href,
                      locale,
                    ),
                    "_blank",
                    "noopener,noreferrer",
                  )
                }
              />
            </>
          )}
          {(data || pending) && (
            <ShellIconButton
              icon="help"
              label={t("使用帮助")}
              onClick={onHelp}
            />
          )}
          {data && (
            <ShellIconButton
              icon="settings"
              label={t("管理控制台（新标签页）")}
              onClick={() => openConsole("")}
            />
          )}
        </ShellIconGroup>
        {data && (
          <ShellUserMenu
            openLabel={t("账号信息")}
            user={{
              displayName: data.user.name,
              avatarAlt: data.user.name,
              avatarSrc: data.user.picture ?? undefined,
              uniqueLine: accountPhone(data.user.phone) || t("未绑定手机号"),
              meta: data.user.email,
            }}
            extras={
              <ShellPanelSlots
                label={t("用户等级")}
                leadIcon="medal"
                lead="row"
                slots={[
                  { key: "role", icon: "user", label: t("角色 · —") },
                  { key: "level", icon: "star", label: t("其他奖章 · 待解锁") },
                  {
                    key: "slot-3",
                    icon: "medal",
                    label: t("其他奖章 · 待解锁"),
                  },
                  {
                    key: "slot-4",
                    icon: "medal",
                    label: t("其他奖章 · 待解锁"),
                  },
                ]}
              />
            }
            links={[
              {
                key: "profile",
                label: t("账号中心"),
                href: withLocalePreference(`${ACCOUNTS_BASE}/account`, locale),
                icon: "user",
                newTab: true,
              },
            ]}
            settings={
              <ShellPreferencePanel
                locale={locale}
                localeOptions={LOCALE_OPTIONS}
                theme={theme.mode}
                density={theme.density}
                fontSize={theme.fontSize}
                labels={{
                  title: t("偏好设置"),
                  locale: t("语言"),
                  theme: t("主题"),
                  density: t("密度"),
                  fontSize: t("文字大小"),
                  themeOptions: {
                    system: t("系统"),
                    light: t("亮色"),
                    dark: t("暗色"),
                  },
                  densityOptions: {
                    compact: t("紧凑"),
                    default: t("默认"),
                    comfortable: t("宽松"),
                  },
                  fontSizeOptions: {
                    small: t("小"),
                    default: t("默认"),
                    large: t("大"),
                  },
                }}
                onLocaleChange={changeLocale}
                onThemeChange={theme.setMode}
                onDensityChange={theme.setDensity}
                onFontSizeChange={theme.setFontSize}
              />
            }
            actions={[
              {
                key: "switch",
                label: t("切换用户"),
                icon: "user-switch",
                onClick: () =>
                  location.assign(authNavigation("switch", location.href)),
              },
              {
                key: "logout",
                label: t("退出登录"),
                icon: "sign-out",
                danger: true,
                onClick: () =>
                  location.assign(authNavigation("logout", location.href)),
              },
            ]}
          />
        )}
      </div>
    </header>
  );
}
