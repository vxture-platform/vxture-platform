/**
 * AuthLogin.tsx - 认证形态组件族（统一登录页、密码/验证码/找回面板、三方登录、chrome）。
 * @package @vxture/accounts
 * @layer Presentation
 * @category Components - Auth
 *
 * ── 为什么在 accounts 而不在 design-system（owner 2026-08-18 判）─────────────
 * DS 只收**通用、无业务含义**的件。这一族说的全是登录 / 绑定 / 找回 / MFA——
 * 认证业务的页面语汇，不是设计系统的原语；它由 DS 的原语（Card / Input /
 * Button / Shell* / Banner）**组合**而成，组合的知识属于拥有认证面的应用，
 * 即 accounts。原先放在 DS 里的代价已经付过一次：DS 被迫携带品牌资产路径、
 * 杜撰的运营指标、human-verification 依赖——全是业务作答，DS 不该替业务答。
 *
 * 其余门户不 import 这里（门户间禁互引）：console 首次补齐、website 的
 * set-nickname 各自用 DS 通用件就地组装同款观感，重复的是几十行版式组合，
 * 换来的是层的干净。
 *
 * T2 重写（批 O）：原实现整份挂 .vx-auth-* 遗留类名，随 155 个遗留样式文件退役后
 * 完全无样式。重写原则：
 * - **能组合 design-ui 现成组件的不自造**：输入走 `Input`/`Label`（焦点环 / 失效态 /
 *   移动端 16px 防缩放都在那里），勾选走 `Checkbox`，tab 走 Radix `Tabs`，按钮走
 *   `Button`，分隔走 `Separator`，字段图标走 `Icon`。
 * - 透明模式（design-system/docs/02-visual-spec.md §3）：登录卡走 `Card` 的 veil 叠层（strong 档）+ 发丝线，
 *   无阴影；页面唯一实色底在 `UnifiedAuthPage` 的 section 上。
 * - 视觉面板不再依赖已退役的 auth 专属 token：底色用语义色 primary 渐变，
 *   NodeGraph 画布颜色从自身 computed color 读取（text-primary-foreground）。
 * - **公开 API 冻结**：导出名与 props 形状与重写前逐项一致，消费方零改动。
 *   默认品牌文案用中性占位 "Brand"，真实品牌名由调用方传入（真名不入仓）。
 * - 背景图 URL 经 inline style 落地：运行时值属 L5，不是设计值。
 */

"use client";
import { useTranslations } from "next-intl";
import { PasswordInput } from "../PasswordInput";
import { AccountsHeader } from "../AccountsChrome";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { type Locale, type Theme } from "@vxture-platform/shared";

/**
 * 语言选项默认值。设计包不再内置平台语言目录(2026-08-21 解耦:设计三包脱离
 * @vxture-platform/shared 以便独立成仓),所以由本门户按平台权威目录构造。
 */
import {
  Banner,
  Button,
  Checkbox,
  Icon,
  Input,
  Label,
  Separator,
  ShellLegalFooter,
  Tabs,
  TabsList,
  TabsTrigger,
  cn,
  type IconName,
  type LocaleSelectOption,
  type ShellLegalFooterLink,
} from "@vxture/design-system";

export type AuthLoginScreen = "login" | "phone" | "forgot";
export type AuthLoginTab = Exclude<AuthLoginScreen, "forgot">;
export type AuthSocialProvider = "feishu" | "dingtalk" | "wechat" | "google";
export type AuthFieldIcon = "user" | "lock" | "phone" | "shield" | "mail";

export interface AuthVisualStat {
  value: string;
  label: string;
}

export interface AuthVisualConfig {
  pageBackgroundImage?: string | undefined;
  leftBackgroundImage?: string | undefined;
  title?: string | undefined;
  description?: string | undefined;
  statusText?: string | undefined;
  stats?: AuthVisualStat[] | undefined;
}

/**
 * 版式：`split` 左视觉 + 右表单（登录 / 绑定 / 找回）；`single` 只有表单列，
 * 用于首次信息补齐一类的独立门——它们没有招徕的任务，一块营销色块只会把
 * "还差几步"这件事推远。
 */
export type AuthPageLayout = "split" | "single";

export interface UnifiedAuthPageProps {
  className?: string | undefined;
  pageBackgroundImage?: string | undefined;
  visual?: AuthVisualConfig | undefined;
  header?: ReactNode | undefined;
  footer?: ReactNode | undefined;
  overlay?: ReactNode | undefined;
  children: ReactNode;
  ariaLabel?: string | undefined;
  layout?: AuthPageLayout | undefined;
}

export interface AuthLoginLayoutProps {
  title?: ReactNode;
  /** 标题下的一行说明。缺省不占位。 */
  description?: ReactNode | undefined;
  children: ReactNode;
}

