/**
 * ShellChrome.tsx - 门户外壳部件族（品牌、工具按钮、语言/主题/全屏、偏好、用户菜单、法务页脚）。
 * @package @vxture/design-system
 * @layer Presentation
 * @category Components - Shell
 *
 * T2 重写（批 O）：原实现整份挂 .vx-shell-* 遗留类名，随 155 个遗留样式文件退役后
 * 完全无样式。重写原则：
 * - **能组合 design-ui 现成组件的不自造**：图标按钮走 `Button`（焦点环 / 禁用态 /
 *   aria-expanded 高亮都在配方层里），浮层走 `Popover`（外点关闭 / Escape / portal /
 *   进出场动效由 Radix + overlayMotion 提供，替代原先手写的事件监听），下拉走
 *   `NativeSelect`，互斥选项走 `SegmentedControl`，认证标走 `StatusBadge`。
 * - 透明模式（design-system/docs/02-visual-spec.md §3）：外壳部件与底同色，hover 用 `bg-accent`（brand 微染），
 *   不动 border / 阴影 / 位置；分隔用发丝线（实线开区块、虚线分行）。
 * - 品牌标识用 §7 的 .vx-brand-* 组合类——那是仍然在册的品牌基线，不是遗留类。
 * - **公开 API 冻结**：导出名与 props 形状与重写前逐项一致，消费方零改动。
 *   默认 label 用中性占位 "Brand"，真实品牌名由调用方传入（真名不入仓）。
 */

import { useState, type ReactNode } from "react";
import * as React from "react";
import type { ThemeMode } from "../../theme/theme.types";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  AvatarSilhouette,
  Button,
  Icon,
  NativeSelect,
  Popover,
  PopoverContent,
  PopoverTrigger,
  SegmentedControl,
  StatusBadge,
  cn,
  useFullscreen,
} from "@vxture/design-ui";
import type { FullscreenMode, IconName } from "@vxture/design-ui";
import { interactive } from "@vxture/design-ui/styles";
import type { Density } from "../../density";
import {
  SHELL_PANEL_HAIRLINE,
  ShellPanelContent,
  ShellPanelControlRow,
  ShellPanelHeader,
  ShellPanelRow,
  ShellPanelSectionTitle,
} from "./ShellPanel";

export type ShellFontSizePreference = "small" | "default" | "large";
export type ShellThemePreference = ThemeMode;

export interface LocaleSelectOption {
  /**
   * 语言代码（BCP-47 风格字符串）。**设计包不拥有平台的语言目录**——支持哪些
   * 语言是平台业务事实，由消费方通过 `options` 给出（2026-08-21 解耦）。
   */
  locale: string;
  label?: string | undefined;
  nativeName?: string | undefined;
  flag?: string | undefined;
}

export interface LocaleSelectPanelProps {
  activeLocale: string;
  options?: LocaleSelectOption[];
  onSelect: (locale: string) => void;
}

export interface ShellIconButtonProps {
  icon: IconName;
  label: string;
  active?: boolean;
  disabled?: boolean;
  className?: string | undefined;
  activeClassName?: string | undefined;
  iconClassName?: string | undefined;
  children?: ReactNode | undefined;
  onClick?: (() => void) | undefined;
}

export interface ShellBrandProps {
  href?: string | undefined;
  logoSrc?: string | undefined;
  logoAlt?: string | undefined;
  label?: ReactNode | undefined;
  /**
   * 字标后的子名（产品代号、环境名之类）。渲染成品牌锁定式的第二段，比字标
   * 略小一档、弱化一级色——它是标识的组成部分，不是旁边另起的一行文字。
   */
  tag?: ReactNode | undefined;
  className?: string | undefined;
  logoClassName?: string | undefined;
  labelClassName?: string | undefined;
}

export interface ShellLocaleSwitcherProps {
  currentLocale: string;
  options?: LocaleSelectOption[] | undefined;
  buttonLabel?: string | undefined;
  panelLabel?: string | undefined;
  align?: "start" | "end" | undefined;
  className?: string | undefined;
  buttonClassName?: string | undefined;
  activeButtonClassName?: string | undefined;
  popoverClassName?: string | undefined;
  onLocaleChange: (locale: string) => void;
}

