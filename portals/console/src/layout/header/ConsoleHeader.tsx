"use client";

/**
 * ConsoleHeader — console 顶栏（DS 外壳部件重建）。
 *
 * 取代原 `TemplateHeader`：那份是设计稿 1:1 转写，整栏挂 `.vxh-*` 遗留类、
 * 图标走 Phosphor 字体、语言下拉是裸原生控件、分段是手搓 `.vxh-seg`，因此
 * 与 opera（全 DS）在字号、间距、圆角、hover 反馈上处处对不上。本文件改用与
 * opera 同一套部件，两个门户的顶栏由同一份实现产出，剩下的差别只有内容。
 *
 * 布局与 opera 逐槽对齐：
 *   leading  = launcher · 品牌 · 竖分隔 · 当前范围
 *   center   = 全局搜索（⌘K）
 *   trailing = [助手] gap-md [系统工具组] gap-md [账户]
 *
 * `shell-template/app.css` 里的 `.vxh-*` 规则不动——admin 仍在消费，console
 * 只是不再引用它们。跟上一轮侧栏迁移同一处理方式。
 */

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  ShellBrand,
  ShellHeader,
  ShellIconButton,
  ShellIconGroup,
  ShellLauncher,
  ShellPanelSlots,
  ShellPreferencePanel,
  ShellSearchBox,
  ShellUserMenu,
  useTheme,
  type ShellFontSizePreference,
  type ShellSearchGroup,
} from "@vxture/design-system";
import {
  setGlobalDensityPreference,
  setGlobalLocalePreference,
  setGlobalThemePreference,
} from "@vxture/platform-browser";
import type { Locale, Theme } from "@vxture-platform/shared";
import { usePathname, useRouter } from "@/lib/i18n/navigation";
import { useConsoleSession } from "@/features/session/ConsoleSessionProvider";
import { useTenant } from "@/features/tenant";
import {
  buildLogoutUrl,
  buildSwitchUrl,
  type ConsoleQuotaUsage,
} from "@/api/console-bff";
import type { ShellDrawerType, ShellView } from "../shell/types";
import { TenantPanel } from "./TenantPanel";
import { useGlobalSearch, type NavSearchEntry } from "./useGlobalSearch";

/**
 * 展示用手机号：存储值带 E.164 国家码（+8613800000000），面板里只给号码本身。
 * 只剥中国大陆的 +86——用户看到的是自己那串熟悉的 11 位数字，国家码在这个
 * 位置是噪音。其余国家码保留：把它们也剥掉会得到一串谁都认不出来的数字。
 */
function formatPhone(phone: string | null | undefined): string {
  if (!phone) return "";
  return phone.startsWith("+86") ? phone.slice(3) : phone;
}

export interface ConsoleHeaderViewOption {
  id: ShellView;
  name: string;
  desc: string;
  /** DS IconName（原实现存的是 Phosphor class 串，转换层已随之退役）。 */
  icon: Parameters<typeof ShellLauncher>[0]["items"][number]["icon"];
}

export interface ConsoleHeaderProps {
  view: ShellView;
  setView: (next: ShellView) => void;
  viewOptions: ConsoleHeaderViewOption[];
  openDrawer: (type: ShellDrawerType) => void;
  onNavigate: (href: string) => void;
  brandName: string;
  /** 侧栏导航项（已过 i18n 与授权过滤），作为搜索的"页面"来源。 */
  navEntries: readonly NavSearchEntry[];
  quotaUsage: ConsoleQuotaUsage | null;
  workspaceName: string | null;
  billingLabel: string;
  planName: string | null;
}

