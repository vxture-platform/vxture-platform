/**
 * ShellPanel.tsx - 外壳弹层面板的**结构语法**（零业务语义）。
 * @package @vxture/design-system
 * @layer Presentation
 * @category Components - Shell
 *
 * 为什么单独成族：外壳上的弹层面板（当前范围切换、账户菜单、任何产品自定义
 * 面板）在多个产品里反复出现，视觉语法完全一致——头部一个标识 + 标题 + 若干
 * meta 行，往下按发丝线分段，每段一个小标题带若干行，行有三种形态（可点导航
 * 行 / 只读信息行 / 带进度条的度量行），外加一排槽位徽章。变的从来只是**内容**。
 *
 * 所以这里只收语法不收内容：本文件不认识"租户""配额""账单""等级"，也不
 * 应该认识（DS 零业务属性，见 03-patterns-guide.md §8）。产品侧拿这些件拼出
 * 自己的面板，业务词汇全部由 props 传入，各产品可以任意定制段落顺序、行数、
 * 文案，而彼此的排版/间距/字号/分隔线保持逐像素一致。
 *
 * 放 design-system 而不是 design-ui：`ShellPanelHeader` 复用同目录 `ShellChrome`
 * 的头像件，依赖方向是单向 design-system → design-ui。
 *
 * 与 `ShellUserMenu` 的关系：那个是**装配好的**账户菜单（带触发器与弹层），
 * 这里是**散件**。ShellUserMenu 的分段语法就是 ShellPanelSection，两处共用同
 * 一组常量，改一处等于改两处。
 */

import * as React from "react";
import type { ReactNode } from "react";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  Icon,
  PopoverContent,
  Progress,
  cn,
} from "@vxture/design-ui";
import type { IconName } from "@vxture/design-ui";

/** 面板内的段落分隔：虚线发丝线（02-visual-spec.md §3）。ShellUserMenu 同款。 */
export const SHELL_PANEL_HAIRLINE =
  "border-t border-dashed border-primary/10 dark:border-primary/20";

/**
 * 面板行的统一列定义。**这些是内部实现，不导出**——对齐靠"用本文件的行组件"
 * 保证，不靠调用方记得引用一组类名常量。曾经把它们导出过：那等于把规范写成
 * 了一份需要人去遵守的约定，而约定的执行率就是这轮返工的由来。
 *
 * 列的算术：`px-sm` + 图标 `size-icon-sm` + `gap-md` = 内容列起点。
 */
const ROW_INSET = "px-sm";
const ROW_LEAD_WIDTH = "w-icon-sm";
const ROW_GAP = "gap-md";
/** 行高统一档：与 `Button size="sm"`（h-control-md）同值。 */
const ROW_HEIGHT = "h-control-md";
/** 行内图标一律走弱化色，与文字拉开层级——各行自己染色是不一致的来源。 */
const ROW_ICON_TONE = "text-muted-foreground";
/**
 * 面板头部标识块（头像 / 图标）的尺寸档。它比行内图标大得多，自成一列。
 */
const IDENTITY_SIZE = "size-media-sm";
const IDENTITY_WIDTH = "w-media-sm";

/**
 * 行首图标格。**无图标也渲染**：同一段里有的行带图标、有的不带时，缺格的那
 * 行文字会左窜一格，整段左缘就毛了。
 */
function RowLead({
  icon,
  width,
}: Readonly<{
  icon?: IconName | undefined;
  width?: "row" | "identity" | undefined;
}>) {
  return (
    <span
      className={cn(
        "inline-grid h-full shrink-0 place-items-center",
        ROW_ICON_TONE,
        width === "identity" ? IDENTITY_WIDTH : ROW_LEAD_WIDTH,
      )}
      aria-hidden="true"
    >
      {icon ? <Icon name={icon} size="sm" /> : null}
    </span>
  );
}

/* ─────────────────────────── 面板外壳 ─────────────────────────── */

export interface ShellPanelContentProps extends React.ComponentPropsWithoutRef<
  typeof PopoverContent
> {}

