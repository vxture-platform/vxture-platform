"use client";

/**
 * Console management header with a separate business workbench entry.
 * @package @vxture/console
 * @layer Presentation
 * @category component
 * @author AI-Generated
 * @date 2026-11-05
 */

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  ShellBrand,
  ShellHeader,
  ShellIconButton,
  ShellIconGroup,
  Button,
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
  withLocalePreference,
} from "@vxture/platform-browser";
import type { Locale, Theme } from "@vxture-platform/shared";
import { usePathname, useRouter } from "@/lib/i18n/navigation";
import { useConsoleSession } from "@/features/session/ConsoleSessionProvider";
import {
  fetchMyWorkspaces,
  fetchSwitchableWorkspaces,
} from "@/api/console-bff";
import { useTenant } from "@/features/tenant";
import {
  buildLogoutUrl,
  buildSwitchUrl,
  type ConsoleQuotaUsage,
} from "@/api/console-bff";
import type { ConsoleWorkspaceItem } from "@/entities/console";
import type { ShellDrawerType } from "../shell/types";
import { buildWorkbenchEntry } from "@/lib/workbench-entry";
import { TenantPanel } from "./TenantPanel";
import { useGlobalSearch, type NavSearchEntry } from "./useGlobalSearch";

const ACCOUNTS_BASE = (
  process.env.NEXT_PUBLIC_ACCOUNTS_URL ??
  (process.env.NODE_ENV === "production"
    ? "https://accounts.vxture.com"
    : "http://localhost:3080")
)
  .trim()
  .replace(/\/+$/, "");

/**
 * 展示用手机号：存储值带 E.164 国家码（+8613800000000），面板里只给号码本身。
 * 只剥中国大陆的 +86——用户看到的是自己那串熟悉的 11 位数字，国家码在这个
 * 位置是噪音。其余国家码保留：把它们也剥掉会得到一串谁都认不出来的数字。
 */
function formatPhone(phone: string | null | undefined): string {
  if (!phone) return "";
  return phone.startsWith("+86") ? phone.slice(3) : phone;
}

export interface ConsoleHeaderProps {
  openDrawer: (type: ShellDrawerType) => void;
  /** 站内未读数（product_330 P2-g）；0 不画角标。 */
  unreadCount?: number;
  onNavigate: (href: string) => void;
  brandName: string;
  /** 侧栏导航项（已过 i18n 与授权过滤），作为搜索的"页面"来源。 */
  navEntries: readonly NavSearchEntry[];
  quotaUsage: ConsoleQuotaUsage | null;
  workspaceName: string | null;
  monthlyBillLabel: string;
  balanceLabel?: string;
  planName: string | null;
}

