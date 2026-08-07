/**
 * AuthLogin.tsx - 认证形态组件族（统一登录页、密码/验证码/找回面板、三方登录、chrome）。
 * @package @vxture/design-system
 * @layer Presentation
 * @category Components - Auth
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

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from "react";
import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import { DEFAULT_LOCALE, type Locale, type Theme } from "@vxture/shared";
import {
  ShellBrand,
  ShellLegalFooter,
  ShellLocaleSwitcher,
  ShellThemeToggle,
  type LocaleSelectOption,
  type ShellLegalFooterLink,
} from "../shell";
import {
  Button,
  Card,
  Checkbox,
  Icon,
  Input,
  Label,
  Separator,
  Tabs,
  TabsList,
  TabsTrigger,
  cn,
} from "@vxture/design-ui";
import type { IconName } from "@vxture/design-ui";

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

export interface UnifiedAuthPageProps {
  className?: string | undefined;
  pageBackgroundImage?: string | undefined;
  visual?: AuthVisualConfig | undefined;
  header?: ReactNode | undefined;
  footer?: ReactNode | undefined;
  overlay?: ReactNode | undefined;
  children: ReactNode;
  ariaLabel?: string | undefined;
}

export interface AuthLoginLayoutProps {
  title?: string;
  children: ReactNode;
}

export interface AuthFlowFormProps {
  /** div3 信息输入区: tabs + fields + options. */
  input: ReactNode;
  /** div4 登录验证区: turnstile + submit button. */
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
  trailingAction?: ReactNode | undefined;
  value: string;
  error?: string | undefined;
  hint?: string | undefined;
  autoComplete?: string | undefined;
  autoFocus?: boolean | undefined;
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

export interface AuthTurnstileProps {
  siteKey?: string | undefined;
  action?: string | undefined;
  cData?: string | undefined;
  appearance?: "always" | "execute" | "interaction-only" | undefined;
  size?: "normal" | "flexible" | "compact" | undefined;
  theme?: "auto" | "light" | "dark" | undefined;
  language?: string | undefined;
  resetSignal?: number | undefined;
  className?: string | undefined;
  onToken: (token: string) => void;
  onExpire?: (() => void) | undefined;
  onError?: ((errorCode?: string) => void) | undefined;
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
  useLoginLayout?: boolean;
  children: ReactNode;
}

export interface AuthLoginOptionOverrides extends Pick<
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
> {}

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
  turnstile?: ReactNode;
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
  turnstile?: ReactNode;
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

const DEFAULT_AUTH_BRAND_LOGO = "/brand/vxture-logo-white.png";
// 中性占位。真实品牌名由调用方传入——真名不入仓。
const DEFAULT_AUTH_BRAND_LABEL = "Brand";

const DEFAULT_AUTH_VISUAL: Required<
  Omit<AuthVisualConfig, "leftBackgroundImage" | "pageBackgroundImage">
> = {
  title: "Build intelligence into everything.",
  description:
    "Orchestrate models, manage pipelines, and deploy AI workflows at scale from a single workspace.",
  statusText: "All systems operational",
  stats: [
    { value: "40ms", label: "avg latency" },
    { value: "99.97%", label: "uptime SLA" },
    { value: "12B+", label: "tokens/day" },
  ],
};

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
  pageBackgroundImage,
  visual,
  header,
  footer,
  overlay,
  children,
  ariaLabel = "authentication",
}: Readonly<UnifiedAuthPageProps>) {
  // 背景图 URL 是运行时值（L5），经 inline style 落地，不属于设计值硬编码。
  const style: CSSProperties = {};
  if (pageBackgroundImage) {
    style.backgroundImage = `url(${pageBackgroundImage})`;
  }

  return (
    <section
      className={cn(
        "relative flex min-h-screen flex-col bg-background bg-cover bg-center",
        className,
      )}
      style={style}
    >
      {overlay}
      {header}
      <main className="flex flex-1 items-center justify-center px-md py-xl">
        {/* 登录卡：veil 叠层（strong 档）+ 发丝线，无阴影（02-visual-spec.md §3）。 */}
        <Card
          surface="strong"
          aria-label={ariaLabel}
          className="w-full max-w-page-lg flex-row overflow-hidden"
        >
          <AuthVisualPanel visual={visual} />
          <Separator
            orientation="vertical"
            className="hidden h-auto self-stretch bg-primary/10 lg:block dark:bg-primary/20"
          />
          <div className="flex min-w-0 flex-1 flex-col justify-center gap-lg p-xl">
            {children}
          </div>
        </Card>
      </main>
      {footer}
    </section>
  );
}

