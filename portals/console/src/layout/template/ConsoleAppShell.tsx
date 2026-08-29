"use client";

/* 控制台壳层容器 — 1:1 转写自设计稿 main-template.jsx App。
 * Header 置顶 + 主体行(Sidebar / 内容 / Assistant) + Drawer——全 DS 组件与 T2 工具类。
 * 路由走 Next；导航/授权来自 P2 注册表；助手为真实 VardaChat。 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Link, usePathname, useRouter } from "@/lib/i18n/navigation";
import { writeNavCollapsed } from "@vxture-platform/shared";
import { useConsoleSession } from "@/features/session/ConsoleSessionProvider";
import { appCenterModuleTiles, consoleDomains } from "@/config/navigation";
import {
  fetchMyApps,
  fetchMySubscriptions,
  fetchMyWorkspaces,
  fetchQuotaUsage,
  fetchTenantModelQuotas,
  type ConsoleQuotaUsage,
  type ProductAppTile,
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
import type { ShellView, ShellDrawerType } from "../shell/types";
import {
  ConsoleHeader,
  type ConsoleHeaderViewOption,
} from "../header/ConsoleHeader";
import type { NavSearchEntry } from "../header/useGlobalSearch";
import { TemplateDrawer, type DrawerNotif } from "./TemplateDrawer";
import { AppCenter, type AppCenterModuleEntry } from "./AppCenter";

/* 内容滚动区：原先是遗留 CSS 的 `.content-scroll`（shell-template 已随批 D
 * 整体退役）。等价 Tailwind 写法在此。`data-content-scroll` 是给路由跳转后复位滚动条用的
 * 锚点——用数据属性而不是继续拿类名当选择器，类名以后可以随便改。 */
const CONTENT_SCROLL = "min-w-0 flex-1 scroll-smooth overflow-y-auto";
const CONTENT_SCROLL_ATTR = "data-content-scroll";

/* nav 收起态已迁到 cookie（见 (console)/layout.tsx 与 nav-preference.constants.ts），不再
 * 列在这里——留一个用不到的 key 会让下一个人以为它还是权威来源。 */
