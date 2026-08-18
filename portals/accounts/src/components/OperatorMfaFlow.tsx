/**
 * OperatorMfaFlow.tsx - operator second-factor continuation (Step2 + enroll).
 * @package @vxture/accounts
 *
 * Rendered after an operator's first factor succeeds and the IdP returns
 * `mfa_required` (identity-platform-operator.md §3.2). Three sub-steps, reusing
 * the design-system auth primitives (no design-system changes):
 *   - verify   — enter a TOTP code (or a recovery code) → /mfa/verify.
 *   - enroll   — enroll-on-login: scan the QR + confirm the first code →
 *                /mfa/enroll/totp(/confirm); on success surfaces recovery codes.
 *   - recovery — show the one-time recovery codes, then continue to the app.
 * On completion the browser navigates to the RP redirect (authorization code).
 */
"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Banner, Button } from "@vxture/design-system";
import {
  AuthField,
  AuthFlowForm,
  AuthLoginTemplate,
  AuthPrimaryButton,
} from "./auth/AuthLogin";
import {
  ACCOUNTS_AUTH_VISUAL,
  AccountsAuthFooter,
  AccountsAuthHeader,
} from "./AuthChrome";
import {
  beginOperatorTotpEnroll,
  confirmOperatorTotpEnroll,
  verifyOperatorMfa,
} from "@/api/oidc";
import {
  authenticateOperatorPasskey,
  enrollOperatorPasskeyOnLogin,
} from "@/api/operator-webauthn";
import { TotpQrCode } from "./TotpQrCode";

interface OperatorMfaFlowProps {
  readonly mfaToken: string;
  readonly methods: string[];
  readonly enrollRequired: boolean;
  readonly enrollFactor: "totp" | "webauthn" | null;
}

type Phase = "verify" | "enroll" | "recovery";

