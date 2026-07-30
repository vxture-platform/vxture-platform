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
import { Button } from "../ui/Button";

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
const DEFAULT_AUTH_BRAND_LABEL = "vxture.ai";

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

export function UnifiedAuthPage({
  className = "",
  pageBackgroundImage,
  visual,
  header,
  footer,
  overlay,
  children,
  ariaLabel = "vxture authentication",
}: Readonly<UnifiedAuthPageProps>) {
  const style: CSSProperties &
    Partial<Record<"--vx-auth-bg" | "--vx-auth-visual-bg", string>> = {};
  if (pageBackgroundImage) {
    style["--vx-auth-bg"] = `url(${pageBackgroundImage})`;
  }
  if (visual?.leftBackgroundImage) {
    style["--vx-auth-visual-bg"] =
      `var(--vx-color-auth-visual-bg), url(${visual.leftBackgroundImage}) center / cover no-repeat`;
  }

  return (
    <section className={`vx-auth-page ${className}`.trim()} style={style}>
      {overlay}
      {header}
      <main className="vx-auth-main">
        <div className="vx-auth-card" aria-label={ariaLabel}>
          <AuthVisualPanel visual={visual} />
          <div className="vx-auth-divider" />
          <div className="vx-auth-form-panel">{children}</div>
        </div>
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
    <div className="vx-auth-login-layout">
      <section
        className="vx-auth-section vx-auth-section-title"
        aria-label="登录标题"
      >
        <div className="vx-auth-panel-heading">
          <h1>{title}</h1>
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
 *   <div bottom 留白>                    ← bottom spacer
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
        className="vx-auth-flow-form"
        onSubmit={onSubmit}
        autoComplete={autoComplete}
      >
        <section
          className="vx-auth-section vx-auth-section-inputs"
          aria-label={inputAriaLabel}
        >
          {input}
        </section>

        <section
          className="vx-auth-section vx-auth-section-verify"
          aria-label={primaryAriaLabel}
        >
          {primary}
        </section>

        {social ? (
          <section
            className="vx-auth-section vx-auth-section-social"
            aria-label={socialAriaLabel}
          >
            {social}
          </section>
        ) : null}
      </form>

      {footer ? (
        <section
          className="vx-auth-section vx-auth-section-footer"
          aria-label={footerAriaLabel}
        >
          {footer}
        </section>
      ) : null}

      <div className="vx-auth-bottom-spacer" aria-hidden="true" />
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
    <div className="vx-auth-tabs">
      {order.map((tab) => (
        <button
          key={tab}
          type="button"
          className={`vx-auth-tab${active === tab ? " vx-auth-tab--active" : ""}`}
          onClick={() => onChange(tab)}
        >
          {labels[tab]}
        </button>
      ))}
    </div>
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
    <header className="vx-auth-header">
      <div className="vx-auth-header-inner">
        <ShellBrand
          href={brandHref}
          logoSrc={brandLogoSrc}
          logoAlt={brandLogoAlt}
          label={brandLabel}
          className="vx-auth-brand"
          logoClassName="vx-auth-brand-logo"
          labelClassName="vx-auth-brand-title"
        />

        <div className="vx-auth-header-actions">
          {onLocaleChange ? (
            <ShellLocaleSwitcher
              currentLocale={currentLocale}
              options={localeOptions}
              buttonLabel={localeButtonLabel}
              panelLabel={localePanelLabel}
              className="vx-auth-locale-control"
              buttonClassName="vx-auth-icon-button"
              activeButtonClassName="vx-auth-icon-button--active"
              popoverClassName="vx-auth-locale-popover"
              onLocaleChange={onLocaleChange}
            />
          ) : null}

          {onThemeChange ? (
            <ShellThemeToggle
              currentTheme={currentTheme}
              buttonLabel={themeButtonLabel}
              lightLabel={lightThemeLabel}
              darkLabel={darkThemeLabel}
              className="vx-auth-icon-button"
              activeClassName="vx-auth-icon-button--active"
              onThemeChange={onThemeChange}
            />
          ) : null}
        </div>
      </div>
    </header>
  );
}

