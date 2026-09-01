"use client";

/**
 * OperaShell — Opera 外壳（DS 共享外壳组件重建）。
 *
 * 外壳布局收进 DS 的 ShellHeader / ShellViewport（`@vxture/design-system`），
 * 本文件只管拼零件、拿 opera 自己的会话/导航数据填槽。侧栏内容见
 * DS 的 ShellSidebarNav；外壳收放/隐藏的宽度状态机在 DS 的 ShellSidebarFrame 里
 * （ShellViewport 内部接线），本文件只传 sidebarMode。header 走 `height="lg"`
 * （56px，阴影分区+半透明底），材质是从生产环境 admin 头部吸收进 DS 的视觉
 * 语言，不再是发丝线+纯色的旧透明模式；高度按控制台的信息密度取 56 而非 64。
 *
 * 助手（Varda）入口：**只在非生产构建里存在**。header 的 AI 图标按钮打开一个
 * 占位面板（AssistantPlaceholder）——真实 VardaChat 接入被后端 surface 鉴权矩阵
 * 挡住（varda-bff 的 surface × userType 合法组合只认 "admin"/"console"，opera
 * 还没有对应的 userType/工具白名单/dataScope 决策，见 workplans 里的登记），
 * 占位只为验证布局机制（narrow/wide/full 三态、full 态隐藏 header+sidebar），
 * 真实换成 VardaChat 时布局不用再动。生产构建里按钮、面板、localStorage 读写
 * 三样都不渲染不执行：一个点开只写着「占位」的助手，在运营者面前不是功能是误导
 * （2026-08-30）。
 *
 * 会话：生产由边缘网关兜底，渲染的永远是 `/auth/session` 给的真身份，拿不到就
 * 不渲染外壳（SessionProvider 会带去登录）。开发环境无网关时用占位 operator 渲染，
 * 占位在用户菜单里明确标注；那个占位对象在生产构建里是 `null`（见 DEV_OPERATOR）。
 *
 * 两处「非生产」都直接写 `process.env.NODE_ENV !== "production"` 而不是抽一个运行时
 * 开关：Next 在构建期把它替换成字面量，生产包里这两段成为死代码，连字符串都不进
 * bundle——「不存在」比「不显示」硬。
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ShellSearchGroup } from "@vxture/design-system";
import {
  Icon,
  ShellBrand,
  ShellAgentButton,
  ShellHeader,
  ShellIconButton,
  ShellIconGroup,
  ShellLauncher,
  ShellPageContainer,
  ShellPreferencePanel,
  ShellSearchBox,
  ShellSidebarNav,
  ShellUserMenu,
  ShellViewport,
  ToastProvider,
  TooltipProvider,
  cn,
  type ShellSidebarMode,
  useTheme,
} from "@vxture/design-system";
import { operaNavSections } from "@/config/navigation";
import { writeNavCollapsed } from "@vxture-platform/shared";
import {
  useOperatorSession,
  type OperatorIdentity,
} from "@/features/session/SessionProvider";
import {
  LOCALE_CONFIGS,
  SUPPORTED_LOCALES,
  type Locale,
} from "@vxture-platform/shared";
import { useLocaleSwitch } from "@/lib/useLocaleSwitch";

const LS_ASSISTANT_OPEN = "vx-opera-assistant-open";
const LS_ASSISTANT_MODE = "vx-opera-assistant-mode";

/* 开发占位会话。**生产构建里恒为 null**——判据是 NODE_ENV，不是"有没有拿到会话"：
   生产环境拿不到会话该做的是去登录，不是渲染一个假运营者。

   字段与 `OperatorIdentity` 对齐——占位对象比真身份少字段时，面板要么崩、要么
   走进只有开发环境才命中的分支，两者都会让开发时看到的东西和生产不一样，而这个
   占位存在的理由恰恰是"没有边缘网关时也能看真界面"。 */
const DEV_OPERATOR: OperatorIdentity | null =
  process.env.NODE_ENV !== "production"
    ? {
        sub: "opr_dev",
        displayName: "Dev Operator",
        role: "platform-admin",
        email: "",
        emailVerified: false,
      }
    : null;

/* 用户菜单里给占位会话的标注。同一判据：生产构建里连这句话都不该在包里——实测
   （2026-08-30 next build 后 grep 产物）DEV_OPERATOR 的字段全部消失，只剩这句留着。 */
const DEV_SESSION_META =
  process.env.NODE_ENV !== "production" ? "开发占位会话（无边缘网关）" : "";

