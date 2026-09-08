/**
 * OnboardingPanel.tsx — 注册补齐（owner 2026-09-08 定档）。
 * @package @vxture/accounts
 *
 * ── 补的是哪个洞 ──
 * 从子域应用发起注册时，手机验证通过就直接回跳应用了：没有补齐资料，也没有任何
 * 「注册成功」的交代；过几天打开 console 才被 console 自己的门拦下来补。根因在
 * auth-bff 的 completeLoginWithPhone —— 它拿到了 `{ user, isNew }` 却只解构 user，
 * 把 isNew 丢掉，新老用户走同一个出口。
 *
 * 更要紧的是**位置错了**：补齐此前只在 console 外壳里实现，于是从 karda 注册的人
 * 可以永远不补齐，显示名一直是 `_10000123`——而发票、通知、邀请都要用它。补齐属于
 * 身份面，不属于某一个消费方应用，所以搬到这里：一处实现，每个信赖方都拿到完整账号。
 *
 * ── 三项必填 ──
 * 账号名 / 显示名 / 邮箱。邮箱必填是 owner 的裁定：账单、到期提醒、退款进度默认都走
 * 邮件，没有邮箱等于这些通知全发不出去。手机号是验证过的锚点，只读展示。
 *
 * ── 为什么成功态原地切换、不另开一个路由 ──
 * 授权码是在**提交成功那一刻**才发的（TTL 300 秒），带着它跨路由传递要么塞进
 * URL（进浏览器历史）要么存 sessionStorage。原地切换省掉这一整类问题：拿到
 * redirectTo 就先画「注册完成」，几秒后自己跳过去。
 */
"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button, Field, FieldLabel, Input } from "@vxture/design-system";
import { AuthLoginTemplate } from "./auth/AuthLogin";
import { AccountsAuthFooter, AccountsAuthHeader } from "./AuthChrome";
import {
  fetchOnboardingState,
  submitOnboarding,
  OnboardingSessionError,
} from "@/api/oidc";

/** 与后端 assertValidAccount 同口径：字母开头，字母数字下划线，4–32 位。 */
const ACCOUNT_RE = /^[A-Za-z][A-Za-z0-9_]{3,31}$/;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
/** 建号时发的默认用户名（`_{user_no}`）——预填时要清掉，不能让人直接提交它。 */
const DEFAULT_ACCOUNT_RE = /^_\d+$/;
/** 「注册完成」停留时长。够读完一句话，不至于让人等。 */
const RETURN_DELAY_MS = 2500;

function maskPhone(phone: string): string {
  const d = phone.replace(/\D/g, "");
  if (d.length < 7) return phone;
  return `${d.slice(0, 3)}****${d.slice(-4)}`;
}

