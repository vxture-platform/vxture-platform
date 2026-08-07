/**
 * ShellSidebarNav.tsx - 侧栏导航内容（token 化的通用导航壳）。
 * @package @vxture/design-system
 * @layer Presentation
 * @category Components - Shell
 *
 * 与业务无关：不读任何业务配置，导航结构（sections）、域名称都由调用方（产品层）
 * 以 props 传入；本文件只拥有 ShellNavItem / ShellNavSection 的形状契约，不认识
 * 任何具体菜单数据——菜单内容永远由产品侧组装。状态持久化的 localStorage key
 * 前缀（storageKeyPrefix）也是必填 prop，不在组件里内置任何产品名——这是跨产品
 * 复用的前提，多个消费方各自传自己的命名空间，不会读写同一个 key 串状态。
 *
 * 与 `ShellSidebarFrame`（design-ui）配对：**Frame 拥有宽度/显隐状态机**
 * （expanded/collapsed/hidden、过渡动画），**Nav 是装进 Frame 里的内容**。本文件
 * 不管外壳，只管内容；hidden 态下 ShellSidebarFrame 直接不渲染 children，本组件
 * 根本不会挂载。
 *
 * 放在 design-system（不是 design-ui）：要复用同目录 `ShellChrome.tsx` 里的
 * `ShellIconButton`，依赖方向是单向 design-system → design-ui，design-ui 不能
 * 反过来引 design-system 的导出（lint:boundaries 硬门）——跟 `ShellLauncher`
 * 落在这个包的理由一致。
 *
 * 路由无关：导航项的链接元素由 `linkComponent` 注入，默认原生 `<a>`。本包不依赖
 * `next`（package.json 里没有），因此不能 import `next/link`；产品侧有路由库时把
 * 自己的 Link 传进来即可。
 *
 * 结构分五层，间距只用两个 token：--space-xs(8) 与 --space-2xs(4)，叠加
 * 而不是新开档位：
 *
 * L1 容器：p-xs(8，四周)。
 * L2 title/content/footer 三块，横向都各自缩进 px-2xs(4)，与 aside 的
 *   px-xs(8) 叠加得到统一的 12px 图标列起点（title/group 的图标横坐标
 *   因此完全对齐）：
 *   - title：内层图标/标签行 h-header-sm(40) 不变，外层包一层 p-2xs(4，
 *     四周)，块总高 40+4+4=48。用 padding 包一层"外壳"而不是直接在 40 行
 *     上加 padding——40 行本身零内边距，图标盒 40×40 不会被压。
 *     叠加：aside pt-xs(8) + title 自己的 pt-2xs(4) = 12。
 *   - content：flex-1 可滚动，py-2xs(4)（只在纵向；横向缩进交给每个
 *     group 自己去对齐 title，content 自己不再重复缩进，否则会跟 group
 *     的缩进叠两次，图标列对不齐）。title→content 靠 title 的 pb-2xs(4)
 *     + content 的 pt-2xs(4) 叠成 8，不用额外的 gap 工具类。
 *   - footer：64px 块（h-header-xl），底部安全区。内容由 `footer` 槽位注入，
 *     不传就是空占位——**高度恒定**，传不传都不改间距契约。
 * L3 group：p-2xs(4，四周——纵向是 py，横向缩进对齐 title)。组间距不用
 *   显式 gap，靠相邻两个 group 自己的 pt/pb(4+4) 叠成 8。
 * L4 group 内部：title→items 用 gap-xs(8)。
 * L5 item：h-control-xl(40)，padding=0，gap-xs(8)（图标导轨到标签）。
 *
 * 图标行容器一律不用 justify-center（曾经用过，踩过坑）：justify-center
 * 是动态的，每帧按容器*当前*宽度重算；标签是条件渲染，collapsed 一变就
 * 瞬间从 DOM 消失，跟 aside 的宽度过渡（300ms）完全不同步——结果是点击
 * 收起的瞬间标签先没了，图标被居中到"侧栏还没收窄之前"的宽行正中间，
 * 然后才跟着宽度平滑收窄，看起来就是"先跳一下再收起"。改回默认的
 * justify-start：图标锚定在 aside 不会动的左边缘上，宽度过渡全程原地
 * 不动，只有 label 那一截跟着宽度伸缩，符合"图标不变、内容展开收起"。
 * item/title 的导轨本来就等于收起态可用宽度（40=40），默认左对齐已经是
 * 对的。唯一例外是 group-title 的 chevron 导轨（32×32）比可用宽度（40）
 * 窄 4px——这个差值给它的 NavRail 加一个**静态** ml-2xs(4px) 抵消，
 * 不是动态居中，margin 不随宽度过渡重算，不会跳。
 *
 * group-title 文字额外缩进 pl-xs(8)（加在 NavLabel 上，只在展开态渲染时
 * 才存在，不影响收起态）——不加的话文字贴着按钮左边缘，hover/active
 * 背景一亮就很难看。
 *
 * 复合标题（"<品牌> · <子域>"）按 " · " 分隔符拆出品牌前缀单独染
 * text-primary-text（品牌主色），不含分隔符的标题原样渲染——见
 * splitBrandTitle，认分隔符不认具体品牌名，不把业务名称写死进组件。
 *
 * 颜色：图标维持 muted-foreground 不变；标签文字单独提一级到
 * foreground（NavLabel 上单独盖一层 text-foreground，不影响图标的颜色，
 * 因为图标走的是容器上的 text-muted-foreground 被 currentColor 继承，
 * 标签是显式覆盖）——item 的 active 态例外，走 primary-text，不叠加。
 *
 * title 区域的全局分组收合按钮：常态 opacity-0，hover 或键盘 focus 命中
 * title 整行（group/group-hover）才显示并可点击，避免常驻占视觉噪音。
 *
 * 图标："图标板块"（导轨盒）统一 size-control-xl(40×40)，与 item/title 的
 * 行高同源，天然对齐、居中；group-title 的 chevron 用比例更小的
 * size-control-md(32×32)，因为它所在的行只有 32 高。图标本身：侧栏收合/
 * 展开按钮 20px（Icon size="md"，绕开 ShellIconButton 内置的 size="sm"，
 * 直接传 children）；其余全部 16px（size="sm"，ShellIconButton 默认值）。
 *
 * title 行内顺序：图标 → 域名称 → 全局分组收合按钮（按钮居右，用
 * size-control-md 导轨——跟每个 group 自己的 chevron 同一个尺寸/同一条
 * 右侧列，"对齐分组按钮"）。
 *
 * 收起态：没有任何文字占位符——标签直接不渲染（条件渲染，不是 opacity
 * 隐藏），图标导轨盒本身固定尺寸不受影响，图标横坐标因此在两态间不跳动；
 * 分组标题行本身（连同它的 chevron）仍然渲染，保证收起/展开切换时所有
 * 导航项的纵向位置不因为"标题行消失"而跳动。
 *
 * 不设背景、不设边线：与内容区同底色，仅靠留白分界。滚动发生在 content
 * 块内部（title/footer 常驻不滚动）；滚动条视觉隐藏但滚动行为保留。
 */

