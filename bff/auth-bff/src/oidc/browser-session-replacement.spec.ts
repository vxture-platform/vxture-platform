/**
 * Reauthentication retires only the browser's replaced customer session.
 * @package @vxture/bff-auth
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-16
 */
import { expect, it, vi } from "vitest";
import { OidcService } from "./oidc.service";

function fixture(oldRealm = "customer", nextRealm = "customer") {
  const service = Object.create(OidcService.prototype) as OidcService;
  const endSession = vi.fn(async () => null);
  Object.assign(service, {
    redis: {
      getOidcSession: vi.fn(async (sid: string) => ({
        realm: sid === "old" ? oldRealm : nextRealm,
      })),
    },
    endSession,
  });
  return { service, endSession };
}

it("revokes the replaced session before issuing a new browser cookie", async () => {
  const { service, endSession } = fixture();
  await service.replaceCustomerSession("old", "new");
  expect(endSession).toHaveBeenCalledWith(["old"]);
});

it("preserves independent devices and an unchanged central session", async () => {
  const { service, endSession } = fixture();
  await service.replaceCustomerSession(undefined, "new");
  await service.replaceCustomerSession("new", "new");
  expect(endSession).not.toHaveBeenCalled();
});

it("never revokes the workforce realm through a customer cookie", async () => {
  const { service, endSession } = fixture("workforce");
  await service.replaceCustomerSession("old", "new");
  expect(endSession).not.toHaveBeenCalled();
});

it("rejects a new session outside the customer realm", async () => {
  const { service, endSession } = fixture("customer", "workforce");
  await expect(service.replaceCustomerSession("old", "new")).rejects.toThrow();
  expect(endSession).not.toHaveBeenCalled();
});