export function OnboardingPanel() {
  const [phone, setPhone] = useState("");
  const [account, setAccount] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [doneRedirect, setDoneRedirect] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const s = await fetchOnboardingState();
        if (!active) return;
        setPhone(s.phone);
        // 默认用户名不预填：留着它，人一路回车就把 `_10000123` 提交上去了。
        setAccount(DEFAULT_ACCOUNT_RE.test(s.account) ? "" : s.account);
        setDisplayName(s.displayName ?? "");
        setEmail(s.email ?? "");
      } catch (err) {
        if (!active) return;
        setErrors({
          form:
            err instanceof OnboardingSessionError
              ? "登录会话已失效，请回到应用重新发起登录。"
              : "读取账号信息失败，请刷新重试。",
        });
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // 成功之后自动回应用。用 location.assign 而不是 router：redirectTo 是应用的
  // 绝对地址，不属于本站路由表。
  useEffect(() => {
    if (!doneRedirect) return;
    const t = setTimeout(() => {
      window.location.assign(doneRedirect);
    }, RETURN_DELAY_MS);
    return () => clearTimeout(t);
  }, [doneRedirect]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const a = account.trim();
    const n = displayName.trim();
    const e = email.trim();

    // 逐字段校验，一次把问题说全：三条共用一个错误串会变成「改完一条才被告知
    // 还有一条」。
    const next: Record<string, string> = {};
    if (!ACCOUNT_RE.test(a))
      next.account = "4–32 位，字母开头，只能用字母、数字、下划线";
    if (!n) next.displayName = "请填写显示名称";
    if (!EMAIL_RE.test(e)) next.email = "请填写有效的邮箱地址";
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setSubmitting(true);
    try {
      const { redirectTo } = await submitOnboarding({
        account: a,
        displayName: n,
        email: e,
      });
      setDoneRedirect(redirectTo);
    } catch (err) {
      if (err instanceof OnboardingSessionError) {
        setErrors({ form: "登录会话已失效，请回到应用重新发起登录。" });
      } else {
        // 409 说的是「这一格被占了」，不是整张表单的问题——按字段回报。
        const msg = err instanceof Error ? err.message : "";
        if (msg.includes("username"))
          setErrors({ account: "这个账号名已被使用" });
        else if (msg.includes("email"))
          setErrors({ email: "这个邮箱已被使用" });
        else setErrors({ form: "提交失败，请重试。" });
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (doneRedirect) {
    return (
      <AuthLoginTemplate
        header={<AccountsAuthHeader />}
        footer={<AccountsAuthFooter />}
        title="注册完成"
        description="账号已创建，个人工作空间已就绪。正在返回应用…"
      >
        <div className="flex flex-col gap-md">
          <p className="text-body-sm text-muted-foreground">
            如果没有自动跳转，请点下面的按钮。
          </p>
          <Button
            type="button"
            onClick={() => window.location.assign(doneRedirect)}
          >
            返回应用
          </Button>
        </div>
      </AuthLoginTemplate>
    );
  }

  return (
    <AuthLoginTemplate
      header={<AccountsAuthHeader />}
      footer={<AccountsAuthFooter />}
      title="完善账号信息"
      description="还差最后一步。这些信息会用在账单、通知和团队邀请里。"
    >
      <form className="flex flex-col gap-lg" onSubmit={onSubmit}>
        <Field>
          <FieldLabel>手机号</FieldLabel>
          <Input value={maskPhone(phone)} readOnly disabled />
          <p className="text-body-sm text-muted-foreground">
            已验证，作为账号的身份锚点，不可在此修改。
          </p>
        </Field>

        <Field>
          <FieldLabel htmlFor="onboarding-account">账号名</FieldLabel>
          <Input
            id="onboarding-account"
            value={account}
            onChange={(ev) => setAccount(ev.target.value)}
            placeholder="用于登录，4–32 位"
            autoComplete="username"
            disabled={loading || submitting}
          />
          {errors.account ? (
            <p className="text-body-sm text-destructive-text">
              {errors.account}
            </p>
          ) : null}
        </Field>

        <Field>
          <FieldLabel htmlFor="onboarding-name">显示名称</FieldLabel>
          <Input
            id="onboarding-name"
            value={displayName}
            onChange={(ev) => setDisplayName(ev.target.value)}
            placeholder="其他人看到的称呼"
            disabled={loading || submitting}
          />
          {errors.displayName ? (
            <p className="text-body-sm text-destructive-text">
              {errors.displayName}
            </p>
          ) : null}
        </Field>

        <Field>
          <FieldLabel htmlFor="onboarding-email">邮箱</FieldLabel>
          <Input
            id="onboarding-email"
            type="email"
            value={email}
            onChange={(ev) => setEmail(ev.target.value)}
            placeholder="接收账单与重要通知"
            autoComplete="email"
            disabled={loading || submitting}
          />
          {errors.email ? (
            <p className="text-body-sm text-destructive-text">{errors.email}</p>
          ) : null}
        </Field>

        {errors.form ? (
          <p className="text-body-sm text-destructive-text" role="alert">
            {errors.form}
          </p>
        ) : null}

        <Button type="submit" disabled={loading || submitting}>
          {submitting ? "提交中…" : "完成注册"}
        </Button>
      </form>
    </AuthLoginTemplate>
  );
}
