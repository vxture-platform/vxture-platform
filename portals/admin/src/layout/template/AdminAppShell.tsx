"use client";

/* Admin 壳层容器。
 * Header 置顶 + 主体行(Sidebar / 内容 / Assistant) + Drawer——全 DS 组件与 T2 工具类。
 * 顶层视图 = 管理工作域（运营域 / 自治域），launcher 切换即路由跳转；
 * 导航来自 adminWorkspaces；助手为真实 VardaChat（admin surface）。
 *
 * 外壳三件（header / sidebar / 内容容器）已换成 DS 部件，与 console / opera
 * 同源；原先 1:1 转写自设计稿的 `.vxh-*` / `.sidebar` / `.content-*` 遗留类
 * 不再被本文件引用。 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Icon,
  Progress,
  ShellBootScreen,
  ShellPageContainer,
  ShellSidebarFrame,
  ShellSidebarNav,
  type ShellNavSection,
} from "@vxture/design-system";
import { writeNavCollapsed } from "@vxture/shared";
import { useAdminSession } from "@/features/session/AdminSessionProvider";
import {
  adminWorkspaces,
  getAdminNavigationItemByPath,
  getAdminWorkspaceByPath,
} from "@/config/navigation";
import { useConsoleTranslations } from "@/lib/ConsoleIntl";
import { AdminHeader, type AdminHeaderViewOption } from "../header/AdminHeader";
import type { NavSearchEntry } from "../header/useAdminSearch";
import type { ShellView, ShellDrawerType, AssistantMode } from "./shell/types";
import { TemplateAssistant } from "./TemplateAssistant";
import { TemplateDrawer, type DrawerNotif } from "./TemplateDrawer";

/* 内容滚动区：原先是遗留 CSS 的 `.content-scroll`（shell-template/app.css）。
 * 等价 Tailwind 写法搬到这里，admin 因此不再依赖那份 CSS 的布局规则。
 * `data-content-scroll` 是给路由跳转后复位滚动条用的锚点——用数据属性而不是
 * 继续拿类名当选择器，类名以后可以随便改。与 console 同一处理。 */
const CONTENT_SCROLL = "min-w-0 flex-1 scroll-smooth overflow-y-auto";
const CONTENT_SCROLL_ATTR = "data-content-scroll";

/* nav 收起态已迁到 cookie（见 layout.tsx / nav-preference.constants.ts），不再列在这里——
 * 留一个用不到的 key 会让下一个人以为它还是权威来源。 */
const LS = {
  vela: "vx-admin-tpl-vela-open",
  velaMode: "vx-admin-tpl-vela-mode",
};

