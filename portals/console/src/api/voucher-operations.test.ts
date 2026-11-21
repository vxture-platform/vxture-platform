/**
 * voucher-operations.test.ts - Confidential HTTP and recoverable voucher contracts.
 * @package @vxture/console
 * @layer Presentation
 * @category test
 * @author AI-Generated
 * @date 2026-11-20
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import * as api from "./console-bff";

// ============================================================================
// Transport is fully mocked; no service URL or credential is contacted.
// ============================================================================
afterEach(() => vi.unstubAllGlobals());
const claim = {
  secret: "Sensitive.Case-Specific-Claim",
  target: "workspace" as const,
  idempotencyKey: "original-key",
};
const redemption = { voucherId: "voucher", idempotencyKey: "original-key" };
const extension = {
  ...redemption,
  subscriptionId: "subscription",
  expectedPlanVersionId: "version",
  expectedEndAt: "2026-12-01T00:00:00Z",
};
const recharge = { ...redemption, confirmation: "terms-fingerprint" };
function network() {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => Response.json({ ok: true }));
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
describe("voucher HTTP transport", () => {
  it("sends claim secrets exclusively in noncacheable POST bodies", async () => {
    const fetcher = network();
    await api.previewVoucherClaim(claim.secret, claim.target);
    await api.claimVoucher(claim);
    for (const [url, init] of fetcher.mock.calls) {
      expect(String(url)).not.toContain(claim.secret);
      expect(init).toMatchObject({
        method: "POST",
        credentials: "include",
        cache: "no-store",
      });
      expect(JSON.parse(String(init!.body)).secret).toBe(claim.secret);
    }
  });
  it.each([
    ["claims", () => api.claimVoucher(claim)],
    ["redemptions", () => api.redeemSubscriptionVoucher(redemption)],
    ["extensions", () => api.extendSubscriptionVoucher(extension)],
    ["recharges", () => api.redeemRechargeCard(recharge)],
  ] as const)(
    "retains every original %s command field across an explicit retry",
    async (path, invoke) => {
      const fetcher = network();
      fetcher.mockRejectedValueOnce(new Error("response lost"));
      await expect(invoke()).rejects.toMatchObject({ status: 503 });
      expect(fetcher).toHaveBeenCalledOnce();
      await invoke();
      expect(fetcher.mock.calls[0]![1]!.body).toBe(
        fetcher.mock.calls[1]![1]!.body,
      );
      expect(String(fetcher.mock.calls[0]![0])).toContain(
        "/api/promotion/" + path,
      );
    },
  );
  it.each([
    ["claims", api.fetchVoucherClaimResult],
    ["redemptions", api.fetchSubscriptionRedemptionResult],
    ["extensions", api.fetchSubscriptionExtensionResult],
    ["recharges", api.fetchRechargeCardResult],
  ] as const)(
    "preserves valid JSON null for absent %s receipts",
    async (path, recover) => {
      const fetcher = network();
      fetcher.mockResolvedValueOnce(Response.json(null));
      expect(await recover("original-key")).toBeNull();
      expect(String(fetcher.mock.calls[0]![0])).toContain(
        `/api/promotion/${path}/result?idempotencyKey=original-key`,
      );
      expect(fetcher.mock.calls[0]![1]).toMatchObject({
        credentials: "include",
        cache: "no-store",
      });
      expect(fetcher.mock.calls[0]![1]!.body).toBeUndefined();
    },
  );
  it.each([429, 503, 409, 400, 403])(
    "preserves status %i without exposing server response secrets",
    async (status) => {
      const fetcher = network();
      fetcher.mockResolvedValueOnce(
        Response.json({ message: "Sensitive server echo" }, { status }),
      );
      const error: unknown = await api
        .claimVoucher(claim)
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(api.ConsoleBffError);
      expect((error as Error).message).not.toContain("Sensitive");
      expect((error as api.ConsoleBffError).status).toBe(status);
    },
  );
  it("passes server paging, filters and sorting without falling back to a truncated list", async () => {
    const fetcher = network();
    await api.fetchVoucherPage({
      page: 3,
      pageSize: 20,
      status: "paused",
      query: "a & b",
      sort: "expiresAt",
      direction: "desc",
    });
    const url = new URL(String(fetcher.mock.calls[0]![0]));
    expect(url.searchParams.get("query")).toBe("a & b");
    expect(url.searchParams.get("page")).toBe("3");
    expect(url.searchParams.get("direction")).toBe("desc");
  });
  it("preserves the main balance payment, quote and immutable subscription order contract", async () => {
    const fetcher = network();
    await api.quoteOrder("order", {
      useBalance: true,
      creditVoucherId: "credit",
    });
    await api.declareOrderPayment("order", {
      payChannel: "balance",
      creditVoucherId: "credit",
    });
    const order = {
      productCode: "product",
      planVersionId: "version",
      cycleUnit: "month" as const,
      intent: "new" as const,
      autoRenew: false,
      idempotencyKey: "key",
    };
    await api.createSubscriptionOrder(order);
    await api.createSubscriptionOrder(order);
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]!.body))).toEqual({
      useBalance: true,
      creditVoucherId: "credit",
    });
    expect(JSON.parse(String(fetcher.mock.calls[1]![1]!.body)).payChannel).toBe(
      "balance",
    );
    expect(fetcher.mock.calls[2]![1]!.body).toBe(
      fetcher.mock.calls[3]![1]!.body,
    );
    const channel: api.PaymentChannelInfo["channel"] = "balance";
    const leg: api.OrderPaymentLeg["kind"] = "balance";
    expect(channel).toBe("balance");
    expect(leg).toBe("balance");
  });
});
