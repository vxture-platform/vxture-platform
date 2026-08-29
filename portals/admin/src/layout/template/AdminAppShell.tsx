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
  ShellBootScreen,
  ShellPageContainer,
  ShellSidebarFrame,
  ShellSidebarNav,
  useTheme,
  type Density,
  type ShellNavSection,
} from "@vxture/design-system";
import { writeNavCollapsed } from "@vxture-platform/shared";
import { useAdminSession } from "@/features/session/AdminSessionProvider";
import { fetchNotificationLogs } from "@/api/admin-bff";
import type { NotificationLogRecord } from "@/entities/console";
import {
  adminWorkspaces,
  getAdminNavigationItemByPath,
  getAdminWorkspaceByPath,
} from "@/config/navigation";
import { useLocale, useTranslations } from "next-intl";
import { AdminHeader, type AdminHeaderViewOption } from "../header/AdminHeader";
import type { NavSearchEntry } from "../header/useAdminSearch";
import type { ShellView, ShellDrawerType } from "./shell/types";
import { TemplateDrawer, type DrawerNotif } from "./TemplateDrawer";

/* 内容滚动区：原先是遗留 CSS 的 `.content-scroll`（shell-template/app.css）。
 * 等价 Tailwind 写法搬到这里，admin 因此不再依赖那份 CSS 的布局规则。
 * `data-content-scroll` 是给路由跳转后复位滚动条用的锚点——用数据属性而不是
 * 继续拿类名当选择器，类名以后可以随便改。与 console 同一处理。 */
const CONTENT_SCROLL = "min-w-0 flex-1 scroll-smooth overflow-y-auto";
const CONTENT_SCROLL_ATTR = "data-content-scroll";

/* ── 通知抽屉：数据源是 support.notification_logs ──
 * 抽屉里原先是两条写死的演示通知（"高风险操作待审批 · 12 分钟前"之类），每个页面
 * 都能点开看见，却从未对应任何一条记录。2026-08-30 改读 GET /api/notification-logs
 * ——平台通知的投递台账（邮件/短信/站内/Webhook，含失败与退回），最近几条；
 * "前往消息中心"落到同一张台账的完整页。没有的时候就是空态，不补假行。 */
const DRAWER_NOTIF_LIMIT = 8;
const NOTIFICATION_CENTER_HREF = "/notification-logs";
/** 投递状态 → 抽屉行语气：failed/bounced 要人管；queued 还在路上；其余是回执。 */
const NOTIF_LEVEL: Record<string, DrawerNotif["level"]> = {
  failed: "danger",
  bounced: "danger",
  queued: "warning",
};
/** 渠道 → Phosphor 类名。抽屉行的图标仍走字体图标，与 TemplateDrawer 同一套。 */
const NOTIF_ICON: Record<string, string> = {
  email: "ph-envelope",
  sms: "ph-chat-text",
  inapp: "ph-bell",
  webhook: "ph-webhooks-logo",
  push: "ph-device-mobile",
};