export function AuthChromeFooter({
  copyright = "© 2026 vxture.ai. All rights reserved.",
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
      className="vx-auth-footer"
      innerClassName="vx-auth-footer-inner"
      linksClassName="vx-auth-footer-links"
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
    <div className={`vx-auth-turnstile ${className}`.trim()}>
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
  return (
    <div className="vx-auth-field">
      <label htmlFor={`vx-auth-${name}`}>{label}</label>
      <div className="vx-auth-input-wrap">
        {icon ? (
          <span className="vx-auth-field-icon" aria-hidden="true">
            {isAuthFieldIcon(icon) ? <AuthFieldIconGlyph icon={icon} /> : icon}
          </span>
        ) : null}
        <input
          className={
            trailingAction ? "vx-auth-input--with-trailing" : undefined
          }
          id={`vx-auth-${name}`}
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
        {trailingAction}
      </div>
      {error ? <p className="vx-auth-error">{error}</p> : null}
      {hint && !error ? <p className="vx-auth-hint">{hint}</p> : null}
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
        <span className="vx-auth-spinner" />
        {loadingLabel}
      </>
    );
  }

  return (
    <button type="submit" className="vx-auth-primary" disabled={blocked}>
      {buttonContent}
    </button>
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
      <div className="vx-auth-or">
        <span />
        <em>{separatorLabel}</em>
        <span />
      </div>
      <div className="vx-auth-socials">
        {providers.map((provider) => (
          <button
            key={provider.provider}
            type="button"
            className={`vx-auth-social ${provider.provider}`}
            onClick={provider.onClick}
            disabled={provider.disabled}
          >
            <BrandProviderIcon
              provider={provider.provider}
              src={provider.iconSrc}
            />
            {provider.label}
          </button>
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
    <p className="vx-auth-switch">
      {prefix}
      <Button variant="link" onClick={onRegister}>
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
  return (
    <div className="vx-auth-control-set">
      <div className="vx-auth-control-row vx-auth-control-row--utility">
        {showRemember ? (
          <label className="vx-auth-checkbox">
            <input
              type="checkbox"
              checked={rememberChecked}
              disabled={disabled}
              onChange={(event) => onRememberChange?.(event.target.checked)}
            />
            <span>{rememberLabel}</span>
          </label>
        ) : (
          <span />
        )}
        <div className="vx-auth-control-links">
          {showForgot ? (
            onForgot ? (
              <button
                type="button"
                className="vx-auth-control-link"
                onClick={onForgot}
              >
                {forgotLabel}
              </button>
            ) : (
              <a className="vx-auth-control-link" href={forgotHref}>
                {forgotLabel}
              </a>
            )
          ) : null}
          {onForgetMe ? (
            <button
              type="button"
              className="vx-auth-control-link vx-auth-control-link--quiet"
              onClick={onForgetMe}
              disabled={disabled}
              title={forgetMeTitle}
            >
              {forgetMeLabel}
            </button>
          ) : null}
        </div>
      </div>

      <label className="vx-auth-control-row vx-auth-checkbox vx-auth-checkbox--agreement">
        <input
          type="checkbox"
          checked={agreementChecked}
          disabled={disabled}
          onChange={(event) => onAgreementChange(event.target.checked)}
        />
        <span>
          {agreementPrefix}
          <a href={termsHref}>{termsLabel}</a>
          {agreementJoiner}
          <a href={privacyHref}>{privacyLabel}</a>
        </span>
      </label>
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
          <div className="vx-auth-field-stack">
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
                <button
                  type="button"
                  className="vx-auth-password-toggle"
                  aria-label={passwordVisibilityLabel}
                  title={passwordVisibilityLabel}
                  disabled={loading}
                  onClick={() => setPasswordVisible((visible) => !visible)}
                >
                  <AuthPasswordVisibilityIcon visible={passwordVisible} />
                </button>
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
          <div className="vx-auth-verify-turnstile">
            {turnstile}
            {errors?.form ? (
              <p className="vx-auth-error vx-auth-form-error">{errors.form}</p>
            ) : null}
          </div>
          <div className="vx-auth-verify-submit">
            <AuthPrimaryButton
              loading={loading}
              disabled={primaryDisabled}
              label={submitLabel}
              loadingLabel={submitLoadingLabel}
              disabledLabel={primaryDisabledLabel}
            />
          </div>
        </>
      }
      social={social}
      footer={footer}
    />
  );
}

function AuthPasswordVisibilityIcon({
  visible,
}: Readonly<{ visible: boolean }>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M3.8 12s2.8-5 8.2-5 8.2 5 8.2 5-2.8 5-8.2 5-8.2-5-8.2-5Z"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
      <path
        d="M12 9.6a2.4 2.4 0 1 1 0 4.8 2.4 2.4 0 0 1 0-4.8Z"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
      {!visible ? (
        <path
          d="m5 19 14-14"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.8"
        />
      ) : null}
    </svg>
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
          <div className="vx-auth-field-stack">
            <div className="vx-auth-phone-row">
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
            </div>

            <div className="vx-auth-code-field-wrap">
              <div className="vx-auth-code-row">
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
                <button
                  type="button"
                  className="vx-auth-send-code"
                  onClick={onSendCode}
                  disabled={
                    loading ||
                    codeSending ||
                    codeCountdown > 0 ||
                    sendCodeDisabled
                  }
                >
                  {resolvedSendCodeLabel}
                </button>
              </div>
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
          <div className="vx-auth-verify-turnstile">
            {turnstile}
            {errors?.form ? (
              <p className="vx-auth-error vx-auth-form-error">{errors.form}</p>
            ) : null}
          </div>
          <div className="vx-auth-verify-submit">
            <AuthPrimaryButton
              loading={loading}
              disabled={primaryDisabled}
              label={submitLabel}
              loadingLabel={submitLoadingLabel}
              disabledLabel={primaryDisabledLabel}
            />
          </div>
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
        <div className="vx-auth-reset-done">
          <div className="vx-auth-check">✓</div>
          <h1>{sentTitle}</h1>
          <p>
            {sentDescription ?? (
              <>
                重置链接已发送至 <strong>{email || sentEmailFallback}</strong>
                {"，请在 15 分钟内查收并完成重置。"}
              </>
            )}
          </p>
          {sentHint ? <p className="vx-auth-reset-hint">{sentHint}</p> : null}
          <button type="button" onClick={onBack}>
            {sentActionLabel}
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <AuthBackButton onClick={onBack}>{backLabel}</AuthBackButton>
      <div className="vx-auth-panel-heading">
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>

      <form onSubmit={onSubmit} autoComplete="on">
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
    <button type="button" className="vx-auth-back" onClick={onClick}>
      <span>←</span>
      {children}
    </button>
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
      className="vx-auth-social-icon"
      src={src ?? DEFAULT_SOCIAL_ICON_SRC[provider]}
      alt=""
      aria-hidden="true"
      width={22}
      height={22}
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

  return (
    <aside className="vx-auth-visual">
      <NodeGraph />
      <div className="vx-auth-grid" />
      <div className="vx-auth-scan" />
      <div className="vx-auth-fade" />

      {statusText ? (
        <div className="vx-auth-status">
          <span className="vx-auth-status-dot" />
          <span>{statusText}</span>
        </div>
      ) : null}

      <div className="vx-auth-copy">
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
        {stats.length > 0 ? (
          <div className="vx-auth-stats">
            {stats.map((stat) => (
              <div key={`${stat.value}-${stat.label}`}>
                <strong>{stat.value}</strong>
                <span>{stat.label}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </aside>
  );
}

function AuthFieldIconGlyph({ icon }: Readonly<{ icon: AuthFieldIcon }>) {
  if (icon === "lock") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect
          x="5"
          y="10"
          width="14"
          height="10"
          rx="2.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        />
        <path
          d="M8 10V8a4 4 0 0 1 8 0v2"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="1.8"
        />
        <path
          d="M12 14v2"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="1.8"
        />
      </svg>
    );
  }

  if (icon === "phone") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M8 3h8a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        />
        <path
          d="M10 6h4M11 18h2"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="1.8"
        />
      </svg>
    );
  }

  if (icon === "shield") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M12 3 19 6v5c0 4.5-2.8 8.2-7 10-4.2-1.8-7-5.5-7-10V6l7-3Z"
          fill="none"
          stroke="currentColor"
          strokeLinejoin="round"
          strokeWidth="1.8"
        />
        <path
          d="m9.5 12 1.7 1.7 3.5-4"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.8"
        />
      </svg>
    );
  }

  if (icon === "mail") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect
          x="4"
          y="6"
          width="16"
          height="12"
          rx="2.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        />
        <path
          d="m6.5 8.5 5.5 4 5.5-4"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.8"
        />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M4.8 20a7.2 7.2 0 0 1 14.4 0"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.8"
      />
    </svg>
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

type AuthGraphColor = (alpha: number) => string;

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
  graphColor: AuthGraphColor,
) {
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const first = nodes[i];
      const second = nodes[j];
      if (!first || !second) continue;
      const distance = Math.hypot(first.x - second.x, first.y - second.y);
      if (distance < 140) {
        context.strokeStyle = graphColor((1 - distance / 140) * 0.35);
        context.lineWidth = 0.6;
        context.beginPath();
        context.moveTo(first.x, first.y);
        context.lineTo(second.x, second.y);
        context.stroke();
      }
    }
  }
}

function drawVisualNodes(
  context: CanvasRenderingContext2D,
  nodes: AuthGraphNode[],
  graphColor: AuthGraphColor,
) {
  for (const node of nodes) {
    const pulse = (Math.sin(node.phase) + 1) / 2;
    context.fillStyle = graphColor(0.45 + pulse * 0.4);
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

    const styles = getComputedStyle(document.documentElement);
    const nodeRgb = styles.getPropertyValue("--vx-color-auth-node-rgb").trim();
    const graphColor = (alpha: number) => `rgb(${nodeRgb} / ${alpha})`;
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
    <canvas ref={canvasRef} className="vx-auth-nodegraph" aria-hidden="true" />
  );
}
