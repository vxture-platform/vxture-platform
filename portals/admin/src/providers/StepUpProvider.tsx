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
import {
  DialogForm,
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
  Label,
} from "@vxture/design-system";
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

/**
 * 二次验证仪式的呈现选项(owner 2026-08-31)。破坏性操作(删除等)传 `danger:true`,
 * 对话框走 destructive 语义色(提交按钮变红),并可把提交文案改成「确认删除」这类;
 * 不传则维持中性的「验证并继续」——既有调用方零改动。
 */
export interface StepUpOptions {
  danger?: boolean;
  submitLabel?: ReactNode;
}

interface StepUpContextValue {
  /**
   * Run a gated mutation. If it is rejected by the step-up gate, prompt for a
   * TOTP code, verify it, then retry the mutation once. Rejects with
   * StepUpCancelledError if the operator dismisses the prompt. `opts` styles the
   * ceremony dialog (e.g. danger + a destructive confirm label for deletes).
   */
  runWithStepUp: <T>(
    action: () => Promise<T>,
    opts?: StepUpOptions,
  ) => Promise<T>;
}

const StepUpContext = createContext<StepUpContextValue | null>(null);

export function useStepUp(): StepUpContextValue {
  const ctx = useContext(StepUpContext);
  if (!ctx) {
    throw new Error("useStepUp must be used within a StepUpProvider");
  }
  return ctx;
}

const TOTP_LENGTH = 6;

export function StepUpProvider({ children }: { children: ReactNode }) {
  const tShared = useTranslations();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opts, setOpts] = useState<StepUpOptions>({});
  // Resolver/rejecter for the ceremony the caller is currently awaiting.
  const ceremony = useRef<{
    resolve: () => void;
    reject: (reason: unknown) => void;
  } | null>(null);

  const openCeremony = useCallback((ceremonyOpts: StepUpOptions) => {
    return new Promise<void>((resolve, reject) => {
      // A second ceremony while one is open cancels the earlier awaiter.
      ceremony.current?.reject(new StepUpCancelledError());
      ceremony.current = { resolve, reject };
      setCode("");
      setError(null);
      setSubmitting(false);
      setOpts(ceremonyOpts);
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
    async <T,>(action: () => Promise<T>, opts?: StepUpOptions): Promise<T> => {
      try {
        return await action();
      } catch (err) {
        if (!isStepUpRequiredError(err)) throw err;
        await openCeremony(opts ?? {});
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
      if (trimmed.length < TOTP_LENGTH) {
        setError("请输入 6 位动态验证码。");
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
          size="sm"
          danger={opts.danger ?? false}
          title="二次验证"
          description="该高危操作需要完成二次验证。请输入身份验证器应用（TOTP）中的动态验证码。"
          submitLabel={opts.submitLabel ?? "验证并继续"}
          cancelLabel={tShared("actions.cancel")}
          submitting={submitting}
          submitDisabled={code.trim().length < TOTP_LENGTH}
          onOpenChange={(next) => {
            if (!next) finishCeremony(true);
          }}
          onSubmit={(event) => void handleSubmit(event)}
        >
          {/* 标签在上、控件在下(竖排)——避免中文小标题在窄格里被逐字竖排。
              验证码用 InputOTP:6 格单行输入,比裸文本框更清晰(owner 2026-08-31)。 */}
          <div className="flex flex-col items-center gap-sm">
            <Label className="self-start">动态验证码</Label>
            <InputOTP
              maxLength={TOTP_LENGTH}
              value={code}
              onChange={setCode}
              inputMode="numeric"
              autoFocus
              containerClassName="justify-center"
            >
              <InputOTPGroup>
                {Array.from({ length: TOTP_LENGTH }, (_, i) => (
                  <InputOTPSlot key={i} index={i} />
                ))}
              </InputOTPGroup>
            </InputOTP>
          </div>
          {error ? (
            <p
              className="m-0 text-body-sm font-semibold text-destructive-text"
              role="alert"
            >
              {error}
            </p>
          ) : null}
          <p className="m-0 text-body-sm text-muted-foreground">
            未绑定身份验证器？请先在 accounts 门户的安全设置中完成 TOTP
            绑定，再返回此处重试。
          </p>
        </DialogForm>
      ) : null}
    </StepUpContext.Provider>
  );
}
