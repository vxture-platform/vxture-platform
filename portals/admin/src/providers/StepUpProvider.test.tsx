/**
 * StepUpProvider.test.tsx - Exercise real ceremony lifecycles in a rendered DOM.
 * @package @vxture/admin
 * @layer Presentation
 * @category test
 * @author AI-Generated
 * @date 2026-11-20
 */
import { act, type ReactNode, type FormEventHandler } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminBffError, submitOperatorStepUpTotp } from "@/api/admin-bff";
import {
  StepUpProvider,
  useStepUp,
  StepUpCancelledError,
} from "./StepUpProvider";

// ============================================================================
// Only transport and visual primitives are substituted; the provider is real.
// ============================================================================
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/api/admin-bff", async (original) => ({
  ...(await original<typeof import("@/api/admin-bff")>()),
  submitOperatorStepUpTotp: vi.fn(),
}));
vi.mock("@vxture/design-system", () => ({
  DialogForm: (p: {
    children: ReactNode;
    title: string;
    description: string;
    onSubmit: FormEventHandler<HTMLFormElement>;
    submitDisabled: boolean;
    submitting: boolean;
    onOpenChange: (open: boolean) => void;
  }) => (
    <form onSubmit={p.onSubmit}>
      <h1>{p.title}</h1>
      <p>{p.description}</p>
      {p.children}
      <button type="submit" disabled={p.submitDisabled || p.submitting}>
        verify
      </button>
      <button type="button" onClick={() => p.onOpenChange(false)}>
        cancel
      </button>
    </form>
  ),
  InputOTP: (p: { value: string; onChange: (v: string) => void }) => (
    <input
      aria-label="code"
      value={p.value}
      onChange={(e) => p.onChange(e.target.value)}
    />
  ),
  InputOTPGroup: () => null,
  InputOTPSlot: () => null,
  Label: (p: { children: ReactNode }) => <label>{p.children}</label>,
}));
let host: HTMLDivElement;
let root: Root;
let run: ReturnType<typeof useStepUp>["runWithStepUp"];
function Capture() {
  run = useStepUp().runWithStepUp;
  return null;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
function start(action: () => Promise<string>) {
  const promise = run(action);
  void promise.catch(() => undefined);
  return promise;
}
async function code(value = "123456") {
  await act(async () => {
    const input = host.querySelector("input")!;
    Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
}
async function submit() {
  await act(async () => {
    host
      .querySelector("form")!
      .dispatchEvent(
        new window.Event("submit", { bubbles: true, cancelable: true }),
      );
  });
}
async function cancel() {
  await act(async () => {
    host.querySelectorAll("button")[1]!.click();
  });
}
const intent = {
  requestHash: "a".repeat(64),
  action: "撤回卡券",
  target: "V-01",
};
const gate = () =>
  new AdminBffError("step_up_required", 403, undefined, intent);
const verified = { ok: true as const, expiresIn: 300 };
beforeEach(async () => {
  vi.mocked(submitOperatorStepUpTotp).mockReset().mockResolvedValue(verified);
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Network forbidden");
    }),
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root.render(
      <StepUpProvider>
        <Capture />
      </StepUpProvider>,
    );
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// ============================================================================
// Bound retries, cancellation, races and fail-closed verification
// ============================================================================
describe("operator ceremony DOM", () => {
  it("shows server target, submits bound context, then retries exactly once", async () => {
    const action = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(gate())
      .mockResolvedValue("done");
    let pending!: Promise<string>;
    await act(async () => {
      pending = start(action);
    });
    expect(host.textContent).toContain("V-01");
    await code();
    await submit();
    expect(await pending).toBe("done");
    expect(submitOperatorStepUpTotp).toHaveBeenCalledExactlyOnceWith(
      "123456",
      intent,
    );
    expect(action).toHaveBeenCalledTimes(2);
    expect(host.querySelector("form")).toBeNull();
  });
  it("preserves the general nonvoucher ceremony", async () => {
    const action = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new AdminBffError("step_up_required", 403))
      .mockResolvedValue("done");
    let pending!: Promise<string>;
    await act(async () => {
      pending = start(action);
    });
    await code();
    await submit();
    expect(await pending).toBe("done");
    expect(submitOperatorStepUpTotp).toHaveBeenCalledWith("123456", undefined);
  });
  it("does not repeat a second gate rejection", async () => {
    const action = vi.fn<() => Promise<string>>().mockRejectedValue(gate());
    let pending!: Promise<string>;
    await act(async () => {
      pending = start(action);
    });
    await code();
    await submit();
    await expect(pending).rejects.toMatchObject({ status: 403 });
    expect(action).toHaveBeenCalledTimes(2);
  });
  it("propagates unknown network results without offering a ceremony", async () => {
    const action = vi
      .fn<() => Promise<string>>()
      .mockRejectedValue(new Error("response lost"));
    await expect(start(action)).rejects.toThrow("response lost");
    expect(action).toHaveBeenCalledOnce();
    expect(host.querySelector("form")).toBeNull();
  });
  it("cancels the caller while verification is still in flight", async () => {
    const verification = deferred<typeof verified>();
    vi.mocked(submitOperatorStepUpTotp).mockReturnValue(verification.promise);
    const action = vi.fn<() => Promise<string>>().mockRejectedValue(gate());
    let pending!: Promise<string>;
    await act(async () => {
      pending = start(action);
    });
    await code();
    await submit();
    await cancel();
    await expect(pending).rejects.toBeInstanceOf(StepUpCancelledError);
    await act(async () => verification.resolve(verified));
    expect(action).toHaveBeenCalledOnce();
  });
  it("supersedes the old caller without accepting its late verification", async () => {
    const verification = deferred<typeof verified>();
    vi.mocked(submitOperatorStepUpTotp).mockReturnValueOnce(
      verification.promise,
    );
    const first = vi.fn<() => Promise<string>>().mockRejectedValue(gate());
    const second = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(gate())
      .mockResolvedValue("second");
    let a!: Promise<string>, b!: Promise<string>;
    await act(async () => {
      a = start(first);
    });
    await code();
    await submit();
    await act(async () => {
      b = start(second);
    });
    await expect(a).rejects.toBeInstanceOf(StepUpCancelledError);
    await act(async () => verification.resolve(verified));
    expect(second).toHaveBeenCalledOnce();
    expect(host.querySelector("input")!.value).toBe("");
    await code();
    await submit();
    expect(await b).toBe("second");
    expect(first).toHaveBeenCalledOnce();
  });
  it("sends only one verification for same-turn duplicate submits and clears the code", async () => {
    const verification = deferred<typeof verified>();
    vi.mocked(submitOperatorStepUpTotp).mockReturnValue(verification.promise);
    await act(async () => {
      start(vi.fn<() => Promise<string>>().mockRejectedValue(gate()));
    });
    await code();
    await act(async () => {
      const form = host.querySelector("form")!;
      for (let n = 0; n < 2; n++)
        form.dispatchEvent(
          new window.Event("submit", { bubbles: true, cancelable: true }),
        );
    });
    expect(submitOperatorStepUpTotp).toHaveBeenCalledOnce();
    expect(host.querySelector("input")!.value).toBe("");
    await cancel();
    await act(async () => verification.resolve(verified));
  });
  it("rejects nondigit and overlength codes", async () => {
    await act(async () => {
      start(vi.fn<() => Promise<string>>().mockRejectedValue(gate()));
    });
    for (const bad of ["abcdef", "12345", "1234567"]) {
      await code(bad);
      await submit();
    }
    expect(submitOperatorStepUpTotp).not.toHaveBeenCalled();
  });
  it("keeps the server cooldown across cancelled and replacement ceremonies", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-20T00:00:00Z"));
    vi.mocked(submitOperatorStepUpTotp).mockRejectedValueOnce(
      new AdminBffError("limited", 429, undefined, undefined, 60),
    );
    await act(async () => {
      start(vi.fn<() => Promise<string>>().mockRejectedValue(gate()));
    });
    await code();
    await submit();
    expect(host.textContent).toContain("60 秒");
    await cancel();
    const action = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(gate())
      .mockResolvedValue("done");
    let pending!: Promise<string>;
    await act(async () => {
      pending = start(action);
    });
    await code();
    await submit();
    expect(submitOperatorStepUpTotp).toHaveBeenCalledOnce();
    await act(async () => vi.advanceTimersByTime(60000));
    await submit();
    expect(await pending).toBe("done");
  });
  it("blocks further TOTP attempts when the account requires WebAuthn", async () => {
    vi.mocked(submitOperatorStepUpTotp).mockRejectedValue(
      new AdminBffError("webauthn_required", 403),
    );
    await act(async () => {
      start(vi.fn<() => Promise<string>>().mockRejectedValue(gate()));
    });
    await code();
    await submit();
    expect(host.textContent).toContain("不能改用动态码");
    await code();
    await submit();
    expect(submitOperatorStepUpTotp).toHaveBeenCalledOnce();
  });
  it("rejects pending callers on unmount and ignores late verification", async () => {
    const verification = deferred<typeof verified>();
    vi.mocked(submitOperatorStepUpTotp).mockReturnValue(verification.promise);
    const action = vi.fn<() => Promise<string>>().mockRejectedValue(gate());
    let pending!: Promise<string>;
    await act(async () => {
      pending = start(action);
    });
    await code();
    await submit();
    await act(async () => root.render(null));
    await expect(pending).rejects.toBeInstanceOf(StepUpCancelledError);
    await act(async () => verification.resolve(verified));
    expect(action).toHaveBeenCalledOnce();
  });
});