export function ConsoleHeader({
  openDrawer,
  unreadCount = 0,
  onNavigate,
  brandName,
  navEntries,
  quotaUsage,
  workspaceName,
  monthlyBillLabel,
  balanceLabel = "—",
  planName,
}: ConsoleHeaderProps) {
  const t = useTranslations("shell");
  const { session, switchWorkspace } = useConsoleSession();
  const { tenantList, switchTenantContext } = useTenant();
  const locale = useLocale() as Locale;
  const router = useRouter();
  const pathname = usePathname();
  const { theme, setTheme, density, setDensity, fontSize, setFontSize } =
    useTheme();

  const search = useGlobalSearch(navEntries);

  /* 可切换的工作空间(owner 2026-09-09)。**只在会话真有工作空间时取**——
     个人租户、或还没解析出上下文的那一帧,取了也只会得到空列表。
     读失败不报错:面板会退回只画当前那一行,而不是让整个顶栏出错。 */
  const [workspaceOptions, setWorkspaceOptions] = useState<
    { id: string; name: string; isDefault: boolean }[]
  >([]);
  const [tenantWorkspaceDefaults, setTenantWorkspaceDefaults] = useState<
    ConsoleWorkspaceItem[]
  >([]);
  const activeWorkspaceId = session.tenant?.workspace ?? null;
  useEffect(() => {
    let active = true;
    setWorkspaceOptions([]);
    setTenantWorkspaceDefaults([]);
    // Each endpoint keeps its own fallback; a missing list must not hide the other.
    void Promise.allSettled([
      (activeWorkspaceId
        ? fetchSwitchableWorkspaces()
        : Promise.resolve([])
      ).then((list) => {
        if (active) setWorkspaceOptions(list);
      }),
      fetchMyWorkspaces().then((list) => {
        if (active) setTenantWorkspaceDefaults(list);
      }),
    ]);
    return () => {
      active = false;
    };
  }, [session.tenant?.id, activeWorkspaceId]);

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
            onNavigate(hit.href);
          },
        })),
      });
    }
    return groups;
  }, [search.navHits, search.remoteHits, t, onNavigate]);

  return (
    <ShellHeader
      className="max-sm:gap-xs max-sm:px-md max-sm:[&>div:nth-child(2)]:hidden"
      height="lg"
      centerAlign="end"
      leading={
        <>
          {/* owner 2026-09-08:字标 `Workspace Console`(全英文,品牌不翻译——
              中英文同一个串,与 admin 的 `vxture studio` 同体例)。

              **不带租户 tag**(owner 当日改口):租户视角下这一段是多余的——
              人本来就在自己的租户里,而紧邻右侧的 TenantPanel 已经写着当前租户
              并且能切换。品牌位再说一遍等于同一个信息占两处。 */}
          <ShellBrand
            className="h-control-md"
            labelClassName="max-sm:hidden"
            href="/"
            label={brandName}
            logoSrc="/brand/vxture-logo-white.png"
          />
          <span
            className="h-lg w-px bg-border max-sm:hidden"
            aria-hidden="true"
          />
          <TenantPanel
            tenant={session.tenant}
            workspaceName={workspaceName}
            quotaUsage={quotaUsage}
            monthlyBillLabel={monthlyBillLabel}
            balanceLabel={balanceLabel}
            planName={planName}
            tenantOptions={tenantList}
            scopeGroups={tenantList.map((item) => {
              const context = session.tenantOptions?.find(
                (option) => option.id === item.id,
              );
              const defaultSpace = tenantWorkspaceDefaults.find(
                (option) => option.tenantId === item.id,
              );
              const currentSpaces = workspaceOptions.map((space) => ({
                ...space,
                isCurrent: space.id === activeWorkspaceId,
              }));
              return {
                id: item.id,
                name: item.name,
                personal: item.type === "personal",
                identifier:
                  context?.tenantNo ||
                  (item.isCurrent ? session.tenant?.tenantNo : undefined) ||
                  undefined,
                workspaces:
                  item.isCurrent && currentSpaces.length > 0
                    ? currentSpaces
                    : defaultSpace?.workspaceId
                      ? [
                          {
                            id: defaultSpace.workspaceId,
                            name:
                              defaultSpace.workspaceName ||
                              t("defaultWorkspace"),
                            isDefault: true,
                            isCurrent:
                              item.isCurrent &&
                              defaultSpace.workspaceId === activeWorkspaceId,
                          },
                        ]
                      : item.isCurrent && activeWorkspaceId
                        ? [
                            {
                              id: activeWorkspaceId,
                              name: workspaceName || t("defaultWorkspace"),
                              isDefault: false,
                              isCurrent: true,
                            },
                          ]
                        : [],
              };
            })}
            onSwitchTenant={(id) => void switchTenantContext(id)}
            workspaceOptions={workspaceOptions.map((w) => ({
              ...w,
              isCurrent: w.id === activeWorkspaceId,
            }))}
            onSwitchWorkspace={(id) => void switchWorkspace(id)}
            onNavigate={onNavigate}
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
        // Keep the business entry separate from system tools and the account menu.
        <div className="flex items-center gap-md max-sm:gap-xs">
          {user?.id &&
          session.tenant?.mode === "tenant" &&
          activeWorkspaceId ? (
            <Button
              asChild
              variant="ghost"
              size="md"
              className="px-sm text-label-sm"
            >
              <a
                href={buildWorkbenchEntry(
                  {
                    userId: user.id,
                    tenantId: session.tenant.id,
                    workspaceId: activeWorkspaceId,
                  },
                  undefined,
                  locale,
                )}
                target="_blank"
                rel="noopener noreferrer"
                title={t("openBusinessWorkbench")}
              >
                {t("businessWorkbench")}
              </a>
            </Button>
          ) : null}
          <ShellIconGroup label={t("settings")}>
            {/* 2026-09-29:这颗按钮此前的 onClick 是 `() => {}`——有图标、有可访问
                名、有 hover 反馈,点下去什么都不发生。owner 第 5 条裁决把它定成
                侧边抽屉:列未关闭的工单与各自最后一次动静。
                **不加角标**:抽屉不承载已读(已读只在消息中心一处),而角标是
                「有几条没看」的说法,挂上去就等于又开了一份已读。 */}
            <ShellIconButton
              icon="help"
              label={t("help")}
              onClick={() => openDrawer("help")}
            />
            {/* 未读角标：站内收件箱（P2-g）。0 不画——空角标是噪音。 */}
            <span className="relative inline-flex">
              <ShellIconButton
                icon="bell"
                label={
                  unreadCount > 0
                    ? `${t("notifications")} (${unreadCount})`
                    : t("notifications")
                }
                onClick={() => openDrawer("notifications")}
              />
              {unreadCount > 0 ? (
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute -right-2xs -top-2xs inline-flex min-w-4 items-center justify-center rounded-full bg-danger px-2xs text-label-sm leading-4 text-danger-foreground tabular-nums"
                >
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              ) : null}
            </span>
            <ShellIconButton
              icon="settings"
              label={t("settings")}
              onClick={() => {
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
                label: t("accountCenter"),
                href: withLocalePreference(`${ACCOUNTS_BASE}/account`, locale),
                icon: "user",
                newTab: true,
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
