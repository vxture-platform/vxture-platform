"use client";
import { isNavigationActive } from "@/lib/navigation-active";

/* 控制台壳层容器 — 1:1 转写自设计稿 main-template.jsx App。
 * Header 置顶 + 主体行(Sidebar / 内容 / Assistant) + Drawer——全 DS 组件与 T2 工具类。
 * 路由走 Next；导航/授权来自 P2 注册表；助手为真实 VardaChat。 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname, useRouter } from "@/lib/i18n/navigation";
import { writeNavCollapsed } from "@vxture-platform/shared";
import { useConsoleSession } from "@/features/session/ConsoleSessionProvider";
import { consoleDomains } from "@/config/navigation";
import {
  fetchCredits,
  fetchMonthlyBill,
  fetchInbox,
  fetchInboxUnreadCount,
  fetchMySubscriptions,
  fetchMyWorkspaces,
  fetchMyTickets,
  fetchQuotaUsage,
  markInboxAllRead,
  markInboxRead,
  type ConsoleQuotaUsage,
  type ConsoleTicket,
  type InboxMessage,
} from "@/api/console-bff";
import { formatInboxTime, inboxPresentation } from "@/lib/inbox-format";
import { useDerivedTodos } from "@/features/todos/useDerivedTodos";
import { selectVisibleDomains } from "@/features/permissions/navigation-access";
import {
  ShellHeader,
  ShellHeaderActions,
  ShellPageContainer,
  ShellSidebarFrame,
  ShellSidebarNav,
  Skeleton,
  type ShellNavSection,
} from "@vxture/design-system";
import type { ShellDrawerType } from "../shell/types";
import { ConsoleFooter } from "./ConsoleFooter";
import { ConsoleHeader } from "../header/ConsoleHeader";
import type { NavSearchEntry } from "../header/useGlobalSearch";
import { TemplateDrawer, type DrawerNotif } from "./TemplateDrawer";
import { HelpDrawer } from "./HelpDrawer";
import { isOpenTicket } from "@/lib/ticket-state";
import { buildWebsiteDocsUrl } from "@/lib/website-entry";

/* 内容滚动区：原先是遗留 CSS 的 `.content-scroll`（shell-template 已随批 D
 * 整体退役）。等价 Tailwind 写法在此。`data-content-scroll` 是给路由跳转后复位滚动条用的
 * 锚点——用数据属性而不是继续拿类名当选择器，类名以后可以随便改。 */
const CONTENT_SCROLL = "min-w-0 flex-1 scroll-smooth overflow-y-auto";
const CONTENT_SCROLL_ATTR = "data-content-scroll";

/**
 * 注入给 `ShellSidebarNav` 的链接件。
 *
 * 导航里现在混着两类目的地：应用内路由走 next 的 `Link`（客户端跳转、预取），
 * **绝对地址走原生 `<a target="_blank">`** ——模型服务 / 技能工具指的是文档站
 * （owner 2026-09-09：这两项不需要 console 提供页面）。
 *
 * 用 DS 留的 `linkComponent` 注入点而不是去改 DS：那个口子的存在理由正是
 * 「路由无关，由产品侧决定链接怎么渲染」，这里判断的也是产品侧的事实。
 *
 * `noopener` 不能少：`target="_blank"` 打开的页面能拿到 `window.opener`，
 * 是一条已知的钓鱼路径。
 */