export interface ShellThemeToggleProps {
  currentTheme?: ShellThemePreference | string | undefined;
  buttonLabel?: string | undefined;
  lightLabel?: string | undefined;
  darkLabel?: string | undefined;
  className?: string | undefined;
  activeClassName?: string | undefined;
  onThemeChange: (theme: "light" | "dark") => void;
}

export interface ShellFullscreenToggleProps {
  targetId: string;
  mode?: FullscreenMode | undefined;
  lockScroll?: boolean | undefined;
  enterLabel?: string | undefined;
  exitLabel?: string | undefined;
  className?: string | undefined;
  activeClassName?: string | undefined;
  getTargetElement?: (() => HTMLElement | null) | undefined;
}

export interface ShellPreferenceLabels {
  title?: ReactNode;
  locale?: ReactNode;
  theme?: ReactNode;
  density?: ReactNode;
  fontSize?: ReactNode;
  themeOptions?: Partial<Record<ShellThemePreference, ReactNode>>;
  densityOptions?: Partial<Record<Density, ReactNode>>;
  fontSizeOptions?: Partial<Record<ShellFontSizePreference, ReactNode>>;
}

export interface ShellPreferencePanelProps {
  locale: string;
  localeOptions?: LocaleSelectOption[] | undefined;
  theme: ShellThemePreference;
  density?: Density | undefined;
  fontSize?: ShellFontSizePreference | undefined;
  labels?: ShellPreferenceLabels | undefined;
  showDensity?: boolean | undefined;
  showFontSize?: boolean | undefined;
  className?: string | undefined;
  onLocaleChange: (locale: string) => void;
  onThemeChange: (theme: ShellThemePreference) => void;
  onDensityChange?: ((density: Density) => void) | undefined;
  onFontSizeChange?: ((fontSize: ShellFontSizePreference) => void) | undefined;
}

export interface ShellUserBadge {
  key: string;
  label: ReactNode;
}

export interface ShellUserStatusTag {
  /** Tag text, e.g. 已认证 / 未认证. */
  label: ReactNode;
  /** When true, renders a leading check icon and the verified accent. */
  verified?: boolean | undefined;
}

export interface ShellUserMenuUser {
  displayName: string;
  uniqueLine?: string | undefined;
  avatarSrc?: string | undefined;
  avatarAlt?: string | undefined;
  avatarFallback?: string | undefined;
  meta?: ReactNode | undefined;
  /** Right-aligned auth-status tag shown next to the display name. */
  statusTag?: ShellUserStatusTag | undefined;
  badges?: ShellUserBadge[] | undefined;
}

export interface ShellUserMenuAction {
  key: string;
  label: ReactNode;
  icon?: IconName | undefined;
  disabled?: boolean | undefined;
  /** 危险动作（登出等），行走 destructive 语义色（见 ShellPanelRow.danger）。 */
  danger?: boolean | undefined;
  onClick: () => void | Promise<void>;
}

export interface ShellUserMenuLink {
  key: string;
  label: ReactNode;
  href: string;
  icon?: IconName | undefined;
  /** Open in a new browser tab (adds target=_blank + safe rel). */
  newTab?: boolean | undefined;
}

export interface ShellUserMenuPortalReturn {
  label: ReactNode;
  onReturn: () => void;
  dismissLabel?: string | undefined;
  onDismiss?: (() => void) | undefined;
}

export interface ShellUserMenuProps {
  user: ShellUserMenuUser;
  openLabel?: string | undefined;
  online?: boolean | undefined;
  /**
   * 产品自定义段落，插在头部之后、导航链接之前，自带分隔线。用于放本产品才
   * 有的东西（成就槽位、配额摘要、任何 `ShellPanel*` 拼出来的内容）——DS 不
   * 收这些语义，但给它们一个位置，各产品定制的部分才不会各自另起一套排版。
   */
  extras?: ReactNode | undefined;
  settings?: ReactNode | undefined;
  portalReturn?: ShellUserMenuPortalReturn | undefined;
  /** Navigation links rendered as their own divided section (e.g. 个人信息). */
  links?: ShellUserMenuLink[] | undefined;
  actions?: ShellUserMenuAction[] | undefined;
  triggerClassName?: string | undefined;
  contentClassName?: string | undefined;
  statusClassName?: string | undefined;
  align?: "start" | "center" | "end" | undefined;
  sideOffset?: number | undefined;
}

