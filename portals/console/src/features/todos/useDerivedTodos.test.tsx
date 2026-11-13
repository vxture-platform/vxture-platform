/**
 * Incoming invitations remain available without outgoing invitations or tenant permissions.
 * @package @vxture/console
 * @layer Presentation
 * @category test
 * @author AI-Generated
 * @date 2026-11-13
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { useDerivedTodos, type TodoItem } from "./useDerivedTodos";

const fixture = vi.hoisted(() => ({
  sources: {
    orders: [],
    subs: [],
    addonOrders: [],
    quota: null,
    pendingInvites: 0,
    incoming: [] as Array<{
      id: string;
      tenantName: string;
      inviterName: string;
      roleCode: string;
      expiresAt: string;
    }>,
  },
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: (initial: unknown) =>
      initial !== null && typeof initial === "object" && "incoming" in initial
        ? [fixture.sources, vi.fn()]
        : actual.useState(initial),
  };
});
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock("@/features/session/ConsoleSessionProvider", () => ({
  useConsoleSession: () => ({ session: { capabilities: [], tenant: null } }),
}));
vi.mock("@/lib/use-date-format", () => ({
  useDateFormat: () => ({ fmtDate: (value: string) => value }),
}));
vi.mock("@/api/console-bff", () => ({}));

function todos() {
  let result: TodoItem[] = [];
  function Probe() {
    result = useDerivedTodos().todos;
    return null;
  }
  renderToStaticMarkup(<Probe />);
  return result;
}

beforeEach(() => {
  fixture.sources.pendingInvites = 0;
  fixture.sources.incoming = [
    {
      id: "received-1",
      tenantName: "Example Organization",
      inviterName: "Owner",
      roleCode: "member",
      expiresAt: "2026-11-20T00:00:00Z",
    },
  ];
});

describe("received invitation todos", () => {
  it("shows received invitations to ordinary users with no outgoing invitations", () => {
    expect(todos()).toEqual([
      expect.objectContaining({
        kind: "invitation_incoming",
        href: "/memberships#invitations",
      }),
    ]);
  });

  it("keeps received and outgoing invitation destinations separate", () => {
    fixture.sources.pendingInvites = 2;
    expect(todos().map(({ kind, href }) => ({ kind, href }))).toEqual([
      { kind: "invitation_incoming", href: "/memberships#invitations" },
      { kind: "invitation", href: "/members/invitations" },
    ]);
  });

  it("does not invent received invitations when only outgoing invitations exist", () => {
    fixture.sources.incoming = [];
    fixture.sources.pendingInvites = 1;
    expect(todos().map((todo) => todo.kind)).toEqual(["invitation"]);
  });
});
