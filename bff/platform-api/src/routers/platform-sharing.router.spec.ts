/**
 * platform-sharing.router.spec.ts — the visible-set read's two side rules.
 * @package  @vxture/bff-platform-api
 * @layer    Application
 * @category test
 *
 *  1. TD-035：S2S 调用方只能问自己的产品，工作区取 token 的；旧头走 `trust-declared`
 *     回显自报的工作区（已登记的缺口，见 s2s-legacy-scope 快照）。
 *  2. E6（2026-10-04）：旧凭据计数只在旧头那条路上发生——Bearer 调用方一次都不记。
 *
 * @author AI-Generated
 * @date 2026-10-04
 */
import { describe, expect, it, vi } from "vitest";
import type { SharingService } from "@vxture/service-sharing";
import type { LegacyAuthUsageService } from "../platform/legacy-auth-usage.service";
import { PlatformSharingRouter } from "./platform-sharing.router";

const WS_DECLARED = "00000000-0000-4000-8000-0000000000d1";
const WS_TOKEN = "00000000-0000-4000-8000-0000000000a1";

function makeRouter() {
  const resolveVisibleSet = vi.fn(async () => ({
    workspace_id: WS_TOKEN,
    product: "arda",
    grants: [],
  }));
  const recordLegacy = vi.fn();
  const router = new PlatformSharingRouter(
    { resolveVisibleSet } as unknown as SharingService,
    { record: recordLegacy } as unknown as LegacyAuthUsageService,
  );
  return { router, resolveVisibleSet, recordLegacy };
}

const s2s = (productCode: string) => ({
  productCode,
  mode: "service" as const,
  orgId: null,
  workspaceId: WS_TOKEN,
});

describe("GET /platform/sharing/visible-set", () => {
  it("S2S caller: the token's workspace is used, the declared one is discarded, nothing is counted as legacy", async () => {
    const { router, resolveVisibleSet, recordLegacy } = makeRouter();
    await router.visibleSet(
      { workspace_id: WS_DECLARED, product: "arda" },
      s2s("arda"),
    );
    expect(resolveVisibleSet).toHaveBeenCalledWith(WS_TOKEN, "arda");
    expect(recordLegacy).not.toHaveBeenCalled();
  });

  it("S2S caller asking about another product → 403, nothing read, nothing counted", async () => {
    const { router, resolveVisibleSet, recordLegacy } = makeRouter();
    await expect(
      router.visibleSet(
        { workspace_id: WS_TOKEN, product: "karda" },
        s2s("arda"),
      ),
    ).rejects.toMatchObject({ message: "s2s_product_mismatch" });
    expect(resolveVisibleSet).not.toHaveBeenCalled();
    expect(recordLegacy).not.toHaveBeenCalled();
  });

  it("legacy header (no s2sCaller): declared workspace is echoed (trust-declared) and one legacy count is recorded for sharing.visible-set", async () => {
    const { router, resolveVisibleSet, recordLegacy } = makeRouter();
    await router.visibleSet(
      { workspace_id: WS_DECLARED, product: "arda" },
      undefined,
    );
    expect(resolveVisibleSet).toHaveBeenCalledWith(WS_DECLARED, "arda");
    expect(recordLegacy.mock.calls.map((c) => c[0])).toEqual([
      { route: "sharing.visible-set", productCode: "arda" },
    ]);
  });

  it("bad query → 400 before anything is read or counted", async () => {
    const { router, resolveVisibleSet, recordLegacy } = makeRouter();
    await expect(
      router.visibleSet({ workspace_id: WS_DECLARED }, undefined),
    ).rejects.toMatchObject({ status: 400 });
    expect(resolveVisibleSet).not.toHaveBeenCalled();
    expect(recordLegacy).not.toHaveBeenCalled();
  });
});
