/**
 * @vitest-environment jsdom
 * Verify passive session polling without full profile refreshes or stale resurrection.
 * @package @vxture/website
 * @layer Presentation
 * @category test
 * @author AI-Generated
 * @date 2026-11-17
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  probe: vi.fn(),
  profile: vi.fn(),
  setUser: vi.fn(),
  authenticated: true,
}));
vi.mock("@/api/auth.api", () => ({
  hasActiveSession: mocks.probe,
  getProfile: mocks.profile,
  buildRpLoginUrl: () => "/login",
  buildLogoutUrl: () => "/logout",
}));
vi.mock("@/lib/i18n/navigation", () => ({ usePathname: () => "/" }));
vi.mock("@vxture/core-identity-sdk", () => ({
  IDLE_MS: { customer: 1000000 },
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
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers();
  mocks.authenticated = true;
  mocks.probe.mockReset().mockResolvedValue(true);
  mocks.profile.mockReset().mockResolvedValue({ id: "user-a" });
  mocks.setUser.mockReset().mockImplementation((value) => {
    mocks.authenticated = value !== null;
  });
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
  vi.restoreAllMocks();
});
async function mount() {
  await act(async () => root.render(createElement(AuthSessionBootstrap)));
  mocks.profile.mockClear();
  mocks.probe.mockClear();
  mocks.setUser.mockClear();
}
it("checks every 15 seconds using one passive request and no profile reads", async () => {
  await mount();
  await act(async () => vi.advanceTimersByTimeAsync(15000));
  expect(mocks.probe).toHaveBeenCalledTimes(1);
  expect(mocks.profile).not.toHaveBeenCalled();
});
it("pauses hidden tabs and checks on returning to the foreground", async () => {
  await mount();
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "hidden",
  });
  await act(async () => vi.advanceTimersByTimeAsync(45000));
  expect(mocks.probe).not.toHaveBeenCalled();
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
  await act(async () => document.dispatchEvent(new Event("visibilitychange")));
  expect(mocks.probe).toHaveBeenCalledTimes(1);
});
it("clears confirmed logout and stops anonymous heartbeat requests", async () => {
  await mount();
  mocks.probe.mockResolvedValue(false);
  await act(async () => vi.advanceTimersByTimeAsync(45000));
  expect(mocks.setUser).toHaveBeenCalledWith(null);
  expect(mocks.probe).toHaveBeenCalledTimes(1);
});
it("retains identity during outages and collapses overlapping heartbeats", async () => {
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
  expect(mocks.setUser).not.toHaveBeenCalledWith(null);
});
it("does not restore a delayed profile result after a heartbeat confirms logout", async () => {
  await mount();
  let finish!: (value: { id: string }) => void;
  mocks.profile.mockImplementationOnce(
    () =>
      new Promise<{ id: string }>((resolve) => {
        finish = resolve;
      }),
  );
  let deny!: (value: boolean) => void;
  mocks.probe.mockImplementationOnce(
    () =>
      new Promise<boolean>((resolve) => {
        deny = resolve;
      }),
  );
  await act(async () => vi.advanceTimersByTimeAsync(15000));
  await act(async () => window.dispatchEvent(new Event("focus")));
  await act(async () => deny(false));
  await act(async () => finish({ id: "user-a" }));
  expect(mocks.setUser).toHaveBeenCalledWith(null);
  expect(mocks.setUser).not.toHaveBeenCalledWith({ id: "user-a" });
});
