/**
 * OperatorAccountCenter.tsx — operator self-service account center (Phase B).
 * @package @vxture/accounts
 *
 * 运营者本人账户自助中心,身份层单点(收敛 admin/opera/arche 各自的入口)。同源
 * `vx_sid_op` 鉴权读身份(fetchOperatorSelf),内联两步流改邮箱,并给出通行密钥管理入口。
 * 未登录 → 显示登录提示(与 passkeys 页同口径)。B.1 仅覆盖读身份 + 改邮箱;手机/密码/
 * MFA 自助为 B.2。`?returnTo=` 为可选的回控制台入口(安全来源由服务端校验的登录流负责,
 * 此处只做同源相对/白名单前缀的展示,不接受任意跳转)。
 */
"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  Banner,
  Button,
  Card,
  Icon,
  Input,
  Label,
  Skeleton,
  StatusBadge,
} from "@vxture/design-system";
import { useTranslations } from "next-intl";
import {
  fetchOperatorSelf,
  startOperatorEmailChange,
  verifyOperatorEmailChange,
  OperatorUnauthenticatedError,
  type OperatorSelf,
} from "@/api/operator-self";

type Load =
  | { state: "loading" }
  | { state: "unauth" }
  | { state: "error"; message: string }
  | { state: "ready"; self: OperatorSelf };

type EmailStep = "idle" | "enter-email" | "enter-code";

export function OperatorAccountCenter({ returnTo }: { returnTo?: string }) {
  const t = useTranslations("operatorAccount");
  const [load, setLoad] = useState<Load>({ state: "loading" });

  const refresh = useCallback(async () => {
    try {
      setLoad({ state: "ready", self: await fetchOperatorSelf() });
    } catch (e) {
      if (e instanceof OperatorUnauthenticatedError)
        setLoad({ state: "unauth" });
      else
        setLoad({
          state: "error",
          message: e instanceof Error ? e.message : "",
        });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <main className="mx-auto flex w-full max-w-panel-lg flex-col gap-lg px-md py-3xl">
      <header className="flex items-start justify-between gap-md">
        <div className="flex flex-col gap-2xs">
          <h1 className="text-title-md font-semibold">{t("title")}</h1>
          <p className="text-body-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        {returnTo ? (
          <Button asChild variant="ghost" size="sm">
            <a href={returnTo}>
              <Icon name="arrow-left" size="sm" aria-hidden="true" />
              {t("back")}
            </a>
          </Button>
        ) : null}
      </header>

      {load.state === "loading" ? (
        <Skeleton className="h-40 w-full" />
      ) : load.state === "unauth" ? (
        <Banner tone="warning" title={t("loginRequired")} />
      ) : load.state === "error" ? (
        <Banner
          tone="danger"
          title={t("loadFailed")}
          description={load.message}
        />
      ) : (
        <ReadyView self={load.self} onEmailUpdated={refresh} />
      )}
    </main>
  );
}

function ReadyView({
  self,
  onEmailUpdated,
}: {
  self: OperatorSelf;
  onEmailUpdated: () => void;
}) {
  const t = useTranslations("operatorAccount");
  const [step, setStep] = useState<EmailStep>("idle");
  const [newEmail, setNewEmail] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function reset() {
    setStep("idle");
    setNewEmail("");
    setSentTo("");
    setCode("");
    setError(null);
  }

  async function onSend(e: FormEvent) {
    e.preventDefault();
    const email = newEmail.trim().toLowerCase();
    if (!email) return;
    setBusy(true);
    setError(null);
    try {
      const res = await startOperatorEmailChange(email);
      setSentTo(res.sentTo);
      setStep("enter-code");
    } catch (err) {
      setError(err instanceof Error ? err.message : "");
    } finally {
      setBusy(false);
    }
  }

  async function onVerify(e: FormEvent) {
    e.preventDefault();
    const c = code.trim();
    if (!c) return;
    setBusy(true);
    setError(null);
    try {
      await verifyOperatorEmailChange(c);
      setNotice(t("email.updated"));
      reset();
      onEmailUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-lg">
      {notice ? <Banner tone="success" title={notice} /> : null}

      <Card className="flex flex-col gap-md p-lg">
        <h2 className="text-title-sm font-semibold">{t("section.account")}</h2>
        <dl className="flex flex-col gap-sm">
          <Row label={t("field.username")}>{self.username}</Row>
          <Row label={t("field.email")}>
            <span className="inline-flex items-center gap-xs">
              {self.email ?? t("notSet")}
              {self.email ? (
                <StatusBadge tone={self.emailVerified ? "success" : "warning"}>
                  {self.emailVerified ? t("verified") : t("unverified")}
                </StatusBadge>
              ) : null}
            </span>
          </Row>
          <Row label={t("field.phone")}>
            <span className="inline-flex items-center gap-xs">
              {self.phone ?? t("notSet")}
              {self.phone ? (
                <StatusBadge tone={self.phoneVerified ? "success" : "warning"}>
                  {self.phoneVerified ? t("verified") : t("unverified")}
                </StatusBadge>
              ) : null}
            </span>
          </Row>
          <Row label={t("field.role")}>{self.role}</Row>
        </dl>

        {step === "idle" ? (
          <div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setStep("enter-email")}
            >
              {t("email.change")}
            </Button>
          </div>
        ) : (
          <form
            className="flex flex-col gap-sm border-t border-border pt-md"
            onSubmit={step === "enter-email" ? onSend : onVerify}
          >
            {step === "enter-email" ? (
              <Label>
                {t("email.newLabel")}
                <Input
                  type="email"
                  value={newEmail}
                  onChange={(ev) => setNewEmail(ev.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                />
              </Label>
            ) : (
              <>
                <p className="text-body-sm text-muted-foreground">
                  {t("email.sentHint", { target: sentTo })}
                </p>
                <Label>
                  {t("email.codeLabel")}
                  <Input
                    value={code}
                    onChange={(ev) => setCode(ev.target.value)}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                  />
                </Label>
              </>
            )}
            {error ? (
              <Banner tone="danger" title={error || t("loadFailed")} />
            ) : null}
            <div className="flex gap-xs">
              <Button
                type="submit"
                size="sm"
                disabled={
                  busy ||
                  (step === "enter-email" ? !newEmail.trim() : !code.trim())
                }
              >
                {step === "enter-email"
                  ? t("email.sendCode")
                  : t("email.verify")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={reset}
                disabled={busy}
              >
                {t("email.cancel")}
              </Button>
            </div>
          </form>
        )}
      </Card>

      <Card className="flex flex-col gap-md p-lg">
        <h2 className="text-title-sm font-semibold">{t("security.title")}</h2>
        <div className="flex items-center justify-between gap-md">
          <div className="flex flex-col gap-3xs">
            <span className="text-body-md">{t("security.passkeys")}</span>
            <span className="text-body-sm text-muted-foreground">
              {t("security.passkeysHint")}
            </span>
          </div>
          <Button asChild variant="secondary" size="sm">
            <a href="/security/passkeys">{t("security.passkeysManage")}</a>
          </Button>
        </div>
        <p className="text-body-sm text-muted-foreground">
          {t("security.pending")}
        </p>
      </Card>
    </div>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-md">
      <dt className="w-24 shrink-0 text-body-sm text-muted-foreground">
        {label}
      </dt>
      <dd className="text-body-md">{children}</dd>
    </div>
  );
}
