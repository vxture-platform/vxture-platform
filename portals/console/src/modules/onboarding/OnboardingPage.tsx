"use client";

import { useState, type FormEvent } from "react";
import {
  Banner,
  Button,
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  Icon,
  Input,
} from "@vxture/design-system";
import { OnboardingChrome } from "./OnboardingChrome";
import { useTranslations } from "next-intl";
import {
  ConsoleBffError,
  updateUserProfile,
  updateUsername,
} from "@/api/console-bff";
import { useConsoleSession } from "@/features/session/ConsoleSessionProvider";
import { useRouter } from "@/lib/i18n/navigation";

const ACCOUNT_RE = /^[A-Za-z][A-Za-z0-9_]{2,23}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// 法务页在门户站，console 自己没有 /legal 路由——相对路径在这里全是 404。
const WEBSITE_URL = (process.env.NEXT_PUBLIC_WEBSITE_URL ?? "").replace(
  /\/+$/,
  "",
);
// 标签走 i18n(onboarding.legal.*),这里只定路径与键。
const LEGAL_LINKS = [
  { href: `${WEBSITE_URL}/legal/terms`, key: "terms" },
  { href: `${WEBSITE_URL}/legal/privacy`, key: "privacy" },
  { href: `${WEBSITE_URL}/legal/cookies`, key: "cookies" },
] as const;

function normalizeOptional(value: string) {
  const normalized = value.trim();
  return normalized || null;
}

interface FieldErrors {
  account?: string;
  displayName?: string;
  email?: string;
  form?: string;
}

/**
 * First-time setup, forced once for every new phone/social login before the
 * rest of console is reachable (ConsoleShell redirects here while the
 * username still has the system default `_{user_no}` shape). Collects
 * account + display name (required), confirms the already-verified phone,
 * and offers an optional email (format-checked here, verified later from the
 * profile page — see ProfilePage's contact-verify flow).
 *
 * ── 2026-08-17 版式重做 ──────────────────────────────────────────────────
 * 此前它是 `FormPageTemplate`，即一张普通的控制台表单页，于是拿到了三样不该
 * 有的东西：
 *
 * 1. **整副应用外壳。** 侧栏、导航、租户切换器全在，但 ConsoleShell 的重定向
 *    会把人从任何别的路径弹回来——一排按不动的按钮。外壳已在 ConsoleShell
 *    那侧摘掉。
 * 2. **满宽。** `FormPageTemplate` 于 2026-08-12（58fd96d）撤掉了限宽，那是为
 *    opera 的设置页做的明确取舍（与列表页同宽）。取舍本身不动，但四个字段的
 *    首跑表单不该跟着横跨整个控制台。
 * 3. **和上一屏两套观感。** 它紧接在 accounts 的登录卡之后出现，中间只隔一次
 *    跳转。现在用本地 `OnboardingChrome` 组装同款单栏卡（认证族归 accounts，
 *    门户间禁互引，几十行版式组合就地重复）。
 *
 * 手机号改成**只读事实**而不是 `disabled` 的输入框：那一格没有东西可输入，
 * 它是上一步已经验过的结论。长得像输入框却点不动，只会让人以为坏了。
 */
