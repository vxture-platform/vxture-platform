"use client";

/**
 * AdminHeader — admin 顶栏（DS 外壳部件重建）。
 *
 * 取代原 `TemplateHeader`（482 行）：那份是设计稿 1:1 转写，整栏挂 `.vxh-*`
 * 遗留类、图标走 Phosphor 字体、语言下拉是裸原生控件、分段是手搓 `.vxh-seg`，
 * 因此与 console / opera（全 DS）在字号、间距、圆角、hover 反馈上处处对不上。
 * 本文件改用与那两个门户同一套部件，三个门户的顶栏由同一份实现产出，剩下的
 * 差别只有内容。
 *
 * 布局与 console / opera 逐槽对齐：
 *   leading  = launcher · 品牌(+tag) · 竖分隔 · 当前工作域
 *   center   = 全局搜索（⌘K）
 *   trailing = [助手] gap-md [系统工具组] gap-md [账户]
 *
 * admin 形态与 console 的三处内容差异：
 * 1. 第 4 槽是**当前工作域名**（运营业务域 / 平台自治域），不是租户切换器——
 *    admin 是跨租户视角，没有"当前租户"这个概念。
 * 2. 品牌带 `tag="admin"`：三个门户共用 "Vxture Platform" 主名，靠 tag 区分，
 *    与 opera 的 `tag="opera"` 同一形态。
 * 3. launcher 面板切的是工作域（两个），不是 console 的应用中心/控制台。
 */

import { useMemo } from "react";
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
  type IconName,
  type ShellFontSizePreference,
  type ShellSearchGroup,
} from "@vxture/design-system";
import {
  setGlobalDensityPreference,
  setGlobalThemePreference,
} from "@vxture/platform-browser";
import type { Locale, Theme } from "@vxture-platform/shared";
import { useAdminSession } from "@/features/session/AdminSessionProvider";
import { useLocale, useTranslations } from "next-intl";
import type { ShellView } from "../template/shell/types";
import { useAdminSearch, type NavSearchEntry } from "./useAdminSearch";
import { useLocaleSwitch } from "@/lib/useLocaleSwitch";

/**
 * 展示用手机号：存储值带 E.164 国家码（+8613800000000），面板里只给号码本身。
 * 只剥中国大陆的 +86——其余国家码保留，把它们也剥掉会得到一串谁都认不出来的
 * 数字。与 console 同一处理。
 */
function formatPhone(phone: string | null | undefined): string {
  if (!phone) return "";
  return phone.startsWith("+86") ? phone.slice(3) : phone;
}

export interface AdminHeaderViewOption {
  id: ShellView;
  name: string;
  desc: string;
  /** DS IconName（原实现存的是 Phosphor class 串，转换层已随之退役）。 */
  icon: IconName;
}

export interface AdminHeaderProps {
  views: AdminHeaderViewOption[];
  activeViewId: ShellView;
  onSelectView: (id: ShellView) => void;
  /** 当前工作域名，占品牌右侧那一槽。 */
  activeMenuName: string;
  openDrawer: (type: "notifications" | "settings") => void;
  onNavigate: (href: string) => void;
  onSwitchUser: () => void;
  onSignOut: () => void;
  brandName: string;
  /** 侧栏导航项（已过 i18n 与工作域过滤），作为搜索的"页面"来源。 */
  navEntries: readonly NavSearchEntry[];
}

