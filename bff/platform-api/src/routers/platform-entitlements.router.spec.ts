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
 * E6（2026-10-04）：旧凭据计数只在旧头那条路上发生——Bearer 调用方一次都不记；
 * 旧头一次请求问几个产品码就记几笔，且在读之前就记（它数的是「谁还拿旧头来敲门」，
 * 不是「读成功了几次」）。
 *
 * @author AI-Generated
 * @date 2026-08-31
 */
import { describe, expect, it, vi, type Mock } from "vitest";
import type { IntegrationSignalService } from "../platform/integration-signal.service";
import type { LegacyAuthUsageService } from "../platform/legacy-auth-usage.service";
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
  resolve: Mock<
    (
      workspaceId: string,
      codes: string[],
    ) => Promise<Record<string, typeof VIEW>>
  > = vi.fn(async () => ({ arda: VIEW, karda: VIEW })),
) {
  const recordEntitlementRead = vi.fn();
  const recordLegacy = vi.fn();
  const router = new PlatformEntitlementsRouter(
    { resolve } as unknown as PlatformEntitlementsService,
    { recordEntitlementRead } as unknown as IntegrationSignalService,
    { record: recordLegacy } as unknown as LegacyAuthUsageService,
  );
  return { router, resolve, recordEntitlementRead, recordLegacy };
}

const S2S_ARDA = {
  productCode: "arda",
  mode: "service" as const,
  orgId: null,
  workspaceId: WS_TOKEN,
  delegated: false,
};

/** 代上报票（决策 3 PR C）：act.sub 是上报者 atlas，票里没有 workspace。 */
const DELEGATED_ATLAS = {
  productCode: "atlas",
  mode: "service" as const,
  orgId: null,
  workspaceId: null,
  delegated: true,
};

describe("PlatformEntitlementsRouter — E6 legacy-credential counter", () => {
  it("Bearer caller present: never counted", async () => {
    const { router, recordLegacy } = makeRouter();
    await router.resolve(
      { workspace_id: WS_DECLARED, product: "arda" },
      S2S_ARDA,
    );
    expect(recordLegacy).not.toHaveBeenCalled();
  });

  it("legacy header (no s2sCaller): one count per requested product code, route=entitlements", async () => {
    const { router, recordLegacy } = makeRouter();
    await router.resolve(
      { workspace_id: WS_DECLARED, products: "arda,karda" },
      undefined,
    );
    expect(recordLegacy.mock.calls.map((c) => c[0])).toEqual([
      { route: "entitlements", productCode: "arda" },
      { route: "entitlements", productCode: "karda" },
    ]);
  });

  it("legacy header: counted before the read, so a failing read is still a legacy knock", async () => {
    const { router, recordLegacy } = makeRouter(
      vi.fn(async () => {
        throw new Error("db down");
      }),
    );
    await expect(
      router.resolve({ workspace_id: WS_DECLARED, product: "arda" }, undefined),
    ).rejects.toThrow("db down");
    expect(recordLegacy).toHaveBeenCalledTimes(1);
  });
});

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
        delegated: false,
      },
    );
    expect(recordEntitlementRead).toHaveBeenCalledTimes(1);
    expect(recordEntitlementRead).toHaveBeenCalledWith({
      productCode: "arda",
      via: "s2s",
      workspaceId: WS_TOKEN,
      reporter: null,
    });
  });

  it("shared-internal-header caller: attributed to each requested product code", async () => {
    const { router, recordEntitlementRead } = makeRouter();
    await router.resolve(
      { workspace_id: WS_DECLARED, products: "arda,karda" },
      undefined,
    );
    expect(recordEntitlementRead.mock.calls.map((c) => c[0])).toEqual([
      {
        productCode: "arda",
        via: "internal-auth",
        workspaceId: WS_DECLARED,
        reporter: null,
      },
      {
        productCode: "karda",
        via: "internal-auth",
        workspaceId: WS_DECLARED,
        reporter: null,
      },
    ]);
  });

  /*
   * 代上报（决策 3 PR C）：atlas 按调用方产品读 C2（ADR-013 D11）。三件事一起钉：
   *   · 问的产品（≠ act.sub）就是归属产品，工作区取自报值（票里没有）；
   *   · 不记旧凭据计数（它有身份）；
   *   · 信号归到被问的产品、via=s2s、**reporter=atlas**——少了 reporter，opera 会把它读成
   *     「tenderforge 自己换票了」，而那正是 E3a 的陷阱。
   */
  it("delegated reporter (atlas) asking for tenderforge: declared workspace, attributed to tenderforge with reporter=atlas, not counted as legacy", async () => {
    const { router, resolve, recordEntitlementRead, recordLegacy } = makeRouter(
      vi.fn(async () => ({ tenderforge: VIEW })),
    );
    const res = await router.resolve(
      { workspace_id: WS_DECLARED, product: "tenderforge" },
      DELEGATED_ATLAS,
    );
    expect(resolve).toHaveBeenCalledWith(WS_DECLARED, ["tenderforge"]);
    expect(recordLegacy).not.toHaveBeenCalled();
    expect(recordEntitlementRead).toHaveBeenCalledWith({
      productCode: "tenderforge",
      via: "s2s",
      workspaceId: WS_DECLARED,
      reporter: "atlas",
    });
    expect(res).toMatchObject({
      workspace_id: WS_DECLARED,
      product: "tenderforge",
    });
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
