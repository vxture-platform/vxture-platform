"use client";

/**
 * Fixed workspace header built with the same DS chrome as Console.
 * @package @vxture/workbench
 * @layer Presentation
 * @category component
 * @author AI-Generated
 * @date 2026-11-05
 */
import Link from "next/link";
import { useSyncExternalStore } from "react";
import {
  ShellIconButton,
  ShellIconGroup,
  ShellPreferencePanel,
  ShellUserMenu,
  ShellFullscreenToggle,
  useTheme,
} from "@vxture/design-system";
import type { WorkData, WorkRuntime } from "../../lib/contracts";
import { authNavigation } from "../../lib/navigation";
import { buildConsoleEntry } from "../../lib/console-entry";
import { ScopeMenu } from "./ScopeMenu";

// ============================================================================
// Presentation composition
// ============================================================================
const subscribeHydration = (): (() => void) => () => undefined;

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
  pending = false,
}: {
  data: WorkData | null;
  apps: boolean;
  runtime: WorkRuntime;
  onHelp: () => void;
  pending?: boolean;
}): React.JSX.Element {
  const theme = useTheme();
  // Browser-stored theme preferences must not change the first hydration tree.
  const hydrated = useSyncExternalStore(
    subscribeHydration,
    () => true,
    () => false,
  );
  const consoleLink = (path: string): string =>
    data
      ? buildConsoleEntry(data, runtime.consoleUrl, path)
      : runtime.consoleUrl;
  const openConsole = (path: string): void => {
    window.open(consoleLink(path), "_blank", "noopener,noreferrer");
  };
  return (
    <header
      className={`work-header ${data || pending ? "" : "work-header-public"}`}
    >
      <div className="work-header-leading">
        <Link
          href="/"
          className="work-brand vx-brand-lockup"
          aria-label="Ruyin Work 首页"
        >
          {/* The same official mark and two-tone wordmark are used on both surfaces. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="vx-brand-mark"
            src="/brand/vxture-mark.png"
            alt=""
            width={24}
            height={24}
          />
          <span className="work-brand-name">
            <span>Ruyin</span> Work
          </span>
          {!data && !pending && (
            <span className="work-brand-caption">BUSINESS WORKSPACE</span>
          )}
        </Link>
        {data && <ScopeMenu data={data} runtime={runtime} />}
      </div>
      {(data || pending) && (
        <nav className="work-nav" aria-label="主导航">
          <Link href="/" aria-current={!apps ? "page" : undefined}>
            首页
          </Link>
          <Link href="/apps" aria-current={apps ? "page" : undefined}>
            应用中心
          </Link>
        </nav>
      )}
      <div className="work-header-tools">
        <ShellIconGroup label="显示、通知、帮助与控制台">
          <ShellIconButton
            icon={hydrated && theme.theme === "dark" ? "sun" : "moon"}
            label="切换主题"
            onClick={theme.toggle}
          />
          {data && (
            <ShellIconButton
              icon="bell"
              label="工作通知（新标签页）"
              onClick={() => openConsole("inbox")}
            />
          )}
          {!data && !pending && (
            <ShellFullscreenToggle
              targetId="workbench-root"
              enterLabel="全屏显示"
              exitLabel="退出全屏"
            />
          )}
          <ShellIconButton icon="help" label="使用帮助" onClick={onHelp} />
          {data && (
            <ShellIconButton
              icon="settings"
              label="管理控制台（新标签页）"
              onClick={() => openConsole("")}
            />
          )}
        </ShellIconGroup>
        {data && (
          <ShellUserMenu
            openLabel="账号信息"
            user={{
              displayName: data.user.name,
              avatarAlt: data.user.name,
              avatarSrc: data.user.picture ?? undefined,
              uniqueLine: data.user.phone || data.user.email || "账号信息",
              meta: data.user.email,
            }}
            links={[
              {
                key: "profile",
                label: "账号信息",
                href: consoleLink("profile"),
                icon: "user",
                newTab: true,
              },
            ]}
            settings={
              <ShellPreferencePanel
                locale="zh-CN"
                localeOptions={[{ locale: "zh-CN", nativeName: "简体中文" }]}
                theme={theme.mode}
                density={theme.density}
                fontSize={theme.fontSize}
                labels={{
                  title: "偏好设置",
                  locale: "语言",
                  theme: "主题",
                  density: "密度",
                  fontSize: "文字大小",
                  themeOptions: { system: "系统", light: "亮色", dark: "暗色" },
                  densityOptions: {
                    compact: "紧凑",
                    default: "默认",
                    comfortable: "宽松",
                  },
                  fontSizeOptions: {
                    small: "小",
                    default: "默认",
                    large: "大",
                  },
                }}
                onLocaleChange={() => undefined}
                onThemeChange={theme.setMode}
                onDensityChange={theme.setDensity}
                onFontSizeChange={theme.setFontSize}
              />
            }
            actions={[
              {
                key: "switch",
                label: "切换用户",
                icon: "user-switch",
                onClick: () =>
                  location.assign(authNavigation("switch", location.href)),
              },
              {
                key: "logout",
                label: "退出登录",
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