export function AdminHeader({
  views,
  activeViewId,
  onSelectView,
  activeMenuName,
  openDrawer,
  onNavigate,
  onSwitchUser,
  onSignOut,
  brandName,
  navEntries,
}: AdminHeaderProps) {
  const t = useTranslations("shell");
  const { session } = useAdminSession();
  const locale = useLocale();
  const { theme, setTheme, density, setDensity, fontSize, setFontSize } =
    useTheme();
  const search = useAdminSearch(navEntries);

  const user = session.user;
  const displayName = (
    user?.displayName ||
    user?.name ||
    user?.username ||
    "User"
  ).trim();

  /* 偏好三项都要**同时**写两处：useTheme 管当前文档的即时生效，
     platform-browser 的 setGlobal* 管跨门户持久化（同一账号在 console/opera
     打开时沿用）。只写一处的话，切换在当前页有效、刷新或换门户后回退。 */
  /* 只写偏好是不够的：`ConsoleAppProviders` 里那份「订阅偏好变更、就地换词条」
     的客户端状态随 next-intl 迁移一起退役了，所以写完 cookie 还得让服务端重渲染，
     否则拨了语言开关**界面一点反应都没有**，直到下一次硬刷新。 */
  const { switchLocale } = useLocaleSwitch();
  const onLocaleChange = (next: Locale) => {
    switchLocale(next);
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
          onSelect: () => onNavigate(entry.href),
        })),
      });
    }
    // 后端按 kind 混在一个数组里返回，这里按 kind 分组——分组标题是展示文案，
    // 归前端的 i18n，后端不下发中文。
    const KIND_ICON: Record<string, IconName> = {
      tenant: "buildings",
      order: "receipt",
      operator: "user",
    };
    for (const kind of ["tenant", "order", "operator"] as const) {
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
          ...(KIND_ICON[kind] ? { icon: KIND_ICON[kind] } : {}),
          onSelect: () => onNavigate(hit.href),
        })),
      });
    }
    return groups;
  }, [search.navHits, search.remoteHits, t, onNavigate]);

  return (
    <ShellHeader
      height="lg"
      centerAlign="end"
      leading={
        <>
          <ShellLauncher
            items={views.map((option) => ({
              key: option.id,
              icon: option.icon,
              label: option.name,
              description: option.desc,
              active: option.id === activeViewId,
            }))}
            onSelect={(key) => onSelectView(key as ShellView)}
            buttonLabel={t("featureBoards")}
          />
          <ShellBrand
            href="/"
            label={brandName}
            tag="admin"
            logoSrc="/brand/vxture-logo-white.png"
          />
          <span className="h-lg w-px bg-border" aria-hidden="true" />
          <span className="truncate text-label-md text-muted-foreground">
            {activeMenuName}
          </span>
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
        // 组间是板块边界，组内是同类项。与 console / opera 同一套间距。
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
              onClick={() => onNavigate("/settings")}
            />
          </ShellIconGroup>
          <ShellUserMenu
            openLabel={t("userMenu")}
            user={{
              displayName,
              avatarAlt: displayName,
              // 手机号/邮箱缺失时给出明确文案而不是留白——留白读作"没这个字段"，
              // 缺失读作"该补了"，两者对用户的含义完全不同。
              uniqueLine: formatPhone(user?.phone) || t("missingPhone"),
              meta: user?.email || t("missingEmail"),
              // 认证状态用会话里的 emailVerified——原实现恒显"未认证"，那是
              // 一个写死的字面量，跟这个账号的真实状态无关。
              statusTag: user?.emailVerified
                ? { label: t("verifyVerified"), verified: true }
                : { label: t("verifyUnknown") },
            }}
            extras={
              <ShellPanelSlots
                label={t("slotLevel")}
                leadIcon="medal"
                // 槽位排紧接头部、讲的是同一个人，对齐到头部标题（显示名）那一列。
                lead="identity"
                slots={[
                  {
                    key: "role",
                    icon: "user",
                    label: `${t("slotRole")} · ${user?.roleLabel ?? "—"}`,
                    earned: Boolean(user?.roleLabel),
                  },
                  /* 等级体系尚无真实数据源：会话里只有 `roleRank`（授权用的
                   * 角色权重，越大权限越高），它跟"用户等级 L01–L05"不是一
                   * 回事，硬套过来是在编数据。槽位保留但不点亮——点亮一个编
                   * 出来的 L01 会让人以为自己已经有等级了。 */
                  { key: "level", icon: "star", label: t("slotLocked") },
                  { key: "slot-3", icon: "medal", label: t("slotLocked") },
                  { key: "slot-4", icon: "medal", label: t("slotLocked") },
                ]}
              />
            }
            links={[
              {
                key: "profile",
                label: t("profile"),
                href: "/platform-admins",
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
                onClick: onSwitchUser,
              },
              {
                key: "sign-out",
                label: t("signOut"),
                icon: "sign-out",
                danger: true,
                onClick: onSignOut,
              },
            ]}
          />
        </div>
      }
    />
  );
}