function NavLink({
  href,
  children,
  ...rest
}: {
  href: string;
  children?: ReactNode;
} & Record<string, unknown>) {
  if (/^https?:\/\//i.test(href)) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" {...rest}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} {...rest}>
      {children}
    </Link>
  );
}

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
  const locale = useLocale();

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
  /* 站内收件箱（product_330 P2-g）：铃铛角标 = 未读数，抽屉 = 最近 8 条。读失败静默
   * （壳层不能因通知接口挂掉而报错）；未读数每 60s 轮询一次，抽屉打开时把展示出来的
   * 未读逐条标已读。 */
  const [inboxItems, setInboxItems] = useState<InboxMessage[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const loadInbox = useCallback(async () => {
    try {
      const page = await fetchInbox({ limit: 8 });
      setInboxItems(page.items);
      setUnreadCount(page.unreadCount);
    } catch {
      /* 保持上一次的值 */
    }
  }, []);
  useEffect(() => {
    if (status !== "ready") return;
    void loadInbox();
    const timer = setInterval(() => {
      fetchInboxUnreadCount()
        .then((n) => setUnreadCount(n))
        .catch(() => {});
    }, 60_000);
    return () => clearInterval(timer);
  }, [status, loadInbox]);
  useEffect(() => {
    if (drawer !== "notifications") return;
    const unread = inboxItems.filter((m) => m.readAt === null);
    if (unread.length === 0) return;
    void Promise.allSettled(unread.map((m) => markInboxRead(m.id))).then(() =>
      loadInbox(),
    );
    // 只在抽屉打开的那一刻标已读；随后 loadInbox 更新 inboxItems 不应再触发。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawer]);
  /* 待办(批 4b):与「待办与消息」页同一份派生逻辑——铃铛角标 = 待办数 + 未读消息数,
   * 抽屉里待办置顶带「去处理」。抽屉打开时重取一次,处理完的事项别在抽屉里赖着。 */
  const derivedTodos = useDerivedTodos({ enabled: status === "ready" });
  const reloadTodos = derivedTodos.reload;
  useEffect(() => {
    if (drawer === "notifications") reloadTodos();
  }, [drawer, reloadTodos]);
  /* 帮助抽屉的数据(owner 2026-09-29 第 5 条裁决):未关闭的工单 + 各自最后一次
     动静。**只在抽屉打开时取**——它是派生视图,不喂角标、不承载已读,所以没有
     任何理由在每次翻页时都去打一次工单接口。null 区分「还没读到」与「一张都
     没有」;失败置 ticketsFailed,抽屉画重试而不是画「你没有工单」。 */
  const [helpTickets, setHelpTickets] = useState<ConsoleTicket[] | null>(null);
  const [helpLoading, setHelpLoading] = useState(false);
  const [helpFailed, setHelpFailed] = useState(false);
  const loadHelpTickets = useCallback(async () => {
    setHelpLoading(true);
    setHelpFailed(false);
    try {
      const rows = await fetchMyTickets();
      setHelpTickets(rows.filter((ticket) => isOpenTicket(ticket.status)));
    } catch {
      setHelpTickets(null);
      setHelpFailed(true);
    } finally {
      setHelpLoading(false);
    }
  }, []);
  useEffect(() => {
    if (drawer !== "help") return;
    void loadHelpTickets();
  }, [drawer, loadHelpTickets]);
  const tenantId = session.tenant?.id;
  const workspaceId = session.tenant?.workspace;
  const userId = session.user?.id;
  const scopeKey = JSON.stringify([userId, tenantId, workspaceId]);
  const [overview, setOverview] = useState<{
    scopeKey: string;
    balance: { balance: string; currency: string } | null;
    bill: { balance: string; currency: string } | null;
    quota: ConsoleQuotaUsage | null;
    plan: string | null;
    workspace: string | null;
  } | null>(null);
  // Never paint the previous scope while the next effect is still pending.
  const currentOverview = overview?.scopeKey === scopeKey ? overview : null;
  const accountBalance = currentOverview?.balance ?? null;
  const monthlyBill = currentOverview?.bill ?? null;
  const quotaUsage = currentOverview?.quota ?? null;
  const planName = currentOverview?.plan ?? null;
  const workspaceName =
    currentOverview?.workspace ?? session.tenant?.workspaceName ?? null;
  useEffect(() => {
    let alive = true;
    const empty = {
      scopeKey,
      balance: null,
      bill: null,
      quota: null,
      plan: null,
      workspace: null,
    };
    setOverview(empty);
    if (status !== "ready" || !userId || !tenantId) return;

    const update = (value: Partial<NonNullable<typeof overview>>) => {
      if (alive)
        setOverview((previous) => ({
          ...(previous?.scopeKey === scopeKey ? previous : empty),
          ...value,
        }));
    };

    const loadBalance = async () => {
      const value = await fetchCredits();
      update({ balance: value });
    };

    const loadBill = async () => {
      update({ bill: await fetchMonthlyBill() });
    };

    const loadPlan = async () => {
      const subs = await fetchMySubscriptions();
      const active = subs.find((s) => s.status === "active") ?? subs[0];
      update({ plan: active?.planName || null });
    };

    const loadQuota = async () => {
      const usage = await fetchQuotaUsage();
      update({ quota: usage });
    };

    const loadWorkspace = async () => {
      const items = await fetchMyWorkspaces();
      const current =
        items.find(
          (w) => w.tenantId === tenantId && w.workspaceId === workspaceId,
        ) ?? items.find((w) => w.tenantId === tenantId && w.isCurrent);
      update({ workspace: current?.workspaceName ?? null });
    };

    void Promise.allSettled([
      loadBalance(),
      loadBill(),
      loadPlan(),
      loadQuota(),
      loadWorkspace(),
    ]);

    return () => {
      alive = false;
    };
  }, [scopeKey, userId, tenantId, workspaceId, status]);

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
            /* 纯外链项没有 href,它的目的地是文档站(owner 2026-09-09:模型服务 /
               技能工具不需要 console 提供页面)。URL 在这里拼是因为它要带当前
               locale,而导航配置是静态的、拿不到 locale。 */
            href: it.docsSection
              ? buildWebsiteDocsUrl(locale, it.docsSection)
              : (it.href ?? "/"),
            label: tSidebar(`items.${it.labelKey}`),
            icon: it.icon,
            /* 副名标供给来源(Atlas / Runos)。**不走 i18n**:它是产品代号,
               翻译它等于把一个专名改掉。不传的项仍是单行,行为不变。 */
            ...(it.subLabel ? { subLabel: it.subLabel } : {}),
          })),
        })),
      ),
    /* locale 进依赖:外链 URL 里带着它,漏了的话切语言后图标仍指向旧 locale。 */
    [visibleDomains, tSidebar, locale],
  );

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

  const billAmount = monthlyBill ? Number(monthlyBill.balance) : NaN;
  const monthlyBillLabel =
    monthlyBill && Number.isFinite(billAmount)
      ? new Intl.NumberFormat(locale, {
          style: "currency",
          currency: monthlyBill.currency,
        }).format(billAmount)
      : "—";
  const balanceAmount = accountBalance ? Number(accountBalance.balance) : NaN;
  const balanceLabel =
    accountBalance && Number.isFinite(balanceAmount)
      ? new Intl.NumberFormat(locale, {
          style: "currency",
          currency: accountBalance.currency,
        }).format(balanceAmount)
      : "—";

  /* 抽屉条目 = 站内收件箱最近 8 条（P2-g）；点开去消息带的链接，没有链接去「待办与消息」。
     owner 2026-09-09:**不再按待办去重**——与页面同一口径。抽屉只放 8 条,藏掉一条的
     后果比整页更重:人会以为那条通知没来过。待办是派生的、会消失,消息是落库的凭据。 */
  const drawerNotifs: DrawerNotif[] = inboxItems.map((m) => {
    const p = inboxPresentation(m.templateCode);
    return {
      level: p.level,
      icon: p.icon,
      title: m.title,
      meta: `${formatInboxTime(m.createdAt, locale)} · ${m.body}`,
      href: m.link ?? "/inbox",
      unread: m.readAt === null,
    };
  });
  const drawerTodos = derivedTodos.todos.map((todo) => ({
    key: todo.key,
    title: todo.title,
    detail: todo.detail,
    href: todo.href,
    actionLabel: todo.actionLabel,
  }));
  const badgeCount = unreadCount + derivedTodos.todos.length;
  /* 「系统设置」抽屉已删（2026-08-30）：它没有任何入口（header 的齿轮直接去
   * /settings），而它的四行值全是编出来的词条——会话超时/审计保留与 /settings
   * 的真实默认值还互相矛盾。主题/密度的真实状态在 header 的偏好面板里。 */
  const drawerLabels = {
    title: tDrawer("notifications.title"),
    markAllRead: tDrawer("notifications.markAllRead"),
    openCenter: tShell("drawer.openCenter"),
    close: tDrawer("close"),
    empty: tDrawer("notifications.empty"),
    todosTitle: tDrawer("notifications.todosTitle"),
    messagesTitle: tDrawer("notifications.messagesTitle"),
  };

  if (status === "loading") {
    return (
      <div className="vx-shell-user-center flex h-dvh flex-col overflow-hidden text-foreground">
        {/* 骨架用 DS 的 ShellHeader 本体（而非旧的 .vxh--skeleton 类）撑版位：
            两者高度必须逐像素相同，否则会话就绪的一刻整页会往下跳一格。 */}
        <ShellHeader
          height="lg"
          surface="transparent"
          centerAlign="end"
          leading={
            <>
              <Skeleton className="h-icon-lg w-media-xs" />
            </>
          }
          center={<Skeleton className="h-icon-xl w-full max-w-media-4xl" />}
          trailing={
            <ShellHeaderActions>
              <Skeleton className="size-icon-xl rounded-full" />
              <Skeleton className="h-icon-xl w-media-xs rounded-lg" />
              <Skeleton className="size-icon-xl rounded-full" />
            </ShellHeaderActions>
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
            <ShellPageContainer layout="user-center" className="gap-lg">
              <Skeleton className="h-icon-2xl w-media-2xl" />
              <Skeleton className="h-media-lg w-full" />
              <Skeleton className="h-media-lg w-full" />
            </ShellPageContainer>
          </main>
        </div>
        <ConsoleFooter />
      </div>
    );
  }

  return (
    <div className="vx-shell-user-center flex h-dvh flex-col overflow-hidden text-foreground">
      <ConsoleHeader
        openDrawer={(type) => setDrawer(type)}
        unreadCount={badgeCount}
        onNavigate={navigate}
        brandName={tShell("brandName")}
        navEntries={navEntries}
        quotaUsage={quotaUsage}
        workspaceName={workspaceName}
        monthlyBillLabel={monthlyBillLabel}
        balanceLabel={balanceLabel}
        planName={planName}
      />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* DS 外壳 + DS 导航内容：宽度状态机归 ShellSidebarFrame（w-sidebar-*），
         * 内容归 ShellSidebarNav。原先外层是 shell-template.css 的 .sidebar，
         * 它自带 padding 与另一套宽度，跟导航内容自己的 L1 p-xs 叠加，这正是
         * 两个门户间距对不齐的来源（批 D：.sidebar 已随 shell-template 退役）。 */}
        <ShellSidebarFrame mode={navCollapsed ? "collapsed" : "expanded"}>
          <ShellSidebarNav
            /* owner 2026-09-08:侧栏头部不显示分组名(与设计不符) —— 这条仍然有效,
                 变的只是怎么实现。

                 原先的做法是传 `domainName=""`,理由写着「不改 DS——那一格是 flex-1
                 的占位,空着正好让右侧按钮保持靠右」。**两个前提现在都不成立了**:
                 DS 12.13.0 起 `domainName` 本身就是可选的,不传时组件内部渲染等效
                 占位(`min-w-0 flex-1`),靠右不再依赖调用方喂一个空串;而「不改 DS」
                 这个取舍也已被推翻——运营三平面同样要去掉这行标题,于是改在了 DS 侧
                 (owner 2026-09-18)。

                 所以这里现在**什么都不传**。留着空串只会让人以为它有特殊作用。 */
            sections={navSections}
            collapsed={navCollapsed}
            onToggleCollapsed={toggleNav}
            isActive={(href) => isNavigationActive(pathname, href)}
            storageKeyPrefix="vx-console-nav"
            linkComponent={NavLink}
            labels={sidebarLabels}
          />
        </ShellSidebarFrame>
        <main className={CONTENT_SCROLL} {...{ [CONTENT_SCROLL_ATTR]: "" }}>
          <ShellPageContainer layout="user-center">
            {children}
          </ShellPageContainer>
        </main>
      </div>

      <ConsoleFooter />

      {drawer === "notifications" && (
        <TemplateDrawer
          onClose={() => setDrawer(null)}
          onNavigate={navigate}
          onMarkAllRead={() => {
            markInboxAllRead()
              .then(() => loadInbox())
              .catch(() => {});
          }}
          canMarkAllRead={unreadCount > 0}
          onOpenCenter={() => navigate("/inbox")}
          todos={drawerTodos}
          notifications={drawerNotifs}
          labels={drawerLabels}
        />
      )}

      {drawer === "help" && (
        <HelpDrawer
          onClose={() => setDrawer(null)}
          onNavigate={navigate}
          tickets={helpTickets}
          loading={helpLoading}
          failed={helpFailed}
          onRetry={() => void loadHelpTickets()}
        />
      )}
    </div>
  );
}
