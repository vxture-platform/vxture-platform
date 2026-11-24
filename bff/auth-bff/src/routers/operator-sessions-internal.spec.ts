/**
 * Verify that stale interactive caches cannot advertise revoked operators online.
 * @package @vxture/bff-auth
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-24
 */
import "reflect-metadata";
import { afterEach, expect, it, vi } from "vitest";
import { OperatorSessionsInternalRouter } from "./operator-sessions-internal.router";
import type { RedisService } from "../redis/redis.service";
import type { SessionService } from "../authn/session.service";

afterEach(() => vi.unstubAllEnvs());
function fixture() {
  const redis = {
    listOperatorSessions: vi.fn(async () => [
      {
        sid: "live",
        sub: "opr_alice",
        clients: ["arche"],
        authMethod: "password+totp",
        createdAt: 100,
        absExpiresAt: 1000,
      },
      {
        sid: "revoked",
        sub: "opr_alice",
        clients: [],
        authMethod: "password+totp",
        createdAt: 100,
        absExpiresAt: 1000,
      },
      {
        sid: "wrong-owner",
        sub: "opr_alice",
        clients: [],
        authMethod: "password+totp",
        createdAt: 100,
        absExpiresAt: 1000,
      },
    ]),
  };
  const authority = {
    activeWorkforceOwners: vi.fn(
      async () =>
        new Map([
          ["live", "alice"],
          ["wrong-owner", "bob"],
        ]),
    ),
  };
  return {
    authority,
    router: new OperatorSessionsInternalRouter(
      redis as unknown as RedisService,
      authority as unknown as SessionService,
    ),
  };
}
it("hides revoked and wrong-owner cache entries with the durable flag on", async () => {
  vi.stubEnv("WORKFORCE_IDENTITY_SYNC_ENABLED", "true");
  const f = fixture();
  expect((await f.router.list()).sessions).toEqual([
    expect.objectContaining({ operatorId: "alice", clients: ["arche"] }),
  ]);
  expect(f.authority.activeWorkforceOwners).toHaveBeenCalledOnce();
});
it("preserves legacy cache listing while rollout is off", async () => {
  vi.stubEnv("WORKFORCE_IDENTITY_SYNC_ENABLED", "false");
  const f = fixture();
  expect((await f.router.list()).sessions).toHaveLength(3);
  expect(f.authority.activeWorkforceOwners).not.toHaveBeenCalled();
});
it("does not report stale online state during an authority outage", async () => {
  vi.stubEnv("WORKFORCE_IDENTITY_SYNC_ENABLED", "true");
  const f = fixture();
  f.authority.activeWorkforceOwners.mockRejectedValue(
    new Error("database offline"),
  );
  await expect(f.router.list()).rejects.toThrow("database offline");
});
