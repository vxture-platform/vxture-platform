/**
 * Central presence batching, isolation and unavailable-state semantics.
 * @package @vxture/bff-auth
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-19
 */
import { describe, expect, it, vi } from "vitest";
import { RedisService } from "./redis.service";

// ===== Real service with a bounded Redis command fake =====
const now = Math.floor(Date.now() / 1000);
const fields = ["usr_user1", "customer", String(now + 3600), String(now)];
function fixture(value: unknown = fields, count = 1) {
  const service = new RedisService(
    {} as ConstructorParameters<typeof RedisService>[0],
  );
  const hmget = vi.fn();
  const exec = vi
    .fn()
    .mockResolvedValue(Array.from({ length: count }, () => [null, value]));
  const pipeline = vi.fn(() => ({ hmget, exec }));
  Object.assign(service, {
    client: { status: "ready", pipeline },
    prefix: "test:",
  });
  return { service, pipeline, hmget, exec };
}

// ===== Central truth and failure handling =====
describe("customerPresence", () => {
  it("reads only the four required fields and never touches or scans sessions", async () => {
    const f = fixture();
    expect(
      await f.service.customerPresence([
        { userId: "user1", sessionIds: ["sid1"] },
      ]),
    ).toEqual([{ id: "user1", presence: "online" }]);
    expect(f.hmget).toHaveBeenCalledExactlyOnceWith(
      "test:sess:sid1",
      "sub",
      "realm",
      "absExpiresAt",
      "lastActiveAt",
    );
  });
  it.each([
    [[null, null, null, null], "offline"],
    [["usr_user1", "customer", String(now - 1), String(now)], "offline"],
    [
      ["usr_user1", "customer", String(now + 1000), String(now - 120)],
      "offline",
    ],
    [["usr_user1", "workforce", String(now + 1000), String(now)], "offline"],
    [["usr_other", "customer", String(now + 1000), String(now)], "offline"],
    [["usr_user1", "customer", "broken", String(now)], "unknown"],
  ])(
    "does not report online from stale, foreign or corrupt observations",
    async (value, expected) => {
      expect(
        await fixture(value).service.customerPresence([
          { userId: "user1", sessionIds: ["sid1"] },
        ]),
      ).toEqual([{ id: "user1", presence: expected }]);
    },
  );
  it("keeps truncated candidate sets unknown unless activity is proven", async () => {
    const f = fixture([null, null, null, null]);
    expect(
      await f.service.customerPresence([
        { userId: "user1", sessionIds: Array(21).fill("sid1") },
      ]),
    ).toEqual([{ id: "user1", presence: "unknown" }]);
    expect(f.hmget).toHaveBeenCalledTimes(1);
  });
  it("deduplicates candidates and uses bounded pipeline chunks", async () => {
    const f = fixture(fields, 128);
    f.exec
      .mockResolvedValueOnce(Array.from({ length: 128 }, () => [null, fields]))
      .mockResolvedValueOnce([[null, fields]]);
    const users = Array.from({ length: 129 }, (_, i) => ({
      userId: `user${i}`,
      sessionIds: [`sid${i}`],
    }));
    expect(await f.service.customerPresence(users)).toHaveLength(129);
    expect(f.pipeline).toHaveBeenCalledTimes(2);
    expect(f.hmget).toHaveBeenCalledTimes(129);
  });
  it("rejects partial or failed pipelines rather than asserting offline", async () => {
    const f = fixture();
    f.exec.mockResolvedValueOnce([]);
    await expect(
      f.service.customerPresence([{ userId: "user1", sessionIds: ["sid1"] }]),
    ).rejects.toThrow("Customer activity unavailable");
    f.exec.mockResolvedValueOnce([[new Error("redis failure"), null]]);
    await expect(
      f.service.customerPresence([{ userId: "user1", sessionIds: ["sid1"] }]),
    ).rejects.toThrow("Customer activity unavailable");
  });
});
