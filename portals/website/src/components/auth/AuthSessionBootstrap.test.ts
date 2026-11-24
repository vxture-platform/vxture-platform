/**
 * @vitest-environment jsdom
 * Verify real event transport, reconciliation and stale-response protection.
 * @package @vxture/website
 * @layer Presentation
 * @category test
 * @author AI-Generated
 * @date 2026-11-25
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  profile: vi.fn(),
  setUser: vi.fn(),
  login: vi.fn(),
  authenticated: true,
}));
vi.mock("@/api/auth.api", () => ({
  getProfile: mocks.profile,
  buildRpLoginUrl: mocks.login,
  buildLogoutUrl: () => "/logout",
}));
vi.mock("@/lib/i18n/navigation", () => ({ usePathname: () => "/" }));
vi.mock("@vxture/core-identity-sdk", async (original) => ({
  ...(await original<typeof import("@vxture/core-identity-sdk")>()),
  startIdleWatcher: () => () => {},
}));
vi.mock("@/stores/auth.store", () => ({
  useAuthStore: {
    getState: () => ({
      isAuthenticated: mocks.authenticated,
      setUser: mocks.setUser,
    }),
    setState: vi.fn(),
  },
}));
import { AuthSessionBootstrap } from "./AuthSessionBootstrap";

// ============================================================================
// Real SDK and React lifecycle, with a controlled same-origin SSE response
// ============================================================================
let root: Root;
let stream: ReadableStreamDefaultController<Uint8Array>;
const unauthorized = { isAxiosError: true, response: { status: 401 } };
async function emit(name: string, reason: string) {
  await act(async () => {
    stream.enqueue(
      new TextEncoder().encode(
        `event: ${name}\ndata: ${JSON.stringify({ reason })}\n\n`,
      ),
    );
  });
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("BroadcastChannel", undefined);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, options: RequestInit) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          stream = controller;
        },
      });
      options.signal?.addEventListener("abort", () => {
        try {
          stream.close();
        } catch {
          /* Already cancelled. */
        }
      });
      return new Response(body, {
        headers: {
          "content-type": "text/event-stream",
          "x-vxture-session-sync": "events-v1",
        },
      });
    }),
  );
  mocks.authenticated = true;
  mocks.profile.mockReset().mockResolvedValue({ id: "user-a" });
  mocks.login.mockReset().mockReturnValue("/login");
  mocks.setUser.mockReset().mockImplementation((value) => {
    mocks.authenticated = value !== null;
  });
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
  sessionStorage.clear();
  root = createRoot(document.createElement("div"));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function mount() {
  await act(async () => root.render(createElement(AuthSessionBootstrap)));
}

// ============================================================================
// Negotiation, invalidation and failure behavior
// ============================================================================
it("retires timed and focus reads after negotiation while heartbeats keep the stream alive", async () => {
  await mount();
  await emit("resync-required", "connected");
  expect(mocks.profile).toHaveBeenCalledTimes(2);
  for (let i = 0; i < 13; i++) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(25000);
      stream.enqueue(new TextEncoder().encode(": heartbeat\n\n"));
      window.dispatchEvent(new Event("focus"));
    });
  }
  expect(mocks.profile).toHaveBeenCalledTimes(2);
});
it("skips hidden compatibility reads but processes identity events in hidden tabs", async () => {
  await mount();
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "hidden",
  });
  await act(async () => vi.advanceTimersByTimeAsync(45000));
  expect(mocks.profile).toHaveBeenCalledTimes(1);
  mocks.profile.mockResolvedValue({ id: "user-b" });
  await emit("context-changed", "context-changed");
  expect(mocks.setUser).toHaveBeenLastCalledWith({ id: "user-b" });
});
it("clears confirmed logout without a silent redirect", async () => {
  await mount();
  mocks.profile.mockRejectedValue(unauthorized);
  await emit("session-ended", "revoked");
  expect(mocks.setUser).toHaveBeenLastCalledWith(null);
  expect(mocks.login).not.toHaveBeenCalled();
});
it("retains identity on 503 and network outages", async () => {
  await mount();
  mocks.profile.mockRejectedValueOnce({
    isAxiosError: true,
    response: { status: 503 },
  });
  await emit("access-changed", "access-changed");
  expect(mocks.setUser).not.toHaveBeenCalledWith(null);
  mocks.profile.mockRejectedValueOnce(new Error("offline"));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
    window.dispatchEvent(new Event("focus"));
  });
  expect(mocks.setUser).not.toHaveBeenCalledWith(null);
});
it("rechecks after an older in-flight response before accepting a logout notification", async () => {
  await mount();
  let finish!: (value: { id: string }) => void;
  mocks.profile.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
    window.dispatchEvent(new Event("focus"));
  });
  await emit("session-ended", "revoked");
  expect(mocks.profile).toHaveBeenCalledTimes(2);
  mocks.profile.mockRejectedValueOnce(unauthorized);
  await act(async () => finish({ id: "user-a" }));
  expect(mocks.profile).toHaveBeenCalledTimes(3);
  expect(mocks.setUser).toHaveBeenLastCalledWith(null);
});
it("does not apply a profile response after its request deadline", async () => {
  await mount();
  let finish!: (value: { id: string }) => void;
  mocks.profile.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await emit("context-changed", "context-changed");
  mocks.setUser.mockClear();
  await act(async () => vi.advanceTimersByTimeAsync(15000));
  await act(async () => finish({ id: "stale" }));
  expect(mocks.setUser).not.toHaveBeenCalled();
});
