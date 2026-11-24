/**
 * Session synchronization regression checks without a browser DOM.
 * @package @vxture/console
 * @layer Presentation
 * @category test
 * @author AI-Generated
 * @date 2026-11-19
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionSnapshot } from "@/entities/console";
import { ConsoleSessionProvider } from "./ConsoleSessionProvider";

// ============================================================================
// Hook boundary harness: exercise asynchronous callbacks and browser signals.
// ============================================================================
const harness = vi.hoisted(() => ({
  effects: [] as Array<() => void | (() => void)>,
  writeState: vi.fn(),
  restore: vi.fn<() => Promise<SessionSnapshot>>(),
  events: vi.fn(),
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof React>()),
  useState: <T>(value: T) => [value, harness.writeState],
  useRef: <T>(value: T) => ({ current: value }),
  useCallback: <T>(callback: T) => callback,
  useMemo: <T>(factory: () => T) => factory(),
  useEffect: (effect: () => void | (() => void)) =>
    harness.effects.push(effect),
}));
vi.mock("@vxture/core-identity-sdk", () => ({
  IDLE_MS: { customer: 1000 },
  startIdleWatcher: vi.fn(),
}));
vi.mock("@/api/console-bff", () => ({
  restoreSession: harness.restore,
  buildLogoutUrl: vi.fn(),
  buildRpLoginUrl: vi.fn(),
  buildTenantSwitchUrl: vi.fn(),
  buildWorkspaceSwitchUrl: vi.fn(),
}));
vi.mock("./session-events", () => ({ startSessionEvents: harness.events }));

const initial: SessionSnapshot = {
  isAuthenticated: true,
  user: { id: "user", name: "Member", email: "", roleLabel: "Member" },
  tenant: {
    id: "team",
    name: "Team",
    mode: "tenant",
    tenantType: "organization",
    workspace: "first",
  },
  tenantOptions: [],
  capabilities: [],
};
const reload = vi.fn();
class ContextChannel {
  static current: ContextChannel;
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  postMessage = vi.fn();
  close = vi.fn();
  constructor() {
    ContextChannel.current = this;
  }
}
function mount(initialSession: SessionSnapshot | null = initial) {
  const element = ConsoleSessionProvider({
    children: null,
    initialSession,
  });
  const cleanup = harness.effects[0]?.();
  const value = (
    element as React.ReactElement<{
      value: { refreshSession: () => Promise<SessionSnapshot> };
    }>
  ).props.value;
  return { ...value, channel: ContextChannel.current, cleanup };
}
beforeEach(() => {
  harness.effects.length = 0;
  vi.clearAllMocks();
  harness.restore.mockReset();
  vi.stubGlobal("React", React);
  vi.stubGlobal("BroadcastChannel", ContextChannel);
  vi.stubGlobal("window", { location: { reload } });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

// ============================================================================
// Changed scope invalidates panels; defaults and stale requests cannot switch it.
// ============================================================================
describe("Console session context synchronization", () => {
  it("suppresses timer and focus reads only while negotiated event sync is active", async () => {
    const browser = new EventTarget();
    const page = new EventTarget();
    let timer!: () => void;
    vi.stubGlobal(
      "window",
      Object.assign(browser, {
        location: { reload },
        setInterval: vi.fn((callback: () => void) => {
          timer = callback;
          return 1;
        }),
        clearInterval: vi.fn(),
      }),
    );
    vi.stubGlobal(
      "document",
      Object.assign(page, { visibilityState: "visible" }),
    );
    mount();
    const cleanup = harness.effects[2]?.();
    harness.effects[3]?.();
    const mode = harness.events.mock.calls[0]![1] as (active: boolean) => void;
    harness.restore.mockResolvedValue(initial);
    mode(true);
    timer();
    browser.dispatchEvent(new Event("focus"));
    page.dispatchEvent(new Event("visibilitychange"));
    expect(harness.restore).not.toHaveBeenCalled();
    mode(false);
    timer();
    await Promise.resolve();
    expect(harness.restore).toHaveBeenCalledOnce();
    if (typeof cleanup === "function") cleanup();
  });
  it("applies an SSE-triggered anonymous snapshot and rejects an older authenticated response", async () => {
    const f = mount();
    harness.effects[3]?.();
    const reconcile = harness.events.mock.calls[0]![0] as () => Promise<string>;
    let finish!: (snapshot: SessionSnapshot) => void;
    harness.restore.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const old = f.refreshSession();
    const anonymous: SessionSnapshot = {
      isAuthenticated: false,
      user: null,
      tenant: null,
      tenantOptions: [],
      capabilities: [],
    };
    harness.restore.mockResolvedValueOnce(anonymous);
    expect(await reconcile()).toBe("anonymous");
    finish(initial);
    expect(await old).toEqual(anonymous);
    expect(harness.writeState).toHaveBeenCalledWith(anonymous);
  });

  it("keeps a new account selected when an old connection asks for a recheck", async () => {
    mount();
    harness.effects[3]?.();
    const reconcile = harness.events.mock.calls[0]![0] as () => Promise<string>;
    harness.restore.mockResolvedValue({
      ...initial,
      user: { ...initial.user!, id: "new-user" },
    });
    expect(await reconcile()).toBe("active");
    expect(reload).toHaveBeenCalledOnce();
  });

  it("reports unavailable to the stream when the view cannot be verified", async () => {
    mount();
    harness.effects[3]?.();
    const reconcile = harness.events.mock.calls[0]![0] as () => Promise<string>;
    harness.restore.mockRejectedValue(new Error("HTTP 503"));
    expect(await reconcile()).toBe("unavailable");
    expect(reload).not.toHaveBeenCalled();
  });
  it("preserves the current identity when a manual refresh fails", async () => {
    const f = mount();
    harness.restore.mockRejectedValue(new Error("HTTP 503"));
    expect(await f.refreshSession()).toEqual(initial);
    expect(
      harness.writeState.mock.calls.every(
        ([value]) => typeof value === "string",
      ),
    ).toBe(true);
    expect(reload).not.toHaveBeenCalled();
  });

  it("accepts an explicit anonymous snapshot after confirmed session absence", async () => {
    const f = mount();
    const anonymous: SessionSnapshot = {
      isAuthenticated: false,
      user: null,
      tenant: null,
      tenantOptions: [],
      capabilities: [],
    };
    harness.restore.mockResolvedValue(anonymous);
    expect(await f.refreshSession()).toEqual(anonymous);
    expect(harness.writeState).toHaveBeenCalledWith(anonymous);
  });

  it("does not start silent login when the initial session request fails", async () => {
    const replace = vi.fn();
    vi.stubGlobal("window", { location: { search: "", replace } });
    mount(null);
    harness.restore.mockRejectedValue(new Error("Network unavailable"));
    harness.effects[1]?.();
    await vi.waitFor(() =>
      expect(harness.writeState).toHaveBeenCalledWith("ready"),
    );
    expect(replace).not.toHaveBeenCalled();
  });

  it("reloads panel caches after a change to a non-default workspace", async () => {
    const f = mount();
    harness.restore.mockResolvedValue({
      ...initial,
      tenant: { ...initial.tenant!, workspace: "second" },
    });
    await f.refreshSession();
    expect(reload).toHaveBeenCalledOnce();
    expect(f.channel.postMessage).toHaveBeenCalledWith(
      JSON.stringify(["user", "team", "second"]),
    );
  });

  it("updates default metadata without treating it as a current scope switch", async () => {
    const f = mount();
    const updated = {
      ...initial,
      tenantOptions: [{ ...initial.tenant!, isDefault: true }],
    };
    harness.restore.mockResolvedValue(updated);
    await f.refreshSession();
    expect(reload).not.toHaveBeenCalled();
    expect(harness.writeState).toHaveBeenCalledWith(updated);
  });

  it("ignores a late restore response after a newer request has completed", async () => {
    const f = mount();
    let finishOld!: (snapshot: SessionSnapshot) => void;
    harness.restore.mockReturnValueOnce(
      new Promise((resolve) => {
        finishOld = resolve;
      }),
    );
    harness.restore.mockResolvedValueOnce(initial);
    const oldRequest = f.refreshSession();
    await f.refreshSession();
    finishOld({
      ...initial,
      tenant: { ...initial.tenant!, workspace: "stale" },
    });
    expect(await oldRequest).toEqual(initial);
    expect(reload).not.toHaveBeenCalled();
    expect(f.channel.postMessage).toHaveBeenCalledTimes(1);
  });

  it("uses other tabs only as invalidation signals and closes the channel", () => {
    const f = mount();
    const receive = (data: unknown) =>
      f.channel.onmessage?.({ data } as MessageEvent<unknown>);
    receive(JSON.stringify(["user", "team", "first"]));
    receive({ accessToken: "untrusted" });
    expect(reload).not.toHaveBeenCalled();
    receive(JSON.stringify(["user", "team", "second"]));
    expect(reload).toHaveBeenCalledOnce();
    expect(harness.writeState).not.toHaveBeenCalled();
    if (typeof f.cleanup === "function") f.cleanup();
    expect(f.channel.close).toHaveBeenCalledOnce();
  });
});
