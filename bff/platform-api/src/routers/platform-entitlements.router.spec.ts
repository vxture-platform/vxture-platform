/**
 * platform-entitlements.router.spec.ts - the C2 signal hook on the
 * entitlements read.
 * @package  @vxture/bff-platform-api
 * @layer    Application
 * @category test
 *
 * Pins the attribution rule: an S2S caller is attributed to its token
 * identity (and the token's workspace), a shared-internal-header caller to
 * every product code it asked about. Nothing is recorded when the read
 * itself fails.
 *
 * @author AI-Generated
 * @date 2026-08-31
 */
import { describe, expect, it, vi } from "vitest";
import type { IntegrationSignalService } from "../platform/integration-signal.service";
import type { PlatformEntitlementsService } from "../platform/platform-entitlements.service";
import { PlatformEntitlementsRouter } from "./platform-entitlements.router";

const WS_DECLARED = "00000000-0000-4000-8000-0000000000d1";
const WS_TOKEN = "00000000-0000-4000-8000-0000000000a1";

const VIEW = {
  tier: null,
  features: [],
  limits: {},
  bundled: [],
  pools: [],
  subscription: null,
};

function makeRouter(
  resolve = vi.fn(async () => ({ arda: VIEW, karda: VIEW })),
) {
  const recordEntitlementRead = vi.fn();
  const router = new PlatformEntitlementsRouter(
    { resolve } as unknown as PlatformEntitlementsService,
    { recordEntitlementRead } as unknown as IntegrationSignalService,
  );
  return { router, resolve, recordEntitlementRead };
}

describe("PlatformEntitlementsRouter — C2 last-seen signal", () => {
  it("S2S caller: attributed to act.sub with the token's workspace", async () => {
    const { router, recordEntitlementRead } = makeRouter();
    await router.resolve(
      { workspace_id: WS_DECLARED, product: "arda" },
      {
        productCode: "arda",
        mode: "service",
        orgId: null,
        workspaceId: WS_TOKEN,
      },
    );
    expect(recordEntitlementRead).toHaveBeenCalledTimes(1);
    expect(recordEntitlementRead).toHaveBeenCalledWith({
      productCode: "arda",
      via: "s2s",
      workspaceId: WS_TOKEN,
    });
  });

  it("shared-internal-header caller: attributed to each requested product code", async () => {
    const { router, recordEntitlementRead } = makeRouter();
    await router.resolve(
      { workspace_id: WS_DECLARED, products: "arda,karda" },
      undefined,
    );
    expect(recordEntitlementRead.mock.calls.map((c) => c[0])).toEqual([
      { productCode: "arda", via: "internal-auth", workspaceId: WS_DECLARED },
      { productCode: "karda", via: "internal-auth", workspaceId: WS_DECLARED },
    ]);
  });

  it("nothing is recorded when the read itself fails", async () => {
    const { router, recordEntitlementRead } = makeRouter(
      vi.fn(async () => {
        throw new Error("db down");
      }),
    );
    await expect(
      router.resolve({ workspace_id: WS_DECLARED, product: "arda" }, undefined),
    ).rejects.toThrow("db down");
    expect(recordEntitlementRead).not.toHaveBeenCalled();
  });
});