/**
 * 面板的浮层外壳：固定宽度、四周留白、段间距、以及**打开时不抢焦点**。
 *
 * 单独成件而不是让每个面板各写一串 className：这几样是"面板长什么样"的
 * 定义，散在调用点就等于每加一个面板都要抄一遍，抄漏一项就出现一个宽度或
 * 内距不同的异类（本轮之前 ShellUserMenu 与 TenantPanel 正是各写各的）。
 *
 * `onOpenAutoFocus` 拦掉：Radix 默认把焦点移进浮层的第一个可聚焦元素，对
 * **菜单**是对的（用户就是来选一项的），但这类面板是"看一眼当前状态、顺手
 * 点个入口"，一打开就有个下拉被套上焦点环，读起来像是它已经被选中、正等着
 * 输入。触发器保持焦点，Tab 仍可正常进入面板，键盘可达性不受影响。
 */
export const ShellPanelContent = React.forwardRef<
  React.ComponentRef<typeof PopoverContent>,
  Readonly<ShellPanelContentProps>
>(function ShellPanelContent(
  { className, sideOffset = 8, onOpenAutoFocus, ...props },
  ref,
) {
  return (
    <PopoverContent
      ref={ref}
      sideOffset={sideOffset}
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        onOpenAutoFocus?.(event);
      }}
      className={cn(
        // w-80(320px) 是**组件尺寸**，不进 T2 刻度（01-usage.md §3，
        // PopoverContent 自己的 w-72 同理）。
        "flex w-80 flex-col gap-md p-md",
        className,
      )}
      {...props}
    />
  );
});

/* ─────────────────────────── 段落 ─────────────────────────── */

export interface ShellPanelSectionProps {
  /** 段落小标题；不传则只有分隔线，没有标题行。 */
  title?: ReactNode | undefined;
  /** 是否画上缘分隔线。面板第一段传 false，否则弹层顶部会多一条线。 */
  divided?: boolean | undefined;
  children: ReactNode;
  className?: string | undefined;
}

export function ShellPanelSection({
  title,
  divided = true,
  children,
  className,
}: Readonly<ShellPanelSectionProps>) {
  return (
    <div
      className={cn(
        // 段内行距 gap-xs、段与分隔线之间 pt-md。原来是 gap-2xs(4) / pt-sm(10)：
        // 行本身没有边框也没有底色，靠留白分界，4px 不足以把两行读成两件事，
        // 整段糊成一片；分隔线上方那一档同理，线贴着上一段的最后一行。
        "flex flex-col gap-xs",
        divided && cn("pt-md", SHELL_PANEL_HAIRLINE),
        className,
      )}
    >
      {title ? <ShellPanelSectionTitle>{title}</ShellPanelSectionTitle> : null}
      {children}
    </div>
  );
}

/**
 * 段落小标题。单独导出是因为不是每处分段都由 `ShellPanelSection` 渲染
 * （`ShellPreferencePanel` 自己就是一段），标题样式仍需同源——左内距与行的
 * 左内距同档，标题左缘对齐各行图标左缘。
 */
export function ShellPanelSectionTitle({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <p className={cn(ROW_INSET, "text-label-sm text-muted-foreground")}>
      {children}
    </p>
  );
}

/* ─────────────────────────── 头部 ─────────────────────────── */

export interface ShellPanelHeaderProps {
  /** 标识：图标名（走 Icon）或图片地址（走 Avatar）二选一，都不传则不渲染。 */
  icon?: IconName | undefined;
  avatarSrc?: string | undefined;
  avatarAlt?: string | undefined;
  /** 头像加载失败/未设置时的占位内容；不传则回落到 `icon`。 */
  avatarFallback?: ReactNode | undefined;
  title: ReactNode;
  /** 标题右侧的贴标（认证状态之类），由调用方直接给节点——DS 不判断"什么算已认证"。 */
  titleAside?: ReactNode | undefined;
  /**
   * 标题下的若干 meta 行。每行可带自己的前置图标；行内容是节点，产品侧爱放
   * 什么放什么。传空数组或不传则没有 meta 区。
   */
  metaRows?: ReadonlyArray<{
    key: string;
    icon?: IconName | undefined;
    content: ReactNode;
  }>;
  className?: string | undefined;
}

