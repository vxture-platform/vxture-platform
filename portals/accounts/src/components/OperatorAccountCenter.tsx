/**
 * OperatorAccountCenter.tsx — operator self-service account center (Phase B).
 * @package @vxture/accounts
 *
 * 运营者本人账户自助中心,身份层单点(收敛 admin/opera/arche 各自的入口)。同源
 * `vx_sid_op` 鉴权读身份(fetchOperatorSelf);内联两步流改邮箱/手机(email 走邮件码、
 * phone 走短信码),改密码(验旧+设新),并给出通行密钥管理入口。未登录 → 显示登录提示
 * (与 passkeys 页同口径)。B.1 邮箱、B.2 手机/密码;MFA 自助为 B.2c。
 * `?returnTo=` 为可选的回控制台入口(白名单由 page 服务端把关,不接受任意跳转)。
 */
"use client";

import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
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
  startOperatorPhoneChange,
  verifyOperatorPhoneChange,
  changeOperatorPassword,
  OperatorUnauthenticatedError,
  type OperatorSelf,
} from "@/api/operator-self";

type Load =
  | { state: "loading" }
  | { state: "unauth" }
  | { state: "error"; message: string }
  | { state: "ready"; self: OperatorSelf };

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
        <ReadyView self={load.self} onChanged={refresh} />
      )}
    </main>
  );
}

/** null = no flow open; otherwise the two-step contact-change flow for email|phone. */
type ContactFlow = {
  kind: "email" | "phone";
  step: "input" | "code";
  value: string;
  sentTo: string;
  code: string;
};

function ReadyView({
  self,
  onChanged,
}: {
  self: OperatorSelf;
  onChanged: () => void;
}) {
  const t = useTranslations("operatorAccount");
  const [flow, setFlow] = useState<ContactFlow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function open(kind: "email" | "phone") {
    setError(null);
    setFlow({ kind, step: "input", value: "", sentTo: "", code: "" });
  }
  function cancel() {
    setFlow(null);
    setError(null);
  }

  async function onSubmitContact(e: FormEvent) {
    e.preventDefault();
    if (!flow) return;
    setBusy(true);
    setError(null);
    try {
      if (flow.step === "input") {
        const value = flow.value.trim();
        if (!value) return;
        const res =
          flow.kind === "email"
            ? await startOperatorEmailChange(value.toLowerCase())
            : await startOperatorPhoneChange(value);
        setFlow({ ...flow, step: "code", sentTo: res.sentTo });
      } else {
        const code = flow.code.trim();
        if (!code) return;
        if (flow.kind === "email") await verifyOperatorEmailChange(code);
        else await verifyOperatorPhoneChange(flow.value.trim(), code);
        setNotice(
          flow.kind === "email" ? t("email.updated") : t("phone.updated"),
        );
        setFlow(null);
        onChanged();
      }
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
            <ContactValue
              value={self.email}
              verified={self.emailVerified}
              notSet={t("notSet")}
              verifiedLabel={t("verified")}
              unverifiedLabel={t("unverified")}
              onChange={() => open("email")}
              changeLabel={t("email.change")}
              disabled={flow !== null}
            />
          </Row>
          <Row label={t("field.phone")}>
            <ContactValue
              value={self.phone}
              verified={self.phoneVerified}
              notSet={t("notSet")}
              verifiedLabel={t("verified")}
              unverifiedLabel={t("unverified")}
              onChange={() => open("phone")}
              changeLabel={t("phone.change")}
              disabled={flow !== null}
            />
          </Row>
          <Row label={t("field.role")}>{self.role}</Row>
        </dl>

        {flow ? (
          <form
            className="flex flex-col gap-sm border-t border-border pt-md"
            onSubmit={onSubmitContact}
          >
            {flow.step === "input" ? (
              <Label>
                {flow.kind === "email"
                  ? t("email.newLabel")
                  : t("phone.newLabel")}
                <Input
                  type={flow.kind === "email" ? "email" : "tel"}
                  value={flow.value}
                  onChange={(ev) =>
                    setFlow({ ...flow, value: ev.target.value })
                  }
                  placeholder={
                    flow.kind === "email" ? "you@example.com" : "13800000000"
                  }
                  autoComplete={flow.kind === "email" ? "email" : "tel"}
                />
              </Label>
            ) : (
              <>
                <p className="text-body-sm text-muted-foreground">
                  {t("email.sentHint", { target: flow.sentTo })}
                </p>
                <Label>
                  {t("email.codeLabel")}
                  <Input
                    value={flow.code}
                    onChange={(ev) =>
                      setFlow({ ...flow, code: ev.target.value })
                    }
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
                  (flow.step === "input"
                    ? !flow.value.trim()
                    : !flow.code.trim())
                }
              >
                {flow.step === "input"
                  ? t("email.sendCode")
                  : t("email.verify")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={cancel}
                disabled={busy}
              >
                {t("email.cancel")}
              </Button>
            </div>
          </form>
        ) : null}
      </Card>

      <PasswordCard onDone={() => setNotice(t("password.updated"))} />

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

function ContactValue({
  value,
  verified,
  notSet,
  verifiedLabel,
  unverifiedLabel,
  onChange,
  changeLabel,
  disabled,
}: {
  value: string | null;
  verified: boolean;
  notSet: string;
  verifiedLabel: string;
  unverifiedLabel: string;
  onChange: () => void;
  changeLabel: string;
  disabled: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-sm">
      <span className="inline-flex items-center gap-xs">
        {value ?? notSet}
        {value ? (
          <StatusBadge tone={verified ? "success" : "warning"}>
            {verified ? verifiedLabel : unverifiedLabel}
          </StatusBadge>
        ) : null}
      </span>
      <Button variant="link" size="sm" onClick={onChange} disabled={disabled}>
        {changeLabel}
      </Button>
    </span>
  );
}

function PasswordCard({ onDone }: { onDone: () => void }) {
  const t = useTranslations("operatorAccount");
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setOpen(false);
    setCurrent("");
    setNext("");
    setConfirm("");
    setError(null);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (next !== confirm) {
      setError(t("password.mismatch"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await changeOperatorPassword(current, next);
      reset();
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-md p-lg">
      <h2 className="text-title-sm font-semibold">{t("password.title")}</h2>
      {open ? (
        <form className="flex flex-col gap-sm" onSubmit={onSubmit}>
          <Label>
            {t("password.current")}
            <Input
              type="password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              autoComplete="current-password"
            />
          </Label>
          <Label>
            {t("password.new")}
            <Input
              type="password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              autoComplete="new-password"
            />
          </Label>
          <Label>
            {t("password.confirm")}
            <Input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
            />
          </Label>
          <p className="text-body-sm text-muted-foreground">
            {t("password.hint")}
          </p>
          {error ? <Banner tone="danger" title={error} /> : null}
          <div className="flex gap-xs">
            <Button
              type="submit"
              size="sm"
              disabled={busy || !current || !next || !confirm}
            >
              {t("password.change")}
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
      ) : (
        <div>
          <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
            {t("password.change")}
          </Button>
        </div>
      )}
    </Card>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-md">
      <dt className="w-24 shrink-0 text-body-sm text-muted-foreground">
        {label}
      </dt>
      <dd className="text-body-md">{children}</dd>
    </div>
  );
}
