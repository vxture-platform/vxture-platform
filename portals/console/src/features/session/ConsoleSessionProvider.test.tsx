/**
 * @vitest-environment jsdom
 * Keep passive Console checks separate from aggregated session projections.
 * @package @vxture/console
 * @layer Presentation
 * @category test
 * @author AI-Generated
 * @date 2026-11-17
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ probe: vi.fn(), restore: vi.fn() }));
vi.mock("@/api/console-bff", () => ({
  hasActiveSession: mocks.probe,
  restoreSession: mocks.restore,
  buildRpLoginUrl: () => "/login",
  buildLogoutUrl: () => "/logout",
  buildTenantSwitchUrl: () => "/tenant",
  buildWorkspaceSwitchUrl: () => "/workspace",
}));
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
  mocks.probe.mockReset().mockResolvedValue(true);
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
  mocks.probe.mockClear();
}
it("uses one passive check without four projection reads every 15 seconds", async () => {
  await mount();
  await act(async () => vi.advanceTimersByTimeAsync(15000));
  expect(mocks.probe).toHaveBeenCalledTimes(1);
  expect(mocks.restore).not.toHaveBeenCalled();
});
it("pauses both full and passive checks in hidden tabs", async () => {
  await mount();
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "hidden",
  });
  await act(async () => vi.advanceTimersByTimeAsync(300000));
  expect(mocks.probe).not.toHaveBeenCalled();
  expect(mocks.restore).not.toHaveBeenCalled();
});
it("removes the authenticated shell on confirmed denial and stops anonymous polling", async () => {
  await mount();
  mocks.probe.mockResolvedValue(false);
  await act(async () => vi.advanceTimersByTimeAsync(45000));
  expect(host.textContent).toBe("Anonymous");
  expect(mocks.probe).toHaveBeenCalledTimes(1);
});
it("does not log out during an outage or overlap passive checks", async () => {
  await mount();
  let finish!: (value: null) => void;
  mocks.probe.mockImplementationOnce(
    () =>
      new Promise<null>((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () => vi.advanceTimersByTimeAsync(45000));
  expect(mocks.probe).toHaveBeenCalledTimes(1);
  await act(async () => finish(null));
  expect(host.textContent).toBe("Authenticated");
});
it("fences an older projection response after confirmed logout", async () => {
  await mount();
  let deny!: (value: boolean) => void;
  let finish!: (value: SessionSnapshot) => void;
  mocks.probe.mockImplementationOnce(
    () =>
      new Promise<boolean>((resolve) => {
        deny = resolve;
      }),
  );
  await act(async () => vi.advanceTimersByTimeAsync(15000));
  mocks.restore.mockImplementationOnce(
    () =>
      new Promise<SessionSnapshot>((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () => window.dispatchEvent(new Event("focus")));
  await act(async () => deny(false));
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