/* 占位助手只在非生产构建里存在：按钮、面板、localStorage 的读写都挂在这个判据上。
   三处同一判据，缺一处就会出现「生产没有按钮、却因为 localStorage 残留而进了全屏
   态」这种无路可退的状态。 */
const ASSISTANT_PLACEHOLDER_ENABLED = process.env.NODE_ENV !== "production";

type AssistantMode = "narrow" | "wide" | "full";

/**
 * 占位助手面板（仅开发构建）：只验证 narrow/wide/full 三态的布局反应（宽度切换、
 * 全屏时 header/sidebar 隐藏），不接真实对话——真实 VardaChat 需要 opera surface
 * 后端支持后再换掉这个组件，外层 ShellViewport 的 focusMode 联动不用改。
 */
function AssistantPlaceholder({
  mode,
  onClose,
  onToggleWide,
  onToggleFull,
}: {
  mode: AssistantMode;
  onClose: () => void;
  onToggleWide: () => void;
  onToggleFull: () => void;
}) {
  const tShared = useTranslations();
  return (
    <aside
      className={cn(
        "flex shrink-0 flex-col gap-sm border-l bg-background p-md",
        "border-primary/10 dark:border-primary/20",
        mode === "full" && "w-full",
      )}
      style={
        mode === "narrow"
          ? { width: "var(--container-panel-sm)" }
          : mode === "wide"
            ? { width: "var(--container-panel-lg)" }
            : undefined
      }
    >
      <div className="flex items-center justify-between gap-sm">
        <span className="text-label-md font-medium text-foreground">
          Varda（开发占位）
        </span>
        <div className="flex items-center gap-2xs">
          <ShellIconButton
            icon={mode === "wide" ? "arrow-right" : "arrow-left"}
            label={mode === "wide" ? "还原窄版" : "加宽"}
            active={mode === "wide"}
            disabled={mode === "full"}
            onClick={onToggleWide}
          />
          <ShellIconButton
            icon={mode === "full" ? "minimize" : "maximize"}
            label={mode === "full" ? "退出全屏" : "全屏"}
            active={mode === "full"}
            onClick={onToggleFull}
          />
          <ShellIconButton
            icon="x"
            label={tShared("common.close")}
            onClick={onClose}
          />
        </div>
      </div>
      <p className="text-body-sm text-muted-foreground">
        真实助手待后端鉴权支持；此面板仅开发构建有，用来验证布局三态。
      </p>
    </aside>
  );
}

