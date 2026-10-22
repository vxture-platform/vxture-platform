/**
 * invoice-receipts.http.spec.ts - Auth, verification and compatibility regressions.
 * @package @vxture/bff-console
 * @layer Application
 * @category Test
 * @author AI-Generated
 * @date 2026-10-22
 */
import "reflect-metadata";
import { Module, type INestApplication } from "@nestjs/common";
import { APP_GUARD, NestFactory } from "@nestjs/core";
import { BillingService, InvoiceReceiptService } from "@vxture/service-billing";
import { OrganizationService } from "@vxture/service-organization";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { BillingRouter } from "./billing.router";
import { CapabilityGuard } from "../auth/capability";
import type { RequestContext } from "../types/console.types";
import type { Request, Response, NextFunction } from "express";
import type { AddressInfo } from "node:net";

// ============================================================================
// HTTP fixture (only session lookup and storage are replaced)
// ============================================================================
const TENANT = "11111111-1111-4111-8111-111111111111";
const BILL = "22222222-2222-4222-8222-222222222222";
const ADDRESS = "33333333-3333-4333-8333-333333333333";
const apply = vi.fn();
const verification = vi.fn();
const record = {
  id: BILL,
  invoiceNo: "FAP-TEST",
  billId: BILL,
  billNo: "INV-TEST",
  bills: [{ id: BILL, billNo: "INV-TEST", amount: "0.30" }],
  createdAt: new Date(),
  issuedAt: null,
  sendAt: null,
};
@Module({
  controllers: [BillingRouter],
  providers: [
    { provide: BillingService, useValue: {} },
    { provide: InvoiceReceiptService, useValue: { applyReceipt: apply } },
    {
      provide: OrganizationService,
      useValue: { getLatestTenantVerification: verification },
    },
    {
      provide: "COMMERCE_PG_POOL",
      useValue: { query: vi.fn(async () => ({ rows: [] })) },
    },
    { provide: APP_GUARD, useClass: CapabilityGuard },
  ],
})
class TestModule {}
let app: INestApplication;
let base: string;
beforeAll(async () => {
  app = await NestFactory.create(TestModule, { logger: false });
  app.use(
    (req: Request & RequestContext, _res: Response, next: NextFunction) => {
      if (req.headers["x-test-session"] === "yes")
        Object.assign(req, {
          user: { id: TENANT },
          tenant: { id: TENANT },
          capabilities:
            req.headers["x-test-capability"] === "yes"
              ? ["tenant.invoice.manage"]
              : ["tenant.billing.read"],
        });
      next();
    },
  );
  await app.listen(0, "127.0.0.1");
  base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
});
afterAll(async () => {
  await app.close();
});
beforeEach(() => {
  vi.clearAllMocks();
  apply.mockResolvedValue(record);
  verification.mockResolvedValue({
    status: "verified",
    verificationMethod: "documents",
  });
});
async function submit(body: unknown, session = true, capable = true) {
  return fetch(`${base}/api/billing/receipts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-test-session": session ? "yes" : "no",
      "x-test-capability": capable ? "yes" : "no",
    },
    body: JSON.stringify(body),
  });
}
const input = {
  billIds: [BILL],
  addressId: ADDRESS,
  invoiceType: "electronic_general",
};

// ============================================================================
// Authorization, input shape, and trusted tenant context
// ============================================================================
describe("invoice application HTTP", () => {
  it("requires a session and the invoice write capability", async () => {
    expect((await submit(input, false)).status).toBe(401);
    expect((await submit(input, true, false)).status).toBe(403);
    expect(apply).not.toHaveBeenCalled();
  });
  it.each([
    [],
    [BILL, BILL],
    ["bad"],
    Array.from(
      { length: 51 },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    ),
  ])("rejects malformed or oversized bill sets %j", async (billIds) => {
    expect((await submit({ ...input, billIds })).status).toBe(400);
    expect(apply).not.toHaveBeenCalled();
  });
  it("rejects ambiguous old/new inputs", async () => {
    expect((await submit({ ...input, billId: BILL })).status).toBe(400);
  });
  it.each([
    null,
    { status: "verified", verificationMethod: "lite" },
    { status: "pending", verificationMethod: "documents" },
  ])("retains the existing full-verification gate %j", async (latest) => {
    verification.mockResolvedValue(latest);
    expect((await submit(input)).status).toBe(400);
    expect(apply).not.toHaveBeenCalled();
  });
  it("uses the verified tenant and returns the complete allocation", async () => {
    const response = await submit({
      ...input,
      tenantId: ADDRESS,
      amount: "999.00",
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(
      expect.objectContaining({ bills: record.bills }),
    );
    expect(apply).toHaveBeenCalledWith({
      ...input,
      tenantId: TENANT,
      userId: TENANT,
    });
  });
  it("keeps single-bill callers compatible", async () => {
    expect(
      (
        await submit({
          billId: BILL,
          addressId: ADDRESS,
          invoiceType: "electronic_general",
        })
      ).status,
    ).toBe(201);
    expect(apply.mock.calls[0]?.[0].billIds).toEqual([BILL]);
  });
});