function ShellFrame({
  children,
  initialNavCollapsed,
}: {
  children: ReactNode;
  initialNavCollapsed: boolean;
}) {
  const { session, status, signOut } = useAdminSession();
  const router = useRouter();
  const pathname = usePathname();
  const tNav = useConsoleTranslations("navigation");
  const tShell = useConsoleTranslations("shell");
  const tDrawer = useConsoleTranslations("drawer");

  /* 初始值由服务端从 cookie 读出后传入，首帧即最终态。写死 false 再在 effect
   * 里纠正，会让刷新时导航"先展开再收起"闪一下——localStorage 对服务端不可见，
   * 那个时序问题无法在客户端解决。 */
  const [navCollapsed, setNavCollapsed] = useState(initialNavCollapsed);
  const [velaOpen, setVelaOpen] = useState(false);
  const [assistantMode, setAssistantMode] = useState<AssistantMode>("narrow");
  const [drawer, setDrawer] = useState<ShellDrawerType | null>(null);

  // hydrate persisted UI state (client-only, avoids SSR mismatch)
  useEffect(() => {
    try {
      // nav 收起态不在这里读：它已经由服务端经 cookie 传进来了（见上）。
      setVelaOpen(window.localStorage.getItem(LS.vela) === "1");
      const m = window.localStorage.getItem(LS.velaMode);
      if (m === "narrow" || m === "wide" || m === "full") setAssistantMode(m);
    } catch {
      /* ignore */
    }
  }, []);

  /* 未登录的跳转**只由 AdminSessionProvider 发起**，这里不再另开一路。
   *
   * 原先这里还有一个 `router.replace('/login?next=…')`：它与 provider 里的
   * `location.replace(silent SSO)` 是两个独立的跳转触发器，靠 `vx_sso_silent`
   * 标志错开先后，而中间那个 `/login` 页本身又是一次完整页面加载——只为在屏幕上
   * 写一句"正在跳转到登录…"再跳走。provider 现在直接跳交互式登录，这一跳没了。
   * `/login` 路由保留（可能有深链指向它），只是不再在主路径上。 */

  const toggleNav = () =>
    setNavCollapsed((c) => {
      const n = !c;
      writeNavCollapsed("admin", n);
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
      writeNavCollapsed("admin", true);
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

  // ── 顶层视图（管理工作域）──
  const activeWorkspace = getAdminWorkspaceByPath(pathname);
  /* icon 直接取注册表里的 DS IconName。原先经 WORKSPACE_PH_ICON + phNavIcon
   * 转成 Phosphor class 串——那是为字体图标准备的降级层，随字体图标一起退役。 */
  const views: AdminHeaderViewOption[] = adminWorkspaces.map((w) => ({
    id: w.id,
    name: w.label,
    desc: w.description,
    icon: w.icon,
  }));
  const selectView = (id: ShellView) => {
    const w = adminWorkspaces.find((x) => x.id === id);
    if (w) navigate(w.homeHref);
  };

  // ── 侧栏导航分组（来自当前工作域）──
  const navSections: ShellNavSection[] = useMemo(
    () =>
      activeWorkspace.sections.map((section) => ({
        title: tNav(`sections.${section.id}`, section.title),
        items: section.items.map((it) => ({
          href: it.href,
          label: tNav(`items.${it.id}.label`, it.label),
          icon: it.icon,
        })),
      })),
    [activeWorkspace, tNav],
  );
  const activeHref = getAdminNavigationItemByPath(pathname)?.item.href;

  /* 搜索面板的「页面」来源：拍平当前工作域的导航项。用 navSections 而不是
   * 原始注册表——当前域里看不到的页面不该出现在结果里。 */
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

  /* 侧栏底部卡片 · 占位重点指标（待接真实平台健康度 BFF）。
   * DS 导航的 footer 槽是固定 64px，原先的三行卡片会溢出，重建成"一行标签 +
   * 一条进度"。收起态不渲染——轨道宽度放不下标签。 */
  const healthPct = 99;
  const sidebarFooter = navCollapsed ? null : (
    <div className="flex w-full flex-col justify-center gap-2xs px-2xs">
      <div className="flex items-center gap-2xs text-label-sm text-muted-foreground">
        <Icon name="gauge" size="xs" fallback="placeholder" />
        <span className="min-w-0 flex-1 truncate">
          {tShell("metricCard.title", "平台健康度")}
        </span>
        <span className="shrink-0 tabular-nums">{healthPct}%</span>
      </div>
      <Progress value={healthPct} />
    </div>
  );

  // ── Drawer 占位数据（demo，待接真实消息中心 / 系统设置）──
  const drawerNotifs: DrawerNotif[] = [
    {
      level: "danger",
      icon: "ph-warning-octagon",
      title: tDrawer("notifications.items.audit.title", "高风险操作待审批"),
      meta: tDrawer("notifications.items.audit.meta", "审批中心 · 12 分钟前"),
      href: "/approval-center",
    },
    {
      level: "info",
      icon: "ph-ticket",
      title: tDrawer("notifications.items.ticket.title", "新增待处理工单 6 条"),
      meta: tDrawer("notifications.items.ticket.meta", "工单中心 · 今日"),
      href: "/tickets",
    },
  ];
  const settingsRows: Array<[string, string]> = [
    [
      tDrawer("settings.rows.theme.label", "默认主题"),
      tDrawer("settings.rows.theme.value", "跟随系统"),
    ],
    [
      tDrawer("settings.rows.density.label", "界面密度"),
      tDrawer("settings.rows.density.value", "默认"),
    ],
    [
      tDrawer("settings.rows.sessionTimeout.label", "会话超时"),
      tDrawer("settings.rows.sessionTimeout.value", "30 分钟"),
    ],
    [
      tDrawer("settings.rows.auditRetention.label", "审计日志保留"),
      tDrawer("settings.rows.auditRetention.value", "180 天"),
    ],
  ];
  const drawerLabels = {
    notificationsTitle: tDrawer("notifications.title", "消息中心"),
    settingsTitle: tDrawer("settings.title", "系统设置"),
    markAllRead: tDrawer("notifications.markAllRead", "全部已读"),
    openCenter: tDrawer("openCenter", "前往消息中心"),
    close: tDrawer("close", "关闭"),
  };

  const sidebarLabels = {
    expandNav: tShell("sidebar.expandNav", "展开导航"),
    collapseNav: tShell("sidebar.collapseNav", "收起导航"),
    expandAllGroups: tShell("sidebar.expandAllGroups", "展开全部分组"),
    collapseAllGroups: tShell("sidebar.collapseAllGroups", "收起全部分组"),
  };

  const handleSignOut = async () => {
    await signOut();
    router.replace("/login");
  };
  const handleSwitchUser = async () => {
    await signOut();
    router.replace("/login");
  };

  const velaActive = velaOpen;

  /* 会话未定 → 整屏加载页，不是骨架屏。
   *
   * 骨架屏的前提是「这块内容一定会出现，只是还没到」——它承诺布局。会话未定时
   * 这个前提不成立：答案可能是"未登录"，接下来整页会被换成登录跳转。此时画一屏
   * header + 侧栏 + 卡片的骨架，等于先许诺一个不会兑现的界面再当面撤掉；未登录
   * 冷启动要落回门户两次，同一屏骨架就闪两遍。ShellBootScreen 只画居中的转圈，
   * 且 250ms 内出结果就完全不显示。 */
  if (status !== "ready") {
    return (
      <ShellBootScreen
        label="Vxture Platform"
        description={tShell("loading.label", "加载中")}
      />
    );
  }

  /* 走到这里只剩一种情况：会话接口**请求失败**（BFF 不可达），provider 的
   * catch 分支置了 ready + 空会话。正常的"未登录"根本到不了这里——provider
   * 已经把浏览器送去登录了，状态会一直停在 loading。
   *
   * 原先这里 `return null`，于是 BFF 挂掉时用户看到的是一片纯白，没有任何
   * 线索。继续显示加载页并说明原因，至少是句人话。 */
  if (!session.isAuthenticated || !session.user) {
    return (
      <ShellBootScreen
        label="Vxture Platform"
        description={tShell("loading.unreachable", "无法连接服务，正在重试…")}
        delayMs={0}
      />
    );
  }

  return (
    <div
      className={
        // bg-background 由外壳自己上：底色原先由遗留样式层画在 html 上，
        // 退役后必须有人把 --background 画出来，跟 console 是同一个位置。
        // 批 D：.app 遗留类换工具类；vela-open/nav-collapsed 状态钩子全仓无样式引用，删。
        "flex h-screen flex-col overflow-hidden bg-background text-foreground"
      }
    >
      <AdminHeader
        views={views}
        activeViewId={activeWorkspace.id}
        onSelectView={selectView}
        activeMenuName={activeWorkspace.label}
        assistantOpen={velaOpen}
        setAssistantOpen={openVela}
        showAssistant
        openDrawer={(t) => setDrawer(t)}
        onNavigate={navigate}
        onSwitchUser={handleSwitchUser}
        onSignOut={handleSignOut}
        brandName="Vxture Platform"
        navEntries={navEntries}
      />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* DS 外壳 + DS 导航内容：宽度状态机归 ShellSidebarFrame（w-sidebar-*），
         * 内容归 ShellSidebarNav。原先外层是 shell-template.css 的 .sidebar，
         * 它自带 padding 与另一套宽度，跟导航内容自己的内距叠加，这正是三个
         * 门户间距对不齐的来源。 */}
        <ShellSidebarFrame mode={navCollapsed ? "collapsed" : "expanded"}>
          <ShellSidebarNav
            domainName={activeWorkspace.label}
            sections={navSections}
            collapsed={navCollapsed}
            onToggleCollapsed={toggleNav}
            // admin 路由有嵌套（/tenants/:id），active 判定要前缀匹配；根路由
            // 例外，否则它对任何路径都成立。
            isActive={(href) =>
              href === "/"
                ? pathname === "/"
                : (activeHref ?? pathname).startsWith(href)
            }
            storageKeyPrefix="vx-admin-nav"
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

export function AdminAppShell({
  children,
  initialNavCollapsed = false,
}: {
  children: ReactNode;
  initialNavCollapsed?: boolean;
}) {
  return (
    <ShellFrame initialNavCollapsed={initialNavCollapsed}>
      {children}
    </ShellFrame>
  );
}
