/**
 * @vitest-environment jsdom
 * WorkPortal foreground reconciliation regression tests.
 * @package @vxture/workbench
 * @layer Presentation
 * @category test
 * @author AI-Generated
 * @date 2026-11-12
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LoadResult, WorkData, WorkRuntime } from "../../lib/contracts";
import type { HomeCopy } from "../../lib/presentation";

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  login: vi.fn(),
}));
vi.mock("../../lib/api", () => ({
  loadWorkData: mocks.load,
}));
vi.mock("../../lib/navigation", () => ({ authNavigation: mocks.login }));
vi.mock("../../lib/locale", () => ({
  useWorkLocale: () => ({ locale: "zh-CN", t: (value: string) => value }),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
vi.mock("next/link", () => ({
  default: ({ children }: React.PropsWithChildren) => children,
}));
vi.mock("@vxture/design-system", () => ({
  Button: ({
    children,
    disabled,
    asChild,
  }: React.PropsWithChildren<{ disabled?: boolean; asChild?: boolean }>) =>
    asChild ? children : React.createElement("button", { disabled }, children),
  Drawer: ({
    open,
    children,
    footer,
  }: React.PropsWithChildren<{ open: boolean; footer: React.ReactNode }>) =>
    open
      ? React.createElement(
          "section",
          { "data-testid": "drawer" },
          children,
          footer,
        )
      : null,
  ToastProvider: ({ children }: React.PropsWithChildren) => children,
  Icon: () => null,
  SegmentedControl: () => null,
  ShellFooter: () => React.createElement("footer", null, "Legal information"),
}));
vi.mock("./WorkHeader", () => ({ WorkHeader: () => null }));
vi.mock("./TitleRegion", () => ({ TitleRegion: () => "Verified workspace" }));
vi.mock("./LoginPage", () => ({ LoginPage: () => "Anonymous" }));
vi.mock("./AppCatalog", () => ({
  AppCard: ({
    app,
    onOverview,
  }: {
    app: { name: string };
    onOverview: (app: unknown) => void;
  }) =>
    React.createElement(
      "button",
      { "data-testid": "overview", onClick: () => onOverview(app) },
      app.name,
    ),
  AppCatalog: () => null,
}));
vi.mock("./NotificationDrawer", () => ({ NotificationDrawer: () => null }));
vi.mock("./use-app-activity", () => ({
  useAppActivity: (data: WorkData | null) => ({
    apps: data?.catalog.status === "ready" ? data.catalog.data : [],
    view: "favorites",
    enabled: true,
    result: { status: "ready" },
  }),
}));
import { WorkPortal } from "./WorkPortal";

// ============================================================================
// Identity and controlled background reads
// ============================================================================
const ready: LoadResult<WorkData> = {
  status: "ready",
  data: {
    user: { id: "alice", name: "Alice", email: "", phone: "", picture: null },
    scope: {
      id: "tenant",
      name: "Tenant",
      workspace: "default",
      workspaceName: "Default",
      personal: false,
    },
    catalog: { status: "ready", data: [] },
    scopeOptions: { status: "ready", data: [] },
    workspaces: { status: "ready", data: [] },
    availabilityIssue: null,
    resources: { status: "error", code: 503, message: "Unavailable" },
    balance: { status: "ready", data: "100" },
    monthlyBill: { status: "ready", data: "0" },
  },
};
const anonymous = { status: "error", code: 401, message: "Sign in" } as const;
const runtime: WorkRuntime = {
  authConfigured: true,
  catalogConfigured: true,
  websiteUrl: "https://vxture.com",
  consoleUrl: "https://console.vxture.com",
};
let host: HTMLDivElement;
let root: Root;
let now: number;
let stream: ReadableStreamDefaultController<Uint8Array>;
async function emit(name: string, reason: string) {
  await act(async () => {
    stream.enqueue(
      new TextEncoder().encode(
        `event: ${name}\ndata: ${JSON.stringify({ reason })}\n\n`,
      ),
    );
  });
}
async function foreground() {
  now += 2000;
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
  });
}
async function mount() {
  await act(async () => {
    root.render(
      React.createElement(WorkPortal, {
        runtime,
        copy: {
          titles: ["Hello"],
          fallback: "Hello",
          appLimit: 6,
        } satisfies HomeCopy,
        initialTime: "2026-11-12T00:00:00Z",
      }),
    );
  });
}
beforeEach(() => {
  vi.stubGlobal("React", React);
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
  now = 1_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
  window.history.replaceState(null, "", "/?vx_sso_checked=1");
  sessionStorage.clear();
  mocks.load.mockReset().mockResolvedValue(ready);
  mocks.login.mockReset().mockReturnValue("/auth/login");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ============================================================================
// Reconciliation must not turn a background check into navigation or blank UI
// ============================================================================
describe("WorkPortal session reconciliation", () => {
  it("checks the browser's central identity before loading a fresh document", async () => {
    window.history.replaceState(null, "", "/");
    await mount();
    expect(mocks.login).toHaveBeenCalledWith(
      "login",
      expect.stringContaining("vx_sso_checked=1"),
      expect.objectContaining({ prompt: "none" }),
    );
    expect(mocks.load).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain("Verified workspace");
  });

  it("retains the workspace during a pending refresh and transient failures", async () => {
    await mount();
    let resolveRead!: (value: LoadResult<WorkData>) => void;
    mocks.load.mockImplementationOnce(
      () =>
        new Promise<LoadResult<WorkData>>((resolve) => {
          resolveRead = resolve;
        }),
    );
    await foreground();
    expect(host.textContent).toContain("Verified workspace");
    await act(async () => resolveRead(ready));
    mocks.load.mockResolvedValueOnce({
      status: "error",
      code: 503,
      message: "连接失败",
    });
    await foreground();
    expect(host.textContent).toContain("Verified workspace");
    expect(host.textContent).toContain("连接失败");
  });

  it("clears a confirmed expired session without repeated silent redirects", async () => {
    await mount();
    mocks.load.mockResolvedValue(anonymous);
    await foreground();
    expect(host.textContent).toContain("Anonymous");
    expect(host.textContent).not.toContain("Verified workspace");
    await foreground();
    await foreground();
    expect(mocks.load).toHaveBeenCalledTimes(4);
    expect(mocks.login).not.toHaveBeenCalled();
  });

  it("retires periodic and foreground reads after SSE negotiation", async () => {
    vi.useFakeTimers();
    await mount();
    await emit("resync-required", "connected");
    for (let i = 0; i < 13; i++) {
      now += 25000;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(25000);
        stream.enqueue(new TextEncoder().encode(": heartbeat\n\n"));
        window.dispatchEvent(new Event("focus"));
      });
    }
    expect(mocks.load).toHaveBeenCalledTimes(2);
    mocks.load.mockResolvedValue(anonymous);
    await emit("session-ended", "revoked");
    expect(host.textContent).toContain("Anonymous");
    expect(host.textContent).not.toContain("Verified workspace");
    expect(mocks.login).not.toHaveBeenCalled();
  });
  it("reads again after an older request when logout arrives concurrently", async () => {
    await mount();
    let finishRead!: (value: LoadResult<WorkData>) => void;
    mocks.load.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishRead = resolve;
        }),
    );
    await foreground();
    await emit("session-ended", "revoked");
    expect(mocks.load).toHaveBeenCalledTimes(2);
    mocks.load.mockResolvedValue(anonymous);
    await act(async () => finishRead(ready));
    expect(mocks.load).toHaveBeenCalledTimes(3);
    expect(host.textContent).toContain("Anonymous");
    expect(host.textContent).not.toContain("Verified workspace");
  });
  it("retains identity on outages and skips hidden compatibility reads", async () => {
    vi.useFakeTimers();
    await mount();
    mocks.load.mockResolvedValue({
      status: "error",
      code: 503,
      message: "Unavailable",
    });
    await emit("access-changed", "access-changed");
    expect(host.textContent).toContain("Verified workspace");
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    now += 300000;
    await act(async () => vi.advanceTimersByTimeAsync(300000));
    expect(mocks.load).toHaveBeenCalledTimes(2);
  });
  it("updates authorization from events even while hidden", async () => {
    await mount();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    mocks.load.mockResolvedValue(anonymous);
    await emit("session-ended", "revoked");
    expect(host.textContent).toContain("Anonymous");
    expect(mocks.login).not.toHaveBeenCalled();
  });

  it("keeps a failed silent callback anonymous on later foreground checks", async () => {
    window.history.replaceState(null, "", "/?vx_sso_silent=0");
    mocks.load.mockResolvedValue(anonymous);
    await mount();
    expect(window.location.search).toBe("");
    await foreground();
    await foreground();
    expect(host.textContent).toContain("Anonymous");
    expect(mocks.login).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Drawer authorization is derived from fresh data, never the opening snapshot
// ============================================================================
it("removes an open drawer's launch link when refreshed membership access is revoked", async () => {
  if (ready.status !== "ready") throw new Error("fixture");
  const app = {
    code: "agent",
    name: "Agent",
    brand: "",
    description: "",
    category: "agent" as const,
    version: "1",
    stage: "stable",
    tier: null,
    icon: null,
    href: "https://registered.example/",
    available: true,
    availabilityLabel: "可使用",
  };
  const current = {
    ...ready.data,
    catalog: { status: "ready" as const, data: [app] },
  };
  mocks.load.mockResolvedValue({ status: "ready", data: current });
  await mount();
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[data-testid="overview"]')?.click(),
  );
  expect(
    host.querySelector(
      '[data-testid="drawer"] a[href="https://registered.example/"]',
    ),
  ).not.toBeNull();
  mocks.load.mockResolvedValue({
    status: "ready",
    data: {
      ...current,
      catalog: {
        status: "ready",
        data: [
          { ...app, available: false, availabilityLabel: "联系管理员授权" },
        ],
      },
    },
  });
  await foreground();
  const drawer = host.querySelector('[data-testid="drawer"]');
  expect(drawer?.textContent).toContain("联系管理员授权");
  expect(
    drawer?.querySelector('a[href="https://registered.example/"]'),
  ).toBeNull();
  expect(drawer?.querySelector("button[disabled]")).not.toBeNull();
});