export function OperaShell({
  children,
  initialNavCollapsed = false,
}: {
  children: ReactNode;
  initialNavCollapsed?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { operator, status, signOut } = useOperatorSession();
  const [searchQuery, setSearchQuery] = useState("");
  const { theme, setTheme, density, setDensity, fontSize, setFontSize } =
    useTheme();
  const { locale, switchLocale } = useLocaleSwitch();
  /* 初始值由服务端从 cookie 读出后传入，首帧即最终态。写死 false 再在 effect 里
   * 纠正，会让刷新时导航"先展开再收起"闪一下——localStorage 对服务端不可见，
   * 那个时序问题无法在客户端解决。 */
  const [collapsed, setCollapsed] = useState(initialNavCollapsed);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantMode, setAssistantMode] = useState<AssistantMode>("narrow");

  useEffect(() => {
    if (!ASSISTANT_PLACEHOLDER_ENABLED) return;
    try {
      // 收起态不在这里读：已由服务端经 cookie 传入（见上）。
      setAssistantOpen(window.localStorage.getItem(LS_ASSISTANT_OPEN) === "1");
      const m = window.localStorage.getItem(LS_ASSISTANT_MODE);
      if (m === "narrow" || m === "wide" || m === "full") setAssistantMode(m);
    } catch {
      /* ignore */
    }
  }, []);

  const toggleNav = () =>
    setCollapsed((c) => {
      const next = !c;
      writeNavCollapsed("opera", next);
      return next;
    });

  const persistAssistant = (open: boolean, mode: AssistantMode) => {
    try {
      window.localStorage.setItem(LS_ASSISTANT_OPEN, open ? "1" : "0");
      window.localStorage.setItem(LS_ASSISTANT_MODE, mode);
    } catch {
      /* ignore */
    }
  };
  const toggleAssistant = () =>
    setAssistantOpen((open) => {
      const next = !open;
      persistAssistant(next, assistantMode);
      return next;
    });
  const closeAssistant = () => {
    setAssistantOpen(false);
    setAssistantMode("narrow");
    persistAssistant(false, "narrow");
  };
  const toggleAssistantWide = () => {
    const next: AssistantMode = assistantMode === "wide" ? "narrow" : "wide";
    setAssistantMode(next);
    persistAssistant(assistantOpen, next);
  };
  const toggleAssistantFull = () => {
    const next: AssistantMode = assistantMode === "full" ? "narrow" : "full";
    setAssistantMode(next);
    persistAssistant(assistantOpen, next);
  };

  /* Opera 的搜索目前只覆盖导航项——控制平面的业务检索（Provider / Model /
   * Endpoint）要打 atlas 侧接口，那是独立一批工作。搜索框现在就上，是因为
   * 「搜页面」本身已经有真实落点；等后端就绪时这里加一个分组即可，面板与
   * 快捷键不用再动。 */
  const searchGroups: ShellSearchGroup[] = useMemo(() => {
    const needle = searchQuery.trim().toLowerCase();
    if (needle.length < 2) return [];
    const items = operaNavSections.flatMap((section) =>
      section.items
        .filter(
          (item) =>
            item.label.toLowerCase().includes(needle) ||
            /* 副名进匹配：保留英文原词的全部意义就在于运营者从审计事件里抄一个
               `endpoint` 过来能搜到「模型路由」——只匹配中文主名等于把它废掉。 */
            item.subLabel?.toLowerCase().includes(needle) ||
            item.description?.toLowerCase().includes(needle) ||
            section.title?.toLowerCase().includes(needle),
        )
        .map((item) => ({
          key: item.href,
          label: item.label,
          description: item.description ?? section.title,
          icon: item.icon,
          onSelect: () => router.push(item.href),
        })),
    );
    return items.length > 0
      ? [{ key: "pages", heading: "页面", items: items.slice(0, 8) }]
      : [];
  }, [searchQuery, router]);

  /* 生产构建里 DEV_OPERATOR 是 null，这一行退化成 `operator ?? null`：没有真会话
     就没有外壳。 */
  const effectiveOperator = operator ?? DEV_OPERATOR;

  if (status === "loading") {
    return (
      <div className="flex h-dvh items-center justify-center bg-background">
        <Icon
          name="spinner"
          size="lg"
          className="animate-spin text-muted-foreground"
        />
      </div>
    );
  }
  if (!effectiveOperator) return null;

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  const focusMode = assistantOpen && assistantMode === "full";
  const sidebarMode: ShellSidebarMode = focusMode
    ? "hidden"
    : collapsed
      ? "collapsed"
      : "expanded";

  return (
    /* Tooltip 与 Toast 都是**必须有 Provider 才能用**的：Radix 的 Tooltip.Root
     * 在没有 Provider 时直接抛错（收起导航的图标提示会整页崩），useToast 同理。
     * 挂在外壳上，全部页面共用一套延迟与一个 toast 队列。 */
    <TooltipProvider delayDuration={300}>
      <ToastProvider>
        <ShellViewport
          focusMode={focusMode}
          sidebarMode={sidebarMode}
          header={
            <ShellHeader
              height="lg"
              centerAlign="end"
              leading={
                <>
                  <ShellLauncher
                    items={[
                      {
                        key: "opera",
                        icon: "squares-four",
                        label: "基础设施控制平面",
                        active: true,
                      },
                    ]}
                    onSelect={() => {}}
                  />
                  <ShellBrand
                    href="/"
                    label="Vxture Platform"
                    tag="opera"
                    logoSrc="/brand/vxture-logo-icon.svg"
                  />
                  <span className="h-lg w-px bg-border" aria-hidden="true" />
                  {/* 当前域标签与 admin 同一角色：`label-md` 自带 medium(500)。
                      原先是 `body-md`（正文角色，normal 400）再手动 semibold 顶到
                      600——字号颜色都与 admin 相同，只有字重差一档，在 muted 灰上
                      看起来像换了颜色。排版角色是字号/字重/行高/字距一整套，
                      单挑一项覆盖，同一个角色在各处就会长得不一样。 */}
                  <span className="hidden truncate text-label-md text-muted-foreground md:inline">
                    基础设施控制平面
                  </span>
                </>
              }
              center={
                <ShellSearchBox
                  query={searchQuery}
                  onQueryChange={setSearchQuery}
                  groups={searchGroups}
                  labels={{
                    placeholder: "搜索页面",
                    empty: "没有匹配的页面",
                    loading: "检索中",
                    resultsLabel: "搜索结果",
                  }}
                />
              }
              trailing={
                // 三个板块（助手 / 系统工具组 / 用户菜单）之间拉开 gap-md，
                // 跟组内图标的 gap-2xs 区分开——组间是板块边界，组内是同类项。
                <div className="flex items-center gap-md">
                  {ASSISTANT_PLACEHOLDER_ENABLED ? (
                    <ShellAgentButton
                      iconSrc="/assets/ai/ai-agent-icon-32.gif"
                      label="Varda 助手（开发占位）"
                      active={assistantOpen}
                      onClick={toggleAssistant}
                    />
                  ) : null}
                  {/* 没有「告警通知」：opera 没有任何通知源（无告警表、无订阅、无
                      推送），一个点了什么都不发生的铃铛只会让人以为告警会到这里来。
                      有通知源的那天再加，不先摆一个空按钮占位（2026-08-30）。 */}
                  <ShellIconGroup label="系统">
                    <ShellIconButton
                      icon="help"
                      label="帮助"
                      onClick={() => {}}
                    />
                    <ShellIconButton
                      icon="settings"
                      label="系统设置"
                      active={isActive("/settings")}
                      onClick={() => router.push("/settings")}
                    />
                  </ShellIconGroup>
                  {/* 与 admin 的用户菜单同形（同一个 DS 件、同一组槽位）。此前这里
                      只有显示名与角色码两行，因为 opera 只读 access_token 的 claims，
                      而 `name` / `email` 当时只进 id_token——面板不是设计成简版的，
                      是**它手上只有这两样**。auth-bff 补齐 claims 后一并对齐。

                      缺失一律给明确文案而不是留白：留白读作「没这个字段」，
                      缺失读作「该补了」，两者含义完全不同（同 admin 的判据）。 */}
                  <ShellUserMenu
                    user={{
                      displayName: effectiveOperator.displayName,
                      uniqueLine: effectiveOperator.role || "operator",
                      meta: operator
                        ? effectiveOperator.email || "未设置邮箱"
                        : DEV_SESSION_META,
                      ...(operator && effectiveOperator.email
                        ? {
                            statusTag: effectiveOperator.emailVerified
                              ? { label: "已认证", verified: true }
                              : { label: "未认证" },
                          }
                        : {}),
                    }}
                    links={[
                      // 个人信息 = 运营者本人自助（只读自视,写侧待身份层补齐）。
                      // 与治理台 /admins「管理他人」不同，这是本人账户。
                      {
                        key: "profile",
                        label: "个人信息",
                        href: "/me",
                        icon: "user",
                      },
                    ]}
                    settings={
                      <ShellPreferencePanel
                        /* 此前这三项是写死的：locale="zh-CN"、只有一个选项、
                           onLocaleChange 是个空函数——界面上有个语言开关，
                           拨它不会发生任何事。 */
                        locale={locale}
                        localeOptions={SUPPORTED_LOCALES.map((code) => ({
                          locale: code,
                          nativeName: LOCALE_CONFIGS[code].nativeName,
                        }))}
                        theme={theme}
                        density={density}
                        fontSize={fontSize}
                        onLocaleChange={(next) => switchLocale(next as Locale)}
                        onThemeChange={setTheme}
                        onDensityChange={setDensity}
                        onFontSizeChange={setFontSize}
                      />
                    }
                    actions={[
                      {
                        key: "sign-out",
                        label: "退出登录",
                        icon: "sign-out",
                        danger: true,
                        onClick: () => void signOut(),
                      },
                    ]}
                  />
                </div>
              }
            />
          }
          sidebar={
            <ShellSidebarNav
              domainName="Opera"
              sections={operaNavSections}
              collapsed={collapsed}
              onToggleCollapsed={toggleNav}
              isActive={isActive}
              storageKeyPrefix="vx-opera-nav"
              linkComponent={Link}
            />
          }
          dock={
            ASSISTANT_PLACEHOLDER_ENABLED && assistantOpen ? (
              <AssistantPlaceholder
                mode={assistantMode}
                onClose={closeAssistant}
                onToggleWide={toggleAssistantWide}
                onToggleFull={toggleAssistantFull}
              />
            ) : null
          }
        >
          <ShellPageContainer>{children}</ShellPageContainer>
        </ShellViewport>
      </ToastProvider>
    </TooltipProvider>
  );
}
