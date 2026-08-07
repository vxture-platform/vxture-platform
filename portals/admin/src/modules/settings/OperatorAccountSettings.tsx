"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  Button,
  DialogForm,
  Input,
  Label,
  StatusBadge,
  useToast,
} from "@vxture/design-system";
import {
  fetchCurrentUser,
  startOperatorEmailChange,
  verifyOperatorEmailChange,
} from "@/api/admin-bff";
import type { ConsoleUser } from "@/entities/console";

type Step = "enter-email" | "enter-code";

/**
 * 我的账户 · 邮箱（operator 自助改邮箱 + 验证，TD-017 §③）。
 * 运营帮改过邮箱后该邮箱为「未验证」，无法用于密码找回；本人在此改并验证新邮箱后恢复。
 */
export function OperatorAccountSettings() {
  const { toast } = useToast();
  const [user, setUser] = useState<ConsoleUser | null>(null);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("enter-email");
  const [newEmail, setNewEmail] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function reload() {
    fetchCurrentUser()
      .then((u) => setUser(u))
      .catch(() => setUser(null));
  }
  useEffect(reload, []);

  function reset() {
    setStep("enter-email");
    setNewEmail("");
    setSentTo("");
    setCode("");
  }

  async function onSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = newEmail.trim().toLowerCase();
    if (!email) return;
    setSubmitting(true);
    try {
      const res = await startOperatorEmailChange(email);
      setSentTo(res.sentTo);
      setStep("enter-code");
      toast({ tone: "success", title: `验证码已发送至 ${res.sentTo}` });
    } catch (error) {
      toast({
        tone: "danger",
        title: "发送验证码失败",
        ...(error instanceof Error && error.message
          ? { description: error.message }
          : {}),
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function onVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const c = code.trim();
    if (!c) return;
    setSubmitting(true);
    try {
      const res = await verifyOperatorEmailChange(c);
      toast({ tone: "success", title: `邮箱已更新并验证：${res.email}` });
      setOpen(false);
      reset();
      reload();
    } catch (error) {
      toast({
        tone: "danger",
        title: "验证失败",
        ...(error instanceof Error && error.message
          ? { description: error.message }
          : {}),
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="vx-settings-card" aria-label="我的账户 · 邮箱">
      <header className="vx-settings-card__header">
        <h2>我的账户 · 邮箱</h2>
      </header>
      <div className="vx-settings-card__body">
        <div className="vx-settings-row">
          <span className="vx-settings-row__label">当前邮箱</span>
          <span className="vx-settings-row__value">
            {user?.email ?? "-"}
            {user ? (
              user.emailVerified ? (
                <StatusBadge tone="success">已验证</StatusBadge>
              ) : (
                <StatusBadge tone="warning">未验证</StatusBadge>
              )
            ) : null}
          </span>
        </div>
        {user && !user.emailVerified ? (
          <p className="vx-settings-hint">
            当前邮箱未验证（可能被运营代改），无法用于密码找回。请更改并验证邮箱以恢复。
          </p>
        ) : null}
        <Button
          onClick={() => {
            reset();
            setOpen(true);
          }}
        >
          更改并验证邮箱
        </Button>
      </div>

      {open ? (
        <DialogForm
          open
          title="更改邮箱"
          description={
            step === "enter-email"
              ? "输入新邮箱，我们会向该地址发送验证码。"
              : `验证码已发送至 ${sentTo}，输入以完成验证。`
          }
          submitLabel={step === "enter-email" ? "发送验证码" : "验证并保存"}
          submitting={submitting}
          submitDisabled={
            step === "enter-email" ? !newEmail.trim() : !code.trim()
          }
          onOpenChange={(o) => {
            if (!o && !submitting) {
              setOpen(false);
              reset();
            }
          }}
          onSubmit={step === "enter-email" ? onSend : onVerify}
        >
          {step === "enter-email" ? (
            <Label>
              新邮箱
              <Input
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
              />
            </Label>
          ) : (
            <Label>
              验证码
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                inputMode="numeric"
                placeholder="6 位验证码"
                autoComplete="one-time-code"
              />
            </Label>
          )}
        </DialogForm>
      ) : null}
    </section>
  );
}
