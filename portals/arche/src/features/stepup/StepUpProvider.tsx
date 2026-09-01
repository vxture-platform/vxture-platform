"use client";

/* StepUpProvider — 高危操作的二次验证仪式。
 *
 * `product_250` v0.4（owner 2026-08-13）：step-up 的**判据归 platform 目录、执行归
 * console**。provider（atlas/runos）不做这个判断——它们没有 UI，跑不了仪式，只能拒绝；
 * 而且它们能看到的 `amr` 是**会话级**语义（"登录时用过 MFA"，可能 8 小时前），不是
 * **操作级**的"此刻本人在键盘前"。这里跑的才是后者：IdP 现签一枚 TTL 300 秒的凭证。
 *
 * 流程：调用方把写操作包进 `runWithStepUp` → 命中闸门（403 `step_up_required`）→
 * 弹框收 TOTP → 换 cookie → **原样重试一次**。第二次再被拒就照常抛错（比如码对了但
 * 权限本来就不够，那不是仪式能解决的问题）。
 *
 * 与 admin 门户那份同构但独立：两个门户的 step-up 凭证 `aud` 不同
 * （`opera` vs `admin`）、cookie 也刻意不同名，不能互相顶替。
 */

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { DialogForm, Field, FieldLabel, Input } from "@vxture/design-system";
import { useTranslations } from "next-intl";
import {
  isStepUpRequiredError as isStepUpRequiredLib,
  submitOperatorStepUpTotp,
} from "@/lib/api";
// RBAC 写操作走 @/api/arche-bff,抛的是 ArcheBffError;而 @/lib/api 的检测器只认
// ArcheApiError。两套客户端两套错误类,若只认一种,runWithStepUp 就识别不到闸门、
// 不弹框(症状:高危操作只弹"需二次验证"toast、没有输入面板)。两个都认才不漏。
import { isStepUpRequiredError as isStepUpRequiredBff } from "@/api/arche-bff";

/**
 * 操作者主动关掉了验证框（而不是验证失败）。调用方应当**静默处理**——
 * 用户取消不是错误，不该弹一个红色 toast 说"操作失败"。
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
   * 跑一个可能被 step-up 拦截的写操作。被拦截时弹框收码、验证、然后**重试一次**。
   * 操作者取消则以 `StepUpCancelledError` 拒绝。
   */
  runWithStepUp: <T>(action: () => Promise<T>) => Promise<T>;
}

const StepUpContext = createContext<StepUpContextValue | null>(null);

export function useStepUp(): StepUpContextValue {
  const ctx = useContext(StepUpContext);
  if (!ctx) {
    throw new Error("useStepUp 必须在 StepUpProvider 内使用");
  }
  return ctx;
}

export function StepUpProvider({ children }: { children: ReactNode }) {
  const tShared = useTranslations();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 当前正在等待的那次仪式的 resolve/reject。
  const ceremony = useRef<{
    resolve: () => void;
    reject: (reason: unknown) => void;
  } | null>(null);

  const openCeremony = useCallback(() => {
    return new Promise<void>((resolve, reject) => {
      // 前一次还开着就又来一次：取消前一个等待者，不让它悬着。
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
        if (!isStepUpRequiredBff(err) && !isStepUpRequiredLib(err)) throw err;
        await openCeremony();
        // cookie 已种；重试一次。再被拒就正常抛出去。
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
          size="sm"
          title="二次验证"
          description="该操作涉及凭证材料或不可逆变更，需要现在确认一次身份。请输入验证器 App（TOTP）中的动态验证码。"
          submitLabel="验证并继续"
          cancelLabel={tShared("actions.cancel")}
          submitting={submitting}
          submitDisabled={code.trim().length === 0}
          onOpenChange={(next) => {
            if (!next) finishCeremony(true);
          }}
          onSubmit={(event) => void handleSubmit(event)}
        >
          <Field>
            <FieldLabel htmlFor="stepup-code">动态验证码</FieldLabel>
            <Input
              id="stepup-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={8}
              placeholder="6 位验证码"
              className="font-mono"
              autoFocus
            />
          </Field>
          {error ? (
            <p className="text-body-sm text-danger-foreground" role="alert">
              {error}
            </p>
          ) : null}
          <p className="text-body-sm text-muted-foreground">
            未绑定验证器？请先在 accounts 门户的安全设置里完成绑定，再回来重试。
            验证有效期 5 分钟，期间的同类操作不会重复询问。
          </p>
        </DialogForm>
      ) : null}
    </StepUpContext.Provider>
  );
}
