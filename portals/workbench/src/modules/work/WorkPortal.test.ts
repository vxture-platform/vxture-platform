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

const mocks = vi.hoisted(() => ({ load: vi.fn(), login: vi.fn() }));
vi.mock("../../lib/api", () => ({ loadWorkData: mocks.load }));
vi.mock("../../lib/navigation", () => ({ authNavigation: mocks.login }));
vi.mock("../../lib/locale", () => ({
  useWorkLocale: () => ({ locale: "zh-CN", t: (value: string) => value }),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
vi.mock("next/link", () => ({
  default: ({ children }: React.PropsWithChildren) => children,
}));
vi.mock("@vxture/design-system", () => ({
  Button: ({ children }: React.PropsWithChildren) => children,
  Drawer: () => null,
  Icon: () => null,
  SegmentedControl: () => null,
  ShellFooter: () => React.createElement("footer", null, "Legal information"),
}));
vi.mock("./WorkHeader", () => ({ WorkHeader: () => null }));
vi.mock("./TitleRegion", () => ({ TitleRegion: () => "Verified workspace" }));
vi.mock("./LoginPage", () => ({ LoginPage: () => "Anonymous" }));
vi.mock("./AppCatalog", () => ({
  AppCard: () => null,
  AppCatalog: () => null,
}));
vi.mock("./NotificationDrawer", () => ({ NotificationDrawer: () => null }));
vi.mock("./use-app-activity", () => ({
  useAppActivity: () => ({
    apps: [],
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
  now = 1_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
  window.history.replaceState(null, "", "/");
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ============================================================================
// Reconciliation must not turn a background check into navigation or blank UI
// ============================================================================
describe("WorkPortal session reconciliation", () => {
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
    mocks.load.mockRejectedValueOnce(new Error("offline"));
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
