/**
 * Application assignments reuse workspace membership and the shared seat limit.
 * @package @vxture/console
 * @layer Presentation
 * @category test
 * @author AI-Generated
 * @date 2026-11-13
 */
import { beforeEach, describe, it, expect, vi } from "vitest";
import {
  createElement,
  type ReactNode,
  type ButtonHTMLAttributes,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkspaceProductSeatsDialog } from "./WorkspaceProductSeatsDialog";
import type { MemberRecord } from "@/entities/console";
import type { ProductSeatRow } from "@/api/console-bff";
const f = vi.hoisted(() => ({
  index: 0,
  rows: [] as ProductSeatRow[],
  buttons: [] as ButtonHTMLAttributes<HTMLButtonElement>[],
  grant: vi.fn(async () => {}),
  join: vi.fn(async () => {}),
  read: vi.fn(async () => []),
}));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: (initial: unknown) => {
      const index = f.index++;
      return index === 0
        ? [f.rows, vi.fn()]
        : index < 5
          ? [initial, vi.fn()]
          : actual.useState(initial);
    },
  };
});
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? key + JSON.stringify(values) : key,
}));
vi.mock("@vxture/design-system", () => ({
  DialogForm: ({ children }: { children: ReactNode }) => (
    <section>{children}</section>
  ),
  Banner: ({ title }: { title: string }) => <p>{title}</p>,
  EmptyState: ({ title }: { title: string }) => <p>{title}</p>,
  StatusBadge: ({ children }: { children: ReactNode }) => (
    <span>{children}</span>
  ),
  NativeSelect: ({
    children,
    ...props
  }: import("react").SelectHTMLAttributes<HTMLSelectElement>) =>
    createElement("select", props, children),
  Button: (props: ButtonHTMLAttributes<HTMLButtonElement>) => {
    f.buttons.push(props);
    return createElement("button", props);
  },
}));
vi.mock("@/api/console-bff", () => ({
  ConsoleBffError: class extends Error {},
  PRODUCT_SEAT_ERROR_CODES: [],
  fetchProductSeats: () => f.read(),
  grantProductSeat: (...args: unknown[]) => f.grant(...(args as [])),
  revokeProductSeat: vi.fn(),
  addWorkspaceMember: (...args: unknown[]) => f.join(...(args as [])),
}));
const member = (
  id: string,
  inWorkspace = true,
  status: MemberRecord["status"] = "Active",
) =>
  ({
    accountId: id,
    name: id,
    status,
    workspaces: inWorkspace ? [{ id: "workspace" }] : [],
  }) as MemberRecord;
function render(
  members: MemberRecord[],
  targetMemberId?: string,
  onMembersChanged?: () => Promise<void>,
) {
  f.index = 0;
  f.buttons = [];
  return renderToStaticMarkup(
    <WorkspaceProductSeatsDialog
      workspaceId="workspace"
      workspaceName="Organization workspace"
      members={members}
      targetMemberId={targetMemberId}
      onClose={() => {}}
      {...(onMembersChanged ? { onMembersChanged } : {})}
    />,
  );
}
function button(label: string) {
  return f.buttons.find((b) => b.children === label)!;
}
beforeEach(() => {
  vi.clearAllMocks();
  f.rows = [
    {
      productId: "product",
      productCode: "cospace",
      productName: "CoSpace",
      subscriptionId: "subscription",
      seatMax: 5,
      occupied: 1,
      holders: [
        {
          userId: "owner",
          userNo: "1234567890",
          displayName: "Owner",
          grantedAt: "2026-11-13",
        },
      ],
    },
  ];
});
describe("application assignments", () => {
  it("shows the selected member's empty authorization and grants that member directly", async () => {
    const html = render(
      [
        member("owner"),
        member("invitee"),
        member("suspended", true, "Suspended"),
      ],
      "invitee",
    );
    expect(html).toContain("memberUnassigned");
    expect(html).not.toContain(">Owner<");
    expect(html).not.toContain('value="suspended"');
    expect(button("assign").disabled).toBe(false);
    await button("assign").onClick?.({} as never);
    expect(f.grant).toHaveBeenCalledWith("workspace", "product", "invitee");
  });
  it("requires workspace membership before assigning a seat", async () => {
    const changed = vi.fn(async () => {});
    const html = render([member("invitee", false)], "invitee", changed);
    expect(html).toContain("notInWorkspace");
    expect(button("assign").disabled).toBe(true);
    await button("joinWorkspace").onClick?.({} as never);
    expect(f.join).toHaveBeenCalledWith("workspace", "invitee");
    expect(changed).toHaveBeenCalledOnce();
    expect(f.grant).not.toHaveBeenCalled();
  });
  it("disables grants at the subscription limit", () => {
    f.rows[0]!.occupied = 5;
    expect(render([member("invitee")], "invitee")).toContain("fullHint");
    expect(button("assign").disabled).toBe(true);
  });
  it("does not offer another member as a candidate in member-specific mode", () => {
    const html = render([member("invitee"), member("other")], "invitee");
    expect(html).toContain('value="invitee"');
    expect(html).not.toContain('value="other"');
  });
});
