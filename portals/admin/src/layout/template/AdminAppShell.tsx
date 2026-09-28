"use client";

/* Admin 壳层容器。
 * Header 置顶 + 主体行(Sidebar / 内容 / Assistant) + Drawer——全 DS 组件与 T2 工具类。
 * 顶层视图 = 管理工作域（运营域 / 自治域），launcher 切换即路由跳转；
 * 导航来自 adminWorkspaces；助手为真实 VardaChat（admin surface）。
 *
 * 外壳三件（header / sidebar / 内容容器）已换成 DS 部件，与 console / opera
 * 同源；原先 1:1 转写自设计稿的 `.vxh-*` / `.sidebar` / `.content-*` 遗留类
 * 不再被本文件引用。 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Button,
  EmptyState,
  ShellBootScreen,
  ShellPageContainer,
  ShellSidebarFrame,
  ShellSidebarNav,
  useTheme,
  useToast,
  type Density,
  type ShellNavSection,
} from "@vxture/design-system";
import { formatDateTime, writeNavCollapsed } from "@vxture-platform/shared";
import { useAdminSession } from "@/features/session/AdminSessionProvider";
import {
  fetchNotificationLogs,
  fetchOperatorNotices,
  markAllOperatorNoticesRead,
  markOperatorNoticeRead,
} from "@/api/admin-bff";
import type { OperatorNoticeItem } from "@/api/admin-bff";
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
import {
  TemplateDrawer,
  type DrawerNotif,
  type DrawerNotifSection,
} from "./TemplateDrawer";

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
/* 「前往消息中心」的落地页原是 admin 的 /notification-logs。完整台账页随治理平面
 * cutover（#121）迁去 arche 了，admin 里这个路由已不存在——按钮和每一行都还指着它，
 * 点了 404，2026-09-08 走查才发现。抽屉本身保留（看最近几条投递记录不需要落地页），
 * 落地页不传：TemplateDrawer 拿不到 href 就不渲染按钮、整行降级成不可点。
 *
 * 续行的 `*` 不是排版洁癖：ds/no-raw-color 的 isCommentLine 按「本行以 * 开头」
 * 认注释，纯缩进的续行不算，于是 `（#121）` 会被当成三位十六进制色值报错。 */
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

/* ── 通知抽屉第一段 + 铃铛角标：运营通告（admin.operator_notices）──
 * 客户申报付款 / 申请退款 / 退订这些事件，客户收到消息的同时由通知分发器镜像成
 * 一条运营通告（2026-09-28 根治：「运营端收到的信息和客户侧要完整一致」）；opera
 * 手工发布的通告也在同一张表。角标 = 本平面未读数；抽屉列 digest 档（当天已读 +
 * 所有未读）最近几条，「查看全部」落到 /messages。投递日志退为第二段，功能不删。
 *
 * 2026-09-28 第四批改了「已读」这一半（前三批把信号做全，这一批让它读得懂）：
 *   · 抽屉里给一颗「全部标记已读」。作用域 = 角标数的那个集合（本平面全部未读），
 *     所以按完角标必然归零；筛选不参与——那一层在 /messages 上。
 *   · **点开一条就把它标成已读**。此前刻意不代点，理由是「点开一条不等于处理完」；
 *     但角标数的是「有没有看过」，不是「有没有办完」，于是三批信号做全之后角标长期
 *     停在两位数、谁也不再看它——一个永远不归零的角标等于没有角标。办没办完由通告
 *     指向的那张单子自己回答（订单页、退款页），不由这里的已读位代答。 */
const DRAWER_NOTICE_LIMIT = 10;
/** 未读数轮询间隔。与 console 站内收件箱同一节奏。 */
const NOTICE_POLL_MS = 60_000;
/** 严重度 → 抽屉行语气。 */
const NOTICE_LEVEL: Record<
  OperatorNoticeItem["severity"],
  DrawerNotif["level"]
> = {
  critical: "danger",
  warning: "warning",
  info: "info",
};
/** 严重度 → Phosphor 类名。抽屉行的图标仍走字体图标，与投递日志同一套。 */
const NOTICE_ICON: Record<OperatorNoticeItem["severity"], string> = {
  critical: "ph-warning-octagon",
  warning: "ph-warning",
  info: "ph-megaphone",
};