export interface ShellLegalFooterLink {
  href: string;
  label: ReactNode;
}

export interface ShellLegalFooterProps {
  copyright?: ReactNode | undefined;
  links?: ShellLegalFooterLink[] | undefined;
  legalLabel?: string | undefined;
  className?: string | undefined;
  innerClassName?: string | undefined;
  linksClassName?: string | undefined;
}

/**
 * 语言选项缺省为空：设计包不内置平台的语言目录（见 LocaleSelectOption.locale）。
 * 需要语言切换的消费方必须显式传 `options` / `localeOptions`——website 与
 * opera 本就如此传；accounts 的默认值改由该门户自己用 @vxture-platform/shared 构造。
 */
const DEFAULT_LOCALE_OPTIONS: LocaleSelectOption[] = [];

const DEFAULT_LEGAL_LINKS: ShellLegalFooterLink[] = [
  { href: "/legal/terms", label: "服务条款" },
  { href: "/legal/privacy", label: "隐私政策" },
  { href: "/legal/cookies", label: "Cookie 使用政策" },
];

const THEME_OPTIONS: readonly ShellThemePreference[] = [
  "system",
  "light",
  "dark",
];
const DENSITY_OPTIONS: readonly Density[] = [
  "compact",
  "default",
  "comfortable",
];
const FONT_SIZE_OPTIONS: readonly ShellFontSizePreference[] = [
  "small",
  "default",
  "large",
];

/**
 * 用户菜单内的字段级分隔：发丝线，虚线分行（02-visual-spec.md §3）。取值与
 * `ShellPanelSection` 同一常量——两处若各写各的，用户菜单与产品自拼的面板会
 * 在同一个 header 上出现两种深浅的分隔线。
 */
const HAIRLINE_FIELD = SHELL_PANEL_HAIRLINE;

export function LocaleSelectPanel({
  activeLocale,
  options = DEFAULT_LOCALE_OPTIONS,
  onSelect,
}: LocaleSelectPanelProps) {
  return (
    <div className="flex flex-col gap-2xs" role="menu">
      {options.map((option) => {
        const active = option.locale === activeLocale;
        return (
          <Button
            key={option.locale}
            variant={active ? "secondary" : "ghost"}
            role="menuitemradio"
            aria-checked={active}
            className="h-auto w-full justify-start gap-sm px-sm py-xs text-left"
            onClick={() => onSelect(option.locale)}
          >
            {option.flag ? (
              <span className="shrink-0 text-body-lg" aria-hidden="true">
                {option.flag}
              </span>
            ) : null}
            <span className="flex min-w-0 flex-1 flex-col items-start gap-none">
              <span className="text-label-md">
                {option.nativeName ?? option.label ?? option.locale}
              </span>
              {option.label && option.label !== option.nativeName ? (
                <span className="text-body-sm text-muted-foreground">
                  {option.label}
                </span>
              ) : null}
            </span>
            {active ? <Icon name="check" size="sm" /> : null}
          </Button>
        );
      })}
    </div>
  );
}

