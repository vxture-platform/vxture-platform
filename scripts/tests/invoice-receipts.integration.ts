/**
 * invoice-receipts.integration.ts - Real PostgreSQL migration and finance regression.
 * @package vxture-platform
 * @layer Application
 * @category Test
 * @author AI-Generated
 * @date 2026-10-22
 * @description Run only against an isolated invoice232* database with the pre-change
 * DDL. Run through run-invoice-receipts.mjs against a dedicated local database.
 */
import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Pool } from "pg";
import type { Request } from "express";
import { PgReceiptRepository } from "../../services/commerce/billing/src/repository/pg-receipt.repository";
import { InvoiceReceiptService } from "../../services/commerce/billing/src/service/receipt.service";
import { InvoiceReviewRouter } from "../../bff/admin-bff/src/routers/invoice-review.router";
import { BillingRouter } from "../../bff/admin-bff/src/routers/billing.router";
import { InvoicesRouter } from "../../bff/admin-bff/src/routers/invoices.router";
import type { RequestContext } from "../../bff/admin-bff/src/types/console.types";

// ============================================================================
// Isolated database fixture
// ============================================================================
test("merged invoice applications and migration", async (t) => {
  const url = new URL(
    process.env.INVOICE_TEST_DATABASE_URL ??
      "postgres://postgres@127.0.0.1:14785/invoice232",
  );
  assert.ok(
    ["localhost", "127.0.0.1"].includes(url.hostname) &&
      /^\/invoice232\w*$/.test(url.pathname),
    "Refusing a non-local/non-test database",
  );
  const owner = new Pool({ connectionString: url.href });
  const runtime = new Pool({
    connectionString: url.href,
    options: "-c role=platform_svc",
  });
  const readonly = new Pool({
    connectionString: url.href,
    options: "-c role=reporting_ro",
  });
  try {
    const user = (
      await owner.query<{ id: string }>(
        `insert into account.users(account, phone, phone_verified_at) values ($1, $2, now()) returning id`,
        [`invoice-${randomUUID()}`, randomUUID().slice(0, 24)],
      )
    ).rows[0]!.id;
    async function tenant() {
      return (
        await owner.query<{ id: string }>(
          `insert into tenancy.tenants(name, type, owner_user_id) values ('invoice integration', 'organization', $1) returning id`,
          [user],
        )
      ).rows[0]!.id;
    }
    const tenantId = await tenant();
    const other = await tenant();
    async function bill(
      amount = "1.00",
      status = "paid",
      currency = "CNY",
      tenant = tenantId,
    ) {
      return (
        await owner.query<{ id: string }>(
          `insert into billing.invoices(tenant_id, bill_no, bill_cycle, cycle_start_date, cycle_end_date, total_amount, payable_amount, paid_amount, currency, bill_status, created_by_type, created_by_id)
        values ($1, $2, '202610', '2026-10-01', '2026-10-31', $3, $3, $3, $4, $5, 'customer', $6) returning id`,
          [tenant, `INV-${randomUUID()}`, amount, currency, status, user],
        )
      ).rows[0]!.id;
    }
    const address = (
      await owner.query<{ id: string }>(
        `insert into billing.billing_addresses(tenant_id, invoice_tax_type, title, created_by) values ($1, 'general', 'Snapshot title', $2) returning id`,
        [tenantId, user],
      )
    ).rows[0]!.id;
    const legacyBill = await bill("7.13");
    const legacy = (
      await owner.query<{ id: string }>(
        `insert into billing.invoice_receipts(tenant_id, bill_id, invoice_no, invoice_type, invoice_tax_type, invoice_title, company_info, invoice_amount, created_by_type, created_by_id)
      values ($1, $2, $3, 'electronic_general', 'general', 'Legacy', '{}', 7.13, 'customer', $4) returning id`,
        [tenantId, legacyBill, `FAP-${randomUUID()}`, user],
      )
    ).rows[0]!.id;
    const migration = readFileSync(
      "deploy/database/migrations/2026-12-07-merged-invoice-receipts.sql",
      "utf8",
    );
    await owner.query(migration);
    await owner.query(migration);
    const service = new InvoiceReceiptService(new PgReceiptRepository(runtime));
    const review = new InvoiceReviewRouter(runtime);
    const adminBilling = new BillingRouter(readonly, runtime);
    const ledger = new InvoicesRouter(readonly);
    const req = {
      user: { id: user },
      capabilities: [
        "commerce:invoice.manage",
        "commerce:invoice.read",
        "commerce:billing.read",
        "commerce:invoice.void",
      ],
      headers: {},
    } as unknown as Request & RequestContext;
    const apply = (billIds: string[], patch = {}) =>
      service.applyReceipt({
        tenantId,
        userId: user,
        billIds,
        addressId: address,
        invoiceType: "electronic_general",
        ...patch,
      });
    const rejects = (promise: Promise<unknown>, status: number) =>
      assert.rejects(
        promise,
        (err: unknown) =>
          typeof err === "object" &&
          err !== null &&
          "getStatus" in err &&
          (err as { getStatus: () => number }).getStatus() === status,
      );

    // ========================================================================
    // Data migration and eligibility
    // ========================================================================
    await t.test(
      "historical allocations backfill once and remain readable",
      async () => {
        const row = (
          await runtime.query(
            `select amount::text from billing.invoice_receipt_bills where receipt_id = $1`,
            [legacy],
          )
        ).rows;
        assert.deepEqual(row, [{ amount: "7.13" }]);
        assert.equal(
          (await service.listReceipts(tenantId)).find((r) => r.id === legacy)
            ?.bills.length,
          1,
        );
        await rejects(apply([legacyBill]), 409);
      },
    );
    const a = await bill("0.10"),
      b = await bill("0.20");
    const merged = await apply([b, a]);
    await t.test(
      "exact cents, stable snapshots, full allocation and legacy fields",
      async () => {
        assert.equal(merged.invoiceAmount, "0.30");
        assert.equal(merged.bills.length, 2);
        assert.equal(merged.billId, [a, b].sort()[0]);
        await owner.query(
          `update billing.billing_addresses set title = 'Changed later' where id = $1`,
          [address],
        );
        assert.equal(
          (await service.listReceipts(tenantId)).find((r) => r.id === merged.id)
            ?.invoiceTitle,
          "Snapshot title",
        );
        assert.equal(
          (await ledger.listInvoiceLedger(req)).find((r) => r.id === merged.id)
            ?.bills?.length,
          2,
        );
        for (const id of [a, b]) {
          const detail = await adminBilling.getBilling(req, id);
          assert.equal(
            detail?.invoicedAmount,
            Number(id === a ? "0.10" : "0.20"),
          );
          assert.equal(
            detail?.invoiceReceipts.filter((r) => r.id === merged.id).length,
            1,
          );
        }
      },
    );
    await t.test(
      "duplicate members, missing bills and tenant isolation",
      async () => {
        await rejects(apply([a]), 409);
        await rejects(apply([a, a]), 400);
        await rejects(apply([randomUUID()]), 404);
        await rejects(apply([await bill("1.00", "paid", "CNY", other)]), 404);
        assert.deepEqual(await service.listReceipts(other), []);
      },
    );
    await t.test(
      "settlement, currency, nonzero, overflow and maximum count",
      async () => {
        await rejects(apply([await bill("1.00", "unpaid")]), 409);
        await rejects(apply([await bill("0.00")]), 400);
        await rejects(apply([await bill("-1.00")]), 400);
        await rejects(
          apply([await bill("1.00"), await bill("1.00", "paid", "USD")]),
          400,
        );
        await rejects(
          apply([await bill("9999999999.99"), await bill("0.01")]),
          400,
        );
        await rejects(
          apply(Array.from({ length: 51 }, () => randomUUID())),
          400,
        );
        const ids = await Promise.all(
          Array.from({ length: 50 }, () => bill("0.01")),
        );
        assert.equal((await apply(ids)).invoiceAmount, "0.50");
      },
    );
    await t.test(
      "foreign/deleted addresses and incompatible invoice types rollback",
      async () => {
        const id = await bill();
        await rejects(apply([id], { addressId: randomUUID() }), 404);
        const foreign = (
          await owner.query<{ id: string }>(
            `insert into billing.billing_addresses(tenant_id, invoice_tax_type, title, created_by) values ($1, 'general', 'Other', $2) returning id`,
            [other, user],
          )
        ).rows[0]!.id;
        await rejects(apply([id], { addressId: foreign }), 404);
        await owner.query(
          "update billing.billing_addresses set tenant_id = $2, deleted_at = now() where id = $1",
          [foreign, tenantId],
        );
        await rejects(apply([id], { addressId: foreign }), 404);
        await rejects(apply([id], { invoiceType: "electronic_special" }), 400);
        assert.equal((await apply([id])).bills.length, 1);
      },
    );
    await t.test(
      "overlapping parallel applications reserve each bill once",
      async () => {
        const ids = await Promise.all([bill(), bill(), bill()]);
        const results = await Promise.allSettled([
          apply([ids[1]!, ids[0]!]),
          apply([ids[2]!, ids[1]!]),
        ]);
        assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
        assert.equal(results.filter((r) => r.status === "rejected").length, 1);
        assert.equal(
          (
            await runtime.query(
              `select count(*)::int as n from billing.invoice_receipt_bills where bill_id = $1`,
              [ids[1]],
            )
          ).rows[0].n,
          1,
        );
      },
    );

    // ========================================================================
    // Review, actual issuance, atomic audit, and rejection/reapplication
    // ========================================================================
    await t.test(
      "operator capability and state transitions are enforced",
      async () => {
        await rejects(
          review.review(
            { ...req, capabilities: [] } as Request & RequestContext,
            merged.id,
            { action: "approve", reason: "test" },
          ),
          403,
        );
        await rejects(
          review.review(req, merged.id, {
            action: "issue",
            reason: "test",
            invoiceElectronicNo: "TEST-1",
            invoiceFileUrl: "https://invoice.test/file.pdf",
            taxAmount: "0.01",
            issuedAt: "2026-10-22T01:00:00Z",
          }),
          409,
        );
        await review.review(req, merged.id, {
          action: "approve",
          reason: "Reviewed complete allocation",
        });
        await rejects(
          review.review(req, merged.id, { action: "approve", reason: "again" }),
          409,
        );
        const issue = {
          action: "issue",
          reason: "Recorded actual invoice",
          invoiceElectronicNo: `TEST-${randomUUID()}`,
          invoiceFileUrl: "https://invoice.test/file.pdf",
          taxAmount: "0.01",
          issuedAt: "2026-10-22T01:00:00Z",
        };
        await rejects(
          review.review(req, merged.id, { ...issue, taxAmount: "0.31" }),
          400,
        );
        await rejects(
          review.review(req, merged.id, {
            ...issue,
            invoiceFileUrl: "javascript:alert(1)",
          }),
          400,
        );
        await review.review(req, merged.id, issue);
        await rejects(
          review.review(req, merged.id, {
            action: "reject",
            reason: "too late",
          }),
          409,
        );
        assert.equal(
          (await service.listReceipts(tenantId)).find((r) => r.id === merged.id)
            ?.invoiceStatus,
          "issued",
        );
        assert.equal(
          (
            await runtime.query(
              `select count(*)::int as n from support.audit_logs where resource_id = $1 and action in ('billing.invoice.approve', 'billing.invoice.issue')`,
              [merged.invoiceNo],
            )
          ).rows[0].n,
          2,
        );
        const next = await apply([await bill()]);
        await review.review(req, next.id, {
          action: "approve",
          reason: "reviewed",
        });
        await rejects(review.review(req, next.id, issue), 409);
      },
    );
    await t.test(
      "rejection releases every member for a new application",
      async () => {
        const ids = [await bill(), await bill()];
        const old = await apply(ids);
        await review.review(req, old.id, {
          action: "reject",
          reason: "Please correct title",
        });
        assert.notEqual((await apply(ids)).id, old.id);
        await rejects(
          review.review(req, old.id, {
            action: "approve",
            reason: "cannot reopen",
          }),
          409,
        );
      },
    );
    await t.test(
      "legacy offline registration preserves currency and cannot duplicate pending applications",
      async () => {
        const usd = await bill("2.00", "paid", "USD");
        const body = {
          invoiceNo: `OFF-${randomUUID()}`,
          invoiceTitle: "Offline",
          invoiceAmount: 2,
          issuedAt: "2026-10-22T01:00:00Z",
          invoiceType: "electronic_general",
          invoiceTaxType: "general",
          invoiceStatus: "issued",
        };
        const detail = await adminBilling.syncOfflineInvoice(req, usd, body);
        assert.equal(detail.invoiceReceipts[0]?.currency, "USD");
        assert.equal(detail.invoiceReceipts[0]?.bills?.length, 1);
        const pending = await bill();
        await apply([pending]);
        await rejects(
          adminBilling.syncOfflineInvoice(req, pending, {
            ...body,
            invoiceNo: `OFF-${randomUUID()}`,
          }),
          409,
        );
      },
    );
    await t.test(
      "allocation sum/scope constraints reject partial transactions",
      async () => {
        await assert.rejects(
          runtime.query(
            `update billing.invoice_receipt_bills set amount = 1 where receipt_id = $1`,
            [merged.id],
          ),
          /receipt_allocation_mismatch/,
        );
        await assert.rejects(
          runtime.query(
            `update billing.invoice_receipts set invoice_amount = 5 where id = $1`,
            [merged.id],
          ),
          /receipt_allocation_mismatch/,
        );
        await assert.rejects(
          runtime.query(
            "update billing.invoice_receipts set tenant_id = $2 where id = $1",
            [merged.id, other],
          ),
          /receipt_allocation_scope_mismatch/,
        );
        await assert.rejects(
          runtime.query(
            "update billing.invoice_receipts set currency = 'USD' where id = $1",
            [merged.id],
          ),
          /receipt_allocation_scope_mismatch/,
        );
        assert.equal(
          (await service.listReceipts(tenantId)).find((r) => r.id === merged.id)
            ?.invoiceAmount,
          "0.30",
        );
      },
    );
  } finally {
    await Promise.all([owner.end(), runtime.end(), readonly.end()]);
  }
});
