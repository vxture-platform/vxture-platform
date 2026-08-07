"use client";

/* 控制台壳层容器 — 1:1 转写自设计稿 main-template.jsx App。
 * Header 置顶 + .app-body(Sidebar / 内容 / Assistant) + Drawer。
 * 路由走 Next；导航/授权来自 P2 注册表；助手为真实 VardaChat。 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Link, usePathname, useRouter } from "@/lib/i18n/navigation";
import { writeNavCollapsed } from "@vxture/shared";
import { useConsoleSession } from "@/features/session/ConsoleSessionProvider";
import { consoleDomains } from "@/config/navigation";
import {
  fetchMyApps,
  fetchMySubscriptions,
  fetchMyWorkspaces,
  fetchQuotaUsage,
  fetchTenantModelQuotas,
  type AppEntry,
  type ConsoleQuotaUsage,
} from "@/api/console-bff";
import {
  findActiveDomain,
  selectVisibleDomains,
} from "@/features/permissions/navigation-access";
import {
  Icon,
  Progress,
  ShellHeader,
  ShellPageContainer,
  ShellSidebarFrame,
  ShellSidebarNav,
  Skeleton,
  type ShellNavSection,
} from "@vxture/design-system";
import type { ShellView, ShellDrawerType, AssistantMode } from "../shell/types";
import {
  ConsoleHeader,
  type ConsoleHeaderViewOption,
} from "../header/ConsoleHeader";
import type { NavSearchEntry } from "../header/useGlobalSearch";
import { TemplateAssistant } from "./TemplateAssistant";
import { TemplateDrawer, type DrawerNotif } from "./TemplateDrawer";
import { AppCenter, type ConsoleApp } from "./AppCenter";

/* 内容滚动区：原先是遗留 CSS 的 `.content-scroll`（shell-template/app.css，
 * admin 仍在消费，不动）。等价 Tailwind 写法搬到这里，console 因此不再依赖
 * 那份 CSS 的布局规则。`data-content-scroll` 是给路由跳转后复位滚动条用的
 * 锚点——用数据属性而不是继续拿类名当选择器，类名以后可以随便改。 */
const CONTENT_SCROLL = "min-w-0 flex-1 scroll-smooth overflow-y-auto";
const CONTENT_SCROLL_ATTR = "data-content-scroll";

/* nav 收起态已迁到 cookie（见 (console)/layout.tsx 与 nav-preference.constants.ts），不再
 * 列在这里——留一个用不到的 key 会让下一个人以为它还是权威来源。 */
const LS = {
  view: "vx-console-view",
  vela: "vx-console-vela-open",
  velaMode: "vx-console-vela-mode",
};

