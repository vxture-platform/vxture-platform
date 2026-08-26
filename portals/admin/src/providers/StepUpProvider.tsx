"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { DialogForm, Input, Label } from "@vxture/design-system";
import { useTranslations } from "next-intl";
import {
  isStepUpRequiredError,
  submitOperatorStepUpTotp,
} from "@/api/admin-bff";

/**
 * Thrown when the operator dismisses the step-up ceremony instead of completing
 * it. Callers should treat this as a silent cancellation (no error toast).
 */
export class StepUpCancelledError extends Error {
  constructor() {
    super("step_up_cancelled");
    this.name = "StepUpCancelledError";
  }
}

export function isStepUpCancelled(error: unknown): boolean {
  return error instanceof StepUpCancelledError;
}

interface StepUpContextValue {
  /**
   * Run a gated mutation. If it is rejected by the step-up gate, prompt for a
   * TOTP code, verify it, then retry the mutation once. Rejects with
   * StepUpCancelledError if the operator dismisses the prompt.
   */
  runWithStepUp: <T>(action: () => Promise<T>) => Promise<T>;
}

const StepUpContext = createContext<StepUpContextValue | null>(null);

export function useStepUp(): StepUpContextValue {
  const ctx = useContext(StepUpContext);
  if (!ctx) {
    throw new Error("useStepUp must be used within a StepUpProvider");
  }
  return ctx;
}

export function StepUpProvider({ children }: { children: ReactNode }) {
  const tShared = useTranslations();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Resolver/rejecter for the ceremony the caller is currently awaiting.
  const ceremony = useRef<{
    resolve: () => void;
    reject: (reason: unknown) => void;
  } | null>(null);

  const openCeremony = useCallback(() => {
    return new Promise<void>((resolve, reject) => {
      // A second ceremony while one is open cancels the earlier awaiter.
      ceremony.current?.reject(new StepUpCancelledError());
      ceremony.current = { resolve, reject };
      setCode("");
      setError(null);
      setSubmitting(false);
      setOpen(true);
    });
  }, []);

  const finishCeremony = useCallback((cancelled: boolean) => {
    const current = ceremony.current;
    ceremony.current = null;
    setOpen(false);
    if (!current) return;
    if (cancelled) current.reject(new StepUpCancelledError());
    else current.resolve();
  }, []);

  const runWithStepUp = useCallback(
    async <T,>(action: () => Promise<T>): Promise<T> => {
      try {
        return await action();
      } catch (err) {
        if (!isStepUpRequiredError(err)) throw err;
        await openCeremony();
        // Cookie is set; retry once. A second gate rejection surfaces normally.
        return action();
      }
    },
    [openCeremony],
  );

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const trimmed = code.trim();
      if (!trimmed) {
        setError("请输入动态验证码。");
        return;
      }
      setSubmitting(true);
      setError(null);
      try {
        await submitOperatorStepUpTotp(trimmed);
        finishCeremony(false);
      } catch (err) {
        setError(
          err instanceof Error && err.message
            ? err.message
            : "验证失败，请确认验证码后重试。",
        );
      } finally {
        setSubmitting(false);
      }
    },
    [code, finishCeremony],
  );

  return (
    <StepUpContext.Provider value={{ runWithStepUp }}>
      {children}
      {open ? (
        <DialogForm
          open
          title="二次验证"
          description="该高危操作需要完成二次验证。请输入身份验证器应用（TOTP）中的动态验证码。"
          submitLabel="验证并继续"
          cancelLabel={tShared("actions.cancel")}
          submitting={submitting}
          submitDisabled={code.trim().length === 0}
          onOpenChange={(next) => {
            if (!next) finishCeremony(true);
          }}
          onSubmit={(event) => void handleSubmit(event)}
        >
          <Label>
            动态验证码
            <Input
              className="vx-step-up-code-input"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={8}
              placeholder="6 位验证码"
              autoFocus
            />
          </Label>
          {error ? (
            <p className="vx-step-up-error" role="alert">
              {error}
            </p>
          ) : null}
          <p className="vx-step-up-hint">
            未绑定身份验证器？请先在 accounts 门户的安全设置中完成 TOTP
            绑定，再返回此处重试。
          </p>
        </DialogForm>
      ) : null}
    </StepUpContext.Provider>
  );
}