export function ShellBrand({
  href = "/",
  logoSrc,
  logoAlt = "",
  // 中性占位。真实品牌名由调用方传入——真名不入仓。
  label = "Brand",
  tag,
  className,
  logoClassName,
  labelClassName,
}: ShellBrandProps) {
  return (
    <a
      href={href}
      // §7 品牌标识组合类：仍在册的 DS 基线（brand.css），非遗留类。
      className={cn("vx-brand-lockup", className)}
      aria-label={typeof label === "string" ? label : undefined}
    >
      {logoSrc ? (
        <img
          src={logoSrc}
          alt={logoAlt}
          aria-hidden={logoAlt ? undefined : true}
          // 与 .vx-brand-mark 的 --spacing-icon-lg 同值。属性只用于预留版位
          // 防抖动，实际尺寸由 CSS 决定；两处不同步会在图片加载前跳一下。
          width={24}
          height={24}
          className={cn("vx-brand-mark", logoClassName)}
          draggable={false}
        />
      ) : null}
      {/* 不挂 `text-title-lg`：那是个**完整排版角色**（字族/字号/字重/行高/
          字距五项一起来），只为了收字号却把 .vx-brand-name 的字重 700 压成了
          600，且工具类层压 components 层，压得静默。字号已归到 brand.css 的
          品牌基线里。 */}
      <span className={cn("vx-brand-name", labelClassName)}>{label}</span>
      {/* §7 品牌锁定式的第二段，样式见 brand.css 的 .vx-brand-local-name：
          浅底 + 淡描边的贴片。**不再画分隔符**——贴片自己的边框已经把它和字标
          分开了，中间再来个"·"是同一件事说两遍。 */}
      {tag ? <span className="vx-brand-local-name">{tag}</span> : null}
    </a>
  );
}

/**
 * forwardRef 是给 Radix Trigger（asChild）用的；同理把未知 props 透传给
 * Button，否则 Popover 注入的 onClick / aria 属性会被丢掉，面板永远打不开。
 */
export const ShellIconButton = React.forwardRef<
  HTMLButtonElement,
  ShellIconButtonProps
>(function ShellIconButton(
  {
    icon,
    label,
    active = false,
    disabled = false,
    className,
    activeClassName,
    iconClassName,
    children,
    onClick,
    ...rest
  },
  ref,
) {
  return (
    <Button
      ref={ref}
      variant="ghost"
      size="icon-md"
      title={label}
      aria-label={label}
      aria-pressed={active || undefined}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "text-muted-foreground hover:text-foreground",
        active && "bg-accent text-foreground",
        active && activeClassName,
        className,
      )}
      {...rest}
    >
      {children ?? <Icon name={icon} size="sm" className={iconClassName} />}
    </Button>
  );
});

ShellIconButton.displayName = "ShellIconButton";

export interface ShellIconGroupProps {
  label: string;
  children: ReactNode;
  className?: string | undefined;
}

/**
 * 一组 `ShellIconButton` 的容器——admin 生产实测：组内没有真实边框，平时
 * 透明，`:hover`/`:focus-within` 时整组点亮一层 `bg-accent` 的底色，标示
 * "这几个按钮是一组"；单个按钮自己的 active/hover 反馈（`ShellIconButton` 的
 * `bg-accent` 更强一档）继续独立生效，两层叠加。纯 CSS 伪类触发，不是受控
 * active 状态，也不限定组内按钮个数。
 *
 * 圆角跟随子项：容器零内边距贴着子按钮的边框，若用比子按钮更大的圆角（比如
 * `rounded-full`），外框的弧线会切过子按钮方形的角，hover 时出现错位的缺口。
 * `ShellIconButton` 走 `radiusClamp`（`min(--radius-md, 8px)`），容器用同一
 * 量级的 `rounded-lg`（= `--radius`，同为 8px 基准），弧度贴合。
 */
export function ShellIconGroup({
  label,
  children,
  className,
}: ShellIconGroupProps) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        "inline-flex items-center gap-2xs rounded-lg transition-colors duration-fast hover:bg-accent focus-within:bg-accent",
        className,
      )}
    >
      {children}
    </div>
  );
}

export type ShellAgentButtonSize = "sm" | "md" | "lg" | "xl" | "2xl";

const AGENT_BUTTON_PX: Record<ShellAgentButtonSize, number> = {
  sm: 16,
  md: 20,
  lg: 24,
  xl: 32,
  "2xl": 48,
};

/** 与 `size-icon-*` 逐档同值（Icon.tsx 的 sizeClassMap 同一套表），两处改一处必须改另一处。 */
const AGENT_BUTTON_SIZE_CLASS: Record<ShellAgentButtonSize, string> = {
  sm: "size-icon-sm",
  md: "size-icon-md",
  lg: "size-icon-lg",
  xl: "size-icon-xl",
  "2xl": "size-icon-2xl",
};

