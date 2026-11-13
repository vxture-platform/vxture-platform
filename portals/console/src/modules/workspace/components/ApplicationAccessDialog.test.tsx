/**
 * Subscription assignments cannot silently move to a different workspace.
 * @package @vxture/console
 * @layer Presentation
 * @category test
 * @author AI-Generated
 * @date 2026-11-13
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { ApplicationAccessDialog } from "./ApplicationAccessDialog";
import type { ConsoleWorkspace } from "@/api/console-bff";

// ============================================================================
// Run the data-loading effect against controlled responses, then render its state.
// ============================================================================
const f = vi.hoisted(() => ({
  states: [] as unknown[],
  index: 0,
  effects: [] as Array<() => (() => void) | void>,
  workspaces: vi.fn<() => Promise<ConsoleWorkspace[]>>(),
  members: vi.fn(async () => []),
  seatProps: null as null | {
    workspaceId: string;
    productCode?: string;
    targetMemberId?: string;
  },
}));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: (initial: unknown) => {
      const slot = f.index++;
      if (!(slot in f.states)) f.states[slot] = initial;
      return [
        f.states[slot],
        (next: unknown) => {
          f.states[slot] =
            typeof next === "function" ? next(f.states[slot]) : next;
        },
      ];
    },
    useEffect: (effect: () => (() => void) | void) => {
      f.effects.push(effect);
    },
  };
});
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/api/console-bff", () => ({
  fetchWorkspaces: () => f.workspaces(),
  fetchMembers: () => f.members(),
}));
vi.mock("@vxture/design-system", () => ({
  DialogForm: ({ children }: { children: ReactNode }) => (
    <section>{children}</section>
  ),
  Banner: ({ title }: { title: string }) => <p>{title}</p>,
  Button: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  NativeSelect: () => null,
}));
vi.mock("./WorkspaceProductSeatsDialog", () => ({
  WorkspaceProductSeatsDialog: (props: NonNullable<typeof f.seatProps>) => {
    f.seatProps = props;
    return <p>{props.workspaceId}</p>;
  },
}));
const active = (id: string, status = "active") =>
  ({ id, name: id, status }) as ConsoleWorkspace;
function render(workspaceId: string, productCode?: string) {
  f.index = 0;
  f.effects = [];
  f.seatProps = null;
  return renderToStaticMarkup(
    <ApplicationAccessDialog
      workspaceId={workspaceId}
      {...(productCode ? { productCode } : { memberId: "member" })}
      onClose={() => {}}
    />,
  );
}
async function load(workspaceId: string, productCode?: string) {
  render(workspaceId, productCode);
  const cleanup = f.effects[0]!();
  await new Promise<void>((resolve) => setImmediate(resolve));
  return { html: render(workspaceId, productCode), cleanup };
}
beforeEach(() => {
  vi.clearAllMocks();
  f.states = [];
  f.index = 0;
  f.effects = [];
  f.seatProps = null;
  f.workspaces.mockResolvedValue([active("first"), active("requested")]);
});
describe("application authorization workspace", () => {
  it("keeps the requested subscription workspace even when another workspace appears first", async () => {
    await load("requested", "cospace");
    expect(f.seatProps).toMatchObject({
      workspaceId: "requested",
      productCode: "cospace",
    });
  });
  it.each([
    { workspaces: [] },
    { workspaces: [active("first")] },
    { workspaces: [active("first"), active("requested", "archived")] },
  ])(
    "does not substitute an unavailable subscription workspace %#",
    async ({ workspaces }) => {
      f.workspaces.mockResolvedValue(workspaces);
      const { html } = await load("requested", "cospace");
      expect(html).toContain("workspaceUnavailable");
      expect(f.seatProps).toBeNull();
    },
  );
  it("allows member management to select an available workspace when none was preselected", async () => {
    await load("");
    expect(f.seatProps).toMatchObject({
      workspaceId: "first",
      targetMemberId: "member",
    });
  });
  it("does not expose assignment controls after the roster fails to load", async () => {
    f.workspaces.mockRejectedValue(new Error("unavailable"));
    const { html } = await load("requested", "cospace");
    expect(html).toContain("loadFailed");
    expect(f.seatProps).toBeNull();
  });
  it("ignores a late response after the dialog closes", async () => {
    let complete!: (rows: ConsoleWorkspace[]) => void;
    f.workspaces.mockReturnValue(
      new Promise((resolve) => {
        complete = resolve;
      }),
    );
    render("requested", "cospace");
    const cleanup = f.effects[0]!();
    cleanup?.();
    complete([active("requested")]);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(render("requested", "cospace")).toContain("loading");
    expect(f.seatProps).toBeNull();
  });
});
