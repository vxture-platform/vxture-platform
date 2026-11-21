import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { PromotionService } from "./promotion.service";
import type { PgPromotionRepository } from "../repository/pg-promotion.repository";
import type { VoucherScope } from "../types/promotion.types";

// Settlement-engine orchestration guards (product_321 §5.1): repo is mocked;
// the subject is reserve ordering + abort, finalize idempotency, and the
// release credential discipline (only named vouchers, stale skipped).

const SCOPE: VoucherScope = {
  tenantId: "org-1",
  workspaceId: "ws-1",
  userId: "u-1",
};

const CLIENT = {} as PoolClient;

interface Mocks {
  repo: {
    listAvailableVouchers: ReturnType<typeof vi.fn>;
    resolveAvailableVoucher: ReturnType<typeof vi.fn>;
    reserve: ReturnType<typeof vi.fn>;
    finalize: ReturnType<typeof vi.fn>;
    release: ReturnType<typeof vi.fn>;
  };
  service: PromotionService;
}

const build = (): Mocks => {
  const repo = {
    listAvailableVouchers: vi.fn().mockResolvedValue([]),
    resolveAvailableVoucher: vi.fn().mockResolvedValue(null),
    reserve: vi.fn(),
    finalize: vi.fn(),
    release: vi.fn(),
  };
  const service = new PromotionService(
    repo as unknown as PgPromotionRepository,
  );
  return { repo, service };
};

let m: Mocks;
beforeEach(() => {
  m = build();
});

describe("reserveForOrder", () => {
  it("reserves discount before credit voucher (§7 fixed voucher order)", async () => {
    m.repo.reserve
      .mockResolvedValueOnce({
        effect: { discount_type: "percent", value: 20 },
      })
      .mockResolvedValueOnce({ effect: { amount_cents: 10000 } });

    const reserved = await m.service.reserveForOrder(CLIENT, {
      scope: SCOPE,
      discountVoucherId: "v-d",
      creditVoucherId: "v-c",
    });

    expect(m.repo.reserve).toHaveBeenNthCalledWith(
      1,
      CLIENT,
      SCOPE,
      "v-d",
      "discount",
    );
    expect(m.repo.reserve).toHaveBeenNthCalledWith(
      2,
      CLIENT,
      SCOPE,
      "v-c",
      "credit_voucher",
    );
    expect(reserved).toHaveLength(2);
    expect(reserved[0]?.kind).toBe("discount");
    expect(reserved[1]?.effectSnapshot).toEqual({ amount_cents: 10000 });
  });

  it("throws 409 when a reserve loses the race (rowCount 0)", async () => {
    m.repo.reserve.mockResolvedValueOnce(null);
    await expect(
      m.service.reserveForOrder(CLIENT, {
        scope: SCOPE,
        discountVoucherId: "v-d",
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("throws 409 on malformed batch effect (mid-flight config mutation)", async () => {
    m.repo.reserve.mockResolvedValueOnce({ effect: { bogus: true } });
    await expect(
      m.service.reserveForOrder(CLIENT, {
        scope: SCOPE,
        creditVoucherId: "v-c",
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("no vouchers selected -> no-op", async () => {
    const reserved = await m.service.reserveForOrder(CLIENT, { scope: SCOPE });
    expect(reserved).toEqual([]);
    expect(m.repo.reserve).not.toHaveBeenCalled();
  });
});

describe("finalizeReserved", () => {
  it("is idempotent across confirm re-drives (existing redemption skipped)", async () => {
    m.repo.finalize.mockResolvedValueOnce({
      redemptionId: "r-1",
      already: true,
    });
    const out = await m.service.finalizeReserved(CLIENT, [
      {
        orderId: "order",
        invoiceId: "invoice",
        voucherId: "v-d",
        kind: "discount",
        scope: SCOPE,
        effectSnapshot: {},
        invoiceItemId: "item-1",
      },
    ]);
    expect(out).toEqual([{ voucherId: "v-d", redemptionId: "r-1" }]);
    expect(m.repo.finalize).toHaveBeenCalledTimes(1);
  });
});

describe("releaseReserved", () => {
  it("releases only the vouchers named by the credential", async () => {
    m.repo.release.mockResolvedValue(true);
    const released = await m.service.releaseReserved(CLIENT, {
      orderId: "order",
      invoiceId: "invoice",
      discountVoucherId: "v-d",
    });
    expect(released).toEqual(["v-d"]);
    expect(m.repo.release).toHaveBeenCalledTimes(1);
    expect(m.repo.release).toHaveBeenCalledWith(
      CLIENT,
      "v-d",
      expect.objectContaining({ orderId: "order", invoiceId: "invoice" }),
      undefined,
      undefined,
    );
  });

  it("skips (not throws) on stale credential — voucher no longer reserved", async () => {
    // e.g. re-reserved by another order, or already finalized (P10 guard)
    m.repo.release.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const released = await m.service.releaseReserved(CLIENT, {
      orderId: "order",
      invoiceId: "invoice",
      discountVoucherId: "v-d",
      creditVoucherId: "v-c",
    });
    expect(released).toEqual(["v-c"]);
  });
});