export function ConsoleAppShell({
  children,
  initialNavCollapsed = false,
}: {
  children: ReactNode;
  initialNavCollapsed?: boolean;
}) {
  const { session, status } = useConsoleSession();
  const router = useRouter();
  const pathname = usePathname();
  const tSidebar = useTranslations("sidebar");
  const tShell = useTranslations("shell");
  const tDrawer = useTranslations("drawer");

  const [view, setViewState] = useState<ShellView>("console");
  /* 初始值由服务端从 cookie 读出后传入，首帧即最终态。写死 false 再在 effect 里
   * 纠正，会让刷新时导航"先展开再收起"闪一下——localStorage 对服务端不可见，
   * 那个时序问题无法在客户端解决。 */
  const [navCollapsed, setNavCollapsed] = useState(initialNavCollapsed);
  const [velaOpen, setVelaOpen] = useState(false);
  const [assistantMode, setAssistantMode] = useState<AssistantMode>("narrow");
  const [drawer, setDrawer] = useState<ShellDrawerType | null>(null);
  // 真实数据：Token 用量（配额）与本月账单。无 BFF/无数据时按决策 fallback。
  const [usage, setUsage] = useState<{ used: number; total: number }>({
    used: 0,
    total: 100,
  });
  const [billing, setBilling] = useState<{ amount: number; currency: string }>({
    amount: 0,
    currency: "CNY",
  });
  // Active subscription plan name; null until it loads or when the tenant has
  // no subscription at all — the header falls back to its free-plan label then.
  const [planName, setPlanName] = useState<string | null>(null);
  const [appEntries, setAppEntries] = useState<AppEntry[]>([]);
  /* 配额与当前工作空间原先由 header 自己取。上提到这里是因为它们现在同时喂
   * 「当前范围」面板与侧栏页脚——留在 header 里会让同一份数据被拉两遍。 */
  const [quotaUsage, setQuotaUsage] = useState<ConsoleQuotaUsage | null>(null);
  const [workspaceName, setWorkspaceName] = useState<string | null>(null);

  const tenantId = session.tenant?.id;
  useEffect(() => {
    let alive = true;

    const loadUsage = async () => {
      try {
        const quotas = await fetchTenantModelQuotas();
        const pool = quotas.pools[0];
        if (alive && pool) {
          setUsage({ used: pool.limit - pool.remaining, total: pool.limit });
        }
      } catch {
        /* fallback 0/100 */
      }
    };

    const loadBilling = async () => {
      try {
        const subs = await fetchMySubscriptions();
        const active = subs.find((s) => s.status === "active") ?? subs[0];
        if (alive && active) {
          setBilling({ amount: active.price, currency: active.currency });
          setPlanName(active.planName || null);
        }
      } catch {
        /* fallback 0 */
      }
    };

    const loadApps = async () => {
      try {
        const entries = await fetchMyApps();
        if (alive) setAppEntries(entries);
      } catch {
        /* fallback empty — static catalog rendered below */
      }
    };

    const loadQuota = async () => {
      const usage = await fetchQuotaUsage();
      if (alive) setQuotaUsage(usage);
    };

    const loadWorkspace = async () => {
      const items = await fetchMyWorkspaces();
      if (!alive) return;
      const current =
        items.find((w) => w.tenantId === tenantId) ??
        items.find((w) => w.isCurrent);
      setWorkspaceName(current?.workspaceName ?? null);
    };

    // These reads are independent — fire them concurrently instead of chaining
    // awaits, so the shell's usage/billing/apps/quota data lands after one
    // round-trip rather than five. allSettled, not all: one failing read must
    // not blank the other four (readJson already degrades, but fetchQuotaUsage
    // and fetchMyWorkspaces can still reject on a network error).
    void Promise.allSettled([
      loadUsage(),
      loadBilling(),
      loadApps(),
      loadQuota(),
      loadWorkspace(),
    ]);

    return () => {
      alive = false;
    };
  }, [tenantId]);

  // hydrate persisted UI state (client-only, avoids SSR mismatch)
  useEffect(() => {
    try {
      const v = window.localStorage.getItem(LS.view);
      if (v === "appcenter" || v === "console") setViewState(v);
      // nav 收起态不在这里读：已由服务端经 cookie 传入（见上）。
      setVelaOpen(window.localStorage.getItem(LS.vela) === "1");
      const m = window.localStorage.getItem(LS.velaMode);
      if (m === "narrow" || m === "wide" || m === "full") setAssistantMode(m);
    } catch {
      /* ignore */
    }
  }, []);

  const setView = (v: ShellView) => {
    setViewState(v);
    try {
      window.localStorage.setItem(LS.view, v);
    } catch {
      /* ignore */
    }
  };
  const toggleNav = () =>
    setNavCollapsed((c) => {
      const n = !c;
      try {
        writeNavCollapsed("console", n);
      } catch {
        /* ignore */
      }
      return n;
    });
  const persistVela = (open: boolean, mode: AssistantMode) => {
    try {
      window.localStorage.setItem(LS.vela, open ? "1" : "0");
      window.localStorage.setItem(LS.velaMode, mode);
    } catch {
      /* ignore */
    }
  };
  const openVela = (open: boolean) => {
    setVelaOpen(open);
    persistVela(open, assistantMode);
  };
  const closeAssistant = () => {
    setVelaOpen(false);
    setAssistantMode("narrow");
    persistVela(false, "narrow");
  };
  const toggleAssistantWide = () => {
    const goingWide = assistantMode !== "wide";
    const next: AssistantMode = goingWide ? "wide" : "narrow";
    setAssistantMode(next);
    persistVela(velaOpen, next);
    if (goingWide) {
      setNavCollapsed(true);
      try {
        writeNavCollapsed("console", true);
      } catch {
        /* ignore */
      }
    }
  };
  const toggleAssistantFull = () => {
    const next: AssistantMode = assistantMode === "full" ? "narrow" : "full";
    setAssistantMode(next);
    persistVela(velaOpen, next);
  };

  const navigate = (href: string) => {
    router.push(href);
    const main = document.querySelector(`[${CONTENT_SCROLL_ATTR}]`);
    if (main) main.scrollTop = 0;
  };

  // ── 三级授权过滤 → 可见功能域 ──
  const tenantType =
    session.tenant?.mode === "tenant" ? session.tenant.tenantType : undefined;
  const visibleDomains = useMemo(
    () =>
      selectVisibleDomains(consoleDomains, {
        capabilities: session.capabilities,
        tenantType,
      }),
    [session.capabilities, tenantType],
  );

  /* config/navigation.ts already stores a DS `IconName` per item; the old
   * sidebar converted it to a Phosphor class string via phNavIcon(). The DS
   * nav takes the IconName directly, so that conversion layer is gone. */
  const navSections: ShellNavSection[] = useMemo(
    () =>
      visibleDomains.flatMap((d) =>
        d.sections.map((section) => ({
          title: tSidebar(`sections.${section.titleKey}`),
          items: section.items.map((it) => ({
            href: it.href,
            label: tSidebar(`items.${it.labelKey}`),
            icon: it.icon,
          })),
        })),
      ),
    [visibleDomains, tSidebar],
  );

  const activeDomain = findActiveDomain(visibleDomains, pathname);
  const domainName = activeDomain
    ? tSidebar(`domains.${activeDomain.labelKey}`)
    : undefined;

  /* launcher 的两个目的地。icon 现在是 DS IconName（原先是 Phosphor class
   * 串 "ph-squares-four"，随字体图标一起退役）。 */
  const viewOptions: ConsoleHeaderViewOption[] = [
    {
      id: "appcenter",
      name: tShell("views.appcenter.name"),
      desc: tShell("views.appcenter.desc"),
      icon: "squares-four",
    },
    {
      id: "console",
      name: tShell("views.console.name"),
      desc: tShell("views.console.desc"),
      icon: "settings",
    },
  ];

  /* 搜索面板的「页面」来源：拍平已过授权过滤的导航项。用 navSections 而不是
   * 原始注册表——用户搜不到的页面不该出现在结果里。 */
  const navEntries: NavSearchEntry[] = useMemo(
    () =>
      navSections.flatMap((section) =>
        section.items.map((item) => ({
          href: item.href,
          label: item.label,
          group: section.title,
        })),
      ),
    [navSections],
  );

  const sidebarLabels = {
    expandNav: tShell("sidebar.expandNav"),
    collapseNav: tShell("sidebar.collapseNav"),
    expandAllGroups: tShell("sidebar.expandAllGroups"),
    collapseAllGroups: tShell("sidebar.collapseAllGroups"),
  };

  const usagePct =
    usage.total > 0 ? Math.round((usage.used / usage.total) * 100) : 0;
  /* The DS nav's footer slot is a fixed 64px block, so the token-usage card is
   * rebuilt compact (one label row + a progress bar) instead of the old
   * three-row card, which would overflow it. Hidden while collapsed — there is
   * no room for a label at rail width. */
  const sidebarFooter = navCollapsed ? null : (
    <div className="flex w-full flex-col justify-center gap-2xs px-2xs">
      <div className="flex items-center gap-2xs text-label-sm text-muted-foreground">
        <Icon name="coins" size="xs" fallback="placeholder" />
        <span className="min-w-0 flex-1 truncate">
          {tShell("tokenCard.title")}
        </span>
        <span className="shrink-0 tabular-nums">
          {usage.used.toLocaleString()} / {usage.total.toLocaleString()}
        </span>
      </div>
      <Progress value={usagePct} />
    </div>
  );

  const currencySymbol =
    billing.currency === "USD" ? "$" : billing.currency === "EUR" ? "€" : "¥";
  const billingAmount = Number(billing.amount ?? 0);
  const billingLabel = `${currencySymbol}${(Number.isFinite(billingAmount) ? billingAmount : 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // No notification source is wired yet — render the drawer's own empty state
  // rather than invented alerts.
  const drawerNotifs: DrawerNotif[] = [];
  const settingsRows: Array<[string, string]> = [
    [
      tDrawer("settings.rows.theme.label"),
      tDrawer("settings.rows.theme.value"),
    ],
    [
      tDrawer("settings.rows.density.label"),
      tDrawer("settings.rows.density.value"),
    ],
    [
      tDrawer("settings.rows.sessionTimeout.label"),
      tDrawer("settings.rows.sessionTimeout.value"),
    ],
    [
      tDrawer("settings.rows.auditRetention.label"),
      tDrawer("settings.rows.auditRetention.value"),
    ],
  ];
  const drawerLabels = {
    notificationsTitle: tDrawer("notifications.title"),
    settingsTitle: tDrawer("settings.title"),
    markAllRead: tDrawer("notifications.markAllRead"),
    openCenter: tShell("drawer.openCenter"),
    close: tDrawer("close"),
  };

  // ── App Center — BFF-driven, enriched with i18n labels ──
  const apps: ConsoleApp[] = useMemo(
    () =>
      appEntries.map((entry) => ({
        id: entry.id,
        name: tShell(`apps.${entry.id}.name`),
        desc: tShell(`apps.${entry.id}.desc`),
        icon: entry.icon,
        tone: entry.tone,
        target: entry.target,
        ...(entry.openVela ? { openVela: true as const } : {}),
      })),
    [appEntries, tShell],
  );
  const appCenterLabels = {
    title: tShell("appcenter.title"),
    desc: tShell("appcenter.desc"),
    shortcutTag: tShell("appcenter.shortcutTag", { count: apps.length }),
    enter: tShell("appcenter.enter"),
  };

  const openApp = (app: ConsoleApp) => {
    setView("console");
    navigate(app.target);
    if (app.openVela) openVela(true);
  };

  const velaActive = velaOpen && view === "console";

  if (status === "loading") {
    return (
      <div className="app bg-background text-foreground">
        {/* 骨架用 DS 的 ShellHeader 本体（而非旧的 .vxh--skeleton 类）撑版位：
            两者高度必须逐像素相同，否则会话就绪的一刻整页会往下跳一格。 */}
        <ShellHeader
          height="lg"
          centerAlign="end"
          leading={
            <>
              <Skeleton className="size-icon-xl rounded-lg" />
              <Skeleton className="h-icon-lg w-media-xs" />
            </>
          }
          center={<Skeleton className="h-control-md w-full max-w-media-4xl" />}
          trailing={
            <div className="flex items-center gap-md">
              <Skeleton className="size-icon-xl rounded-full" />
              <Skeleton className="h-icon-xl w-media-xs rounded-lg" />
              <Skeleton className="size-icon-xl rounded-full" />
            </div>
          }
        />
        <div className="app-body">
          <div className="sidebar">
            <div className="vxh-skeleton-nav">
              {[...Array(6)].map((_, i) => (
                <div
                  key={i}
                  className="vxh-skeleton-block vxh-skeleton-block--nav"
                />
              ))}
            </div>
          </div>
          <main className={CONTENT_SCROLL} {...{ [CONTENT_SCROLL_ATTR]: "" }}>
            <ShellPageContainer className="gap-lg">
              <Skeleton className="h-icon-2xl w-media-2xl" />
              <Skeleton className="h-media-lg w-full" />
              <Skeleton className="h-media-lg w-full" />
            </ShellPageContainer>
          </main>
        </div>
      </div>
    );
  }

  return (
    <div
      className={
        // bg-background 由外壳自己上：底色原先是 console-base.css 挂在 html
        // 上的一条渐变，退役后必须有人把 --background 画出来，跟 opera 的
        // ShellViewport 是同一个位置（外壳根节点）。
        "app bg-background text-foreground" +
        (velaActive ? " vela-open" : "") +
        (view === "console" && navCollapsed ? " nav-collapsed" : "")
      }
    >
      <ConsoleHeader
        view={view}
        setView={setView}
        viewOptions={viewOptions}
        assistantOpen={velaOpen}
        setAssistantOpen={openVela}
        openDrawer={(type) => setDrawer(type)}
        onNavigate={navigate}
        brandName="Workspace Console"
        navEntries={navEntries}
        quotaUsage={quotaUsage}
        workspaceName={workspaceName}
        billingLabel={billingLabel}
        planName={planName}
      />

      {view === "appcenter" ? (
        <div className="app-body">
          <main className={CONTENT_SCROLL} {...{ [CONTENT_SCROLL_ATTR]: "" }}>
            <ShellPageContainer>
              <AppCenter
                apps={apps}
                onOpen={openApp}
                labels={appCenterLabels}
              />
            </ShellPageContainer>
          </main>
        </div>
      ) : (
        <div className="app-body">
          {/* DS 外壳 + DS 导航内容：宽度状态机归 ShellSidebarFrame（w-sidebar-*），
           * 内容归 ShellSidebarNav。原先外层是 shell-template.css 的 .sidebar，
           * 它自带 padding 与另一套宽度，跟导航内容自己的 L1 p-xs 叠加，这正是
           * 两个门户间距对不齐的来源。admin 仍用 .sidebar，共享 CSS 未改动。 */}
          <ShellSidebarFrame mode={navCollapsed ? "collapsed" : "expanded"}>
            <ShellSidebarNav
              domainName={domainName ?? tShell("views.console.name")}
              sections={navSections}
              collapsed={navCollapsed}
              onToggleCollapsed={toggleNav}
              isActive={(href) =>
                href === "/" ? pathname === "/" : pathname.startsWith(href)
              }
              storageKeyPrefix="vx-console-nav"
              linkComponent={Link}
              labels={sidebarLabels}
              footer={sidebarFooter}
            />
          </ShellSidebarFrame>
          <main className={CONTENT_SCROLL} {...{ [CONTENT_SCROLL_ATTR]: "" }}>
            <ShellPageContainer>{children}</ShellPageContainer>
          </main>
          {velaActive && (
            <TemplateAssistant
              mode={assistantMode}
              onClose={closeAssistant}
              onToggleWide={toggleAssistantWide}
              onToggleFull={toggleAssistantFull}
            />
          )}
        </div>
      )}

      {drawer && (
        <TemplateDrawer
          type={drawer}
          onClose={() => setDrawer(null)}
          onNavigate={navigate}
          notifications={drawerNotifs}
          settingsRows={settingsRows}
          labels={drawerLabels}
        />
      )}
    </div>
  );
}