export interface ShellAgentButtonProps {
  iconSrc: string;
  label: string;
  active?: boolean;
  disabled?: boolean;
  /** 图标视觉尺寸，默认 "xl"（32px，跟其余 header 工具图标同档）。 */
  size?: ShellAgentButtonSize;
  onClick?: () => void;
  className?: string | undefined;
}

/**
 * header 里的 AI 助手入口——跟 `ShellIconButton` 分开建是因为素材不同：这里
 * 装的是产品侧提供的动图头像（`iconSrc`，比如 Varda 的 gif），不是 Phosphor
 * 线性图标。组件本身不认识"Varda"或任何具体助手，`iconSrc`/`label` 全由
 * 调用方传入；`size` 决定用哪一档 `size-icon-*`，调用方按素材原始分辨率选
 * 对应档位，避免缩放糊图（比如 32px 显示配 32px 素材）。
 */
export function ShellAgentButton({
  iconSrc,
  label,
  active = false,
  disabled = false,
  size = "xl",
  onClick,
  className,
}: ShellAgentButtonProps) {
  const px = AGENT_BUTTON_PX[size];
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active || undefined}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        interactive,
        "inline-grid shrink-0 place-items-center overflow-hidden rounded-full hover:bg-accent",
        AGENT_BUTTON_SIZE_CLASS[size],
        active && "bg-accent",
        className,
      )}
    >
      <img
        src={iconSrc}
        alt=""
        aria-hidden="true"
        width={px}
        height={px}
        className="size-full object-contain"
        draggable={false}
      />
    </button>
  );
}

