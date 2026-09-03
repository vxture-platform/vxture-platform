import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { broadcastAnnouncements } from "./announcements";
import type { NotificationDispatcher } from "./dispatcher";

function fakePool(tenantsByAnnouncement: Record<string, string[]>) {
  const marked: unknown[][] = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes("from admin.announcements")) {
      return {
        rows: Object.keys(tenantsByAnnouncement).map((id) => ({
          id,
          title: `A ${id}`,
          content: "body",
          cta_url: id === "a2" ? "https://x.test/a2" : null,
          target_plans: id === "a2" ? ["arda-pro"] : null,
          target_tenant_types: [],
        })),
        rowCount: 1,
      };
    }
    if (sql.includes("from tenancy.tenants t")) {
      // the tenant query is per announcement; identify it by the plans param
      const plans = params[1] as string[];
      const id = plans.length > 0 ? "a2" : "a1";
      return {
        rows: tenantsByAnnouncement[id]!.map((t) => ({ id: t })),
        rowCount: 1,
      };
    }
    if (sql.includes("update admin.announcements")) {
      marked.push(params);
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`unexpected sql: ${sql}`);
  });
  return { pool: { query } as unknown as Pool, marked };
}

describe("broadcastAnnouncements", () => {
  it("fans out one notify per targeted tenant and stamps meta.broadcast_at with counts", async () => {
    const f = fakePool({ a1: ["t-1", "t-2"], a2: ["t-3"] });
    const notify = vi.fn(async () => ({
      inboxCreated: 1,
      emailsSent: 0,
      emailsFailed: 0,
      skipped: 0,
    }));
    const dispatcher = { notify } as unknown as NotificationDispatcher;
    const s = await broadcastAnnouncements(f.pool, dispatcher);
    expect(s).toEqual({
      announcements: 2,
      tenants: 3,
      inboxCreated: 3,
      emailsSent: 0,
    });
    expect(notify).toHaveBeenCalledTimes(3);
    const calls = notify.mock.calls as unknown as {
      tenantId: string;
      templateCode: string;
      link?: string;
      params: Record<string, string>;
    }[][];
    const a2Call = calls.find((c) => c[0]!.tenantId === "t-3")![0]!;
    expect(a2Call.templateCode).toBe("announcement.published");
    expect(a2Call.link).toBe("https://x.test/a2");
    expect(a2Call.params.title).toBe("A a2");
    expect(f.marked.map((p) => p[0])).toEqual(["a1", "a2"]);
    expect(f.marked[0]!.slice(1)).toEqual([2, 2, 0]);
  });

  it("no pending announcements → no writes", async () => {
    const f = fakePool({});
    const notify = vi.fn();
    const s = await broadcastAnnouncements(f.pool, {
      notify,
    } as unknown as NotificationDispatcher);
    expect(s.announcements).toBe(0);
    expect(notify).not.toHaveBeenCalled();
    expect(f.marked).toEqual([]);
  });
});
