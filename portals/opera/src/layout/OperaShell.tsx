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
 * 助手（Varda）入口：header 有 AI 图标按钮，点击打开一个占位面板
 * （AssistantPlaceholder）——真实 VardaChat 接入被后端 surface 鉴权矩阵挡住
 * （varda-bff 的 surface × userType 合法组合只认 "admin"/"console"，opera
 * 还没有对应的 userType/工具白名单/dataScope 决策，见 workplans 里的登记），
 * 本轮只把布局机制（narrow/wide/full 三态、full 态隐藏 header+sidebar）打通、
 * 占位面板可验证，真实换成 VardaChat 时布局不用再动。
 *
 * 会话：生产由边缘网关兜底；开发环境无网关时用占位 operator 渲染（界面
 * 先行、功能排期），占位在用户菜单里明确标注。
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
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
import { useOperatorSession } from "@/features/session/SessionProvider";

const LS_ASSISTANT_OPEN = "vx-opera-assistant-open";
const LS_ASSISTANT_MODE = "vx-opera-assistant-mode";

/* 开发占位会话。字段与 `OperatorIdentity` 对齐——占位对象比真身份少字段时，
   面板要么崩、要么走进只有开发环境才命中的分支，两者都会让开发时看到的东西
   和生产不一样，而这个占位存在的理由恰恰是"没有边缘网关时也能看真界面"。 */
const DEV_OPERATOR = {
  sub: "opr_dev",
  displayName: "Dev Operator",
  role: "platform-admin",
  email: "",
  emailVerified: false,
};

type AssistantMode = "narrow" | "wide" | "full";

/**
 * 占位助手面板：只验证 narrow/wide/full 三态的布局反应（宽度切换、全屏时
 * header/sidebar 隐藏），不接真实对话——真实 VardaChat 需要 opera surface
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
          Varda（占位）
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
          <ShellIconButton icon="x" label="关闭" onClick={onClose} />
        </div>
      </div>
      <p className="text-body-sm text-muted-foreground">
        真实助手接入待 opera surface 后端鉴权支持，当前仅演示布局三态。
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
  /* 初始值由服务端从 cookie 读出后传入，首帧即最终态。写死 false 再在 effect 里
   * 纠正，会让刷新时导航"先展开再收起"闪一下——localStorage 对服务端不可见，
   * 那个时序问题无法在客户端解决。 */
  const [collapsed, setCollapsed] = useState(initialNavCollapsed);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantMode, setAssistantMode] = useState<AssistantMode>("narrow");

  useEffect(() => {
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

  const isDev = process.env.NODE_ENV === "development";
  const effectiveOperator =
    operator ?? (isDev && status !== "loading" ? DEV_OPERATOR : null);

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

  const focusMode = assistantMode === "full";
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
                  <ShellAgentButton
                    iconSrc="/assets/ai/ai-agent-icon-32.gif"
                    label="Varda 助手"
                    active={assistantOpen}
                    onClick={toggleAssistant}
                  />
                  <ShellIconGroup label="系统">
                    <ShellIconButton
                      icon="help"
                      label="帮助"
                      onClick={() => {}}
                    />
                    <ShellIconButton
                      icon="bell"
                      label="告警通知"
                      onClick={() => {}}
                    />
                    <ShellIconButton
                      icon="settings"
                      label="系统设置"
                      onClick={() => {}}
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
                        : "开发占位会话（无边缘网关）",
                      ...(operator && effectiveOperator.email
                        ? {
                            statusTag: effectiveOperator.emailVerified
                              ? { label: "已认证", verified: true }
                              : { label: "未认证" },
                          }
                        : {}),
                    }}
                    settings={
                      <ShellPreferencePanel
                        locale="zh-CN"
                        localeOptions={[
                          { locale: "zh-CN", nativeName: "简体中文" },
                        ]}
                        theme={theme}
                        density={density}
                        fontSize={fontSize}
                        onLocaleChange={() => {}}
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
            assistantOpen ? (
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