function formatNotifTime(value: string, locale: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return formatDateTime(date, locale, "");
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
  const { toast } = useToast();

  /* 初始值由服务端从 cookie 读出后传入，首帧即最终态。写死 false 再在 effect
   * 里纠正，会让刷新时导航"先展开再收起"闪一下——localStorage 对服务端不可见，
   * 那个时序问题无法在客户端解决。 */
  const [navCollapsed, setNavCollapsed] = useState(initialNavCollapsed);
  const [drawer, setDrawer] = useState<ShellDrawerType | null>(null);
  /* 只在通知抽屉打开时拉，关掉就丢：这是抽屉不是收件箱，台账没有已读态可维护。
   * `null` = 还没回来，与"回来了但是空"分开画。没有 content:notification_log.read 能力的
   * 操作员拿到 403，readJson 落回 []——对他们抽屉就是空的，不报错。 */
  const [notifLogs, setNotifLogs] = useState<NotificationLogRecord[] | null>(
    null,
  );
  const closeDrawer = () => {
    setDrawer(null);
    setNotifLogs(null);
  };
  /* 运营通告：`null` = 还没回来；读失败记 `noticesFailed`，抽屉里说「读取失败」
   * 而不是画成「没有通告」——那是两件事。角标在失败时不画：拿不到数就不报数。 */
  const [notices, setNotices] = useState<OperatorNoticeItem[] | null>(null);
  const [noticesFailed, setNoticesFailed] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  /* 「全部标记已读」在办中。按钮禁用，免得连按两次发两个请求——第二个会回
     marked:0，而人会读成「只标上了 0 条」。 */
  const [markingAll, setMarkingAll] = useState(false);
  const loadNotices = useCallback(async () => {
    try {
      const result = await fetchOperatorNotices({
        scope: "digest",
        limit: DRAWER_NOTICE_LIMIT,
        offset: 0,
      });
      setNotices(result.items);
      setUnreadCount(result.unread);
      setNoticesFailed(false);
    } catch {
      setNotices([]);
      setUnreadCount(0);
      setNoticesFailed(true);
    }
  }, []);

  /* 点开一条时把它标成已读。
     先改本地态再发请求：这一步没有失败代价（重标幂等），等一圈往返才变灰会让人
     以为没点上——而这一下点击紧接着就是路由跳转，抽屉当场卸载，根本等不到回包。
     失败时下一次轮询（每分钟）自会把真值读回来。 */
  const markNoticeRead = useCallback((notice: OperatorNoticeItem) => {
    if (notice.readAt !== null) return;
    const readAt = new Date().toISOString();
    setNotices((prev) =>
      prev
        ? prev.map((item) =>
            item.id === notice.id ? { ...item, readAt } : item,
          )
        : prev,
    );
    setUnreadCount((prev) => Math.max(0, prev - 1));
    void markOperatorNoticeRead(notice.id).catch(() => {
      /* 本地已经画成已读了，纠正交给下一次轮询：这里再弹一个错，会在人已经
         跳到订单页之后从背后冒出来说「刚才那下没成」，而他也无从处置。 */
    });
  }, []);

  /* 「全部标记已读」。
     这一下**不乐观更新**：它一次动几十条，猜错的面比单条大得多，而且它不伴随
     路由跳转，等一个往返是可以接受的。回来之后重读一次——角标归不归零由库里的
     真值说，不由这里的减法说。 */
  const markAllNoticesRead = useCallback(async () => {
    setMarkingAll(true);
    try {
      const { marked } = await markAllOperatorNoticesRead();
      toast({
        tone: "success",
        title: tDrawer("notices.markAllDone", { count: marked }),
      });
    } catch {
      /* 失败要说出来。不说的话界面上什么都没变，而「什么都没变」同时兼容
         「没有未读可标」与「请求挂了」——两者对人的含义完全不同。

         **只给目录里的标题，不挂 cause.message**：那串没有哪一侧保证它
         跟着 locale 走——服务端没给 message 时它还会是客户端写死的兜底句，
         于是英文标题下面跟一句中文说明。壳层这两个 toast 因此同一形状：
         只一句标题，字句全部来自 messages 目录。 */
      toast({
        tone: "danger",
        title: tDrawer("notices.markAllFailed"),
      });
    } finally {
      setMarkingAll(false);
      await loadNotices();
    }
  }, [loadNotices, toast, tDrawer]);

  /* 会话就绪后拉一次，之后每分钟刷新；抽屉每次打开再拉一次，列出来的一定是
   * 当下的。 */
  useEffect(() => {
    if (status !== "ready") return;
    void loadNotices();
    const timer = setInterval(() => {
      void loadNotices();
    }, NOTICE_POLL_MS);
    return () => clearInterval(timer);
  }, [status, loadNotices]);

  useEffect(() => {
    if (drawer !== "notifications") return;
    void loadNotices();
  }, [drawer, loadNotices]);

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
  /* 工作域的名字与说明走词条。此前这两处是配置里的中文字面量直出——于是英文
     界面下侧栏与菜单项都是英文，而表头这个切换器仍是「运营平面」。owner 实看
     报的「半中半英」，这是其中一处。 */
  const views: AdminHeaderViewOption[] = adminWorkspaces.map((w) => ({
    id: w.id,
    name: tNav(`workspaces.${w.id}.label`),
    desc: tNav(`workspaces.${w.id}.description`),
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
        /* 不再 `t.has()` 托底。原来的理由是「键由数据驱动，词条目录不可能穷举」
           ——那句话不成立：数据驱动的是运行时选哪一个，不是可能有哪些。取值
           集合就是 navigation.ts，它在仓里，是可枚举的。

           而托底的代价是**静默的半中半英**：有词条的菜单项在英文界面变英文，
           没词条的原样留中文，两者并排出现在同一条侧栏里，谁也不会报错。
           2026-09-20 实测缺 3 条（planVersions / atlas / capabilityPricing）。

           现在由 `lint:admin-nav-messages` 在 CI 期保证每个 id 都有词条，缺了
           当场红。运行时缺键则由 `adminMessageFallback` 渲染成键路径本身——
           难看，但看得见，比悄悄换回中文强。 */
        title: tNav(`sections.${section.id}`),
        items: section.items.map((it) => ({
          href: it.href,
          label: tNav(`items.${it.id}.label`),
          /* 副名走配置里的英文原词，不走词条：它的用途是让人把中文菜单名对上审计
             事件与 API 里的那个词（opera 规则一），那个词在两种界面语言下是同一个，
             翻译它等于把这条路断掉。

             条件展开而不是 `subLabel: it.subLabel`——本仓开着
             `exactOptionalPropertyTypes`，「不传这个键」与「传了但值是 undefined」
             是两件事，后者对 `subLabel?: string` 不合法。 */
          ...(it.subLabel === undefined ? {} : { subLabel: it.subLabel }),
          icon: it.icon,
        })),
        ...(section.dividerBefore === undefined
          ? {}
          : { dividerBefore: section.dividerBefore }),
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
    };
  });
  const drawerNotices: DrawerNotif[] = (notices ?? []).map((notice) => ({
    id: notice.id,
    level: NOTICE_LEVEL[notice.severity],
    icon: NOTICE_ICON[notice.severity],
    title: notice.title,
    meta: [
      notice.readAt === null ? tDrawer("notices.unread") : null,
      formatNotifTime(notice.publishedAt, locale),
    ]
      .filter(Boolean)
      .join(" · "),
    // link 是 admin 内相对路径（/orders/{order_no} 之类）；没有就整行不可点。
    ...(notice.link ? { href: notice.link } : {}),
    // 点开就算看过了。已读的行不再发第二次请求（markNoticeRead 自己先挡）。
    onActivate: () => markNoticeRead(notice),
  }));
  const noticeSection: DrawerNotifSection = {
    key: "notices",
    title: tDrawer("notices.title"),
    items: drawerNotices,
    loading: notices === null,
    emptyTitle: noticesFailed
      ? tDrawer("notices.loadFailed")
      : tDrawer("notices.empty.title"),
    emptyDescription: noticesFailed
      ? undefined
      : tDrawer("notices.empty.description"),
    actions: [
      /* 没有未读时不画这颗按钮：一颗按下去恒回「0 条」的按钮比灰按钮更糟——
         它看起来能做事，按了却什么也没发生。读失败时也不画：拿不到数就不报数，
         更不该在不知道有几条未读的时候提供一个「全都标掉」。 */
      ...(unreadCount > 0 && !noticesFailed
        ? [
            {
              key: "mark-all",
              label: tDrawer("notices.markAll"),
              icon: "ph-checks",
              disabled: markingAll,
              onClick: () => {
                void markAllNoticesRead();
              },
            },
          ]
        : []),
      {
        key: "view-all",
        label: tDrawer("notices.viewAll"),
        icon: "ph-arrow-square-out",
        href: "/messages",
      },
    ],
  };
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

  /* 登录成功但没有运营平台的任何权限：说清原因，不放进去看一页页的 403。 */
  if (!session.capabilities.includes("admin.plane")) {
    return (
      <div className="flex h-dvh items-center justify-center bg-background px-md">
        <EmptyState
          icon="buildings"
          title={tShell("forbidden.title")}
          description={tShell("forbidden.description")}
          action={
            <Button variant="outline" onClick={() => void signOut()}>
              {tShell("forbidden.signOut")}
            </Button>
          }
        />
      </div>
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
        unreadCount={unreadCount}
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
          sections={[noticeSection]}
          notificationsTitle={tDrawer("deliveries.title")}
          notifications={drawerNotifs}
          notificationsLoading={notifLogs === null}
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