export function OnboardingPage() {
  const t = useTranslations("onboarding");
  const { session, refreshSession } = useConsoleSession();
  const router = useRouter();

  const [account, setAccount] = useState("");
  const [displayName, setDisplayName] = useState(
    session.user?.displayName ?? session.user?.name ?? "",
  );
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});

  const phone = session.user?.phone ?? "";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedAccount = account.trim();
    const trimmedName = displayName.trim();
    const trimmedEmail = email.trim();

    // 逐字段校验，而不是"遇到第一条就 return"：原先三条规则共用一个 `error`
    // 字符串，改完账号提交、才被告知显示名也有问题——一次只肯说一条。
    const next: FieldErrors = {};
    if (!ACCOUNT_RE.test(trimmedAccount))
      next.account = t("errors.accountFormat");
    if (!trimmedName) next.displayName = t("errors.displayNameRequired");
    if (trimmedEmail && !EMAIL_RE.test(trimmedEmail))
      next.email = t("errors.emailFormat");
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setSubmitting(true);
    try {
      await updateUserProfile({
        displayName: trimmedName,
        email: normalizeOptional(trimmedEmail),
      });
      await updateUsername(trimmedAccount);
      await refreshSession();
      router.replace("/");
    } catch (caught) {
      const status =
        caught instanceof ConsoleBffError ? caught.status : undefined;
      // 409 说的是"这个账号名被占了"，那是**账号那一格**的问题，不是整张表单的。
      setErrors(
        status === 409
          ? { account: t("errors.accountTaken") }
          : { form: t("errors.generic") },
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    // 单栏认证版式由本地 OnboardingChrome 组装（认证族已随 owner 判迁出 DS，
    // 归 accounts；门户间禁互引）。页眉 logo + 名称、页脚署 Vxture Studio +
    // 门户站法务链接，均与 accounts 认证面同规。
    <OnboardingChrome
      brandLogoSrc="/brand/vxture-logo-icon.svg"
      brandLabel={t("brand")}
      copyright={t("copyright", { year: new Date().getFullYear() })}
      legalLinks={LEGAL_LINKS.map((l) => ({
        href: l.href,
        label: t(`legal.${l.key}`),
      }))}
      title={t("title")}
      description={t("description")}
    >
      <form
        className="flex flex-col gap-lg"
        onSubmit={(event) => void handleSubmit(event)}
        noValidate
      >
        {errors.form ? <Banner tone="danger" title={errors.form} /> : null}

        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="onboarding-account">
              {t("fields.account")}
            </FieldLabel>
            <Input
              id="onboarding-account"
              className="h-control-xl"
              value={account}
              onChange={(event) => setAccount(event.target.value)}
              placeholder={t("fields.accountPlaceholder")}
              minLength={3}
              maxLength={24}
              autoComplete="username"
              aria-invalid={Boolean(errors.account)}
              required
              autoFocus
            />
            {errors.account ? <FieldError>{errors.account}</FieldError> : null}
          </Field>

          <Field>
            <FieldLabel htmlFor="onboarding-display-name">
              {t("fields.displayName")}
            </FieldLabel>
            <Input
              id="onboarding-display-name"
              className="h-control-xl"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              autoComplete="nickname"
              aria-invalid={Boolean(errors.displayName)}
              required
            />
            {errors.displayName ? (
              <FieldError>{errors.displayName}</FieldError>
            ) : null}
          </Field>

          {phone ? (
            <Field>
              <FieldLabel>{t("fields.phone")}</FieldLabel>
              {/* 只读事实，不是控件：上一步已经验过了，这里没有东西可输入。
                  原先它是一个 `disabled` 的 <input>——长得像输入框、点不动，
                  第一反应是页面坏了，而不是"这一项已经好了"。 */}
              <p className="flex items-center gap-xs text-body-md text-foreground">
                <span className="tabular-nums">{phone}</span>
                <span className="inline-flex items-center gap-2xs text-label-sm text-success-text">
                  <Icon name="check" size="sm" aria-hidden="true" />
                  {t("fields.phoneVerified")}
                </span>
              </p>
            </Field>
          ) : null}

          <Field>
            <FieldLabel htmlFor="onboarding-email">
              {t("fields.email")}
            </FieldLabel>
            <Input
              id="onboarding-email"
              className="h-control-xl"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder={t("fields.emailPlaceholder")}
              autoComplete="email"
              aria-invalid={Boolean(errors.email)}
            />
            {errors.email ? (
              <FieldError>{errors.email}</FieldError>
            ) : (
              <FieldDescription>{t("fields.emailHint")}</FieldDescription>
            )}
          </Field>
        </FieldGroup>

        <Button
          type="submit"
          size="xl"
          className="w-full"
          disabled={submitting}
        >
          {submitting ? t("actions.submitting") : t("actions.submit")}
        </Button>
      </form>
    </OnboardingChrome>
  );
}