export function ConsoleHeader({
  view,
  setView,
  viewOptions,
  openDrawer,
  onNavigate,
  brandName,
  navEntries,
  quotaUsage,
  workspaceName,
  billingLabel,
  planName,
}: ConsoleHeaderProps) {
  const t = useTranslations("shell");
  const { session } = useConsoleSession();
  const { tenantList, switchTenantContext } = useTenant();
  const locale = useLocale() as Locale;
  const router = useRouter();
  const pathname = usePathname();
  const { theme, setTheme, density, setDensity, fontSize, setFontSize } =
    useTheme();
  const search = useGlobalSearch(navEntries);

  const user = session.user;
  const displayName = (
    user?.displayName ||
    user?.name ||
    user?.username ||
    "User"
  ).trim();

  /* 偏好三项都要**同时**写两处：useTheme 管当前文档的即时生效，
     platform-browser 的 setGlobal* 管跨门户持久化（同一账号在 admin/opera
     打开时沿用）。只写一处的话，切换在当前页有效、刷新或换门户后回退。 */
  const onLocaleChange = (next: Locale) => {
    setGlobalLocalePreference(next);
    router.replace(pathname, { locale: next });
  };
  const onThemeChange = (next: Parameters<typeof setTheme>[0]) => {
    setTheme(next);
    setGlobalThemePreference(next as Theme);
  };
  const onDensityChange = (next: Parameters<typeof setDensity>[0]) => {
    setDensity(next);
    setGlobalDensityPreference(next);
  };

  const searchGroups: ShellSearchGroup[] = useMemo(() => {
    const groups: ShellSearchGroup[] = [];
    if (search.navHits.length > 0) {
      groups.push({
        key: "pages",
        heading: t("search.groups.pages"),
        items: search.navHits.map((entry) => ({
          key: entry.href,
          label: entry.label,
          ...(entry.group ? { description: entry.group } : {}),
          icon: "arrow-long-right" as const,
          onSelect: () => {
            setView("console");
            onNavigate(entry.href);
          },
        })),
      });
    }
    // 后端按 kind 混在一个数组里返回，这里按 kind 分组——分组标题是展示文案，
    // 归前端的 i18n，后端不下发中文。
    for (const kind of ["member", "invoice"] as const) {
      const items = search.remoteHits.filter((hit) => hit.kind === kind);
      if (items.length === 0) continue;
      groups.push({
        key: kind,
        heading: t(`search.groups.${kind}`),
        items: items.map((hit) => ({
          key: hit.id,
          label: hit.label,
          ...(hit.description ? { description: hit.description } : {}),
          ...(hit.meta ? { meta: hit.meta } : {}),
          icon: kind === "member" ? ("user" as const) : ("receipt" as const),
          onSelect: () => {
            setView("console");
            onNavigate(hit.href);
          },
        })),
      });
    }
    return groups;
  }, [search.navHits, search.remoteHits, t, setView, onNavigate]);

  return (
    <ShellHeader
      height="lg"
      centerAlign="end"
      leading={
        <>
          <ShellLauncher
            items={viewOptions.map((option) => ({
              key: option.id,
              icon: option.icon,
              label: option.name,
              description: option.desc,
              active: option.id === view,
            }))}
            onSelect={(key) => setView(key as ShellView)}
            buttonLabel={t("featureBoards")}
          />
          <ShellBrand
            href="/"
            label={brandName}
            logoSrc="/brand/vxture-logo-white.png"
          />
          <span className="h-lg w-px bg-border" aria-hidden="true" />
          <TenantPanel
            tenant={session.tenant}
            workspaceName={workspaceName}
            quotaUsage={quotaUsage}
            billingLabel={billingLabel}
            planName={planName}
            tenantOptions={tenantList}
            onSwitchTenant={(id) => void switchTenantContext(id)}
            onNavigate={onNavigate}
            onBeforeNavigate={() => setView("console")}
          />
        </>
      }
      center={
        <ShellSearchBox
          query={search.query}
          onQueryChange={search.setQuery}
          groups={searchGroups}
          loading={search.loading}
          labels={{
            placeholder: t("searchPlaceholder"),
            empty: search.error ? t("search.error") : t("search.empty"),
            loading: t("search.loading"),
            resultsLabel: t("search.title"),
          }}
        />
      }
      trailing={
        // 三个板块（助手 / 系统工具组 / 账户）之间 gap-md，组内图标 gap-2xs：
        // 组间是板块边界，组内是同类项。与 opera 同一套间距。
        <div className="flex items-center gap-md">
          {/* Varda 助手入口已随独立仓迁出移除(2026-08-18),重构发包后恢复。 */}
          <ShellIconGroup label={t("settings")}>
            <ShellIconButton icon="help" label={t("help")} onClick={() => {}} />
            <ShellIconButton
              icon="bell"
              label={t("notifications")}
              onClick={() => openDrawer("notifications")}
            />
            <ShellIconButton
              icon="settings"
              label={t("settings")}
              onClick={() => {
                setView("console");
                onNavigate("/settings");
              }}
            />
          </ShellIconGroup>
          <ShellUserMenu
            openLabel={t("userMenu")}
            user={{
              displayName,
              ...(user?.picture ? { avatarSrc: user.picture } : {}),
              avatarAlt: displayName,
              // 手机号/邮箱缺失时给出明确文案而不是留白——留白读作"没这个字段"，
              // 缺失读作"该补了"，两者对用户的含义完全不同。
              uniqueLine: formatPhone(user?.phone) || t("missingPhone"),
              meta: user?.email || t("missingEmail"),
              statusTag: { label: t("verifyUnknown") },
            }}
            extras={
              <ShellPanelSlots
                label={t("slotLevel")}
                leadIcon="medal"
                // 槽位排紧接头部、讲的是同一个人，对齐到头部标题（显示名）那一列。
                lead="row"
                slots={[
                  {
                    key: "role",
                    icon: "user",
                    label: `${t("slotRole")} · ${user?.roleLabel ?? "—"}`,
                    earned: Boolean(user?.roleLabel),
                  },
                  // 等级体系尚未产出真实数据，槽位保留但不点亮——点亮一个编
                  // 出来的 L01 会让用户以为自己已经有等级了。
                  { key: "level", icon: "star", label: t("slotLocked") },
                  { key: "slot-3", icon: "medal", label: t("slotLocked") },
                  { key: "slot-4", icon: "medal", label: t("slotLocked") },
                ]}
              />
            }
            links={[
              {
                key: "profile",
                label: t("userMenu"),
                href: "/profile",
                icon: "user",
              },
            ]}
            settings={
              <ShellPreferencePanel
                locale={locale}
                theme={theme}
                density={density}
                fontSize={fontSize as ShellFontSizePreference}
                labels={{
                  title: t("prefsTitle"),
                  themeOptions: {
                    system: t("themeSystem"),
                    light: t("themeLight"),
                    dark: t("themeDark"),
                  },
                  densityOptions: {
                    compact: t("densityCompact"),
                    default: t("densityDefault"),
                    comfortable: t("densityComfy"),
                  },
                  fontSizeOptions: {
                    small: t("fontSmall"),
                    default: t("fontDefault"),
                    large: t("fontLarge"),
                  },
                }}
                // 设计件回吐字符串(它不再拥有平台语言目录);本门户传入的
                // options 来自平台权威目录,边界处收窄回 Locale。
                onLocaleChange={(next) => onLocaleChange(next as Locale)}
                onThemeChange={onThemeChange}
                onDensityChange={onDensityChange}
                onFontSizeChange={setFontSize}
              />
            }
            actions={[
              {
                key: "switch-user",
                label: t("switchUser"),
                icon: "user-switch",
                // 顶层跳转，不能用 router：vx_sid 必须跟着走到 IdP。
                onClick: () => window.location.assign(buildSwitchUrl()),
              },
              {
                key: "sign-out",
                label: t("signOut"),
                icon: "sign-out",
                danger: true,
                onClick: () => window.location.assign(buildLogoutUrl()),
              },
            ]}
          />
        </div>
      }
    />
  );
}
