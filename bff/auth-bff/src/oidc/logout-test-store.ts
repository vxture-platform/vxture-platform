/**
 * In-memory durable-work fixture for logout orchestration tests.
 * @package @vxture/bff-auth
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-17
 */
import { vi } from "vitest";
import type { OidcLogoutWork } from "../redis/redis.service";

/** Model persistent progress independently of a service instance. */
export function logoutTestStore(
  snapshot: (sid: string) => { sub: string | null; clientIds: string[] },
  retire: (sid: string) => void = () => {},
) {
  const records = new Map<string, OidcLogoutWork>();
  const leases = new Map<string, string>();
  return {
    records,
    leases,
    beginOidcLogout: vi.fn(async (sid: string) => {
      const identity = snapshot(sid);
      if (!records.has(sid))
        records.set(sid, {
          sid,
          ...identity,
          realm: identity.sub?.startsWith("opr_") ? "workforce" : "customer",
          cleanupComplete: false,
          attempts: 0,
        });
      retire(sid);
      return structuredClone(records.get(sid)!);
    }),
    claimOidcLogout: vi.fn(async (sid: string, lease: string) => {
      const work = records.get(sid);
      if (!work || leases.has(sid)) return null;
      leases.set(sid, lease);
      return structuredClone(work);
    }),
    saveOidcLogout: vi.fn(async (work: OidcLogoutWork, lease: string) => {
      if (leases.get(work.sid) !== lease) return false;
      if (work.cleanupComplete && work.clientIds.length === 0)
        records.delete(work.sid);
      else records.set(work.sid, structuredClone(work));
      leases.delete(work.sid);
      return true;
    }),
    pendingOidcLogouts: vi.fn(async () => [...records.keys()]),
  };
}