import { useEffect, useState, type ReactNode } from "react";
import * as React from "react";
import {
  Button,
  Icon,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  cn,
} from "@vxture/design-ui";
import type { IconName } from "@vxture/design-ui";
import { interactive } from "@vxture/design-ui/styles";
import { ShellIconButton } from "./ShellChrome";

export interface ShellNavItem {
  href: string;
  label: string;
  icon: IconName;
}

export interface ShellNavSection {
  title: string;
  items: ShellNavItem[];
}

export interface ShellSidebarNavProps {
  /** 侧栏顶部的域名称（title 行的文字）。 */
  domainName: string;
  sections: ShellNavSection[];
  collapsed: boolean;
  onToggleCollapsed: () => void;
  isActive: (href: string) => boolean;
  /** 状态持久化 key 前缀——调用方各自传自己的命名空间，组件不假设产品名。 */
  storageKeyPrefix: string;
  /** 渲染导航项的链接元素。默认原生 <a>（整页导航）；产品侧有路由库时传入
   *  自己的 Link（opera 传 next/link，console 传 next-intl 的 locale 感知
   *  Link），组件因此不依赖任何路由实现。 */
  readonly linkComponent?: React.ElementType;
  /** 底部固定块（h-header-xl=64）的内容；不传则是空占位，高度不变。 */
  readonly footer?: React.ReactNode;
  /**
   * 两个控件的无障碍名。默认值是中文——本件从一个纯中文产品提炼而来，保留
   * 默认可以让不做 i18n 的消费方零配置接入；做 i18n 的消费方（console 是
   * 双语）必须传入，否则英文档下这两个按钮会显中文。
   */
  readonly labels?: Partial<ShellSidebarNavLabels>;
}

export interface ShellSidebarNavLabels {
  expandNav: string;
  collapseNav: string;
  expandAllGroups: string;
  collapseAllGroups: string;
}

const DEFAULT_LABELS: ShellSidebarNavLabels = {
  expandNav: "展开导航",
  collapseNav: "收起导航",
  expandAllGroups: "展开全部分组菜单项",
  collapseAllGroups: "收起全部分组菜单项",
};

function readClosedGroups(storageKey: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(storageKey);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function writeClosedGroups(storageKey: string, closed: Set<string>) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify([...closed]));
  } catch {
    /* ignore */
  }
}