export interface AuthFlowFormProps {
  /** div3 信息输入区: tabs + fields + options. */
  input: ReactNode;
  /** div4 登录验证区: verification + submit button. */
  primary: ReactNode;
  /** div5 三方登录区: divider + provider cards. */
  social?: ReactNode | undefined;
  /** div6 注册链接区 (rendered outside the <form>). */
  footer?: ReactNode | undefined;
  inputAriaLabel?: string | undefined;
  primaryAriaLabel?: string | undefined;
  socialAriaLabel?: string | undefined;
  footerAriaLabel?: string | undefined;
  autoComplete?: string | undefined;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

export interface AuthTabsProps {
  active: AuthLoginTab;
  onChange: (screen: AuthLoginTab) => void;
  passwordLabel?: string;
  phoneLabel?: string;
  /** Left→right tab order. Defaults to password-first; pass to swap. */
  order?: readonly AuthLoginTab[];
}

export interface AuthFieldProps {
  label: string;
  name: string;
  type: string;
  placeholder: string;
  icon?: AuthFieldIcon | ReactNode | undefined;
  /** 贴在输入框**内**右缘的小控件（显示密码之类的图标按钮）。 */
  trailingAction?: ReactNode | undefined;
  /**
   * 与输入框并排、在标签**之下**的独立控件（"获取验证码"这一类）。
   *
   * 单独给一个槽是因为对齐：原先由调用方在外面拼 `flex` 再给按钮补一个
   * `mt-lg` 去跳过标签，那个数字等于「标签行高 + 间距」，标签字号或密度一改
   * 就错位，而错位不报错。放进来之后按钮和输入框同在标签下的那一行里，
   * 由 flex 自己对齐，也不必再猜。
   */
  action?: ReactNode | undefined;
  value: string;
  error?: string | undefined;
  hint?: string | undefined;
  autoComplete?: string | undefined;
  autoFocus?: boolean | undefined;
  inputMode?: "numeric" | undefined;
  maxLength?: number | undefined;
  required?: boolean | undefined;
  disabled?: boolean | undefined;
  onChange: (value: string) => void;
}

export interface AuthPrimaryButtonProps {
  loading: boolean;
  label: string;
  loadingLabel: string;
  disabled?: boolean | undefined;
  disabledLabel?: string | undefined;
}

export interface AuthSocialButtonConfig {
  provider: AuthSocialProvider;
  label: string;
  disabled?: boolean | undefined;
  iconSrc?: string | undefined;
  onClick?: (() => void) | undefined;
}

export interface AuthSocialButtonsProps {
  providers: AuthSocialButtonConfig[];
  separatorLabel?: string | undefined;
}

export interface AuthTenantSocialButtonsProps {
  readonly onFeishu: () => void;
  readonly onDingTalk: () => void;
  readonly separatorLabel?: string | undefined;
}

export interface AuthRegisterPromptProps {
  readonly onRegister: () => void;
  readonly prefix?: string | undefined;
  readonly label?: string | undefined;
}

export interface AuthLoginContentProps {
  readonly screen: AuthLoginScreen;
  readonly forgot: ReactNode;
  readonly phone: ReactNode;
  readonly password: ReactNode;
}

export function useAuthVerificationCountdown(active: boolean, seconds = 5) {
  const [remainingSeconds, setRemainingSeconds] = useState(seconds);

  useEffect(() => {
    if (!active) {
      setRemainingSeconds(seconds);
      return undefined;
    }

    setRemainingSeconds(seconds);
    const intervalId = globalThis.setInterval(() => {
      setRemainingSeconds((value) => Math.max(0, value - 1));
    }, 1000);

    return () => globalThis.clearInterval(intervalId);
  }, [active, seconds]);

  return remainingSeconds;
}

export interface AuthChromeHeaderProps {
  brandHref?: string | undefined;
  brandLogoSrc?: string | undefined;
  brandLogoAlt?: string | undefined;
  brandLabel?: ReactNode | undefined;
  currentLocale?: Locale | undefined;
  localeOptions?: LocaleSelectOption[] | undefined;
  localeButtonLabel?: string | undefined;
  localePanelLabel?: string | undefined;
  currentTheme?: Theme | string | undefined;
  themeButtonLabel?: string | undefined;
  lightThemeLabel?: string | undefined;
  darkThemeLabel?: string | undefined;
  onLocaleChange?: ((locale: Locale) => void) | undefined;
  onThemeChange?: ((theme: "light" | "dark") => void) | undefined;
}

export interface AuthChromeFooterProps {
  copyright?: ReactNode;
  links?: ShellLegalFooterLink[];
  legalLabel?: string;
}

export interface AuthLoginOptionsProps {
  disabled?: boolean;
  rememberChecked?: boolean | undefined;
  agreementChecked: boolean;
  rememberLabel?: ReactNode;
  agreementPrefix?: ReactNode;
  agreementJoiner?: ReactNode;
  termsLabel?: ReactNode;
  privacyLabel?: ReactNode;
  termsHref?: string;
  privacyHref?: string;
  forgotLabel?: ReactNode;
  forgotHref?: string;
  forgetMeLabel?: ReactNode;
  forgetMeTitle?: string;
  /** Show the "forgot password" link. Off for verification-code login. */
  showForgot?: boolean;
  /** Show the "remember me" checkbox. Off for the accounts login surface. */
  showRemember?: boolean | undefined;
  onRememberChange?: ((checked: boolean) => void) | undefined;
  onAgreementChange: (checked: boolean) => void;
  onForgot?: (() => void) | undefined;
  onForgetMe?: (() => void) | undefined;
}

export interface AuthLoginTemplateProps extends Omit<
  UnifiedAuthPageProps,
  "children"
> {
  title?: string;
  description?: ReactNode | undefined;
  useLoginLayout?: boolean;
  children: ReactNode;
}

export type AuthLoginOptionOverrides = Pick<
  AuthLoginOptionsProps,
  | "rememberLabel"
  | "agreementPrefix"
  | "agreementJoiner"
  | "termsLabel"
  | "privacyLabel"
  | "termsHref"
  | "privacyHref"
  | "forgotLabel"
  | "forgotHref"
  | "forgetMeLabel"
  | "forgetMeTitle"
  | "showRemember"
>;

export interface AuthPasswordLoginPanelProps {
  tabs?: ReactNode;
  identifier: string;
  password: string;
  rememberChecked?: boolean | undefined;
  agreementChecked: boolean;
  errors?:
    | {
        identifier?: string | undefined;
        password?: string | undefined;
        form?: string | undefined;
      }
    | undefined;
  loading: boolean;
  verification?: ReactNode;
  social?: ReactNode;
  footer?: ReactNode;
  primaryDisabled?: boolean;
  primaryDisabledLabel?: string | undefined;
  submitLabel?: string;
  submitLoadingLabel?: string;
  identifierLabel?: string;
  identifierName?: string;
  identifierPlaceholder?: string;
  identifierAutoComplete?: string;
  passwordLabel?: string;
  passwordName?: string;
  passwordPlaceholder?: string;
  passwordAutoComplete?: string;
  showForgot?: boolean;
  options?: AuthLoginOptionOverrides | undefined;
  onChangeIdentifier: (value: string) => void;
  onChangePassword: (value: string) => void;
  onRememberChange?: ((checked: boolean) => void) | undefined;
  onAgreementChange: (checked: boolean) => void;
  onForgot?: (() => void) | undefined;
  onForgetMe?: (() => void) | undefined;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

export interface AuthPhoneLoginPanelProps {
  tabs?: ReactNode;
  phone: string;
  code: string;
  rememberChecked?: boolean | undefined;
  agreementChecked: boolean;
  errors?:
    | {
        phone?: string | undefined;
        code?: string | undefined;
        form?: string | undefined;
      }
    | undefined;
  loading: boolean;
  codeSending?: boolean;
  codeCountdown?: number;
  sendCodeDisabled?: boolean;
  verification?: ReactNode;
  social?: ReactNode;
  footer?: ReactNode;
  primaryDisabled?: boolean;
  primaryDisabledLabel?: string | undefined;
  submitLabel?: string;
  submitLoadingLabel?: string;
  phoneLabel?: string;
  phoneName?: string;
  phonePlaceholder?: string;
  /** Identifier input type/icon/autocomplete — override to accept email too (D-CC). */
  phoneInputType?: string;
  phoneIcon?: AuthFieldIcon | ReactNode | undefined;
  phoneAutoComplete?: string;
  codeLabel?: string;
  codeName?: string;
  codePlaceholder?: string;
  sendCodeLabel?: string;
  sendingCodeLabel?: string;
  verificationPendingLabel?: string;
  retryCodeLabel?: (seconds: number) => string;
  showForgot?: boolean;
  options?: AuthLoginOptionOverrides | undefined;
  onChangePhone: (value: string) => void;
  onChangeCode: (value: string) => void;
  onSendCode: () => void;
  onRememberChange?: ((checked: boolean) => void) | undefined;
  onAgreementChange: (checked: boolean) => void;
  onForgot?: (() => void) | undefined;
  onForgetMe?: (() => void) | undefined;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

export interface AuthForgotPasswordPanelProps {
  email: string;
  error?: string | undefined;
  loading: boolean;
  resetSent?: boolean;
  backLabel?: ReactNode;
  title?: ReactNode;
  description?: ReactNode | undefined;
  sentTitle?: ReactNode | undefined;
  sentDescription?: ReactNode | undefined;
  sentHint?: ReactNode | undefined;
  sentEmailFallback?: ReactNode | undefined;
  sentActionLabel?: ReactNode | undefined;
  emailLabel?: string;
  emailName?: string;
  emailPlaceholder?: string;
  submitLabel?: string;
  submitLoadingLabel?: string;
  onBack: () => void;
  onChangeEmail: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

// 中性占位。真实品牌名由调用方传入——真名不入仓。

/**
 * 视觉面板的缺省文案。**只留中性占位，不带任何可核实的数字。**
 *
 * 原先这里默认了 `40ms / 99.97% / 12B+` 和 "All systems operational"。accounts
 * 从不传 `visual`，于是这四条一路默认到了生产登录页上——那是把杜撰的运行指标
 * 当事实展示给每一个来登录的人，且没有任何数据源能对上。缺省值不该是"看起来
 * 像真的"，因为看起来像真的就没人会去传真的。
 *
 * 要展示指标的调用方自己传 `stats`，并且自己对数字负责。
 */
const DEFAULT_SOCIAL_ICON_SRC: Record<AuthSocialProvider, string> = {
  feishu: "/brand/feishu-logo-icon.svg",
  dingtalk: "/brand/dingtalk-logo-icon.svg",
  wechat: "/brand/wechat_logo_icon.svg",
  // Official Google "G" (color, unaltered) — consuming app serves the asset.
  google: "/brand/google-logo-icon.svg",
};

const AUTH_FIELD_ICONS = new Set<AuthFieldIcon>([
  "user",
  "lock",
  "phone",
  "shield",
  "mail",
]);

/** 字段图标语义 → Icon 档名。shield 用 shield-check：验证码即校验语义。 */
const AUTH_FIELD_ICON_NAME: Record<AuthFieldIcon, IconName> = {
  user: "user",
  lock: "lock",
  phone: "phone",
  shield: "shield-check",
  mail: "mail",
};

export function UnifiedAuthPage({
  className,
  header,
  footer,
  overlay,
  children,
}: Readonly<UnifiedAuthPageProps>) {
  return (
    <section className={cn("accounts-viewport", className)}>
      {header}
      {overlay}
      <main className="accounts-content">
        <div className="accounts-auth">{children}</div>
      </main>
      {footer}
    </section>
  );
}

export function AuthLoginLayout({
  title,
  description,
  children,
}: Readonly<AuthLoginLayoutProps>) {
  const formText = useTranslations("accountsForms");
  title ??= formText("sign_in_to_vxture");
  return (
    <>
      <div className="accounts-auth-heading">
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      <div className="accounts-auth-surface">{children}</div>
    </>
  );
}

export function AuthLoginTemplate({
  title,
  description,
  useLoginLayout = true,
  children,
  ...pageProps
}: Readonly<AuthLoginTemplateProps>) {
  const formText = useTranslations("accountsForms");
  title ??= formText("welcome_back");
  return (
    <UnifiedAuthPage {...pageProps}>
      {useLoginLayout ? (
        <AuthLoginLayout title={title} description={description}>
          {children}
        </AuthLoginLayout>
      ) : (
        children
      )}
    </UnifiedAuthPage>
  );
}

/**
 * Login layout blocks (see the agreed structure):
 *   <div title>                         ← AuthLoginLayout (outside this form)
 *   <form flow-form>
 *     <section 信息输入区>  tabs + fields + options
 *     <section 登录验证区>  verification + submit button
 *     <section 三方登录区>  divider + provider cards
 *   </form>
 *   <section 注册链接区>                 ← register link, outside the form
 */
export function AuthFlowForm({
  input,
  primary,
  social,
  footer,
  inputAriaLabel,
  primaryAriaLabel,
  socialAriaLabel,
  footerAriaLabel,
  autoComplete = "on",
  onSubmit,
}: Readonly<AuthFlowFormProps>) {
  const formText = useTranslations("accountsForms");
  inputAriaLabel ??= formText("sign_in_details");
  primaryAriaLabel ??= formText("sign_in_verification");
  socialAriaLabel ??= formText("connected_accounts");
  footerAriaLabel ??= formText("registration");
  return (
    <>
      <form
        className="accounts-login-form"
        onSubmit={onSubmit}
        autoComplete={autoComplete}
      >
        <section className="flex flex-col gap-md" aria-label={inputAriaLabel}>
          {input}
        </section>

        <section className="flex flex-col gap-sm" aria-label={primaryAriaLabel}>
          {primary}
        </section>

        {social ? (
          <section
            className="flex flex-col gap-md"
            aria-label={socialAriaLabel}
          >
            {social}
          </section>
        ) : null}
      </form>

      {footer ? (
        <section
          className="flex flex-col items-center"
          aria-label={footerAriaLabel}
        >
          {footer}
        </section>
      ) : null}
    </>
  );
}

export function AuthTabs({
  active,
  onChange,
  passwordLabel,
  phoneLabel,
  order = ["login", "phone"],
}: Readonly<AuthTabsProps>) {
  const formText = useTranslations("accountsForms");
  passwordLabel ??= formText("password_login");
  phoneLabel ??= formText("code_login");
  const labels: Record<AuthLoginTab, string> = {
    login: passwordLabel,
    phone: phoneLabel,
  };
  return (
    <Tabs
      value={active}
      onValueChange={(value) => onChange(value as AuthLoginTab)}
    >
      {/* 与输入框、提交按钮同高（control-xl / 40）。认证表单是竖着一列控件，
          三种高度（36 / 32 / 40）叠在一起时参差是一眼能看出来的。 */}
      <TabsList className="accounts-login-tabs">
        {order.map((tab) => (
          <TabsTrigger key={tab} value={tab}>
            {labels[tab]}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

export function AuthChromeHeader({
  brandLabel = "Vxture Accounts",
}: Readonly<AuthChromeHeaderProps>) {
  return <AccountsHeader brandLabel={brandLabel} />;
}

export function AuthChromeFooter({
  copyright = "© 2026 Brand. All rights reserved.",
  links,
  legalLabel = "Legal links",
}: Readonly<AuthChromeFooterProps>) {
  const formText = useTranslations("accountsForms");
  links ??= [
    { href: "/legal/terms", label: formText("terms_of_service") },
    { href: "/legal/privacy", label: formText("privacy_policy") },
    { href: "/legal/cookies", label: formText("cookie_policy") },
  ];
  return (
    <ShellLegalFooter
      copyright={copyright}
      links={links}
      legalLabel={legalLabel}
    />
  );
}

export function AuthField({
  label,
  name,
  type,
  placeholder,
  icon,
  trailingAction,
  action,
  value,
  error,
  hint,
  autoComplete,
  autoFocus,
  inputMode,
  maxLength,
  required = true,
  disabled,
  onChange,
}: Readonly<AuthFieldProps>) {
  const FieldInput = type === "password" ? PasswordInput : Input;
  const inputId = `vx-auth-${name}`;
  const describedById = error || hint ? `${inputId}-desc` : undefined;
  return (
    <div className="accounts-auth-field">
      <Label htmlFor={inputId}>
        {label}
        {required ? (
          <span className="accounts-required" aria-hidden="true">
            *
          </span>
        ) : null}
      </Label>
      {/* 标签下的一行：输入框 + 可选的并列控件。并列控件在这一行里对齐，
          不靠调用方补 margin 去跳过标签高度。 */}
      <div className="flex items-center gap-sm">
        <div className="relative flex min-w-0 flex-1 items-center">
          {icon ? (
            <span
              className="pointer-events-none absolute left-sm flex text-muted-foreground"
              aria-hidden="true"
            >
              {isAuthFieldIcon(icon) ? (
                <Icon name={AUTH_FIELD_ICON_NAME[icon]} size="sm" />
              ) : (
                icon
              )}
            </span>
          ) : null}
          <FieldInput
            // 认证表单统一到 control-xl(40)：`Input` 基座是 control-md(32)，
            // 与同屏的 Tabs(36) / 提交按钮(40) 三个高度并存。
            className={cn(
              "h-control-xl",
              icon && "pl-xl",
              trailingAction && "pr-3xl",
            )}
            {...(type === "password" ? { trailingAction } : {})}
            id={inputId}
            name={name}
            type={type}
            value={value}
            placeholder={placeholder}
            autoComplete={autoComplete}
            autoFocus={autoFocus}
            inputMode={inputMode}
            maxLength={maxLength}
            required={required}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
            aria-invalid={Boolean(error)}
            aria-describedby={describedById}
          />
          {trailingAction && type !== "password" ? (
            <span className="absolute right-2xs flex items-center">
              {trailingAction}
            </span>
          ) : null}
        </div>
        {action}
      </div>
      {error ? (
        <p id={describedById} className="text-body-sm text-destructive-text">
          {error}
        </p>
      ) : null}
      {hint && !error ? (
        <p id={describedById} className="text-body-sm text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function isAuthFieldIcon(icon: AuthFieldProps["icon"]): icon is AuthFieldIcon {
  return (
    typeof icon === "string" && AUTH_FIELD_ICONS.has(icon as AuthFieldIcon)
  );
}

/**
 * 两个登录面板的"登录验证区"逐字相同（人机验证 + 表单级错误 + 提交按钮）。
 * 各写一份的话，改其中一处另一处会静默不跟——批 O 重写后它们已经这样并排
 * 存在了一段时间。合成一处。
 */
function AuthPrimarySection({
  verification,
  formError,
  loading,
  disabled,
  label,
  loadingLabel,
  disabledLabel,
}: Readonly<{
  verification?: ReactNode;
  formError?: string | undefined;
  loading: boolean;
  disabled: boolean;
  label: string;
  loadingLabel: string;
  disabledLabel?: string | undefined;
}>) {
  return (
    <>
      <div className="accounts-verification">
        {verification}
        {/* 表单级错误原先是一行居中的红字，夹在 human-verification 那块灰盒子和提交按钮
            中间——整页视觉最重的元素正好压在它上面，而它自己没有任何形状。
            改用 `Banner`：这就是 DS 收「常驻提示条」的那一件，语气与图标都由
            六档语气给，不必在这里再配一套。 */}
        {formError ? <Banner tone="danger" title={formError} /> : null}
      </div>
      <AuthPrimaryButton
        loading={loading}
        disabled={disabled}
        label={label}
        loadingLabel={loadingLabel}
        disabledLabel={disabledLabel}
      />
    </>
  );
}

export function AuthPrimaryButton({
  loading,
  label,
  loadingLabel,
  disabled = false,
  disabledLabel,
}: Readonly<AuthPrimaryButtonProps>) {
  const blocked = loading || disabled;
  let buttonContent: ReactNode = label;
  if (disabled && disabledLabel) {
    buttonContent = disabledLabel;
  }
  if (loading) {
    buttonContent = (
      <>
        <span
          className="size-icon-xs animate-spin rounded-full border-medium border-current border-t-transparent"
          aria-hidden="true"
        />
        {loadingLabel}
      </>
    );
  }

  return (
    <Button
      type="submit"
      size="xl"
      className="w-full rounded-full"
      disabled={blocked}
    >
      {buttonContent}
    </Button>
  );
}

export function AuthSocialButtons({
  providers,
  separatorLabel,
}: Readonly<AuthSocialButtonsProps>) {
  const formText = useTranslations("accountsForms");
  separatorLabel ??= formText("other_sign_in_methods");
  if (providers.length === 0) {
    return null;
  }

  return (
    <>
      <div className="accounts-social-divider" aria-label={separatorLabel}>
        <span className="flex-1">
          <Separator />
        </span>
        <em className="shrink-0 text-label-sm text-muted-foreground not-italic">
          {separatorLabel}
        </em>
        <span className="flex-1">
          <Separator />
        </span>
      </div>
      <div className="accounts-social-buttons">
        {providers.map((provider) => (
          <Button
            type="button"
            key={provider.provider}
            variant="outline"
            className="flex-1 gap-sm"
            onClick={provider.onClick}
            disabled={provider.disabled}
          >
            <BrandProviderIcon
              provider={provider.provider}
              src={provider.iconSrc}
            />
            {provider.label}
          </Button>
        ))}
      </div>
    </>
  );
}

const AUTH_TENANT_SOCIAL_ICON_SRC = {
  feishu: "/brand/feishu-logo-icon.svg",
  dingtalk: "/brand/dingtalk-logo-icon.svg",
  wechat: "/brand/wechat_logo_icon.svg",
} as const;

export function AuthTenantSocialButtons({
  onFeishu,
  onDingTalk,
  separatorLabel,
}: Readonly<AuthTenantSocialButtonsProps>) {
  const formText = useTranslations("accountsForms");

  return (
    <AuthSocialButtons
      separatorLabel={separatorLabel}
      providers={[
        {
          provider: "feishu",
          label: formText("feishu"),
          iconSrc: AUTH_TENANT_SOCIAL_ICON_SRC.feishu,
          onClick: onFeishu,
        },
        {
          provider: "dingtalk",
          label: formText("dingtalk"),
          iconSrc: AUTH_TENANT_SOCIAL_ICON_SRC.dingtalk,
          onClick: onDingTalk,
        },
        {
          provider: "wechat",
          label: formText("wechat"),
          iconSrc: AUTH_TENANT_SOCIAL_ICON_SRC.wechat,
          disabled: true,
        },
      ]}
    />
  );
}

export function AuthRegisterPrompt({
  onRegister,
  prefix,
  label,
}: Readonly<AuthRegisterPromptProps>) {
  const formText = useTranslations("accountsForms");
  prefix ??= formText("new_here");
  label ??= formText("register");
  return (
    <p className="flex items-center gap-2xs text-body-sm text-muted-foreground">
      {prefix}
      <Button variant="link" size="xs" onClick={onRegister}>
        {label}
      </Button>
    </p>
  );
}

export function AuthLoginContent({
  screen,
  forgot,
  phone,
  password,
}: Readonly<AuthLoginContentProps>) {
  if (screen === "forgot") {
    return <>{forgot}</>;
  }

  if (screen === "phone") {
    return <>{phone}</>;
  }

  return <>{password}</>;
}

export function AuthLoginOptions({
  disabled = false,
  rememberChecked = false,
  agreementChecked,
  rememberLabel,
  agreementPrefix,
  agreementJoiner,
  termsLabel,
  privacyLabel,
  termsHref = `${process.env.NEXT_PUBLIC_WEBSITE_URL || "https://vxture.com"}/legal/terms`,
  privacyHref = `${process.env.NEXT_PUBLIC_WEBSITE_URL || "https://vxture.com"}/legal/privacy`,
  forgotLabel,
  forgotHref = "#forgot-password",
  forgetMeLabel,
  forgetMeTitle,
  showForgot = true,
  showRemember = true,
  onRememberChange,
  onAgreementChange,
  onForgot,
  onForgetMe,
}: Readonly<AuthLoginOptionsProps>) {
  const formText = useTranslations("accountsForms");
  rememberLabel ??= formText("remember_me");
  agreementPrefix ??= formText("i_agree_to_the");
  agreementJoiner ??= formText("and");
  termsLabel ??= formText("terms_of_service_2");
  privacyLabel ??= formText("privacy_policy");
  forgotLabel ??= formText("forgot_password");
  forgetMeLabel ??= formText("forget_me");
  forgetMeTitle ??= formText("clear_saved_sign_in_details");
  const linkClass = "text-link hover:text-link-hover hover:underline";
  // 同意行里的链接**贴着**中文正文排，"同意用户协议和隐私政策"会挤成一条。
  // 补一点左右留白，链接才从句子里读得出来。这一档只给内联的那两条——
  // "忘记密码？"是句末独立的链接，补 margin 会把它推离右缘。
  const inlineLinkClass = cn(linkClass, "mx-2xs");
  return (
    <div className="accounts-login-options flex flex-col gap-sm">
      <div className="accounts-login-options-tools flex items-center justify-between gap-sm">
        {showRemember ? (
          <span className="flex items-center gap-xs">
            <Checkbox
              id="vx-auth-remember"
              checked={rememberChecked}
              disabled={disabled}
              onCheckedChange={(checked) =>
                onRememberChange?.(checked === true)
              }
            />
            <Label
              htmlFor="vx-auth-remember"
              className="text-body-sm text-muted-foreground"
            >
              {rememberLabel}
            </Label>
          </span>
        ) : (
          <span />
        )}
        <span className="flex items-center gap-sm">
          {showForgot ? (
            onForgot ? (
              <Button type="button" variant="link" size="xs" onClick={onForgot}>
                {forgotLabel}
              </Button>
            ) : (
              <a className={cn("text-body-sm", linkClass)} href={forgotHref}>
                {forgotLabel}
              </a>
            )
          ) : null}
          {onForgetMe ? (
            <Button
              variant="link"
              size="xs"
              className="text-muted-foreground hover:text-foreground"
              onClick={onForgetMe}
              disabled={disabled}
              title={forgetMeTitle}
            >
              {forgetMeLabel}
            </Button>
          ) : null}
        </span>
      </div>

      <span className="flex items-start gap-xs">
        <Checkbox
          id="vx-auth-agreement"
          checked={agreementChecked}
          disabled={disabled}
          onCheckedChange={(checked) => onAgreementChange(checked === true)}
        />
        <Label
          htmlFor="vx-auth-agreement"
          className="block text-body-sm text-muted-foreground"
        >
          {agreementPrefix}
          <a
            href={termsHref}
            className={inlineLinkClass}
            target="_blank"
            rel="noopener noreferrer"
          >
            {termsLabel}
          </a>
          {agreementJoiner}
          <a
            href={privacyHref}
            className={inlineLinkClass}
            target="_blank"
            rel="noopener noreferrer"
          >
            {privacyLabel}
          </a>
        </Label>
      </span>
    </div>
  );
}

export function AuthPasswordLoginPanel({
  tabs,
  identifier,
  password,
  rememberChecked,
  agreementChecked,
  errors,
  loading,
  verification,
  social,
  footer,
  primaryDisabled = false,
  primaryDisabledLabel,
  submitLabel,
  submitLoadingLabel,
  identifierLabel,
  identifierName = "username",
  identifierPlaceholder = "email / username / phone",
  identifierAutoComplete = "username",
  passwordLabel,
  passwordName = "password",
  passwordPlaceholder,
  passwordAutoComplete = "current-password",
  showForgot = true,
  options,
  onChangeIdentifier,
  onChangePassword,
  onRememberChange,
  onAgreementChange,
  onForgot,
  onForgetMe,
  onSubmit,
}: Readonly<AuthPasswordLoginPanelProps>) {
  const formText = useTranslations("accountsForms");
  submitLabel ??= formText("sign_in");
  submitLoadingLabel ??= formText("signing_in");
  identifierLabel ??= formText("email");
  passwordLabel ??= formText("password_2");
  passwordPlaceholder ??= formText("enter_your_password");

  return (
    <AuthFlowForm
      onSubmit={onSubmit}
      input={
        <>
          {tabs}
          <div className="accounts-login-fields flex flex-col gap-md">
            <AuthField
              label={identifierLabel}
              name={identifierName}
              type="text"
              placeholder={identifierPlaceholder}
              icon="user"
              value={identifier}
              error={errors?.identifier}
              autoComplete={identifierAutoComplete}
              autoFocus
              disabled={loading}
              onChange={onChangeIdentifier}
            />
            <AuthField
              label={passwordLabel}
              name={passwordName}
              type="password"
              placeholder={passwordPlaceholder}
              icon="lock"
              trailingAction={
                showForgot ? (
                  onForgot ? (
                    <Button
                      type="button"
                      variant="link"
                      size="xs"
                      onClick={onForgot}
                    >
                      {formText("forgot_password")}
                    </Button>
                  ) : (
                    <a
                      className="text-body-sm text-link"
                      href="/forgot-password"
                    >
                      {formText("forgot_password")}
                    </a>
                  )
                ) : undefined
              }
              value={password}
              error={errors?.password}
              autoComplete={passwordAutoComplete}
              disabled={loading}
              onChange={onChangePassword}
            />

            <AuthLoginOptions
              {...options}
              disabled={loading}
              showForgot={false}
              rememberChecked={rememberChecked}
              agreementChecked={agreementChecked}
              onRememberChange={onRememberChange}
              onAgreementChange={onAgreementChange}
              onForgot={onForgot}
              onForgetMe={onForgetMe}
            />
          </div>
        </>
      }
      primary={
        <AuthPrimarySection
          verification={verification}
          formError={errors?.form}
          loading={loading}
          disabled={primaryDisabled}
          label={submitLabel}
          loadingLabel={submitLoadingLabel}
          disabledLabel={primaryDisabledLabel}
        />
      }
      social={social}
      footer={footer}
    />
  );
}

export function AuthPhoneLoginPanel({
  tabs,
  phone,
  code,
  rememberChecked,
  agreementChecked,
  errors,
  loading,
  codeSending = false,
  codeCountdown = 0,
  sendCodeDisabled = false,
  verification,
  social,
  footer,
  primaryDisabled = false,
  primaryDisabledLabel,
  submitLabel,
  submitLoadingLabel,
  phoneLabel,
  phoneName = "phone",
  phonePlaceholder,
  phoneInputType = "tel",
  phoneIcon = "phone",
  phoneAutoComplete = "tel",
  codeLabel,
  codeName = "code",
  sendCodeLabel,
  sendingCodeLabel,
  retryCodeLabel,
  showForgot = true,
  options,
  onChangePhone,
  onChangeCode,
  onSendCode,
  onRememberChange,
  onAgreementChange,
  onForgot,
  onForgetMe,
  onSubmit,
}: Readonly<AuthPhoneLoginPanelProps>) {
  const formText = useTranslations("accountsForms");
  submitLabel ??= formText("sign_in");
  submitLoadingLabel ??= formText("signing_in");
  phoneLabel ??= formText("phone_number");
  phonePlaceholder ??= formText("enter_your_phone_number");
  codeLabel ??= formText("verification_code");
  sendCodeLabel ??= formText("send_code");
  sendingCodeLabel ??= formText("sending");
  retryCodeLabel ??= (seconds) => formText("retry_after", { seconds });
  let resolvedSendCodeLabel = sendCodeLabel;
  if (codeSending) {
    resolvedSendCodeLabel = sendingCodeLabel;
  }
  if (codeCountdown > 0) {
    resolvedSendCodeLabel = retryCodeLabel(codeCountdown);
  }

  return (
    <AuthFlowForm
      onSubmit={onSubmit}
      input={
        <>
          {tabs}
          <div className="accounts-login-fields flex flex-col gap-md">
            <AuthField
              label={phoneLabel}
              name={phoneName}
              type={phoneInputType}
              placeholder={phonePlaceholder}
              icon={phoneIcon}
              value={phone}
              error={errors?.phone}
              autoComplete={phoneAutoComplete}
              autoFocus
              disabled={loading || codeSending}
              onChange={onChangePhone}
            />

            <AuthField
              label={codeLabel}
              name={codeName}
              type="text"
              placeholder={formText("enter_the_6_digit_code")}
              icon="shield"
              inputMode="numeric"
              maxLength={6}
              autoComplete="one-time-code"
              value={code}
              error={errors?.code}
              disabled={loading || codeSending}
              onChange={(value) =>
                onChangeCode(value.replace(/\D/g, "").slice(0, 6))
              }
              action={
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  // Preserve the action width throughout the countdown.
                  className="accounts-send-code"
                  onClick={onSendCode}
                  disabled={
                    loading ||
                    codeSending ||
                    codeCountdown > 0 ||
                    sendCodeDisabled
                  }
                >
                  {resolvedSendCodeLabel}
                </Button>
              }
            />

            <AuthLoginOptions
              {...options}
              disabled={loading}
              showForgot={showForgot}
              rememberChecked={rememberChecked}
              agreementChecked={agreementChecked}
              onRememberChange={onRememberChange}
              onAgreementChange={onAgreementChange}
              onForgot={onForgot}
              onForgetMe={onForgetMe}
            />
          </div>
        </>
      }
      primary={
        <AuthPrimarySection
          verification={verification}
          formError={errors?.form}
          loading={loading}
          disabled={primaryDisabled}
          label={submitLabel}
          loadingLabel={submitLoadingLabel}
          disabledLabel={primaryDisabledLabel}
        />
      }
      social={social}
      footer={footer}
    />
  );
}

/**
 * 认证流程的终态屏（"邮件已发送" / "密码已重置" / "绑定完成"）。
 *
 * 抽出来是因为它已经有三份：`AuthForgotPasswordPanel` 的 `resetSent` 分支写了
 * 一份完整的，accounts 的两个重置面各自另写了一份——而后两份挂的是
 * `.vx-auth-reset-done` / `.vx-auth-check`，那批类名随 155 个遗留样式文件一起
 * 退役了，没有任何地方再定义它们。于是那两页的成功态是：一个裸的 ✓ 字符、
 * 一个没有间距的标题、一段没有层次的正文。**不报错，只是难看。**
 */
export type AuthResultTone = "success" | "danger" | "neutral";

export interface AuthResultPanelProps {
  /** 终态的性质：办成了 / 办不成 / 只是告知。缺省是办成了。 */
  readonly tone?: AuthResultTone | undefined;
  readonly title: ReactNode;
  readonly description?: ReactNode | undefined;
  readonly hint?: ReactNode | undefined;
  /** 收尾动作（"返回登录"一类）。 */
  readonly action?: ReactNode | undefined;
}

/** 三档只换图与徽底的语气，形状是同一个——终态屏的版式只有一种。 */
const AUTH_RESULT_TONES: Record<
  AuthResultTone,
  { readonly icon: IconName; readonly badge: string }
> = {
  success: { icon: "check", badge: "bg-success-muted text-success-text" },
  danger: {
    icon: "error",
    badge: "bg-destructive-muted text-destructive-text",
  },
  neutral: { icon: "info", badge: "bg-accent text-muted-foreground" },
};

export function AuthResultPanel({
  tone = "success",
  title,
  description,
  hint,
  action,
}: Readonly<AuthResultPanelProps>) {
  const { icon, badge } = AUTH_RESULT_TONES[tone];
  return (
    <div className="accounts-result">
      <span className={cn("accounts-result-icon", badge)} aria-hidden="true">
        <Icon name={icon} size="lg" />
      </span>
      <h1 className="text-balance text-title-lg text-foreground">{title}</h1>
      {description ? (
        <p className="text-pretty text-body-md text-muted-foreground">
          {description}
        </p>
      ) : null}
      {hint ? (
        <p className="text-body-sm text-muted-foreground">{hint}</p>
      ) : null}
      {action ? <div className="w-full pt-2xs">{action}</div> : null}
    </div>
  );
}

export function AuthForgotPasswordPanel({
  email,
  error,
  loading,
  resetSent = false,
  backLabel,
  title,
  description,
  sentTitle,
  sentDescription,
  sentHint,
  sentEmailFallback,
  sentActionLabel,
  emailLabel,
  emailName = "email",
  emailPlaceholder = "you@company.com",
  submitLabel,
  submitLoadingLabel,
  onBack,
  onChangeEmail,
  onSubmit,
}: Readonly<AuthForgotPasswordPanelProps>) {
  const formText = useTranslations("accountsForms");
  backLabel ??= formText("back_to_sign_in");
  title ??= formText("reset_password");
  description ??= formText("enter_your_email_to_receive_a_reset_link");
  sentTitle ??= formText("reset_email_sent");
  sentHint ??= formText("check_your_spam_folder_if_you_cannot_find_the_email");
  sentEmailFallback ??= formText("your_email");
  sentActionLabel ??= formText("back_to_sign_in");
  emailLabel ??= formText("email");
  submitLabel ??= formText("send_reset_link");
  submitLoadingLabel ??= formText("generating");
  if (resetSent) {
    return (
      <>
        <AuthResultPanel
          title={sentTitle}
          description={
            sentDescription ?? (
              <>
                {formText("a_reset_link_was_sent_to")}{" "}
                <strong className="text-foreground">
                  {email || sentEmailFallback}
                </strong>
                {formText("reset_your_password_within_15_minutes")}
              </>
            )
          }
          hint={sentHint}
          action={
            <Button size="xl" className="w-full" onClick={onBack}>
              {sentActionLabel}
            </Button>
          }
        />
      </>
    );
  }

  return (
    <>
      <AuthBackButton onClick={onBack}>{backLabel}</AuthBackButton>
      <AuthLoginLayout title={title} description={description}>
        <form
          className="flex flex-col gap-md"
          onSubmit={onSubmit}
          autoComplete="on"
        >
          <AuthField
            label={emailLabel}
            name={emailName}
            type="email"
            placeholder={emailPlaceholder}
            icon="mail"
            value={email}
            error={error}
            autoComplete="email"
            autoFocus
            disabled={loading}
            onChange={onChangeEmail}
          />
          <AuthPrimaryButton
            loading={loading}
            label={submitLabel}
            loadingLabel={submitLoadingLabel}
          />
        </form>
      </AuthLoginLayout>
    </>
  );
}

function AuthBackButton({
  children,
  onClick,
}: Readonly<{
  children: ReactNode;
  onClick: () => void;
}>) {
  const formText = useTranslations("accountsForms");

  return (
    <Button
      variant="ghost"
      size="md"
      className="accounts-back"
      onClick={onClick}
    >
      <Icon name="arrow-left" size="sm" />
      <span className="sr-only">{children}</span>
      <span aria-hidden="true">{formText("back")}</span>
    </Button>
  );
}

export function BrandProviderIcon({
  provider,
  src,
}: Readonly<{
  provider: AuthSocialProvider;
  src?: string | undefined;
}>) {
  return (
    // 20px 的三方品牌小图标（本地 public 静态 SVG）——next/image 的优化管线
    // 对它没有收益，只有开销。
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="size-icon-md shrink-0"
      src={src ?? DEFAULT_SOCIAL_ICON_SRC[provider]}
      alt=""
      aria-hidden="true"
      width={20}
      height={20}
      decoding="async"
      draggable={false}
      referrerPolicy="no-referrer"
    />
  );
}
