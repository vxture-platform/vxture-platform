/**
 * @vitest-environment jsdom
 * Favorite persistence feedback and star rendering regression coverage.
 * @package @vxture/workbench
 * @layer Presentation
 * @category test
 * @author AI-Generated
 * @date 2026-11-13
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import type { WorkApp, WorkData } from "../../lib/contracts";

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  save: vi.fn(),
  toast: vi.fn(),
}));
vi.mock("../../lib/api", () => ({
  loadAppActivity: mocks.load,
  saveAppActivity: mocks.save,
}));
vi.mock("../../lib/locale", () => ({
  useWorkLocale: () => ({ t: (text: string) => text }),
}));
vi.mock("@vxture/design-system", () => ({
  useToast: () => ({ toast: mocks.toast }),
  Button: ({
    children,
    variant: _variant,
    size: _size,
    ...props
  }: React.PropsWithChildren<React.ButtonHTMLAttributes<HTMLButtonElement>> & {
    variant?: string;
    size?: string;
  }) => React.createElement("button", props, children),
  Badge: ({ children }: React.PropsWithChildren) =>
    React.createElement("span", null, children),
  Icon: ({ name, weight = "regular" }: { name: string; weight?: string }) =>
    React.createElement("svg", { "data-icon": name, "data-weight": weight }),
}));
import { useAppActivity } from "./use-app-activity";
import { AppCard } from "./AppCatalog";

// ============================================================================
// Controlled persistence and scope cancellation
// ============================================================================
const app: WorkApp = {
  code: "focus",
  name: "Focus",
  brand: "",
  description: "",
  category: "agent",
  version: "1",
  stage: "",
  tier: null,
  icon: null,
  href: "/focus",
  available: true,
  availabilityLabel: "",
};
const data: WorkData = {
  user: { id: "alice", name: "Alice", email: "", phone: "", picture: null },
  scope: {
    id: "tenant",
    name: "Tenant",
    workspace: "default",
    workspaceName: "Default",
    personal: false,
  },
  catalog: { status: "ready", data: [app] },
  scopeOptions: { status: "ready", data: [] },
  workspaces: { status: "ready", data: [] },
  availabilityIssue: null,
  resources: { status: "error", code: 503, message: "Unavailable" },
  balance: { status: "ready", data: "100" },
  monthlyBill: { status: "ready", data: "0" },
};
let host: HTMLDivElement;
let root: Root;
let activity: ReturnType<typeof useAppActivity>;
function Harness({ current = data }: { current?: WorkData }) {
  activity = useAppActivity(current);
  return null;
}
beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  mocks.load.mockResolvedValue({
    status: "ready",
    data: {
      view: "favorites",
      items: [
        { code: app.code, favorite: false, lastUsedAt: null, launches30d: 0 },
      ],
    },
  });
  mocks.save.mockResolvedValue(undefined);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function mount() {
  await act(async () => root.render(React.createElement(Harness)));
}

describe("favorite feedback", () => {
  it("notifies each saved toggle without leaving inline status text", async () => {
    await mount();
    await act(async () => activity.favorite(activity.apps[0]!));
    expect(activity.apps[0]!.favorite).toBe(true);
    expect(mocks.toast).toHaveBeenLastCalledWith({
      title: "已收藏Focus",
      tone: "success",
      duration: 3000,
    });
    await act(async () => activity.favorite(activity.apps[0]!));
    expect(activity.apps[0]!.favorite).toBe(false);
    expect(mocks.toast).toHaveBeenLastCalledWith({
      title: "已取消收藏Focus",
      tone: "success",
      duration: 3000,
    });
    expect(host.textContent).toBe("");
  });
  it("shows a failure notification and retains the saved favorite state", async () => {
    await mount();
    mocks.save.mockRejectedValueOnce(new Error("offline"));
    await act(async () => activity.favorite(activity.apps[0]!));
    expect(activity.apps[0]!.favorite).toBe(false);
    expect(mocks.toast).toHaveBeenCalledExactlyOnceWith({
      title: "操作未保存，请重试",
      tone: "danger",
      duration: 5000,
    });
    expect(activity.enabled).toBe(true);
  });
  it("does not notify or apply a late result after workspace changes", async () => {
    await mount();
    let complete!: () => void;
    mocks.save.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        }),
    );
    await act(async () => activity.favorite(activity.apps[0]!));
    await act(async () =>
      root.render(
        React.createElement(Harness, {
          current: { ...data, scope: { ...data.scope, workspace: "other" } },
        }),
      ),
    );
    await act(async () => complete());
    expect(mocks.toast).not.toHaveBeenCalled();
    expect(activity.apps[0]!.favorite).toBe(false);
  });
  it("uses the filled star variant only for saved favorites", async () => {
    for (const active of [false, true]) {
      await act(async () =>
        root.render(
          React.createElement(AppCard, {
            app: { ...app, favorite: active },
            onOverview: vi.fn(),
            onFavorite: vi.fn(),
            onLaunch: vi.fn(),
            favoritesEnabled: true,
          }),
        ),
      );
      expect(
        host.querySelector('[data-icon="star"]')?.getAttribute("data-weight"),
      ).toBe(active ? "fill" : "regular");
      expect(
        host.querySelector("[aria-pressed]")?.getAttribute("aria-pressed"),
      ).toBe(String(active));
    }
  });
});
