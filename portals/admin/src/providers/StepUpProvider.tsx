"use client";
/**
 * StepUpProvider.tsx - Cancellable, request-bound operator verification.
 * @package @vxture/admin
 * @layer Presentation
 * @category provider
 * @author AI-Generated
 * @date 2026-11-20
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
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
  AdminBffError,
  isStepUpRequiredError,
  submitOperatorStepUpTotp,
  type VoucherStepUpIntent,
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

/** Presentation options for the verification ceremony. */
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

// ============================================================================
// Ceremony lifecycle and shared local cooldown
// ============================================================================
const TOTP_LENGTH = 6;

export function StepUpProvider({ children }: { children: ReactNode }) {
  const tShared = useTranslations();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const inFlight = useRef(false);
  const cooldownUntil = useRef(0);
  const [waitSeconds, setWaitSeconds] = useState(0);
  const [webauthnRequired, setWebauthnRequired] = useState(false);
  const [opts, setOpts] = useState<StepUpOptions>({});
  const [actionIntent, setActionIntent] = useState<
    VoucherStepUpIntent | undefined
  >();
  // Resolver/rejecter for the ceremony the caller is currently awaiting.
  const ceremony = useRef<{
    resolve: () => void;
    reject: (reason: unknown) => void;
    action?: VoucherStepUpIntent;
  } | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      ceremony.current?.reject(new StepUpCancelledError());
      ceremony.current = null;
    };
  }, []);
  useEffect(() => {
    if (!waitSeconds) return;
    const timer = window.setInterval(() => {
      setWaitSeconds(
        Math.max(0, Math.ceil((cooldownUntil.current - Date.now()) / 1000)),
      );
    }, 250);
    return () => window.clearInterval(timer);
  }, [waitSeconds]);

  const openCeremony = useCallback(
    (ceremonyOpts: StepUpOptions, action?: VoucherStepUpIntent) => {
      return new Promise<void>((resolve, reject) => {
        if (!mounted.current) {
          reject(new StepUpCancelledError());
          return;
        }
        // A second ceremony while one is open cancels the earlier awaiter.
        ceremony.current?.reject(new StepUpCancelledError());
        ceremony.current = { resolve, reject, ...(action ? { action } : {}) };
        setActionIntent(action);
        setCode("");
        setError(null);
        setSubmitting(inFlight.current);
        setOpts(ceremonyOpts);
        setOpen(true);
      });
    },
    [],
  );

  const finishCeremony = useCallback((cancelled: boolean) => {
    const current = ceremony.current;
    ceremony.current = null;
    setOpen(false);
    setCode("");
    setActionIntent(undefined);
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
        if (!mounted.current) throw new StepUpCancelledError();
        await openCeremony(
          opts ?? {},
          err instanceof AdminBffError ? err.stepUpAction : undefined,
        );
        // Cookie is set; retry once. A second gate rejection surfaces normally.
        if (!mounted.current) throw new StepUpCancelledError();
        return action();
      }
    },
    [openCeremony],
  );

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const current = ceremony.current;
      if (
        !current ||
        inFlight.current ||
        webauthnRequired ||
        Date.now() < cooldownUntil.current
      )
        return;
      const trimmed = code.trim();
      if (!/^\d{6}$/.test(trimmed)) {
        setError("请输入 6 位数字验证码。");
        return;
      }
      inFlight.current = true;
      setSubmitting(true);
      setCode("");
      setError(null);
      try {
        await submitOperatorStepUpTotp(trimmed, current.action);
        if (mounted.current && ceremony.current === current)
          finishCeremony(false);
      } catch (err) {
        if (!mounted.current) return;
        // A server cooldown survives cancellation and replacement of the dialog.
        if (err instanceof AdminBffError && err.status === 429) {
          const seconds = err.retryAfter ?? 900;
          cooldownUntil.current = Math.max(
            cooldownUntil.current,
            Date.now() + seconds * 1000,
          );
          setWaitSeconds(
            Math.ceil((cooldownUntil.current - Date.now()) / 1000),
          );
        }
        if (err instanceof Error && err.message === "webauthn_required")
          setWebauthnRequired(true);
        if (ceremony.current !== current) return;
        setError(
          err instanceof Error && err.message === "webauthn_required"
            ? "此账号要求通行密钥验证，不能改用动态码。请使用符合账号安全要求的验证方式。"
            : err instanceof AdminBffError && err.status === 429
              ? "验证尝试过于频繁，请等待后重试。"
              : "验证失败，请确认验证码后重试。",
        );
      } finally {
        inFlight.current = false;
        if (mounted.current) setSubmitting(false);
      }
    },
    [code, finishCeremony, webauthnRequired],
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
          description={
            actionIntent
              ? `本次操作：${actionIntent.action}；目标：${actionIntent.target}。验证仅授权本次提交的参数。`
              : "该高危操作需要完成二次验证。请输入身份验证器应用（TOTP）中的动态验证码。"
          }
          submitLabel={opts.submitLabel ?? "验证并继续"}
          cancelLabel={tShared("actions.cancel")}
          submitting={submitting}
          submitDisabled={
            !/^\d{6}$/.test(code.trim()) ||
            submitting ||
            waitSeconds > 0 ||
            webauthnRequired
          }
          onOpenChange={(next) => {
            if (!next) finishCeremony(true);
          }}
          onSubmit={(event) => void handleSubmit(event)}
        >
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
          {waitSeconds > 0 ? (
            <p role="status">请等待 {waitSeconds} 秒后重试。</p>
          ) : null}
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