export function ShellPanelHeader({
  icon,
  avatarSrc,
  avatarAlt,
  avatarFallback,
  title,
  titleAside,
  metaRows = [],
  className,
}: Readonly<ShellPanelHeaderProps>) {
  return (
    // items-center：标识块 48px 比它右侧的两三行文字高，items-start 会让头像
    // 顶着第一行、下方留一截空白，看起来像掉了一行内容。
    <div className={cn("flex items-center", ROW_INSET, ROW_GAP, className)}>
      {avatarSrc || icon || avatarFallback ? (
        <Avatar
          // key on src：头像换/清空时强制重挂，否则 Radix 会留着上一次的
          // "已加载"状态，占位内容再也不显示。
          key={avatarSrc ?? "__default__"}
          className={cn(IDENTITY_SIZE, "shrink-0 text-muted-foreground")}
        >
          {avatarSrc ? (
            <AvatarImage src={avatarSrc} alt={avatarAlt ?? ""} />
          ) : null}
          <AvatarFallback delayMs={0} aria-label={avatarAlt ?? undefined}>
            {avatarFallback ??
              (icon ? <Icon name={icon} className="size-icon-xl" /> : null)}
          </AvatarFallback>
        </Avatar>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col gap-2xs">
        <div className="flex items-center justify-between gap-sm">
          <p className="truncate text-label-lg text-foreground">{title}</p>
          {titleAside}
        </div>
        {metaRows.map((row) => (
          <p
            key={row.key}
            className="flex min-w-0 items-center gap-2xs text-body-sm text-muted-foreground"
          >
            {row.icon ? (
              <Icon name={row.icon} size="xs" className="shrink-0" />
            ) : null}
            <span className="min-w-0 truncate">{row.content}</span>
          </p>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────── 行 ─────────────────────────── */

export interface ShellPanelRowProps {
  icon?: IconName | undefined;
  label: ReactNode;
  /** 副行文案（label 下方一行小字）。 */
  description?: ReactNode | undefined;
  /** 右侧值（数量、金额、当前选中项…）。 */
  value?: ReactNode | undefined;
  /** 右端是否画一个"可进入"的角标。有 onClick/href 时默认为 true。 */
  chevron?: boolean | undefined;
  /**
   * 右端角标改用指定图标（给 chevron 之外的去向语义用，例如"新开页面"用
   * `external-link`）。传了就替代 chevron。
   */
  trailingIcon?: IconName | undefined;
  /** 在新标签页打开（仅 href 生效），自动补 rel。 */
  newTab?: boolean | undefined;
  /** 选中/展开态——用 secondary 底色标注，跟 hover 区分。 */
  active?: boolean | undefined;
  disabled?: boolean | undefined;
  href?: string | undefined;
  /** 渲染链接时用的组件（Next 的 Link 之类）；不传走原生 a。 */
  linkComponent?: React.ElementType | undefined;
  onClick?: (() => void) | undefined;
  className?: string | undefined;
}

/**
 * 面板里的一行。三态由 props 组合决定，不另开变体：
 * - 有 `onClick`/`href` → 可点，带 chevron，hover 有反馈
 * - 只有 `label`/`value` → 只读信息行（渲染成 div，不进 tab 序）
 * - `disabled` → 保留结构与文案，去掉交互（"功能在这里，但现在不可用"）
 */
export function ShellPanelRow({
  icon,
  label,
  description,
  value,
  chevron,
  trailingIcon,
  newTab = false,
  active = false,
  disabled = false,
  href,
  linkComponent,
  onClick,
  className,
}: Readonly<ShellPanelRowProps>) {
  const interactive = Boolean(onClick || href) && !disabled;
  const trailing =
    trailingIcon ??
    ((chevron ?? Boolean(onClick || href)) ? "chevron-right" : undefined);

  const inner = (
    <>
      <RowLead icon={icon} />
      <span className="flex min-w-0 flex-1 flex-col items-start gap-none text-left">
        <span className="w-full truncate text-label-md">{label}</span>
        {description ? (
          <span className="w-full truncate text-body-sm text-muted-foreground">
            {description}
          </span>
        ) : null}
      </span>
      {value !== undefined && value !== null ? (
        <span className="shrink-0 text-body-sm text-muted-foreground tabular-nums">
          {value}
        </span>
      ) : null}
      {trailing ? (
        <Icon
          name={trailing}
          size="xs"
          className={cn("shrink-0", ROW_ICON_TONE)}
        />
      ) : null}
    </>
  );

  // 行高走统一档而不是 h-auto：同一个面板里"只有一行文字"的行和"文字+副行"
  // 的行若各按内容撑高，段落里就会出现两三种行高。带副行时才放开高度。
  const shared = cn(
    "w-full items-center justify-start",
    description ? "h-auto py-xs" : ROW_HEIGHT,
    ROW_INSET,
    ROW_GAP,
    "flex",
    className,
  );

  if (!interactive) {
    return (
      <div
        className={cn(
          shared,
          "rounded-md",
          disabled && "opacity-disabled",
          active && "bg-secondary",
        )}
      >
        {inner}
      </div>
    );
  }

  if (href) {
    const Link = linkComponent ?? "a";
    return (
      <Button
        asChild
        variant={active ? "secondary" : "ghost"}
        size="md"
        className={shared}
      >
        <Link
          href={href}
          onClick={onClick}
          {...(newTab ? { target: "_blank", rel: "noreferrer noopener" } : {})}
        >
          {inner}
        </Link>
      </Button>
    );
  }

  return (
    <Button
      variant={active ? "secondary" : "ghost"}
      size="md"
      className={shared}
      onClick={onClick}
    >
      {inner}
    </Button>
  );
}

/* ─────────────────────────── 控件行 ─────────────────────────── */

export interface ShellPanelControlRowProps {
  icon?: IconName | undefined;
  /** 无障碍名 / tooltip；这一行通常没有可见文字标签，靠图标 + 控件自解释。 */
  label?: ReactNode | undefined;
  /** 控件本体（下拉、分段控件、开关…）占满内容列。 */
  children: ReactNode;
  className?: string | undefined;
}

/**
 * 装控件的一行：左边图标格，右边控件铺满内容列。与 `ShellPanelRow` 共用同一
 * 套列/高，所以偏好设置那几行的图标与上下的链接行、动作行严格同列——这件事
 * 由组件保证，不由调用方拼 flex 时自觉对齐。
 */
export function ShellPanelControlRow({
  icon,
  label,
  children,
  className,
}: Readonly<ShellPanelControlRowProps>) {
  return (
    <div
      className={cn(
        "flex items-center",
        ROW_HEIGHT,
        ROW_INSET,
        ROW_GAP,
        className,
      )}
      title={typeof label === "string" ? label : undefined}
    >
      <RowLead icon={icon} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/* ─────────────────────────── 度量行 ─────────────────────────── */

export interface ShellPanelMeterRowProps {
  icon?: IconName | undefined;
  label: ReactNode;
  /**
   * 右上角的用量文案，**成品字符串**由调用方给——单位、进制、小数位、货币
   * 全是业务判断（字节按 1024、额度按千分位、金额按币种），DS 不做这些决定。
   */
  valueLabel?: ReactNode | undefined;
  /** 0–100。超出范围会被夹紧，避免进度条溢出容器。 */
  percent: number;
  className?: string | undefined;
}

export function ShellPanelMeterRow({
  icon,
  label,
  valueLabel,
  percent,
  className,
}: Readonly<ShellPanelMeterRowProps>) {
  const safe = Number.isFinite(percent)
    ? Math.max(0, Math.min(100, percent))
    : 0;
  return (
    // 图标在导引列，标签行与进度条同在内容列——进度条若挂在外层，它会从图标
    // 左缘起画，比自己的标签更靠左一格。
    <div
      className={cn("flex items-center py-xs", ROW_INSET, ROW_GAP, className)}
    >
      <RowLead icon={icon} />
      <div className="flex min-w-0 flex-1 flex-col gap-2xs">
        <div className={cn("flex items-center", ROW_GAP)}>
          <span className="min-w-0 flex-1 truncate text-label-sm">{label}</span>
          {valueLabel !== undefined && valueLabel !== null ? (
            <span className="shrink-0 text-body-sm text-muted-foreground tabular-nums">
              {valueLabel}
            </span>
          ) : null}
        </div>
        <Progress value={safe} />
      </div>
    </div>
  );
}

/* ─────────────────────────── 槽位排 ─────────────────────────── */

export interface ShellPanelSlot {
  key: string;
  icon: IconName;
  /** 悬停说明；同时作为无障碍名。 */
  label: string;
  /** 已获得 = 实心高亮；未获得 = 灰底轮廓（"这里还有位置，但没解锁"）。 */
  earned?: boolean | undefined;
}

export interface ShellPanelSlotsProps {
  /** 整排的无障碍名，例如"账户标识"。 */
  label: string;
  /** 排首的引导图标（可选）。 */
  leadIcon?: IconName | undefined;
  /**
   * 导引列宽度：
   * - `"row"`（默认）与其余各行的图标同宽，槽位落在行内容列上；
   * - `"identity"` 与面板头部的标识块同宽，槽位落在**头部标题文字**那一列上。
   *
   * 槽位排通常紧跟在头部之后、讲的是同一个主体（谁的徽章），排在标题正下方
   * 比排在行内容列更说得通——所以头部下面第一排一般用 `"identity"`。
   */
  lead?: "row" | "identity" | undefined;
  slots: ReadonlyArray<ShellPanelSlot>;
  className?: string | undefined;
}

/**
 * 一排徽章槽位：固定数量的位置，已获得的点亮、未获得的留灰。DS 只认识
 * "槽位有没有点亮"，不认识槽位代表什么（等级、角色、成就都行）。
 */
export function ShellPanelSlots({
  label,
  leadIcon,
  lead = "row",
  slots,
  className,
}: Readonly<ShellPanelSlotsProps>) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        "flex items-center",
        ROW_HEIGHT,
        ROW_INSET,
        ROW_GAP,
        className,
      )}
    >
      <RowLead icon={leadIcon} width={lead} />
      {/* 槽位是一串同形同色的圆，间距太小会读成一条连续的色带，数不清有几个。 */}
      <span className="flex flex-1 items-center gap-md">
        {slots.map((slot) => (
          <span
            key={slot.key}
            title={slot.label}
            aria-label={slot.label}
            className={cn(
              // icon-lg（24px）而非 icon-xl（32px）：槽位要塞进统一的 32px 行高，
              // 32px 的圆会顶满整行、上下没有呼吸。
              "inline-grid size-icon-lg place-items-center rounded-full transition-colors duration-fast",
              slot.earned
                ? "bg-primary/10 text-primary dark:bg-primary/20"
                : "bg-muted text-muted-foreground opacity-muted",
            )}
          >
            <Icon name={slot.icon} size="sm" />
          </span>
        ))}
      </span>
    </div>
  );
}

/* ─────────────────────────── 范围触发器 ─────────────────────────── */

export interface ShellScopeButtonProps {
  icon?: IconName | undefined;
  label: ReactNode;
  /** 无障碍名/tooltip；label 是节点时必须给。 */
  ariaLabel: string;
  active?: boolean | undefined;
  /** 是否画下拉角标。只作展示、不可点的场合传 false。 */
  caret?: boolean | undefined;
  onClick?: (() => void) | undefined;
  className?: string | undefined;
}

/**
 * header 上的"当前范围"触发器：图标 + 名称 + 下拉角标。哪个产品的"范围"是
 * 什么由调用方决定（租户、业务域、项目、环境……），组件只管这个形状。
 *
 * forwardRef + props 透传是给 Radix `PopoverTrigger asChild` 用的，跟
 * `ShellIconButton` 同一个理由：不透传则弹层永远打不开。
 */
export const ShellScopeButton = React.forwardRef<
  HTMLButtonElement,
  Readonly<ShellScopeButtonProps>
>(function ShellScopeButton(
  { icon, label, ariaLabel, active = false, caret = true, onClick, ...rest },
  ref,
) {
  const { className, ...passthrough } = rest as ShellScopeButtonProps & {
    className?: string;
  };
  return (
    <Button
      ref={ref}
      variant="ghost"
      size="md"
      title={ariaLabel}
      aria-label={ariaLabel}
      aria-expanded={active}
      onClick={onClick}
      className={cn(
        // media-3xl = 192px。名称过长时截断，但要留得下一个可读的名字——
        // media 刻度前几档是**图标级**尺寸（xs=32px），拿来当宽度上限会把
        // 整个按钮压成只剩图标。
        "max-w-media-3xl justify-start gap-2xs text-muted-foreground hover:text-foreground",
        active && "bg-accent text-foreground",
        className,
      )}
      {...passthrough}
    >
      {icon ? <Icon name={icon} size="sm" className="shrink-0" /> : null}
      <span className="min-w-0 truncate text-label-md">{label}</span>
      {caret ? (
        <Icon name="chevron-down" size="xs" className="shrink-0" />
      ) : null}
    </Button>
  );
});

ShellScopeButton.displayName = "ShellScopeButton";
