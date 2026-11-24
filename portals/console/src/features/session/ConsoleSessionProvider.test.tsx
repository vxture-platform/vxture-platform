/**
 * @vitest-environment jsdom
 * Keep compatibility reads bounded and preserve event-driven logout fencing.
 * @package @vxture/console
 * @layer Presentation
 * @category test
 * @author AI-Generated
 * @date 2026-11-17
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ restore: vi.fn(), events: vi.fn() }));
vi.mock("@/api/console-bff", () => ({
  restoreSession: mocks.restore,
  buildRpLoginUrl: () => "/login",
  buildLogoutUrl: () => "/logout",
  buildTenantSwitchUrl: () => "/tenant",
  buildWorkspaceSwitchUrl: () => "/workspace",
}));
vi.mock("./session-events", () => ({ startSessionEvents: mocks.events }));
vi.mock("@vxture/core-identity-sdk", () => ({
  IDLE_MS: { customer: 1000000 },
  startIdleWatcher: () => () => {},
}));
import {
  ConsoleSessionProvider,
  useConsoleSession,
} from "./ConsoleSessionProvider";
import type { SessionSnapshot } from "@/entities/console";
const ready = {
  isAuthenticated: true,
  user: { id: "user-a" },
  tenant: null,
  tenantOptions: [],
  capabilities: [],
} as unknown as SessionSnapshot;
const anonymous: SessionSnapshot = {
  isAuthenticated: false,
  user: null,
  tenant: null,
  tenantOptions: [],
  capabilities: [],
};
// ============================================================================
// Real React lifecycle with controllable event transport and snapshot requests.
// ============================================================================
let root: Root;
let host: HTMLDivElement;
function Consumer() {
  const { session } = useConsoleSession();
  return createElement(
    "span",
    null,
    session.isAuthenticated ? "Authenticated" : "Anonymous",
  );
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.events.mockReset().mockReturnValue(() => {});
  mocks.restore.mockReset().mockResolvedValue(ready);
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function mount() {
  await act(async () =>
    root.render(
      <ConsoleSessionProvider initialSession={ready}>
        <Consumer />
      </ConsoleSessionProvider>,
    ),
  );
  mocks.restore.mockClear();
}
it("uses bounded compatibility reads only while events are unavailable", async () => {
  await mount();
  await act(async () => vi.advanceTimersByTimeAsync(15000));
  expect(mocks.restore).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTimeAsync(285000));
  expect(mocks.restore).toHaveBeenCalledTimes(1);
  const mode = mocks.events.mock.calls[0]![1] as (active: boolean) => void;
  await act(async () => mode(true));
  mocks.restore.mockClear();
  await act(async () => vi.advanceTimersByTimeAsync(600000));
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(mocks.restore).not.toHaveBeenCalled();
});
it("pauses compatibility reads in hidden tabs", async () => {
  await mount();
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "hidden",
  });
  await act(async () => vi.advanceTimersByTimeAsync(300000));
  expect(mocks.restore).not.toHaveBeenCalled();
});
it("removes the authenticated shell on confirmed denial and stops anonymous polling", async () => {
  await mount();
  mocks.restore.mockResolvedValue(anonymous);
  await act(async () => vi.advanceTimersByTimeAsync(300000));
  expect(host.textContent).toBe("Anonymous");
  await act(async () => vi.advanceTimersByTimeAsync(600000));
  expect(mocks.restore).toHaveBeenCalledTimes(1);
});
it("does not log out during an outage or overlap compatibility reads", async () => {
  await mount();
  let fail!: (error: Error) => void;
  mocks.restore.mockImplementationOnce(
    () =>
      new Promise<SessionSnapshot>((_resolve, reject) => {
        fail = reject;
      }),
  );
  await act(async () => vi.advanceTimersByTimeAsync(900000));
  expect(mocks.restore).toHaveBeenCalledTimes(1);
  await act(async () => fail(new Error("unavailable")));
  expect(host.textContent).toBe("Authenticated");
});
it("fences an older projection response after confirmed logout", async () => {
  await mount();
  let finish!: (value: SessionSnapshot) => void;
  mocks.restore.mockImplementationOnce(
    () =>
      new Promise<SessionSnapshot>((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () => vi.advanceTimersByTimeAsync(300000));
  mocks.restore.mockResolvedValueOnce(anonymous);
  const reconcile = mocks.events.mock.calls[0]![0] as () => Promise<string>;
  await act(async () => {
    await reconcile();
  });
  await act(async () => finish(ready));
  expect(host.textContent).toBe("Anonymous");
});
it("checks immediately on reconnect and browser history restoration", async () => {
  await mount();
  await act(async () => vi.advanceTimersByTimeAsync(2000));
  await act(async () => window.dispatchEvent(new Event("online")));
  expect(mocks.restore).toHaveBeenCalledTimes(1);
  await act(async () => vi.advanceTimersByTimeAsync(2000));
  await act(async () => window.dispatchEvent(new Event("pageshow")));
  expect(mocks.restore).toHaveBeenCalledTimes(2);
});