const LS = {
  view: "vx-console-view",
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
  /* 订阅下单/付款流程页默认收起侧栏（owner 2026-08-20）：进入流程时收起一次，
   * 不写偏好 cookie——流程内可手动展开，离开后原偏好不受影响。 */
  const inSubscribeFlow = pathname?.startsWith("/subscribe") ?? false;
  useEffect(() => {
    if (inSubscribeFlow) setNavCollapsed(true);
  }, [inSubscribeFlow]);
  const [drawer, setDrawer] = useState<ShellDrawerType | null>(null);
  /* 侧栏 Token 用量。null = 还没读到；"unavailable" = 读不到（BFF/Atlas 不可达）；
   * "uncovered" = 工作空间没有额度池。此前失败回落 0/100，故障时会画出一根像真
   * 的空仪表——三种非数字状态各自显式呈现，不再有假读数（2026-08-30）。 */
  const [usage, setUsage] = useState<
    { used: number; total: number } | "unavailable" | "uncovered" | null
  >(null);
  const [billing, setBilling] = useState<{ amount: number; currency: string }>({
    amount: 0,
    currency: "CNY",
  });
  // Active subscription plan name; null until it loads or when the tenant has
  // no subscription at all — the header falls back to its free-plan label then.
  const [planName, setPlanName] = useState<string | null>(null);
  /* 应用中心的产品磁贴。null = 还没读到，productsFailed 区分「加载中」与「读取
   * 失败」——空数组是真实的「没订阅任何产品」，不能拿它兜故障。 */
  const [productTiles, setProductTiles] = useState<ProductAppTile[] | null>(
    null,
  );
  const [productsFailed, setProductsFailed] = useState(false);
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
        if (!alive) return;
        // fetchTenantModelQuotas 自己会把失败折成 status:"unavailable"，这里必须
        // 认这个信号——否则空的 pools 会被当成「用量为 0」画出来。
        if (quotas.status === "unavailable") {
          setUsage("unavailable");
          return;
        }
        const pool = quotas.pools[0];
        setUsage(
          pool
            ? { used: pool.limit - pool.remaining, total: pool.limit }
            : "uncovered",
        );
      } catch {
        if (alive) setUsage("unavailable");
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
        const tiles = await fetchMyApps();
        if (!alive) return;
        setProductTiles(tiles);
        setProductsFailed(false);
      } catch {
        if (!alive) return;
        setProductTiles(null);
        setProductsFailed(true);
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
    // not blank the other four (fetchMyApps / fetchQuotaUsage are strict reads
    // that reject on failure; the rest can still reject on a network error).
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
  /* Varda 已迁独立仓重构(2026-08-18):助手停靠列与其状态机随之移除,
   * 重构完成发包后按新包名 @vxture/varda 重新接入。 */

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

  const usageNumbers = typeof usage === "object" ? usage : null;
  const usagePct =
    usageNumbers && usageNumbers.total > 0
      ? Math.round((usageNumbers.used / usageNumbers.total) * 100)
      : 0;
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
          {usageNumbers
            ? `${usageNumbers.used.toLocaleString()} / ${usageNumbers.total.toLocaleString()}`
            : usage === "unavailable"
              ? tShell("tokenCard.unavailable")
              : usage === "uncovered"
                ? tShell("tokenCard.uncovered")
                : "—"}
        </span>
      </div>
      {/* 只有拿到真实读数才画进度条：没有数字的状态画一根空条就是在造假。 */}
      {usageNumbers ? <Progress value={usagePct} /> : null}
    </div>
  );

  const currencySymbol =
    billing.currency === "USD" ? "$" : billing.currency === "EUR" ? "€" : "¥";
  const billingAmount = Number(billing.amount ?? 0);
  const billingLabel = `${currencySymbol}${(Number.isFinite(billingAmount) ? billingAmount : 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // No notification source is wired yet — render the drawer's own empty state
  // rather than invented alerts.
  const drawerNotifs: DrawerNotif[] = [];
  /* 「系统设置」抽屉已删（2026-08-30）：它没有任何入口（header 的齿轮直接去
   * /settings），而它的四行值全是编出来的词条——会话超时/审计保留与 /settings
   * 的真实默认值还互相矛盾。主题/密度的真实状态在 header 的偏好面板里。 */
  const drawerLabels = {
    title: tDrawer("notifications.title"),
    markAllRead: tDrawer("notifications.markAllRead"),
    openCenter: tShell("drawer.openCenter"),
    close: tDrawer("close"),
  };

  // ── App Center：产品磁贴来自 BFF，板块入口来自导航配置 ──
  const moduleEntries: AppCenterModuleEntry[] = useMemo(
    () =>
      appCenterModuleTiles.map((tile) => ({
        id: tile.id,
        icon: tile.icon,
        href: tile.href,
        name: tShell(`apps.${tile.id}.name`),
        desc: tShell(`apps.${tile.id}.desc`),
      })),
    [tShell],
  );
  const appCenterLabels = {
    title: tShell("appcenter.title"),
    desc: tShell("appcenter.desc"),
    shortcutTag: tShell("appcenter.shortcutTag", {
      count: (productTiles?.length ?? 0) + moduleEntries.length,
    }),
    productsTitle: tShell("appcenter.products.title"),
    productsDesc: tShell("appcenter.products.desc"),
    productsEmpty: tShell("appcenter.products.empty"),
    productsBrowse: tShell("appcenter.products.browse"),
    productsUnavailable: tShell("appcenter.products.unavailable"),
    trialing: tShell("appcenter.products.trialing"),
    modulesTitle: tShell("appcenter.modules.title"),
    modulesDesc: tShell("appcenter.modules.desc"),
  };

  /* 站内入口：切回控制台视图再路由。登记了主页的产品不经这里——AppCenter 直接
   * 开新标签。 */
  const openInConsole = (href: string) => {
    setView("console");
    navigate(href);
  };

  if (status === "loading") {
    return (
      <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
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
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {/* 骨架侧栏与真实侧栏同走 ShellSidebarFrame，宽度天然逐像素一致。 */}
          <ShellSidebarFrame mode="expanded">
            <div className="vxh-skeleton-nav">
              {[...Array(6)].map((_, i) => (
                <div
                  key={i}
                  className="vxh-skeleton-block vxh-skeleton-block--nav"
                />
              ))}
            </div>
          </ShellSidebarFrame>
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
      // bg-background 由外壳自己上：底色原先是 console-base.css 挂在 html
      // 上的一条渐变，退役后必须有人把 --background 画出来，跟 opera 的
      // ShellViewport 是同一个位置（外壳根节点）。批 D：.app 遗留类换
      // 工具类；vela-open/nav-collapsed 两个状态钩子全仓无样式引用，删。
      className="flex h-screen flex-col overflow-hidden bg-background text-foreground"
    >
      <ConsoleHeader
        view={view}
        setView={setView}
        viewOptions={viewOptions}
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
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <main className={CONTENT_SCROLL} {...{ [CONTENT_SCROLL_ATTR]: "" }}>
            <ShellPageContainer>
              <AppCenter
                products={productTiles}
                productsFailed={productsFailed}
                modules={moduleEntries}
                onNavigate={openInConsole}
                labels={appCenterLabels}
              />
            </ShellPageContainer>
          </main>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {/* DS 外壳 + DS 导航内容：宽度状态机归 ShellSidebarFrame（w-sidebar-*），
           * 内容归 ShellSidebarNav。原先外层是 shell-template.css 的 .sidebar，
           * 它自带 padding 与另一套宽度，跟导航内容自己的 L1 p-xs 叠加，这正是
           * 两个门户间距对不齐的来源（批 D：.sidebar 已随 shell-template 退役）。 */}
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
        </div>
      )}

      {drawer === "notifications" && (
        <TemplateDrawer
          onClose={() => setDrawer(null)}
          onNavigate={navigate}
          notifications={drawerNotifs}
          labels={drawerLabels}
        />
      )}
    </div>
  );
}