function formatNotifTime(value: string, locale: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/* ── 设置抽屉：两行都读当前状态 ──
 * 主题模式与密度来自 ThemeProvider（header 的偏好面板改的就是这一份，跨门户由
 * platform-browser 持久化）。原先是四条写死的词条——"跟随系统 / 默认 / 会话超时
 * 30 分钟 / 审计日志保留 180 天"；后两项在 admin.settings 里根本没有对应的配置行
 * （seed 只有 operator.mfa.policy），数字是编的，2026-08-30 摘掉。 */
const THEME_LABEL_KEY = {
  system: "themeSystem",
  light: "themeLight",
  dark: "themeDark",
} as const;
const DENSITY_LABEL_KEY: Record<
  Density,
  "densityCompact" | "densityDefault" | "densityComfy"
> = {
  compact: "densityCompact",
  default: "densityDefault",
  comfortable: "densityComfy",
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
  const tNav = useTranslations("navigation");
  const tShell = useTranslations("shell");
  const tDrawer = useTranslations("drawer");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const { mode: themeMode, density } = useTheme();

  /* 初始值由服务端从 cookie 读出后传入，首帧即最终态。写死 false 再在 effect
   * 里纠正，会让刷新时导航"先展开再收起"闪一下——localStorage 对服务端不可见，
   * 那个时序问题无法在客户端解决。 */
  const [navCollapsed, setNavCollapsed] = useState(initialNavCollapsed);
  const [drawer, setDrawer] = useState<ShellDrawerType | null>(null);
  /* 只在通知抽屉打开时拉，关掉就丢：这是抽屉不是收件箱，台账没有已读态可维护。
   * `null` = 还没回来，与"回来了但是空"分开画。没有 notification:log.read 能力的
   * 操作员拿到 403，readJson 落回 []——对他们抽屉就是空的，不报错。 */
  const [notifLogs, setNotifLogs] = useState<NotificationLogRecord[] | null>(
    null,
  );
  const closeDrawer = () => {
    setDrawer(null);
    setNotifLogs(null);
  };

  useEffect(() => {
    if (drawer !== "notifications") return;
    let active = true;
    void fetchNotificationLogs().then((rows) => {
      if (active) setNotifLogs(rows.slice(0, DRAWER_NOTIF_LIMIT));
    });
    return () => {
      active = false;
    };
  }, [drawer]);

  // hydrate persisted UI state (client-only, avoids SSR mismatch)
  useEffect(() => {
    try {
      // nav 收起态不在这里读：它已经由服务端经 cookie 传进来了（见上）。
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
  /* Varda 已迁独立仓重构(2026-08-18):助手停靠列与其状态机随之移除,
   * 重构完成发包后按新包名 @vxture/varda 重新接入。 */

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
        /* 这两处的键**由数据驱动**（工作域配置里的 section / item id），词条目录
           不可能穷举，所以托底是真需要的——`t.has()` 先问一句，没有就用配置里
           自带的中文名。其余 24 处静态键的托底是死代码：键全都存在，那句中文
           永远不会渲染，留着只会让人以为「翻译还没做」。已一并摘掉。 */
        title: tNav.has(`sections.${section.id}`)
          ? tNav(`sections.${section.id}`)
          : section.title,
        items: section.items.map((it) => ({
          href: it.href,
          label: tNav.has(`items.${it.id}.label`)
            ? tNav(`items.${it.id}.label`)
            : it.label,
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

  /* 侧栏底部原先有一条"平台健康度 99%"的进度——`healthPct = 99` 写死，没有任何
   * 健康度数据源（TD-036：平台无健康检查/事件记录表），却挂在每一页上。
   * 2026-08-30 摘掉，footer 槽留空；有真数据源时再回来。 */

  const drawerNotifs: DrawerNotif[] = (notifLogs ?? []).map((log) => {
    const channelKey = `notifications.channels.${log.channel}`;
    const statusKey = `notifications.statuses.${log.status}`;
    return {
      id: log.id,
      level: NOTIF_LEVEL[log.status] ?? "info",
      icon: NOTIF_ICON[log.channel] ?? "ph-bell",
      title: log.subject?.trim() || log.templateCode,
      meta: [
        tDrawer.has(channelKey) ? tDrawer(channelKey) : log.channel,
        tDrawer.has(statusKey) ? tDrawer(statusKey) : log.status,
        log.recipient,
        formatNotifTime(log.createdAt, locale),
      ]
        .filter(Boolean)
        .join(" · "),
      href: NOTIFICATION_CENTER_HREF,
    };
  });
  const settingsRows: Array<[string, string]> = [
    [tDrawer("settings.rows.theme.label"), tShell(THEME_LABEL_KEY[themeMode])],
    [
      tDrawer("settings.rows.density.label"),
      tShell(DENSITY_LABEL_KEY[density]),
    ],
  ];
  const drawerLabels = {
    notificationsTitle: tDrawer("notifications.title"),
    settingsTitle: tDrawer("settings.title"),
    loading: tCommon("loading"),
    emptyTitle: tDrawer("notifications.empty.title"),
    emptyDescription: tDrawer("notifications.empty.description"),
    openCenter: tDrawer("openCenter"),
    close: tDrawer("close"),
  };

  const sidebarLabels = {
    expandNav: tShell("sidebar.expandNav"),
    collapseNav: tShell("sidebar.collapseNav"),
    expandAllGroups: tShell("sidebar.expandAllGroups"),
    collapseAllGroups: tShell("sidebar.collapseAllGroups"),
  };

  const handleSignOut = async () => {
    await signOut();
    router.replace("/login");
  };
  const handleSwitchUser = async () => {
    await signOut();
    router.replace("/login");
  };

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
        description={tShell("loading.label")}
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
        description={tShell("loading.unreachable")}
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
          />
        </ShellSidebarFrame>
        <main className={CONTENT_SCROLL} {...{ [CONTENT_SCROLL_ATTR]: "" }}>
          <ShellPageContainer>{children}</ShellPageContainer>
        </main>
      </div>

      {drawer && (
        <TemplateDrawer
          type={drawer}
          onClose={closeDrawer}
          onNavigate={navigate}
          notifications={drawerNotifs}
          notificationsLoading={notifLogs === null}
          notificationCenterHref={NOTIFICATION_CENTER_HREF}
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