export function ShellLocaleSwitcher({
  currentLocale,
  options = DEFAULT_LOCALE_OPTIONS,
  buttonLabel = "选择语言",
  panelLabel = "语言选择",
  align = "end",
  className,
  buttonClassName,
  activeButtonClassName,
  popoverClassName,
  onLocaleChange,
}: ShellLocaleSwitcherProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className={cn("inline-flex", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <ShellIconButton
            icon="globe"
            label={buttonLabel}
            active={open}
            className={buttonClassName}
            activeClassName={activeButtonClassName}
          />
        </PopoverTrigger>
        <PopoverContent
          align={align}
          sideOffset={8}
          aria-label={panelLabel}
          className={cn("w-auto min-w-media-2xl p-xs", popoverClassName)}
        >
          <LocaleSelectPanel
            activeLocale={currentLocale}
            options={options}
            onSelect={(locale) => {
              setOpen(false);
              onLocaleChange(locale);
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

export function ShellThemeToggle({
  currentTheme = "light",
  buttonLabel,
  lightLabel = "浅色模式",
  darkLabel = "深色模式",
  className,
  activeClassName,
  onThemeChange,
}: ShellThemeToggleProps) {
  const activeTheme = currentTheme === "dark" ? "dark" : "light";
  const nextTheme = activeTheme === "dark" ? "light" : "dark";
  const resolvedLabel =
    buttonLabel ?? (nextTheme === "dark" ? darkLabel : lightLabel);

  return (
    <ShellIconButton
      icon={activeTheme === "dark" ? "sun" : "moon"}
      label={resolvedLabel}
      active={activeTheme === "dark"}
      className={className}
      activeClassName={activeClassName}
      onClick={() => onThemeChange(nextTheme)}
    />
  );
}

export function ShellFullscreenToggle({
  targetId,
  mode = "native",
  lockScroll = false,
  enterLabel = "显示器全屏",
  exitLabel = "退出全屏",
  className,
  activeClassName,
  getTargetElement,
}: ShellFullscreenToggleProps) {
  const {
    enter,
    exit,
    isFullscreen,
    mode: activeMode,
    targetId: activeTargetId,
  } = useFullscreen();
  const active =
    isFullscreen && activeTargetId === targetId && activeMode === mode;

  return (
    <ShellIconButton
      icon={active ? "minimize" : "maximize"}
      label={active ? exitLabel : enterLabel}
      active={active}
      className={className}
      activeClassName={activeClassName}
      onClick={() => {
        if (active) {
          exit();
          return;
        }

        const target =
          getTargetElement?.() ??
          (typeof document !== "undefined" ? document.documentElement : null);
        if (target) {
          enter(targetId, target, { mode, lockScroll });
        }
      }}
    />
  );
}

export function ShellPreferencePanel({
  locale,
  localeOptions = DEFAULT_LOCALE_OPTIONS,
  theme,
  density = "default",
  fontSize = "default",
  labels,
  showDensity = true,
  showFontSize = true,
  className,
  onLocaleChange,
  onThemeChange,
  onDensityChange,
  onFontSizeChange,
}: ShellPreferencePanelProps) {
  return (
    // 行距比面板其余段落宽一档（gap-xs → gap-sm）：这几行每行都是一个带描边
    // 的控件，边框本身就是视觉重量；沿用无边框行的紧凑行距会让这一段挤成一
    // 坨方块。段落标题走 ShellPanelSection 的同款样式，左缘对齐各行图标。
    <div className={cn("flex w-full flex-col gap-sm", className)}>
      {labels?.title ? (
        <ShellPanelSectionTitle>{labels.title}</ShellPanelSectionTitle>
      ) : null}
      <ShellPanelControlRow icon="globe" label={labels?.locale}>
        <NativeSelect
          className="h-control-md text-body-md md:text-body-sm"
          value={locale}
          onChange={(event) => onLocaleChange(event.target.value)}
        >
          {localeOptions.map((option) => (
            <option key={option.locale} value={option.locale}>
              {option.nativeName ?? option.label ?? option.locale}
            </option>
          ))}
        </NativeSelect>
      </ShellPanelControlRow>

      <ShellPanelControlRow icon="sun" label={labels?.theme}>
        <SegmentedControl
          // md 而非 sm：档位在这里决定的是**高度**（sm=h-control-sm 28px，
          // md=h-control-md 32px），而同一栏里的 NativeSelect 与上下相邻的
          // 链接/动作按钮都是 32px。取 sm 会让偏好区三行整体矮 4px，看着像
          // 陷下去一块。
          size="md"
          fill
          value={theme}
          onChange={onThemeChange}
          items={THEME_OPTIONS.map((option) => ({
            value: option,
            label:
              labels?.themeOptions?.[option] ??
              // "系统"而非"跟随系统"：三档并排等宽，最长的一档决定分段宽度，
              // 多两个字会把另外两档也一起撑开。语义没有损失。
              { system: "系统", light: "浅色", dark: "深色" }[option],
          }))}
        />
      </ShellPanelControlRow>

      {showDensity ? (
        <ShellPanelControlRow icon="rows" label={labels?.density}>
          <SegmentedControl
            size="md"
            fill
            value={density}
            onChange={(value) => onDensityChange?.(value)}
            items={DENSITY_OPTIONS.map((option) => ({
              value: option,
              label:
                labels?.densityOptions?.[option] ??
                { compact: "紧凑", default: "默认", comfortable: "宽松" }[
                  option
                ],
            }))}
          />
        </ShellPanelControlRow>
      ) : null}

      {showFontSize ? (
        <ShellPanelControlRow icon="text-t" label={labels?.fontSize}>
          <SegmentedControl
            size="md"
            fill
            value={fontSize}
            onChange={(value) => onFontSizeChange?.(value)}
            items={FONT_SIZE_OPTIONS.map((option) => ({
              value: option,
              label:
                labels?.fontSizeOptions?.[option] ??
                { small: "小", default: "默认", large: "大" }[option],
            }))}
          />
        </ShellPanelControlRow>
      ) : null}
    </div>
  );
}

export function ShellUserMenu({
  user,
  openLabel = "用户菜单",
  online = true,
  extras,
  settings,
  portalReturn,
  links = [],
  actions = [],
  triggerClassName,
  contentClassName,
  statusClassName,
  align = "end",
  sideOffset = 10,
}: ShellUserMenuProps) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon-md"
          aria-label={openLabel}
          title={openLabel}
          className={cn("relative rounded-full", triggerClassName)}
        >
          <ShellUserAvatar user={user} />
          {online ? (
            <span
              aria-hidden="true"
              className={cn(
                "absolute right-none bottom-none size-2xs rounded-full",
                "bg-success ring-2 ring-background",
                statusClassName,
              )}
            />
          ) : null}
        </Button>
      </PopoverTrigger>

      {/* 外壳走 ShellPanelContent：宽度 / 四周留白 / 段间距 / 打开不抢焦点
          全部由它拥有，账户菜单与产品自拼的面板因此是同一个壳。 */}
      <ShellPanelContent
        align={align}
        sideOffset={sideOffset}
        {...(contentClassName ? { className: contentClassName } : {})}
      >
        {/* 头部同样走 ShellPanelHeader：账户菜单的头部与产品自拼面板的头部
            本来就是同一个东西（标识 + 标题 + 贴标 + 若干 meta 行），各写一份
            必然漂移。 */}
        <ShellPanelHeader
          {...(user.avatarSrc ? { avatarSrc: user.avatarSrc } : {})}
          avatarAlt={user.avatarAlt ?? user.displayName}
          avatarFallback={<AvatarSilhouette className="size-media-xs" />}
          title={user.displayName}
          {...(user.statusTag
            ? {
                titleAside: (
                  <StatusBadge
                    tone={user.statusTag.verified ? "success" : "neutral"}
                  >
                    {user.statusTag.verified ? <Icon name="check" /> : null}
                    {user.statusTag.label}
                  </StatusBadge>
                ),
              }
            : {})}
          metaRows={[
            ...(user.uniqueLine
              ? [{ key: "unique", content: user.uniqueLine }]
              : []),
            ...(user.meta ? [{ key: "meta", content: user.meta }] : []),
          ]}
        />

        {user.badges && user.badges.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2xs">
            {user.badges.map((badge) => (
              <StatusBadge key={badge.key} tone="brand">
                {badge.label}
              </StatusBadge>
            ))}
          </div>
        ) : null}

        {extras ? <ShellUserMenuSection>{extras}</ShellUserMenuSection> : null}

        {portalReturn ? (
          <ShellUserMenuSection>
            <div className="flex items-center gap-2xs">
              <Button
                variant="ghost"
                size="md"
                className="flex-1 justify-start gap-sm"
                onClick={() => {
                  setOpen(false);
                  portalReturn.onReturn();
                }}
              >
                <Icon name="arrow-left" size="sm" />
                <span>{portalReturn.label}</span>
              </Button>
              {portalReturn.onDismiss ? (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={portalReturn.dismissLabel ?? "关闭"}
                  onClick={portalReturn.onDismiss}
                >
                  <Icon name="x" size="xs" />
                </Button>
              ) : null}
            </div>
          </ShellUserMenuSection>
        ) : null}

        {links.length > 0 ? (
          <ShellUserMenuSection>
            {/* 走 ShellPanelRow 而不是自己拼 Button：行的列、高、图标色由组件
                拥有，用了组件就自动一致，不必在这里跟着复刻一遍。 */}
            {links.map((link) => (
              <ShellPanelRow
                key={link.key}
                icon={link.icon}
                label={link.label}
                href={link.href}
                newTab={link.newTab ?? false}
                // 这一行会离开当前面板去到另一个页面，右端给去向图标而不是
                // 单纯的 chevron——chevron 在本面板里已经被"展开子面板"占用
                // （见 TenantPanel 的切换范围），两种去向要能一眼分开。
                trailingIcon="external-link"
                onClick={() => setOpen(false)}
              />
            ))}
          </ShellUserMenuSection>
        ) : null}

        {settings ? (
          <ShellUserMenuSection>{settings}</ShellUserMenuSection>
        ) : null}

        {actions.length > 0 ? (
          <ShellUserMenuSection>
            {actions.map((action) => (
              <ShellPanelRow
                key={action.key}
                icon={action.icon}
                label={action.label}
                disabled={action.disabled ?? false}
                danger={action.danger ?? false}
                // 动作就地生效，不去别处，所以右端不画去向图标。
                chevron={false}
                onClick={() => {
                  setOpen(false);
                  void action.onClick();
                }}
              />
            ))}
          </ShellUserMenuSection>
        ) : null}
      </ShellPanelContent>
    </Popover>
  );
}

export type ShellDockMode = "narrow" | "wide" | "full";

export interface ShellDockProps {
  mode?: ShellDockMode | undefined;
  className?: string | undefined;
  children: ReactNode;
}

/**
 * 工作台停靠面板——外壳右缘的停靠列（助手、检查器一类的伴随内容）。
 * 三档：narrow 固定列 / wide 近半屏（clamp 480–760）/ full 全屏接管。
 *
 * 批 D（2026-08-18，原则 3）自 shell-template 的 `.assistant` 收编：console 与
 * admin 的 Varda 停靠列共用此形状，opera 亦可复用；narrow/wide 取值原样保留
 * （420px / clamp(480px,46vw,760px)），零视觉漂移。full 档的叠放从遗留的
 * z-command(4000) 收敛到 T2 的 z-modal——全屏接管本质上就是一层模态。
 */
export function ShellDock({
  mode = "narrow",
  className,
  children,
}: ShellDockProps) {
  return (
    <aside
      className={cn(
        "flex min-h-0 shrink-0 flex-col border-l border-border bg-card shadow-overlay",
        mode === "narrow" && "w-[26.25rem]",
        mode === "wide" && "w-[clamp(30rem,46vw,47.5rem)]",
        mode === "full" &&
          "fixed inset-0 z-modal w-auto border-l-0 shadow-none",
        className,
      )}
    >
      {children}
    </aside>
  );
}

export function ShellLegalFooter({
  copyright = "© 2026 Brand. All rights reserved.",
  links = DEFAULT_LEGAL_LINKS,
  legalLabel = "Legal links",
  className,
  innerClassName,
  linksClassName,
}: ShellLegalFooterProps) {
  return (
    <footer
      className={cn(
        // 区块级分隔用实线发丝线（02-visual-spec.md §3）。
        "border-t border-primary/10 dark:border-primary/20",
        "px-lg py-md text-body-sm text-muted-foreground",
        className,
      )}
    >
      <div
        className={cn(
          "mx-auto flex w-full max-w-page-xl flex-wrap items-center justify-between gap-sm",
          innerClassName,
        )}
      >
        <span>{copyright}</span>
        <nav
          className={cn("flex flex-wrap items-center gap-md", linksClassName)}
          aria-label={legalLabel}
        >
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="transition-colors duration-fast hover:text-foreground hover:underline"
            >
              {link.label}
            </a>
          ))}
        </nav>
      </div>
    </footer>
  );
}

