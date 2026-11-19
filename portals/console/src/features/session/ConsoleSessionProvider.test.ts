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
  probe: vi.fn<() => Promise<boolean>>(),
  restore: vi.fn<() => Promise<SessionSnapshot>>(),
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
  hasActiveSession: harness.probe,
  buildLogoutUrl: vi.fn(),
  buildRpLoginUrl: vi.fn(),
  buildTenantSwitchUrl: vi.fn(),
  buildWorkspaceSwitchUrl: vi.fn(),
}));

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
function mount() {
  const element = ConsoleSessionProvider({
    children: null,
    initialSession: initial,
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
  harness.probe.mockReset();
  vi.stubGlobal("React", React);
  vi.stubGlobal("BroadcastChannel", ContextChannel);
  vi.stubGlobal("window", {
    location: { reload },
    setInterval: vi.fn(),
    clearInterval: vi.fn(),
  });
  vi.stubGlobal("document", { visibilityState: "visible" });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

// ============================================================================
// Changed scope invalidates panels; defaults and stale requests cannot switch it.
// ============================================================================
describe("Console session context synchronization", () => {
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

  it("does not restore authentication after the central session probe expires", async () => {
    const f = mount();
    let finishRestore!: (snapshot: SessionSnapshot) => void;
    harness.restore.mockReturnValueOnce(
      new Promise((resolve) => {
        finishRestore = resolve;
      }),
    );
    harness.probe.mockResolvedValueOnce(false);
    const pendingRestore = f.refreshSession();
    const cleanupProbe = harness.effects[3]?.();
    const probe = vi.mocked(window.setInterval).mock.calls[0]?.[0];
    if (typeof probe !== "function") throw new Error("missing session probe");
    probe();
    await vi.waitFor(() =>
      expect(harness.writeState).toHaveBeenCalledWith(
        expect.objectContaining({ isAuthenticated: false }),
      ),
    );
    finishRestore(initial);
    expect(await pendingRestore).toMatchObject({ isAuthenticated: false });
    expect(f.channel.postMessage).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    if (typeof cleanupProbe === "function") cleanupProbe();
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