export function AuthLoginLayout({
  title = "欢迎回来",
  children,
}: Readonly<AuthLoginLayoutProps>) {
  return (
    <div className="flex flex-col gap-lg">
      <section aria-label="登录标题">
        <div className="flex flex-col gap-2xs">
          <h1 className="text-heading-3 text-foreground">{title}</h1>
        </div>
      </section>
      {children}
    </div>
  );
}

export function AuthLoginTemplate({
  title = "欢迎回来",
  useLoginLayout = true,
  children,
  ...pageProps
}: Readonly<AuthLoginTemplateProps>) {
  return (
    <UnifiedAuthPage {...pageProps}>
      {useLoginLayout ? (
        <AuthLoginLayout title={title}>{children}</AuthLoginLayout>
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
 *     <section 登录验证区>  turnstile + submit button
 *     <section 三方登录区>  divider + provider cards
 *   </form>
 *   <section 注册链接区>                 ← register link, outside the form
 */
export function AuthFlowForm({
  input,
  primary,
  social,
  footer,
  inputAriaLabel = "登录输入",
  primaryAriaLabel = "登录验证",
  socialAriaLabel = "三方登录",
  footerAriaLabel = "注册引导",
  autoComplete = "on",
  onSubmit,
}: Readonly<AuthFlowFormProps>) {
  return (
    <>
      <form
        className="flex flex-col gap-lg"
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
  passwordLabel = "密码登录",
  phoneLabel = "验证码登录",
  order = ["login", "phone"],
}: Readonly<AuthTabsProps>) {
  const labels: Record<AuthLoginTab, string> = {
    login: passwordLabel,
    phone: phoneLabel,
  };
  return (
    <Tabs
      value={active}
      onValueChange={(value) => onChange(value as AuthLoginTab)}
    >
      <TabsList className="w-full">
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
  brandHref = "/",
  brandLogoSrc = DEFAULT_AUTH_BRAND_LOGO,
  brandLogoAlt = "",
  brandLabel = DEFAULT_AUTH_BRAND_LABEL,
  currentLocale = DEFAULT_LOCALE,
  localeOptions,
  localeButtonLabel = "选择语言",
  localePanelLabel = "语言选择",
  currentTheme = "light",
  themeButtonLabel,
  lightThemeLabel = "浅色模式",
  darkThemeLabel = "深色模式",
  onLocaleChange,
  onThemeChange,
}: Readonly<AuthChromeHeaderProps>) {
  return (
    <header className="w-full px-lg py-md">
      <div className="mx-auto flex w-full max-w-page-xl items-center justify-between gap-md">
        <ShellBrand
          href={brandHref}
          logoSrc={brandLogoSrc}
          logoAlt={brandLogoAlt}
          label={brandLabel}
        />

        <div className="flex items-center gap-xs">
          {onLocaleChange ? (
            <ShellLocaleSwitcher
              currentLocale={currentLocale}
              options={localeOptions}
              buttonLabel={localeButtonLabel}
              panelLabel={localePanelLabel}
              onLocaleChange={onLocaleChange}
            />
          ) : null}

          {onThemeChange ? (
            <ShellThemeToggle
              currentTheme={currentTheme}
              buttonLabel={themeButtonLabel}
              lightLabel={lightThemeLabel}
              darkLabel={darkThemeLabel}
              onThemeChange={onThemeChange}
            />
          ) : null}
        </div>
      </div>
    </header>
  );
}

export function AuthChromeFooter({
  copyright = "© 2026 Brand. All rights reserved.",
  links = [
    { href: "/legal/terms", label: "服务条款" },
    { href: "/legal/privacy", label: "隐私政策" },
    { href: "/legal/cookies", label: "Cookie 使用政策" },
  ],
  legalLabel = "Legal links",
}: Readonly<AuthChromeFooterProps>) {
  return (
    <ShellLegalFooter
      copyright={copyright}
      links={links}
      legalLabel={legalLabel}
    />
  );
}

export function AuthTurnstile({
  siteKey,
  action,
  cData,
  appearance = "always",
  size = "flexible",
  theme = "auto",
  language = "auto",
  resetSignal = 0,
  className = "",
  onToken,
  onExpire,
  onError,
}: Readonly<AuthTurnstileProps>) {
  const widgetRef = useRef<TurnstileInstance | undefined>(undefined);
  const handlersRef = useRef({ onToken, onExpire, onError });
  const lastResetSignalRef = useRef(resetSignal);

  useEffect(() => {
    handlersRef.current = { onToken, onExpire, onError };
  }, [onError, onExpire, onToken]);

  useEffect(() => {
    if (!siteKey) {
      return undefined;
    }

    return () => {
      widgetRef.current?.remove();
    };
  }, [siteKey]);

  useEffect(() => {
    if (lastResetSignalRef.current === resetSignal) {
      return;
    }
    lastResetSignalRef.current = resetSignal;

    if (widgetRef.current) {
      handlersRef.current.onExpire?.();
      widgetRef.current.reset();
    }
  }, [resetSignal]);

  if (!siteKey) {
    return null;
  }

  return (
    <div className={cn("flex w-full justify-center", className)}>
      <Turnstile
        ref={widgetRef}
        siteKey={siteKey}
        options={{
          action,
          cData,
          appearance,
          size,
          theme,
          language,
        }}
        scriptOptions={{
          id: "vx-turnstile-script",
          onError: () => handlersRef.current.onError?.("script-load-failed"),
        }}
        onSuccess={(token) => handlersRef.current.onToken(token)}
        onExpire={() => handlersRef.current.onExpire?.()}
        onTimeout={() => handlersRef.current.onExpire?.()}
        onError={(errorCode) => handlersRef.current.onError?.(errorCode)}
        onUnsupported={() => handlersRef.current.onError?.("unsupported")}
      />
    </div>
  );
}

export function AuthField({
  label,
  name,
  type,
  placeholder,
  icon,
  trailingAction,
  value,
  error,
  hint,
  autoComplete,
  autoFocus,
  disabled,
  onChange,
}: Readonly<AuthFieldProps>) {
  const inputId = `vx-auth-${name}`;
  return (
    <div className="flex flex-col gap-2xs">
      <Label htmlFor={inputId}>{label}</Label>
      <div className="relative flex items-center">
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
        <Input
          className={cn(icon && "pl-xl", trailingAction && "pr-3xl")}
          id={inputId}
          name={name}
          type={type}
          value={value}
          placeholder={placeholder}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={Boolean(error)}
        />
        {trailingAction ? (
          <span className="absolute right-2xs flex items-center">
            {trailingAction}
          </span>
        ) : null}
      </div>
      {error ? (
        <p className="text-body-sm text-destructive-text">{error}</p>
      ) : null}
      {hint && !error ? (
        <p className="text-body-sm text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

function isAuthFieldIcon(icon: AuthFieldProps["icon"]): icon is AuthFieldIcon {
  return (
    typeof icon === "string" && AUTH_FIELD_ICONS.has(icon as AuthFieldIcon)
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
    <Button type="submit" size="xl" className="w-full" disabled={blocked}>
      {buttonContent}
    </Button>
  );
}

export function AuthSocialButtons({
  providers,
  separatorLabel = "其他方式登录",
}: Readonly<AuthSocialButtonsProps>) {
  if (providers.length === 0) {
    return null;
  }

  return (
    <>
      <div className="flex items-center gap-md">
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
      <div className="flex flex-col gap-sm sm:flex-row">
        {providers.map((provider) => (
          <Button
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
  return (
    <AuthSocialButtons
      separatorLabel={separatorLabel}
      providers={[
        {
          provider: "feishu",
          label: "飞书",
          iconSrc: AUTH_TENANT_SOCIAL_ICON_SRC.feishu,
          onClick: onFeishu,
        },
        {
          provider: "dingtalk",
          label: "钉钉",
          iconSrc: AUTH_TENANT_SOCIAL_ICON_SRC.dingtalk,
          onClick: onDingTalk,
        },
        {
          provider: "wechat",
          label: "微信",
          iconSrc: AUTH_TENANT_SOCIAL_ICON_SRC.wechat,
          disabled: true,
        },
      ]}
    />
  );
}

export function AuthRegisterPrompt({
  onRegister,
  prefix = "还没有账号？",
  label = "注册账号",
}: Readonly<AuthRegisterPromptProps>) {
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
  rememberLabel = "记住登录信息",
  agreementPrefix = "我已阅读并同意",
  agreementJoiner = "和",
  termsLabel = "用户协议",
  privacyLabel = "隐私政策",
  termsHref = "#terms",
  privacyHref = "#privacy",
  forgotLabel = "忘记密码？",
  forgotHref = "#forgot-password",
  forgetMeLabel = "忘记我",
  forgetMeTitle = "清除浏览器保存的账号密码",
  showForgot = true,
  showRemember = true,
  onRememberChange,
  onAgreementChange,
  onForgot,
  onForgetMe,
}: Readonly<AuthLoginOptionsProps>) {
  const linkClass = "text-link hover:text-link-hover hover:underline";
  return (
    <div className="flex flex-col gap-sm">
      <div className="flex items-center justify-between gap-sm">
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
              <Button variant="link" size="xs" onClick={onForgot}>
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
          <a href={termsHref} className={linkClass}>
            {termsLabel}
          </a>
          {agreementJoiner}
          <a href={privacyHref} className={linkClass}>
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
  turnstile,
  social,
  footer,
  primaryDisabled = false,
  primaryDisabledLabel,
  submitLabel = "登录",
  submitLoadingLabel = "登录中...",
  identifierLabel = "邮箱",
  identifierName = "username",
  identifierPlaceholder = "email / username / phone",
  identifierAutoComplete = "username",
  passwordLabel = "密码",
  passwordName = "password",
  passwordPlaceholder = "请输入密码",
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
  const [passwordVisible, setPasswordVisible] = useState(false);
  const passwordVisibilityLabel = passwordVisible ? "隐藏密码" : "显示密码";

  return (
    <AuthFlowForm
      onSubmit={onSubmit}
      input={
        <>
          {tabs}
          <div className="flex flex-col gap-md">
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
              type={passwordVisible ? "text" : "password"}
              placeholder={passwordPlaceholder}
              icon="lock"
              trailingAction={
                <Button
                  variant="ghost"
                  size="icon-md"
                  className="text-muted-foreground hover:text-foreground"
                  aria-label={passwordVisibilityLabel}
                  title={passwordVisibilityLabel}
                  disabled={loading}
                  onClick={() => setPasswordVisible((visible) => !visible)}
                >
                  <Icon
                    name={passwordVisible ? "eye" : "eye-slash"}
                    size="sm"
                  />
                </Button>
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
        <>
          <div className="flex flex-col gap-sm empty:hidden">
            {turnstile}
            {errors?.form ? (
              <p className="text-center text-body-sm text-destructive-text">
                {errors.form}
              </p>
            ) : null}
          </div>
          <AuthPrimaryButton
            loading={loading}
            disabled={primaryDisabled}
            label={submitLabel}
            loadingLabel={submitLoadingLabel}
            disabledLabel={primaryDisabledLabel}
          />
        </>
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
  turnstile,
  social,
  footer,
  primaryDisabled = false,
  primaryDisabledLabel,
  submitLabel = "登录",
  submitLoadingLabel = "登录中...",
  phoneLabel = "手机号",
  phoneName = "phone",
  phonePlaceholder = "请输入手机号",
  phoneInputType = "tel",
  phoneIcon = "phone",
  phoneAutoComplete = "tel",
  codeLabel = "验证码",
  codeName = "code",
  codePlaceholder = "请输入 6 位验证码",
  sendCodeLabel = "获取验证码",
  sendingCodeLabel = "发送中...",
  verificationPendingLabel = "验证中...",
  retryCodeLabel = (seconds) => `${seconds}s 后重试`,
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
  let resolvedSendCodeLabel = sendCodeLabel;
  if (sendCodeDisabled) {
    resolvedSendCodeLabel = verificationPendingLabel;
  }
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
          <div className="flex flex-col gap-md">
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
              disabled={loading}
              onChange={onChangePhone}
            />

            <div className="flex items-start gap-sm">
              <div className="min-w-0 flex-1">
                <AuthField
                  label={codeLabel}
                  name={codeName}
                  type="text"
                  placeholder={codePlaceholder}
                  icon="shield"
                  value={code}
                  error={errors?.code}
                  autoComplete="one-time-code"
                  disabled={loading}
                  onChange={onChangeCode}
                />
              </div>
              {/* mt 对齐输入行：跳过 Label（label-md 行高）+ gap-2xs。 */}
              <Button
                type="button"
                variant="outline"
                className="mt-lg shrink-0"
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
            </div>

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
        <>
          <div className="flex flex-col gap-sm empty:hidden">
            {turnstile}
            {errors?.form ? (
              <p className="text-center text-body-sm text-destructive-text">
                {errors.form}
              </p>
            ) : null}
          </div>
          <AuthPrimaryButton
            loading={loading}
            disabled={primaryDisabled}
            label={submitLabel}
            loadingLabel={submitLoadingLabel}
            disabledLabel={primaryDisabledLabel}
          />
        </>
      }
      social={social}
      footer={footer}
    />
  );
}

export function AuthForgotPasswordPanel({
  email,
  error,
  loading,
  resetSent = false,
  backLabel = "返回登录",
  title = "重置密码",
  description = "输入注册邮箱，获取重置链接",
  sentTitle = "重置邮件已发送",
  sentDescription,
  sentHint = "未收到邮件？请检查垃圾邮件文件夹。",
  sentEmailFallback = "您的邮箱",
  sentActionLabel = "返回登录",
  emailLabel = "邮箱",
  emailName = "email",
  emailPlaceholder = "you@company.com",
  submitLabel = "获取重置链接",
  submitLoadingLabel = "生成中...",
  onBack,
  onChangeEmail,
  onSubmit,
}: Readonly<AuthForgotPasswordPanelProps>) {
  if (resetSent) {
    return (
      <>
        <AuthBackButton onClick={onBack}>{backLabel}</AuthBackButton>
        <div className="flex flex-col items-center gap-md text-center">
          <span
            className="flex size-media-md items-center justify-center rounded-full bg-success-muted text-success-text"
            aria-hidden="true"
          >
            <Icon name="check" size="lg" />
          </span>
          <h1 className="text-title-lg text-foreground">{sentTitle}</h1>
          <p className="text-body-md text-muted-foreground">
            {sentDescription ?? (
              <>
                重置链接已发送至{" "}
                <strong className="text-foreground">
                  {email || sentEmailFallback}
                </strong>
                {"，请在 15 分钟内查收并完成重置。"}
              </>
            )}
          </p>
          {sentHint ? (
            <p className="text-body-sm text-muted-foreground">{sentHint}</p>
          ) : null}
          <Button className="w-full" onClick={onBack}>
            {sentActionLabel}
          </Button>
        </div>
      </>
    );
  }

  return (
    <>
      <AuthBackButton onClick={onBack}>{backLabel}</AuthBackButton>
      <div className="flex flex-col gap-2xs">
        <h1 className="text-heading-3 text-foreground">{title}</h1>
        {description ? (
          <p className="text-body-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>

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
  return (
    <Button
      variant="ghost"
      size="md"
      className="self-start gap-xs px-xs text-muted-foreground hover:text-foreground"
      onClick={onClick}
    >
      <Icon name="arrow-left" size="sm" />
      {children}
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

function AuthVisualPanel({
  visual,
}: Readonly<{
  visual?: AuthVisualConfig | undefined;
}>) {
  const title = visual?.title ?? DEFAULT_AUTH_VISUAL.title;
  const description = visual?.description ?? DEFAULT_AUTH_VISUAL.description;
  const statusText = visual?.statusText ?? DEFAULT_AUTH_VISUAL.statusText;
  const stats = visual?.stats ?? DEFAULT_AUTH_VISUAL.stats ?? [];

  // 背景图 URL 是运行时值（L5），经 inline style 落地。
  const style: CSSProperties = {};
  if (visual?.leftBackgroundImage) {
    style.backgroundImage = `url(${visual.leftBackgroundImage})`;
  }

  return (
    <aside
      className={cn(
        "relative hidden flex-1 flex-col justify-between gap-xl overflow-hidden",
        "bg-gradient-to-br from-primary to-primary-active bg-cover bg-center",
        "p-2xl text-primary-foreground lg:flex",
      )}
      style={style}
    >
      <NodeGraph />

      {statusText ? (
        <div className="relative flex items-center gap-xs text-label-sm text-primary-foreground/80">
          <span
            className="size-2xs rounded-full bg-success"
            aria-hidden="true"
          />
          <span>{statusText}</span>
        </div>
      ) : null}

      <div className="relative flex flex-col gap-md">
        <h2 className="text-heading-3">{title}</h2>
        {description ? (
          <p className="text-body-md text-primary-foreground/80">
            {description}
          </p>
        ) : null}
        {stats.length > 0 ? (
          <div className="flex flex-wrap gap-xl pt-md">
            {stats.map((stat) => (
              <div
                key={`${stat.value}-${stat.label}`}
                className="flex flex-col gap-2xs"
              >
                <strong className="text-title-lg">{stat.value}</strong>
                <span className="text-label-sm text-primary-foreground/70">
                  {stat.label}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </aside>
  );
}

// 仅用于登录页背景动效，避免把视觉随机误判为安全随机。
function createVisualSequence(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

interface AuthGraphNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  phase: number;
}

interface AuthGraphPoint {
  x: number;
  y: number;
}

function moveVisualNode(
  node: AuthGraphNode,
  width: number,
  height: number,
  mouse: AuthGraphPoint,
) {
  node.phase += 0.014;
  node.x += node.vx;
  node.y += node.vy;

  if (node.x < 0 || node.x > width) node.vx *= -1;
  if (node.y < 0 || node.y > height) node.vy *= -1;

  const dx = node.x - mouse.x;
  const dy = node.y - mouse.y;
  const distance = Math.hypot(dx, dy);
  if (distance > 0 && distance < 100) {
    node.x += (dx / distance) * 0.5;
    node.y += (dy / distance) * 0.5;
  }
}

function drawVisualLinks(
  context: CanvasRenderingContext2D,
  nodes: AuthGraphNode[],
  color: string,
) {
  context.strokeStyle = color;
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const first = nodes[i];
      const second = nodes[j];
      if (!first || !second) continue;
      const distance = Math.hypot(first.x - second.x, first.y - second.y);
      if (distance < 140) {
        context.globalAlpha = (1 - distance / 140) * 0.35;
        context.lineWidth = 0.6;
        context.beginPath();
        context.moveTo(first.x, first.y);
        context.lineTo(second.x, second.y);
        context.stroke();
      }
    }
  }
  context.globalAlpha = 1;
}

function drawVisualNodes(
  context: CanvasRenderingContext2D,
  nodes: AuthGraphNode[],
  color: string,
) {
  context.fillStyle = color;
  for (const node of nodes) {
    const pulse = (Math.sin(node.phase) + 1) / 2;
    context.globalAlpha = 0.45 + pulse * 0.4;
    context.beginPath();
    context.arc(
      node.x,
      node.y,
      node.radius * (1 + pulse * 0.35),
      0,
      Math.PI * 2,
    );
    context.fill();
  }
  context.globalAlpha = 1;
}

function NodeGraph() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mouseRef = useRef({ x: -999, y: -999 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return undefined;
    }

    const context = canvas.getContext("2d");
    if (!context) {
      return undefined;
    }

    // 画布颜色取自身的 computed color（类名给的 text-primary-foreground），
    // 不再依赖已退役的 auth 专属 token。透明度经 globalAlpha 施加。
    const graphColor = getComputedStyle(canvas).color;
    let frame = 0;
    let width = 0;
    let height = 0;
    let nodes: AuthGraphNode[] = [];

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = globalThis.devicePixelRatio || 1;
      width = rect.width;
      height = rect.height;
      canvas.width = Math.max(1, Math.floor(width * ratio));
      canvas.height = Math.max(1, Math.floor(height * ratio));
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      const count = Math.max(22, Math.floor((width * height) / 9000));
      const nextVisualValue = createVisualSequence(
        Math.floor(width * 31 + height * 17 + count),
      );
      nodes = Array.from({ length: count }, () => ({
        x: nextVisualValue() * width,
        y: nextVisualValue() * height,
        vx: (nextVisualValue() - 0.5) * 0.35,
        vy: (nextVisualValue() - 0.5) * 0.35,
        radius: nextVisualValue() * 1.8 + 0.6,
        phase: nextVisualValue() * Math.PI * 2,
      }));
    };

    const draw = () => {
      context.clearRect(0, 0, width, height);
      const mouse = mouseRef.current;

      for (const node of nodes) {
        moveVisualNode(node, width, height, mouse);
      }
      drawVisualLinks(context, nodes, graphColor);
      drawVisualNodes(context, nodes, graphColor);

      frame = globalThis.requestAnimationFrame(draw);
    };

    const handleMouseMove = (event: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouseRef.current = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
    };

    const handleMouseLeave = () => {
      mouseRef.current = { x: -999, y: -999 };
    };

    resize();
    draw();
    globalThis.addEventListener("resize", resize);
    canvas.addEventListener("mousemove", handleMouseMove);
    canvas.addEventListener("mouseleave", handleMouseLeave);

    return () => {
      globalThis.cancelAnimationFrame(frame);
      globalThis.removeEventListener("resize", resize);
      canvas.removeEventListener("mousemove", handleMouseMove);
      canvas.removeEventListener("mouseleave", handleMouseLeave);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 size-full text-primary-foreground"
      aria-hidden="true"
    />
  );
}