/** 导轨盒：固定方形，两态下图标横坐标不变。size 决定所在行的比例。 */
function NavRail({
  size = "control-xl",
  className,
  children,
}: {
  size?: "control-xl" | "control-md";
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center",
        size === "control-xl" ? "size-control-xl" : "size-control-md",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** 标签：只在展开态渲染（调用方条件渲染），本身不含 collapsed 逻辑。 */
function NavLabel({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "min-w-0 flex-1 overflow-hidden whitespace-nowrap text-left",
        className,
      )}
    >
      {children}
    </span>
  );
}

function NavItemRow({
  item,
  collapsed,
  active,
  linkComponent: LinkComponent,
}: {
  item: ShellNavItem;
  collapsed: boolean;
  active: boolean;
  linkComponent: React.ElementType;
}) {
  const link = (
    <LinkComponent
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        interactive,
        "flex h-control-xl items-center gap-xs rounded-md",
        "text-label-md transition-colors duration-fast ease-standard",
        active
          ? "bg-surface-selected text-primary-text"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      <NavRail>
        <Icon name={item.icon} size="sm" />
      </NavRail>
      {!collapsed && (
        <NavLabel className={cn(!active && "text-foreground")}>
          {item.label}
        </NavLabel>
      )}
    </LinkComponent>
  );

  if (!collapsed) return link;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * 复合标题（"<品牌> · <子域>"）的品牌前缀高亮：按 " · " 分隔符拆出第一段，
 * 不认具体品牌名——不含分隔符的标题原样返回。
 */
function splitBrandTitle(
  title: string,
): { brand: string; rest: string } | null {
  const idx = title.indexOf(" · ");
  if (idx === -1) return null;
  return { brand: title.slice(0, idx), rest: title.slice(idx) };
}

/**
 * 分组标题行：恒占一行（h-control-md=32），标题在左、开合图标在行尾
 * （右侧）；不受 collapsed 影响行数——行和它的 chevron 收起态也照常渲染，
 * 只是标题文字不渲染，图标落回与导航项同一左侧列。
 *
 * 用 DS 的 `Button variant="ghost" size="sm"`（原生 <button> 违反
 * ds/no-native-primitive）。size="sm" 已经是 h-control-md(32)，圆角
 * radiusClamp 在默认基数下等值于 rounded-md；其余三处配方默认值必须显式
 * 抵消，否则会改变既有视觉：
 * - `px-none` 抵消 size="sm" 的 px-sm——本行零内边距，缩进由 NavLabel 的
 *   pl-xs 与 chevron 导轨的 ml-2xs 负责。
 * - `justify-start` 抵消 Button 基类的 justify-center——见头部"图标行容器
 *   一律不用 justify-center"那段，收起态会在宽度过渡中途跳一下。
 * - `border-none` 抵消基类的 1px 透明描边，内容盒回到整 32×32，chevron
 *   导轨不被挤掉 1px。
 * - `aria-expanded:*` 抵消 ghost 变体里的 expandable 配方：那是给"展开时
 *   保持高亮"的菜单触发器用的，本行的 aria-expanded 表达的是分组开合，
 *   展开的分组不该常驻一层底色。
 */
function NavGroupHeader({
  title,
  open,
  collapsed,
  onToggle,
}: {
  title: string;
  open: boolean;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const brandTitle = splitBrandTitle(title);
  const trigger = (
    <Button
      variant="ghost"
      size="md"
      onClick={onToggle}
      aria-expanded={open}
      className={cn(
        // 焦点环与 outline-none 不在此重复：Button 基类已含配方 `interactive`。
        "flex h-control-md w-full items-center justify-start gap-xs px-none border-none",
        "text-overline transition-colors duration-fast ease-standard",
        "text-muted-foreground hover:bg-accent hover:text-foreground",
        "aria-expanded:bg-transparent aria-expanded:text-muted-foreground",
      )}
    >
      {!collapsed && (
        <NavLabel className="pl-xs text-foreground">
          {brandTitle ? (
            <>
              <span className="text-primary-text">{brandTitle.brand}</span>
              {brandTitle.rest}
            </>
          ) : (
            title
          )}
        </NavLabel>
      )}
      {/* 固定 4px 静态偏移（不是 justify-center）：32 宽的 chevron 导轨要在
          40 宽的收起态可用列里跟 item 图标对中，差值是常量 (40-32)/2，用
          margin 钉死比动态居中更安全——margin 不随 aside 的宽度过渡重算，
          不会在收起/展开动画中途跳一下。 */}
      <NavRail size="control-md" className="ml-2xs">
        <Icon name={open ? "chevron-down" : "chevron-right"} size="sm" />
      </NavRail>
    </Button>
  );

  if (!collapsed) return trigger;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{trigger}</TooltipTrigger>
      <TooltipContent side="right">{title}</TooltipContent>
    </Tooltip>
  );
}

export function ShellSidebarNav({
  domainName,
  sections,
  collapsed,
  onToggleCollapsed,
  isActive,
  storageKeyPrefix,
  linkComponent = "a",
  footer,
  labels,
}: ShellSidebarNavProps) {
  const text = { ...DEFAULT_LABELS, ...labels };
  const groupsStorageKey = `${storageKeyPrefix}-groups-closed`;

  const [closedGroups, setClosedGroups] = useState<Set<string>>(
    () => new Set(),
  );

  useEffect(() => {
    // 只在挂载后读一次：localStorage 在 SSR 不存在，首帧必须与服务端一致
    // （全部展开），水合完成后再补上持久化状态。故意不依赖 groupsStorageKey。
    setClosedGroups(readClosedGroups(groupsStorageKey));
  }, []);

  const toggleGroup = (title: string) =>
    setClosedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      writeClosedGroups(groupsStorageKey, next);
      return next;
    });

  const allClosed = sections.length > 0 && closedGroups.size >= sections.length;
  const toggleAllGroups = () =>
    setClosedGroups((prev) => {
      const next =
        prev.size >= sections.length
          ? new Set<string>()
          : new Set(sections.map((section) => section.title));
      writeClosedGroups(groupsStorageKey, next);
      return next;
    });

  return (
    /* Provider 由**用得着它的组件自己带**，不指望每个消费方记得在外壳上包一层。
     * 收起态下每个导航项与分组标题都要挂 Tooltip，而 Radix 的 Tooltip.Root
     * 没有 Provider 会直接抛错——于是这个组件在展开态一切正常、用户点一下
     * "收起导航"整页崩溃，是个只在特定交互下才现形的雷（2026-08-04 console
     * 实测踩到：console 全仓没有第二处 Tooltip 用法，外壳自然没包 Provider）。
     * Radix 的 Provider 可嵌套，已经在外层包过的消费方（opera）不受影响。 */
    <TooltipProvider delayDuration={300}>
      <div className="flex h-full flex-col p-xs">
        {/* title */}
        <div className="shrink-0 p-2xs">
          <div className="group flex h-header-sm items-center gap-xs">
            <NavRail>
              <ShellIconButton
                icon="sidebar"
                label={collapsed ? text.expandNav : text.collapseNav}
                onClick={onToggleCollapsed}
              >
                <Icon name="sidebar" size="md" />
              </ShellIconButton>
            </NavRail>
            {!collapsed && (
              <NavLabel className="text-label-md font-medium text-foreground">
                {domainName}
              </NavLabel>
            )}
            {!collapsed && (
              <NavRail size="control-md">
                <ShellIconButton
                  icon={allClosed ? "caret-double-down" : "caret-double-up"}
                  label={
                    allClosed ? text.expandAllGroups : text.collapseAllGroups
                  }
                  onClick={toggleAllGroups}
                  className={cn(
                    "opacity-0 transition-opacity duration-fast ease-standard",
                    "group-hover:opacity-100 focus-visible:opacity-100",
                  )}
                />
              </NavRail>
            )}
          </div>
        </div>

        {/* content */}
        <div
          className={cn(
            "min-h-0 flex-1 overflow-y-auto py-2xs",
            "[scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden",
          )}
        >
          <nav className="flex flex-col">
            {sections.map((section) => {
              const open = !closedGroups.has(section.title);
              return (
                <div key={section.title} className="flex flex-col gap-xs p-2xs">
                  <NavGroupHeader
                    title={section.title}
                    open={open}
                    collapsed={collapsed}
                    onToggle={() => toggleGroup(section.title)}
                  />
                  <div
                    className={cn(
                      "grid transition-[grid-template-rows] duration-base ease-standard motion-reduce:transition-none",
                      open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
                    )}
                  >
                    <div className="overflow-hidden">
                      <nav
                        className="flex flex-col gap-xs"
                        aria-label={section.title}
                      >
                        {section.items.map((item) => (
                          <NavItemRow
                            key={item.href}
                            item={item}
                            collapsed={collapsed}
                            active={isActive(item.href)}
                            linkComponent={linkComponent}
                          />
                        ))}
                      </nav>
                    </div>
                  </div>
                </div>
              );
            })}
          </nav>
        </div>

        {/* footer — 底部安全区，高度恒定；内容由产品侧经 footer 槽位注入 */}
        <div
          className="h-header-xl shrink-0"
          aria-hidden={footer ? undefined : true}
        >
          {footer}
        </div>
      </div>
    </TooltipProvider>
  );
}
