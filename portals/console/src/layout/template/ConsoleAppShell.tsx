"use client";

/* 控制台壳层容器 — 1:1 转写自设计稿 main-template.jsx App。
 * Header 置顶 + .app-body(Sidebar / 内容 / Assistant) + Drawer。
 * 路由走 Next；导航/授权来自 P2 注册表；助手为真实 VardaChat。 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/lib/i18n/navigation";
import { useConsoleSession } from "@/features/session/ConsoleSessionProvider";
import { consoleDomains } from "@/config/navigation";
import {
  fetchMyApps,
  fetchMySubscriptions,
  fetchTenantModelQuotas,
  type AppEntry,
} from "@/api/console-bff";
import {
  findActiveDomain,
  selectVisibleDomains,
} from "@/features/permissions/navigation-access";
import type { ShellView, ShellDrawerType, AssistantMode } from "../shell/types";
import { phNavIcon } from "./icons-map";
import { TemplateHeader, type HeaderViewOption } from "./TemplateHeader";
import { TemplateSidebar, type TplNavGroup } from "./TemplateSidebar";
import { TemplateAssistant } from "./TemplateAssistant";
import { TemplateDrawer, type DrawerNotif } from "./TemplateDrawer";
import { AppCenter, type ConsoleApp } from "./AppCenter";

const LS = {
  view: "vx-console-view",
  nav: "vx-console-sidebar-collapsed",
  vela: "vx-console-vela-open",
  velaMode: "vx-console-vela-mode",
};

export function ConsoleAppShell({ children }: { children: ReactNode }) {
  const { session, status } = useConsoleSession();
  const router = useRouter();
  const pathname = usePathname();
  const tSidebar = useTranslations("sidebar");
  const tShell = useTranslations("shell");
  const tDrawer = useTranslations("drawer");

  const [view, setViewState] = useState<ShellView>("console");
  const [navCollapsed, setNavCollapsed] = useState(false);
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
  const [appEntries, setAppEntries] = useState<AppEntry[]>([]);

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

    // These three reads are independent — fire them concurrently instead of
    // chaining awaits, so the sidebar usage/billing/apps data lands after one
    // round-trip rather than three.
    void Promise.all([loadUsage(), loadBilling(), loadApps()]);

    return () => {
      alive = false;
    };
  }, [tenantId]);

  // hydrate persisted UI state (client-only, avoids SSR mismatch)
  useEffect(() => {
    try {
      const v = window.localStorage.getItem(LS.view);
      if (v === "appcenter" || v === "console") setViewState(v);
      setNavCollapsed(window.localStorage.getItem(LS.nav) === "true");
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
        window.localStorage.setItem(LS.nav, String(n));
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
        window.localStorage.setItem(LS.nav, "true");
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
    const main = document.querySelector(".content-scroll");
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

  const navGroups: TplNavGroup[] = useMemo(
    () =>
      visibleDomains.flatMap((d) =>
        d.sections.map((section) => ({
          group: tSidebar(`sections.${section.titleKey}`),
          items: section.items.map((it) => ({
            href: it.href,
            label: tSidebar(`items.${it.labelKey}`),
            phicon: phNavIcon(it.icon),
          })),
        })),
      ),
    [visibleDomains, tSidebar],
  );

  const activeDomain = findActiveDomain(visibleDomains, pathname);
  const domainName = activeDomain
    ? tSidebar(`domains.${activeDomain.labelKey}`)
    : undefined;

  const viewOptions: HeaderViewOption[] = [
    {
      id: "appcenter",
      name: tShell("views.appcenter.name"),
      desc: tShell("views.appcenter.desc"),
      icon: "ph-squares-four",
    },
    {
      id: "console",
      name: tShell("views.console.name"),
      desc: tShell("views.console.desc"),
      icon: "ph-sliders-horizontal",
    },
  ];

  const headerLabels = {
    featureBoards: tShell("featureBoards"),
    searchPlaceholder: tShell("searchPlaceholder"),
    help: tShell("help"),
    notifications: tShell("notifications"),
    settings: tShell("settings"),
    assistant: tShell("assistant"),
    userMenu: tShell("userMenu"),
    verified: tShell("verified"),
    tenantOrg: tShell("tenantOrg"),
    tenantVerified: tShell("tenantVerified"),
    tenantSettings: tShell("tenantSettings"),
    switchOrg: tShell("switchOrg"),
    prefsTitle: tShell("prefsTitle"),
    themeSystem: tShell("themeSystem"),
    themeLight: tShell("themeLight"),
    themeDark: tShell("themeDark"),
    densityCompact: tShell("densityCompact"),
    densityDefault: tShell("densityDefault"),
    densityComfy: tShell("densityComfy"),
    switchUser: tShell("switchUser"),
    signOut: tShell("signOut"),
  };

  const sidebarLabels = {
    expandNav: tShell("sidebar.expandNav"),
    collapseNav: tShell("sidebar.collapseNav"),
    expandAllGroups: tShell("sidebar.expandAllGroups"),
    collapseAllGroups: tShell("sidebar.collapseAllGroups"),
  };

  const usagePct =
    usage.total > 0 ? Math.round((usage.used / usage.total) * 100) : 0;
  const footer = {
    icon: "ph-coins",
    title: tShell("tokenCard.title"),
    pct: usagePct,
    meta: `${usage.used.toLocaleString()} / ${usage.total.toLocaleString()}`,
  };

  const currencySymbol =
    billing.currency === "USD" ? "$" : billing.currency === "EUR" ? "€" : "¥";
  const billingAmount = Number(billing.amount ?? 0);
  const billingLabel = `${currencySymbol}${(Number.isFinite(billingAmount) ? billingAmount : 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // ── Drawer 占位数据（demo，待接真实消息中心 / 系统设置）──
  const drawerNotifs: DrawerNotif[] = [
    {
      level: "warning",
      icon: "ph-receipt",
      title: tDrawer("notifications.items.billing.title"),
      meta: tDrawer("notifications.items.billing.meta"),
      href: "/billing",
    },
    {
      level: "info",
      icon: "ph-user-plus",
      title: tDrawer("notifications.items.invite.title"),
      meta: tDrawer("notifications.items.invite.meta"),
      href: "/invitations",
    },
    {
      level: "danger",
      icon: "ph-lock-key-open",
      title: tDrawer("notifications.items.security.title"),
      meta: tDrawer("notifications.items.security.meta"),
      href: "/security",
    },
  ];
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
    subscribedTag: tShell("appcenter.subscribedTag", { count: apps.length }),
    statusSubscribed: tShell("appcenter.statusSubscribed"),
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
      <div className="app">
        <div className="vxh vxh--skeleton" aria-hidden="true">
          <div className="vxh-left">
            <div className="vxh-skeleton-block vxh-skeleton-block--icon" />
            <div className="vxh-skeleton-block vxh-skeleton-block--brand" />
          </div>
          <div className="vxh-skeleton-block vxh-skeleton-block--search" />
          <div className="vxh-actions">
            <div className="vxh-skeleton-block vxh-skeleton-block--circle" />
            <div className="vxh-skeleton-block vxh-skeleton-block--circle" />
            <div className="vxh-skeleton-block vxh-skeleton-block--circle" />
          </div>
        </div>
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
          <main className="content-scroll">
            <div className="content-inner vxh-skeleton-content">
              <div className="vxh-skeleton-block vxh-skeleton-block--title" />
              <div className="vxh-skeleton-block vxh-skeleton-block--card" />
              <div className="vxh-skeleton-block vxh-skeleton-block--card" />
            </div>
          </main>
        </div>
      </div>
    );
  }

  return (
    <div
      className={
        "app" +
        (velaActive ? " vela-open" : "") +
        (view === "console" && navCollapsed ? " nav-collapsed" : "")
      }
    >
      <TemplateHeader
        view={view}
        setView={setView}
        viewOptions={viewOptions}
        velaOpen={velaOpen}
        setVelaOpen={openVela}
        showVela
        openDrawer={(t) => setDrawer(t)}
        onNavigate={navigate}
        brandName="Workspace Console"
        billingLabel={billingLabel}
        labels={headerLabels}
      />

      {view === "appcenter" ? (
        <div className="app-body">
          <main className="content-scroll">
            <div className="content-inner">
              <AppCenter
                apps={apps}
                onOpen={openApp}
                labels={appCenterLabels}
              />
            </div>
          </main>
        </div>
      ) : (
        <div className="app-body">
          <TemplateSidebar
            groups={navGroups}
            pathname={pathname}
            onNavigate={navigate}
            collapsed={navCollapsed}
            onToggle={toggleNav}
            domainName={domainName}
            footer={footer}
            labels={sidebarLabels}
          />
          <main className="content-scroll">
            <div className="content-inner">{children}</div>
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
