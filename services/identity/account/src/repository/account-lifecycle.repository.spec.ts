/**
 * Lifecycle fencing, durable checkpoints and failure scheduling.
 * @package @vxture/service-account
 * @layer Domain
 * @category test
 * @author AI-Generated
 * @date 2026-11-07
 */
import { describe, it, expect, vi } from "vitest";
import { AccountLifecycleRepository } from "./account-lifecycle.repository";

// ============================================================================
// Locked account transaction and independent checkpoint connection
// ============================================================================
function build(eligible = true) {
  const row = {
    id: "op",
    user_id: "user",
    status: "pending",
    attempts: 0,
    payload: { sessions: [{ sid: "sid", clients: null }] },
  };
  const query = vi.fn(async (sql: string, _params?: unknown[]) => ({
    rows: sql.includes("from account.users") && eligible ? [row] : [],
    rowCount: 1,
  }));
  const checkpoint = vi.fn(async (_sql: string, _params?: unknown[]) => ({
    rows: [],
    rowCount: 1,
  }));
  const release = vi.fn();
  const repo = new AccountLifecycleRepository({
    query: checkpoint,
    connect: async () => ({ query, release }),
  } as never);
  return { repo, query, checkpoint, release };
}
describe("durable lifecycle worker", () => {
  it("rejects a single-connection pool before taking an account lock", async () => {
    const connect = vi.fn();
    const repo = new AccountLifecycleRepository({
      options: { max: 1 },
      connect,
    } as never);
    await expect(repo.run("op", vi.fn())).rejects.toThrow(
      "at least two pool connections",
    );
    expect(connect).not.toHaveBeenCalled();
  });
  it("locks the account, checkpoints recipients independently and completes only after work", async () => {
    const f = build();
    await f.repo.run("op", async (op, save) => {
      op.payload.sessions[0]!.clients = ["console"];
      await save(op.payload);
      expect(f.checkpoint).toHaveBeenCalledOnce();
    });
    expect(f.query.mock.calls[1]![0]).toContain(
      "for no key update of u skip locked",
    );
    expect(f.query.mock.calls[1]![0]).toContain(
      "l.deletion_requested_at=u.deletion_requested_at",
    );
    expect(f.checkpoint.mock.calls[0]![1]).toEqual([
      "op",
      JSON.stringify({ sessions: [{ sid: "sid", clients: ["console"] }] }),
    ]);
    expect(f.checkpoint.mock.calls[1]![0]).toContain(
      "then 'purge_ready' else 'completed'",
    );
    expect(f.query.mock.calls.at(-1)![0]).toBe("commit");
    expect(f.release).toHaveBeenCalledOnce();
  });
  it("keeps checkpointed recipients on adapter failure and schedules a bounded retry", async () => {
    const f = build();
    await expect(
      f.repo.run("op", async (op, save) => {
        await save(op.payload);
        throw new Error("RP unavailable");
      }),
    ).rejects.toThrow("RP unavailable");
    expect(f.checkpoint.mock.calls).toHaveLength(2);
    expect(f.checkpoint.mock.calls[1]![0]).toContain(
      "status='pending',attempts=attempts+1",
    );
    expect(f.checkpoint.mock.calls[1]![0]).toContain("least(3600");
    expect(f.query.mock.calls.at(-1)![0]).toBe("rollback");
  });
  it("does no work after recovery, on a stale request or while another worker holds the account", async () => {
    const f = build(false);
    const work = vi.fn();
    expect(await f.repo.run("op", work)).toBe(false);
    expect(work).not.toHaveBeenCalled();
    expect(f.checkpoint).not.toHaveBeenCalled();
    expect(f.release).toHaveBeenCalledOnce();
  });
  it("releases the account lock even if retry persistence also fails", async () => {
    const f = build();
    f.checkpoint.mockRejectedValue(new Error("DB down"));
    await expect(
      f.repo.run("op", async () => {
        throw new Error("RP down");
      }),
    ).rejects.toThrow();
    expect(f.query.mock.calls.at(-1)![0]).toBe("rollback");
    expect(f.release).toHaveBeenCalledOnce();
  });
  it("rechecks completed requests when retention expires", async () => {
    const f = build();
    await f.repo.listPending(500);
    expect(f.checkpoint.mock.calls[0]![0]).toContain("l.status='completed'");
    expect(f.checkpoint.mock.calls[0]![0]).toContain(
      "u.deletion_requested_at=l.deletion_requested_at",
    );
    expect(f.checkpoint.mock.calls[0]![1]).toEqual([100]);
  });
});