export function OperatorMfaFlow({
  mfaToken,
  methods,
  enrollRequired,
  enrollFactor,
}: OperatorMfaFlowProps) {
  const enrollWebauthn = enrollRequired && enrollFactor === "webauthn";
  const [phase, setPhase] = useState<Phase>(
    enrollRequired ? "enroll" : "verify",
  );
  const [useRecovery, setUseRecovery] = useState(false);
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Enroll material (fetched on entering the enroll phase).
  const [secret, setSecret] = useState("");
  const [otpauthUri, setOtpauthUri] = useState("");

  // Recovery codes surfaced once after enrollment.
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [redirectTo, setRedirectTo] = useState("");

  // On entering the TOTP enroll phase, stage a secret + fetch the QR material.
  // The webauthn enroll branch is button-driven (no pre-fetch).
  useEffect(() => {
    if (phase !== "enroll" || enrollWebauthn || otpauthUri) return;
    let active = true;
    beginOperatorTotpEnroll(mfaToken)
      .then((m) => {
        if (!active) return;
        setSecret(m.secret);
        setOtpauthUri(m.otpauthUri);
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : "注册初始化失败");
      });
    return () => {
      active = false;
    };
  }, [phase, otpauthUri, mfaToken, enrollWebauthn]);

  const handleVerify = async (event: FormEvent) => {
    event.preventDefault();
    const method = useRecovery ? "recovery" : "totp";
    if (!code.trim()) {
      setError(useRecovery ? "请输入恢复码" : "请输入 6 位验证码");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const { redirectTo: to } = await verifyOperatorMfa(
        mfaToken,
        method,
        code.trim(),
      );
      window.location.assign(to);
    } catch (e) {
      setError(e instanceof Error ? e.message : "验证失败，请重试");
      setLoading(false);
    }
  };

  const handleConfirmEnroll = async (event: FormEvent) => {
    event.preventDefault();
    if (code.trim().length !== 6) {
      setError("请输入验证器中的 6 位验证码");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const result = await confirmOperatorTotpEnroll(mfaToken, code.trim());
      setRecoveryCodes(result.recoveryCodes);
      setRedirectTo(result.redirectTo);
      setCode("");
      setPhase("recovery");
    } catch (e) {
      setError(e instanceof Error ? e.message : "注册失败，请重试");
    } finally {
      setLoading(false);
    }
  };

  const handlePasskey = async () => {
    setLoading(true);
    setError("");
    try {
      const { redirectTo } = await authenticateOperatorPasskey(mfaToken);
      window.location.assign(redirectTo);
    } catch (e) {
      setError(e instanceof Error ? e.message : "通行密钥验证失败，请重试");
      setLoading(false);
    }
  };

  const handleEnrollPasskey = async () => {
    setLoading(true);
    setError("");
    try {
      const { redirectTo } = await enrollOperatorPasskeyOnLogin(mfaToken);
      window.location.assign(redirectTo);
    } catch (e) {
      setError(e instanceof Error ? e.message : "通行密钥注册失败，请重试");
      setLoading(false);
    }
  };

  const copyRecoveryCodes = () => {
    void navigator.clipboard
      ?.writeText(recoveryCodes.join("\n"))
      .catch(() => {});
  };

  // ── verify ────────────────────────────────────────────────────────────────
  if (phase === "verify") {
    return (
      <Shell
        title="二次验证"
        description="第一重凭据已通过。再完成一次验证即可进入运营台。"
      >
        <AuthFlowForm
          onSubmit={handleVerify}
          input={
            <>
              <AuthField
                label={useRecovery ? "恢复码" : "验证码"}
                name="mfa_code"
                type="text"
                autoFocus
                placeholder={
                  useRecovery ? "请输入恢复码" : "请输入验证器 6 位验证码"
                }
                value={code}
                error={error}
                hint={
                  useRecovery
                    ? "使用注册时保存的一次性恢复码"
                    : "打开你绑定的验证器 App 查看"
                }
                onChange={setCode}
              />
              {/* 两个换用其他验证方式的入口。原先是挂 `.vx-auth-link-button`
                  的原生 <button>（accounts 自己的一条局部样式，注释里写着
                  "pending a DS Button primitive"）——那件 primitive 已经有了，
                  就是 `variant="link"`。两个入口并排成一行，而不是各占一行：
                  它们是同一个问题（"我用不了验证器"）的两个答案。 */}
              <div className="flex flex-wrap items-center gap-md">
                <Button
                  variant="link"
                  size="xs"
                  onClick={() => {
                    setUseRecovery((v) => !v);
                    setCode("");
                    setError("");
                  }}
                >
                  {useRecovery ? "改用验证器验证码" : "使用恢复码"}
                </Button>
                {methods.includes("webauthn") ? (
                  <Button
                    variant="link"
                    size="xs"
                    disabled={loading}
                    onClick={() => void handlePasskey()}
                  >
                    使用通行密钥（Passkey）
                  </Button>
                ) : null}
              </div>
            </>
          }
          primary={
            <AuthPrimaryButton
              loading={loading}
              label="验证并登录"
              loadingLabel="验证中…"
            />
          }
        />
      </Shell>
    );
  }

  // ── enroll: WebAuthn (high-privilege bootstrap) ─────────────────────────--
  if (phase === "enroll" && enrollWebauthn) {
    return (
      <Shell
        title="设置通行密钥"
        description="运营账号要求使用通行密钥（Passkey）作为二次验证。"
      >
        <StepHint>
          点击下方按钮，使用 Windows Hello / Touch ID /
          安全密钥完成注册，注册后即可登录。
        </StepHint>
        {/* 错误原先和说明文字用同一个类名，同样的字号同样的颜色——出错时页面上
            只是多了一行字。 */}
        {error ? <Banner tone="danger" title={error} /> : null}
        <Button
          size="xl"
          className="w-full"
          disabled={loading}
          onClick={() => void handleEnrollPasskey()}
        >
          {loading ? "注册中…" : "注册通行密钥并登录"}
        </Button>
      </Shell>
    );
  }

  // ── enroll: TOTP ────────────────────────────────────────────────────────--
  if (phase === "enroll") {
    return (
      <Shell
        title="设置二次验证"
        description="为保护运营账号，需先绑定一个验证器 App。"
      >
        <StepHint>
          用验证器扫描下方二维码，或手动输入密钥，然后填入它生成的 6
          位验证码完成绑定。
        </StepHint>
        {otpauthUri ? <TotpQrCode value={otpauthUri} /> : null}
        {secret ? (
          /* 密钥是要被逐字抄进另一台设备的：等宽、可断行、给一块底，
             而不是夹在正文里的一段 <code>。 */
          <div className="flex flex-col gap-2xs">
            <StepHint>扫不了码就手动输入密钥：</StepHint>
            <code className="break-all rounded-md bg-accent px-sm py-xs font-mono text-body-sm text-foreground select-all">
              {secret}
            </code>
          </div>
        ) : null}
        <AuthFlowForm
          onSubmit={handleConfirmEnroll}
          input={
            <AuthField
              label="验证码"
              name="totp_code"
              type="text"
              autoFocus
              placeholder="请输入验证器 6 位验证码"
              value={code}
              error={error}
              onChange={setCode}
            />
          }
          primary={
            <AuthPrimaryButton
              loading={loading}
              label="确认绑定并登录"
              loadingLabel="绑定中…"
              disabled={!otpauthUri}
            />
          }
        />
      </Shell>
    );
  }

  // ── recovery ────────────────────────────────────────────────────────────--
  return (
    <Shell
      title="保存恢复码"
      description="以下恢复码仅显示这一次，离开本页后无法再看到。"
    >
      {/* 「只显示一次」是这一页唯一重要的信息，此前它和别的说明文字长得一样。
          用 warning 语气把它抬起来——不是报错，是"现在不做以后会后悔"。 */}
      <Banner
        tone="warning"
        title="请立刻保存"
        description="当验证器不可用时，可用一条恢复码登录，每条仅可使用一次。"
      />
      {/* 恢复码要被逐条抄下来：等宽、居中、两列成表。原先挂 `.vx-operator-
          recovery-codes`，那条规则里的 gap / padding / border 引用的是本仓没有
          定义的 `--vx-space-*` 与 `--vx-color-border`，浏览器整条丢弃——渲染
          出来是一个没有任何间距和描边的两列网格。 */}
      <ul className="grid list-none grid-cols-2 gap-sm rounded-lg border border-dashed border-border p-md">
        {recoveryCodes.map((c) => (
          <li key={c} className="text-center">
            <code className="font-mono text-body-md text-foreground select-all">
              {c}
            </code>
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-sm">
        <Button variant="outline" size="xl" onClick={copyRecoveryCodes}>
          复制全部
        </Button>
        <Button size="xl" onClick={() => window.location.assign(redirectTo)}>
          我已保存，继续登录
        </Button>
      </div>
    </Shell>
  );
}

/** Shared chrome for the MFA steps (same template as the login form). */
function Shell({
  title,
  description,
  children,
}: {
  readonly title: string;
  readonly description?: string | undefined;
  readonly children: React.ReactNode;
}) {
  return (
    <AuthLoginTemplate
      header={<AccountsAuthHeader />}
      footer={<AccountsAuthFooter />}
      // 与登录同壳（owner 2026-08-18 判）：二次验证是登录流程的续篇，页面
      // 骨架不该换——左侧视觉面板原样保留，只换右栏内容。此前是
      // layout="single" 的独立居中白页，步进时整页跳变、前后不像同一流程。
      title={title}
      description={description}
      visual={ACCOUNTS_AUTH_VISUAL}
      useLoginLayout
    >
      {/* 各步骤的内容原先直接堆在模板里，块与块之间没有间距——`AuthFlowForm`
          自带竖向节奏，但它上面的说明文字、二维码、按钮不在它里面。 */}
      <div className="flex flex-col gap-md">{children}</div>
    </AuthLoginTemplate>
  );
}

/**
 * 步骤说明文字。原先挂 `.vx-auth-hint`——那个类名随遗留样式层退役后没有定义，
 * 这四段说明在页面上是一色的正文，既不弱化也不分层。
 */
function StepHint({
  children,
  className,
}: {
  readonly children: React.ReactNode;
  readonly className?: string;
}) {
  return (
    <p className={`text-body-sm text-muted-foreground ${className ?? ""}`}>
      {children}
    </p>
  );
}