/** 用户菜单的分段：上缘一条虚线发丝线，段内纵排。 */
function ShellUserMenuSection({ children }: { children: ReactNode }) {
  return (
    // 与 ShellPanelSection 同一组间距（gap-xs / pt-md）——用户菜单的分段和
    // 产品自拼面板的分段是同一个东西，两处间距不同会在同一条 header 上被
    // 直接对比出来。
    <div className={cn("flex flex-col gap-xs pt-md", HAIRLINE_FIELD)}>
      {children}
    </div>
  );
}

function ShellUserAvatar({ user }: { user: ShellUserMenuUser }) {
  return (
    // 只服务 header 上的触发器（32px）。面板里的大头像已经归 ShellPanelHeader，
    // 这里不再保留第二个尺寸档——两处各有一套尺寸正是"同一个头像两种大小"的
    // 由来。
    // key on src forces a remount when the avatar changes/clears so Radix does
    // not keep a stale "loaded" status that would hide the silhouette fallback.
    <Avatar
      key={user.avatarSrc ?? "__default__"}
      className="size-icon-xl text-muted-foreground"
    >
      {user.avatarSrc ? (
        <AvatarImage
          src={user.avatarSrc}
          alt={user.avatarAlt ?? user.displayName}
        />
      ) : null}
      <AvatarFallback
        delayMs={0}
        aria-label={user.avatarAlt ?? user.displayName}
      >
        {/* 显式档位：触发器套在 Button 里，inlineIcon 配方会把不带 size-*
            的 svg 压到 16px，剪影必须自带尺寸类才不被截胖改瘦。 */}
        <AvatarSilhouette className="size-icon-md" />
      </AvatarFallback>
    </Avatar>
  );
}
