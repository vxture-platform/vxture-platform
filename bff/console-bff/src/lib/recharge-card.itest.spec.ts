/**
 * recharge-card.itest.spec.ts - Real card money races on disposable PostgreSQL.
 * @package @vxture/bff-console
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-19
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { setTimeout } from "node:timers/promises";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// ⚠️ 跨层引用: Exercise public domains under their actual BFF roles.
import {
  PgVoucherManagement,
  PgVoucherClaims,
  PgCustomerVoucherLedger,
  VoucherClaimCredentials,
  type VoucherScope,
} from "@vxture/service-promotion";
// ⚠️ 跨层引用: Verify the real ledger, not a money mock.
import { PgWalletLedger, PgRechargeCardFunding } from "@vxture/service-billing";
import {
  previewRechargeCard,
  redeemRechargeCard,
  rechargeCardResult,
} from "./recharge-card-operation";

// ===========================================================================
// Only the runner-owned, marked loopback database is accepted.
// ===========================================================================
describe.skipIf(process.env["RECHARGE_CARD_ITEST"] !== "1")(
  "B11 recharge cards PostgreSQL",
  () => {
    let owner: Pool,
      admin: Pool,
      customer: Pool,
      management: PgVoucherManagement;
    const operator = "11111111-1111-4111-8111-111111111111",
      reviewer = "22222222-2222-4222-8222-222222222222";
    const credentials = new VoucherClaimCredentials({
      VOUCHER_CLAIM_ACTIVE_KEY: "b11",
      VOUCHER_CLAIM_KEYS: JSON.stringify({ b11: "ab".repeat(32) }),
    });
    const root = fileURLToPath(
      new URL("../../../../deploy/database/", import.meta.url),
    );
    beforeAll(async () => {
      const runId = process.env["VOUCHER_CONSOLE_OWNED_RUN_ID"];
      expect(runId).toMatch(
        /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/,
      );
      const url = new URL(
        process.env["VOUCHER_CONSOLE_OWNED_DATABASE_URL"] ?? "",
      );
      expect(url.protocol).toBe("postgresql:");
      expect(url.hostname).toBe("127.0.0.1");
      expect(url.username).toBe("postgres");
      expect(url.password).toBe("");
      expect(url.pathname).toBe("/voucher_recharge");
      expect(url.search + url.hash).toBe("");
      expect(Number(url.port)).toBeGreaterThan(0);
      const connection = {
        host: "127.0.0.1",
        port: Number(url.port),
        database: "voucher_recharge",
        connectionTimeoutMillis: 3000,
        statement_timeout: 15000,
        lock_timeout: 10000,
      };
      owner = new Pool({ ...connection, user: "postgres" });
      const identity = await owner.query(
        "select current_database() db, current_user role, shobj_description(oid, 'pg_database') marker from pg_database where datname=current_database()",
      );
      expect(identity.rows).toEqual([
        {
          db: "voucher_recharge",
          role: "postgres",
          marker: "codex-voucher-console:" + runId,
        },
      ]);
      admin = new Pool({ ...connection, user: "svc_admin_bff" });
      customer = new Pool({ ...connection, user: "svc_console_bff" });
      management = new PgVoucherManagement(
        admin,
        new PgRechargeCardFunding(admin),
      );
    }, 60000);
    afterAll(async () => {
      await customer?.end();
      await admin?.end();
      await owner?.end();
    }, 60000);
    const command = () => ({
      idempotencyKey: randomUUID(),
      reason: "B11 acceptance",
    });
    async function scope(): Promise<VoucherScope> {
      const userId = randomUUID(),
        tenantId = randomUUID(),
        workspaceId = randomUUID();
      await owner.query(
        "insert into account.users(id,account,phone,phone_verified_at) values($1::uuid,$1::text,$2,now())",
        [userId, `+${Date.now()}${Math.floor(Math.random() * 100000)}`],
      );
      await owner.query(
        "insert into tenancy.tenants(id,name,type,owner_user_id) values($1,'B11 tenant','organization',$2)",
        [tenantId, userId],
      );
      await owner.query(
        "insert into tenancy.workspaces(id,tenant_id,name) values($1,$2,'B11 workspace')",
        [workspaceId, tenantId],
      );
      return { userId, tenantId, workspaceId };
    }
    async function payment(s: VoucherScope, amount = "100.00") {
      const invoice = randomUUID(),
        id = randomUUID(),
        transaction = randomUUID();
      await owner.query(
        "insert into billing.invoices(id,tenant_id,bill_no,bill_cycle,cycle_start_date,cycle_end_date,total_amount,payable_amount,paid_amount,bill_status,bill_type,created_by_type) values($1,$2,$3,'202611','2026-11-01','2026-11-30',$4,$4,$4,'paid','one_off','system')",
        [invoice, s.tenantId, `INV-${invoice}`, amount],
      );
      await owner.query(
        "insert into billing.transactions(id,tenant_id,bill_id,transaction_no,trade_type,source_method,amount,currency,balance_before,balance_after,trade_status,actor_type) values($1,$2,$3,$4,'recharge','offline',$5,'CNY',0,0,'success','system')",
        [transaction, s.tenantId, invoice, `TXN-${transaction}`, amount],
      );
      await owner.query(
        "insert into billing.payments(id,tenant_id,bill_id,transaction_id,pay_order_no,pay_source,total_amount,paid_amount,pay_status,paid_at) values($1,$2,$3,$4,$5,'offline',$6,$6,'paid',now())",
        [id, s.tenantId, invoice, transaction, `PAY-${id}`, amount],
      );
      return id;
    }
    async function batch(s: VoucherScope, principal = 0, bonus = 1000) {
      const r = await management.createBatch(operator, {
        ...command(),
        kind: "recharge_card",
        name: "B11 card",
        effect: {
          face_value_cents: principal,
          bonus_cents: bonus,
          ...(bonus ? { bonus_expires_in_days: 90 } : {}),
        },
        tenantId: s.tenantId,
        totalCount: 20,
        perUserLimit: 20,
        validFrom: new Date(Date.now() - 86400000).toISOString(),
        validUntil: new Date(Date.now() + 86400000 * 5).toISOString(),
      });
      const revision = (
        await owner.query<{ revision: string }>(
          "select extract(epoch from updated_at)::text revision from promotion.voucher_batches where id=$1",
          [r.batchId],
        )
      ).rows[0]!.revision;
      await management.actOnBatch(reviewer, r.batchId, {
        ...command(),
        action: "review",
        expectedRevision: revision,
      });
      return r.batchId;
    }
    async function gift() {
      const s = await scope(),
        b = await batch(s),
        v = await management.assign(operator, {
          ...command(),
          batchId: b,
          count: 1,
          targetTenantId: s.tenantId,
          targetUserId: s.userId,
        });
      return { s, b, id: v.voucherIds[0]! };
    }
    async function paid() {
      const s = await scope(),
        b = await batch(s, 10000, 1000),
        p = await payment(s),
        issue = await management.issueClaimCredentials(
          operator,
          b,
          { ...command(), count: 1, fundingPaymentId: p },
          credentials,
        );
      const id = issue.voucherIds[0]!;
      await new PgVoucherClaims(customer, credentials).claim(s, {
        ...command(),
        secret: issue.credentials[0]!.secret,
        target: "user",
      });
      return { s, b, p, id };
    }
    async function redeem(f: { s: VoucherScope; id: string }) {
      const preview = await previewRechargeCard(customer, f.s, f.id);
      return redeemRechargeCard(customer, f.s, {
        voucherId: f.id,
        confirmation: preview.confirmation,
        idempotencyKey: randomUUID(),
      });
    }

    // ===========================================================================
    // Source verification, exact money and atomic evidence.
    // ===========================================================================
    it("posts an unfunded gift only to bonus and leaves preview read-only", async () => {
      const f = await gift();
      await previewRechargeCard(customer, f.s, f.id);
      expect(
        (
          await owner.query(
            "select * from billing.credits where tenant_id=$1",
            [f.s.tenantId],
          )
        ).rowCount,
      ).toBe(0);
      const r = await redeem(f);
      expect(r).toMatchObject({
        principal: "0.00",
        bonus: "10.00",
        balance: "10.00",
      });
      expect(
        await new PgWalletLedger(customer).summary(f.s.tenantId),
      ).toMatchObject({ principalBalance: "0.00", bonusBalance: "10.00" });
      expect(
        (
          await owner.query(
            "select * from promotion.voucher_redemptions where voucher_id=$1",
            [f.id],
          )
        ).rows[0],
      ).toMatchObject({
        kind: "recharge_card",
        principal_wallet_operation_id: null,
      });
    });
    it("converts reserved cash into principal and bonus without recording revenue twice", async () => {
      const f = await paid();
      const r = await redeem(f);
      expect(r).toMatchObject({
        principal: "100.00",
        bonus: "10.00",
        balance: "110.00",
      });
      expect(
        await new PgWalletLedger(customer).summary(f.s.tenantId),
      ).toMatchObject({ principalBalance: "100.00", bonusBalance: "10.00" });
      expect(
        (
          await owner.query(
            "select status from billing.wallet_card_allocations where voucher_id=$1",
            [f.id],
          )
        ).rows[0].status,
      ).toBe("transferred");
      expect(
        (
          await owner.query(
            "select count(*)::int n from billing.transactions where tenant_id=$1 and trade_type='recharge'",
            [f.s.tenantId],
          )
        ).rows[0].n,
      ).toBe(1);
      expect(
        (
          await new PgCustomerVoucherLedger(customer).page(f.s, {
            status: "redeemed",
          })
        ).total,
      ).toBe(1);
    });
    it("blocks principal issue/assignment without verified source", async () => {
      const s = await scope(),
        b = await batch(s, 10000);
      await expect(
        management.issueClaimCredentials(
          operator,
          b,
          { ...command(), count: 1 },
          credentials,
        ),
      ).rejects.toThrow("本金卡");
      await expect(
        management.assign(operator, {
          ...command(),
          batchId: b,
          count: 1,
          targetTenantId: s.tenantId,
        }),
      ).rejects.toThrow("本金卡");
    });
    it("serializes competing issuances spending the same payment", async () => {
      const s = await scope(),
        b = await batch(s, 10000),
        p = await payment(s);
      const results = await Promise.allSettled(
        [1, 2].map(() =>
          management.issueClaimCredentials(
            operator,
            b,
            { ...command(), count: 1, fundingPaymentId: p },
            credentials,
          ),
        ),
      );
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(
        (
          await owner.query(
            "select sum(amount)::text amount from billing.wallet_card_allocations where payment_id=$1",
            [p],
          )
        ).rows[0].amount,
      ).toBe("100.00");
    });
    it("blocks a direct wallet deposit spending card-reserved cash", async () => {
      const f = await paid();
      await expect(
        new PgWalletLedger(customer).post(
          {
            tenantId: f.s.tenantId,
            actorId: f.s.userId,
            actorType: "customer",
            currency: "CNY",
          },
          {
            action: "principal",
            amountCents: 1,
            paymentId: f.p,
            idempotencyKey: randomUUID(),
          },
        ),
      ).rejects.toThrow("不足");
    });
    it("rejects cash from another tenant", async () => {
      const s = await scope(),
        other = await scope(),
        b = await batch(s, 10000),
        p = await payment(other);
      await expect(
        management.issueClaimCredentials(
          operator,
          b,
          { ...command(), count: 1, fundingPaymentId: p },
          credentials,
        ),
      ).rejects.toThrow("当前租户");
    });
    it("releases source only with an unused card revocation", async () => {
      const f = await paid();
      await management.revoke(operator, f.id, command());
      expect(
        (
          await owner.query(
            "select status from billing.wallet_card_allocations where voucher_id=$1",
            [f.id],
          )
        ).rows[0].status,
      ).toBe("released");
      await expect(redeem(f)).rejects.toThrow();
      const issue = await management.issueClaimCredentials(
        operator,
        f.b,
        { ...command(), count: 1, fundingPaymentId: f.p },
        credentials,
      );
      expect(issue.voucherIds).toHaveLength(1);
    });
    it("does not release or revoke already converted principal", async () => {
      const f = await paid();
      await redeem(f);
      await expect(
        management.revoke(operator, f.id, command()),
      ).rejects.toThrow("不可撤回");
    });
    it("returns the original result for simultaneous retries and recovers after a lost reply", async () => {
      const f = await gift(),
        p = await previewRechargeCard(customer, f.s, f.id),
        c = { ...command(), voucherId: f.id, confirmation: p.confirmation };
      const results = await Promise.all([
        redeemRechargeCard(customer, f.s, {
          voucherId: c.voucherId,
          confirmation: c.confirmation,
          idempotencyKey: c.idempotencyKey,
        }),
        redeemRechargeCard(customer, f.s, {
          voucherId: c.voucherId,
          confirmation: c.confirmation,
          idempotencyKey: c.idempotencyKey,
        }),
      ]);
      expect(results[0]).toEqual(results[1]);
      expect(await rechargeCardResult(customer, f.s, c.idempotencyKey)).toEqual(
        results[0],
      );
      await expect(
        redeemRechargeCard(customer, f.s, {
          voucherId: f.id,
          confirmation: "0".repeat(64),
          idempotencyKey: c.idempotencyKey,
        }),
      ).rejects.toThrow("已改变");
    });
    it("one card wins competing distinct requests", async () => {
      const f = await paid(),
        p = await previewRechargeCard(customer, f.s, f.id);
      const r = await Promise.allSettled(
        [1, 2].map(() =>
          redeemRechargeCard(customer, f.s, {
            voucherId: f.id,
            confirmation: p.confirmation,
            idempotencyKey: randomUUID(),
          }),
        ),
      );
      expect(r.filter((v) => v.status === "fulfilled")).toHaveLength(1);
      expect(
        (
          await owner.query(
            "select count(*)::int n from promotion.voucher_redemptions where voucher_id=$1",
            [f.id],
          )
        ).rows[0].n,
      ).toBe(1);
    });
    it("rejects injected funding and stale confirmations without any money effects", async () => {
      const f = await paid(),
        p = await previewRechargeCard(customer, f.s, f.id);
      await expect(
        redeemRechargeCard(customer, f.s, {
          voucherId: f.id,
          confirmation: p.confirmation,
          idempotencyKey: randomUUID(),
          paymentId: f.p,
        } as Parameters<typeof redeemRechargeCard>[2]),
      ).rejects.toThrow("仅接受");
      await expect(
        redeemRechargeCard(customer, f.s, {
          voucherId: f.id,
          confirmation: "0".repeat(64),
          idempotencyKey: randomUUID(),
        }),
      ).rejects.toThrow("重新预览");
      expect(
        (
          await owner.query(
            "select status from billing.wallet_card_allocations where voucher_id=$1",
            [f.id],
          )
        ).rows[0].status,
      ).toBe("reserved");
    });
    it("refuses legacy nonzero wallets in preview and execution", async () => {
      const f = await gift();
      await owner.query(
        "insert into billing.credits(tenant_id,balance) values($1,12.34)",
        [f.s.tenantId],
      );
      await expect(previewRechargeCard(customer, f.s, f.id)).rejects.toThrow(
        "历史来源",
      );
      expect(
        (
          await new PgCustomerVoucherLedger(customer).page(f.s, {
            status: "unavailable",
          })
        ).total,
      ).toBe(1);
    });
    it("enforces tenant ownership for preview and result recovery", async () => {
      const f = await gift(),
        other = await scope();
      const p = await previewRechargeCard(customer, f.s, f.id),
        c = {
          voucherId: f.id,
          confirmation: p.confirmation,
          idempotencyKey: randomUUID(),
        };
      await redeemRechargeCard(customer, f.s, c);
      expect(
        await rechargeCardResult(customer, other, c.idempotencyKey),
      ).toBeNull();
      await expect(
        previewRechargeCard(customer, other, f.id),
      ).rejects.toThrow();
    });
    it("does not persist confidential claim credentials in receipts or events", async () => {
      const s = await scope(),
        b = await batch(s),
        c = { ...command(), count: 1 },
        issued = await management.issueClaimCredentials(
          operator,
          b,
          c,
          credentials,
        ),
        replayed = await management.issueClaimCredentials(
          operator,
          b,
          c,
          credentials,
        );
      expect(replayed.credentials).toEqual([]);
      const evidence = JSON.stringify(
        (
          await owner.query(
            "select result from promotion.voucher_operations where batch_id=$1 union all select metadata from promotion.voucher_events where batch_id=$1",
            [b],
          )
        ).rows,
      );
      expect(evidence).not.toContain(issued.credentials[0]!.secret);
    });

    // =======================================================================
    // Rollbacks, expiry and refunds share the same source capacity guard.
    // =======================================================================
    it("preserves exact principal cents such as 0.29", async () => {
      const s = await scope(),
        b = await batch(s, 29, 0),
        p = await payment(s, "0.29");
      const issue = await management.issueClaimCredentials(
        operator,
        b,
        { ...command(), count: 1, fundingPaymentId: p },
        credentials,
      );
      await new PgVoucherClaims(customer, credentials).claim(s, {
        ...command(),
        secret: issue.credentials[0]!.secret,
        target: "user",
      });
      expect(await redeem({ s, id: issue.voucherIds[0]! })).toMatchObject({
        principal: "0.29",
        bonus: "0.00",
        balance: "0.29",
        bonusExpiresAt: null,
      });
    });
    it("rolls back principal and voucher when the bonus posting fails", async () => {
      const f = await paid();
      await owner.query("insert into billing.credits(tenant_id) values($1)", [
        f.s.tenantId,
      ]);
      const wallet = (
        await owner.query("select id from billing.credits where tenant_id=$1", [
          f.s.tenantId,
        ])
      ).rows[0].id;
      await owner.query(
        "alter table billing.wallet_lots add constraint b11_reject_bonus check(kind<>'bonus' or credit_id<>'" +
          wallet +
          "'::uuid) not valid",
      );
      try {
        await expect(redeem(f)).rejects.toThrow("b11_reject_bonus");
      } finally {
        await owner.query(
          "alter table billing.wallet_lots drop constraint b11_reject_bonus",
        );
      }
      expect(
        (
          await owner.query(
            "select status from billing.wallet_card_allocations where voucher_id=$1",
            [f.id],
          )
        ).rows[0].status,
      ).toBe("reserved");
      expect(
        (
          await owner.query(
            "select status from promotion.vouchers where id=$1",
            [f.id],
          )
        ).rows[0].status,
      ).toBe("assigned");
      expect(
        (
          await owner.query(
            "select count(*)::int n from billing.wallet_operations o join billing.credits c on c.id=o.credit_id where c.tenant_id=$1",
            [f.s.tenantId],
          )
        ).rows[0].n,
      ).toBe(0);
      expect(
        (
          await owner.query(
            "select balance::text from billing.credits where tenant_id=$1",
            [f.s.tenantId],
          )
        ).rows[0].balance,
      ).toBe("0.00");
      expect(await redeem(f)).toMatchObject({ balance: "110.00" });
    });
    it("rechecks expiry after waiting for the wallet lock", async () => {
      const f = await gift();
      await owner.query("insert into billing.credits(tenant_id) values($1)", [
        f.s.tenantId,
      ]);
      const preview = await previewRechargeCard(customer, f.s, f.id),
        blocker = await owner.connect();
      await blocker.query("begin");
      await blocker.query(
        "select id from billing.credits where tenant_id=$1 for update",
        [f.s.tenantId],
      );
      const result = redeemRechargeCard(customer, f.s, {
        voucherId: f.id,
        confirmation: preview.confirmation,
        idempotencyKey: randomUUID(),
      }).then(
        () => "success",
        () => "rejected",
      );
      try {
        await setTimeout(100);
        await owner.query(
          "update promotion.voucher_batches set valid_until=clock_timestamp()+interval '100 milliseconds' where id=$1",
          [f.b],
        );
        await setTimeout(200);
        await blocker.query("commit");
      } finally {
        await blocker.query("rollback");
        blocker.release();
      }
      expect(await result).toBe("rejected");
      expect(
        (
          await owner.query(
            "select balance::text from billing.credits where tenant_id=$1",
            [f.s.tenantId],
          )
        ).rows[0].balance,
      ).toBe("0.00");
    });
    it("serializes redemption versus revocation without stranded principal", async () => {
      const f = await paid(),
        p = await previewRechargeCard(customer, f.s, f.id);
      const results = await Promise.allSettled([
        redeemRechargeCard(customer, f.s, {
          voucherId: f.id,
          confirmation: p.confirmation,
          idempotencyKey: randomUUID(),
        }),
        management.revoke(operator, f.id, command()),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const status = (
        await owner.query(
          "select status from billing.wallet_card_allocations where voucher_id=$1",
          [f.id],
        )
      ).rows[0].status;
      expect(["released", "transferred"]).toContain(status);
      expect(
        (await new PgWalletLedger(customer).summary(f.s.tenantId)).balance,
      ).toBe(status === "transferred" ? "110.00" : "0.00");
    });
    it("card issue and cash-refund reservation cannot spend the same receipt", async () => {
      const s = await scope(),
        b = await batch(s, 10000),
        p = await payment(s);
      const refund = async () => {
        const c = await admin.connect();
        try {
          await c.query("begin");
          const r = randomUUID();
          await c.query(
            `insert into billing.refunds(id,tenant_id,bill_id,pay_record_id,refund_no,refund_amount,created_by_type,created_by_id) select $1,tenant_id,bill_id,id,$2,100,'operator',$3 from billing.payments where id=$4`,
            [r, "RF-" + r, operator, p],
          );
          await c.query(
            "insert into billing.refund_allocations(refund_id,payment_id,currency,amount) values($1,$2,'CNY',100)",
            [r, p],
          );
          await c.query("commit");
        } catch (e) {
          await c.query("rollback");
          throw e;
        } finally {
          c.release();
        }
      };
      const results = await Promise.allSettled([
        management.issueClaimCredentials(
          operator,
          b,
          { ...command(), count: 1, fundingPaymentId: p },
          credentials,
        ),
        refund(),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    });
    it("database permissions prevent rewriting funding facts", async () => {
      const f = await paid();
      await expect(
        admin.query(
          "update billing.wallet_card_allocations set amount=1 where voucher_id=$1",
          [f.id],
        ),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        admin.query(
          "delete from billing.wallet_card_allocations where voucher_id=$1",
          [f.id],
        ),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        admin.query(
          "update billing.wallet_card_allocations set status='released' where voucher_id=$1",
          [f.id],
        ),
      ).rejects.toThrow("inconsistent");
    });
    it("reclaims the linked bonus while preserving principal provenance", async () => {
      const f = await paid();
      await redeem(f);
      const bonus = (
        await owner.query(
          "select l.id from promotion.voucher_redemptions r join billing.wallet_lots l on l.operation_id=r.bonus_wallet_operation_id where r.voucher_id=$1",
          [f.id],
        )
      ).rows[0].id;
      await new PgWalletLedger(customer).post(
        {
          tenantId: f.s.tenantId,
          actorId: f.s.userId,
          actorType: "customer",
          currency: "CNY",
        },
        { action: "reclaim", lotId: bonus, idempotencyKey: randomUUID() },
      );
      expect(
        await new PgWalletLedger(customer).summary(f.s.tenantId),
      ).toMatchObject({
        principalBalance: "100.00",
        bonusBalance: "0.00",
        balance: "100.00",
      });
    });
    it("reapplies the expansion migration without changing money history", async () => {
      const before = (
        await owner.query(
          "select count(*)::int n from billing.wallet_operations",
        )
      ).rows[0].n;
      const sql = readFileSync(
        `${root}/migrations/2026-12-11-recharge-card-funding.sql`,
        "utf8",
      );
      await owner.query(sql);
      await owner.query(sql);
      await owner.query(
        readFileSync(`${root}/verify/recharge-card-preflight.sql`, "utf8"),
      );
      expect(
        (
          await owner.query(
            "select count(*)::int n from billing.wallet_operations",
          )
        ).rows[0].n,
      ).toBe(before);
      expect(await redeem(await paid())).toMatchObject({ balance: "110.00" });
    });
  },
);
