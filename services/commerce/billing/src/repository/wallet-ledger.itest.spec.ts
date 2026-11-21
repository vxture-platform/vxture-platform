/**
 * wallet-ledger.itest.spec.ts - Wallet sources on disposable PostgreSQL and real roles.
 * @package @vxture/service-billing
 * @layer Domain
 * @category test
 * @author AI-Generated
 * @date 2026-11-20
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { setTimeout } from "node:timers/promises";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PgWalletLedger } from "./pg-wallet-ledger";
import { PgRechargeCardFunding } from "./pg-recharge-card-funding";
import { PgTenantClosureRepository } from "./pg-tenant-closure.repository";
import type { WalletContext, WalletCommand } from "../types/wallet.types";

// ===========================================================================
// The suite owns this container and never reads a configured database URL.
// ===========================================================================
describe.skipIf(process.env["WALLET_LEDGER_ITEST"] !== "1")(
  "B10 wallet source PostgreSQL",
  () => {
    const runId = randomUUID();
    const container = `codex-wallet-b10-${runId.slice(0, 12)}`;
    let containerId = "";
    let owner: Pool,
      runtime: Pool,
      ledger: PgWalletLedger,
      started = false;
    const docker = (args: string[]) =>
      execFileSync("docker", args, {
        encoding: "utf8",
        timeout: 60000,
        stdio: ["pipe", "pipe", "pipe"],
      });
    beforeAll(async () => {
      containerId = docker([
        "run",
        "--detach",
        "--pull=never",
        "--name",
        container,
        "--label",
        `codex.run=${runId}`,
        "--env",
        "POSTGRES_HOST_AUTH_METHOD=trust",
        "--publish",
        "127.0.0.1::5432",
        "postgres:18-alpine",
      ]).trim();
      started = true;
      console.info(
        "S07_R2B_CONTAINER_OWNERSHIP=" +
          JSON.stringify({ name: container, id: containerId, runId }),
      );
      const info = JSON.parse(docker(["inspect", container]))[0];
      expect(info.Id).toBe(containerId);
      expect(info.Config.Labels["codex.run"]).toBe(runId);
      expect(info.HostConfig.PortBindings["5432/tcp"]).toEqual([
        { HostIp: "127.0.0.1", HostPort: "" },
      ]);
      console.info(`S07_R2A_CONTAINER_CREATED=${container}`);
      for (let attempt = 0; ; attempt++)
        try {
          docker([
            "exec",
            container,
            "pg_isready",
            "-h",
            "127.0.0.1",
            "-U",
            "postgres",
          ]);
          break;
        } catch (error) {
          if (attempt === 40) throw error;
          await setTimeout(250);
        }
      const port = Number(
        docker(["port", container, "5432/tcp"]).trim().split(":").at(-1),
      );
      owner = new Pool({
        host: "127.0.0.1",
        port,
        user: "postgres",
        database: "postgres",
        password: "",
        ssl: false,
        connectionTimeoutMillis: 10000,
        statement_timeout: 20000,
        idle_in_transaction_session_timeout: 20000,
      });
      const dir = fileURLToPath(
        new URL("../../../../../deploy/database/ddl/", import.meta.url),
      );
      for (const name of readdirSync(dir)
        .filter((n) => /^\d.*\.sql$/.test(n))
        .sort())
        await owner.query(readFileSync(`${dir}/${name}`, "utf8"));
      await owner.query(
        "alter role svc_console_bff login;alter role svc_auth_bff login",
      );
      runtime = new Pool({
        host: "127.0.0.1",
        port,
        user: "svc_console_bff",
        database: "postgres",
        password: "",
        ssl: false,
        connectionTimeoutMillis: 10000,
        statement_timeout: 20000,
        idle_in_transaction_session_timeout: 20000,
      });
      ledger = new PgWalletLedger(runtime);
    }, 60000);
    afterAll(async () => {
      try {
        await runtime?.end();
      } finally {
        try {
          await owner?.end();
        } finally {
          if (started) {
            const info = JSON.parse(docker(["inspect", container]))[0];
            expect(info.Id).toBe(containerId);
            expect(info.Config.Labels["codex.run"]).toBe(runId);
            docker(["rm", "--force", "--volumes", container]);
            console.info(`S07_R2A_CONTAINER_CLEANED=${container}`);
          }
        }
      }
    }, 60000);
    async function fixture(): Promise<WalletContext> {
      const tenantId = randomUUID(),
        actorId = randomUUID();
      await owner.query(
        "insert into account.users(id,account,phone,phone_verified_at) values($1::uuid,$1::text,$2,now())",
        [actorId, `+${Date.now()}${Math.floor(Math.random() * 100000)}`],
      );
      await owner.query(
        "insert into tenancy.tenants(id,name,type,owner_user_id) values($1,'B10 tenant','organization',$2)",
        [tenantId, actorId],
      );
      return { tenantId, actorId, actorType: "customer", currency: "CNY" };
    }
    async function payment(scope: WalletContext, amount = "10.00") {
      const invoice = randomUUID(),
        id = randomUUID(),
        transaction = randomUUID();
      await owner.query(
        "insert into billing.invoices(id,tenant_id,bill_no,bill_cycle,cycle_start_date,cycle_end_date,total_amount,payable_amount,paid_amount,bill_status,bill_type,created_by_type) values($1,$2,$3,'202611','2026-11-01','2026-11-30',$4,$4,$4,'paid','one_off','system')",
        [invoice, scope.tenantId, `INV-${invoice}`, amount],
      );
      await owner.query(
        "insert into billing.transactions(id,tenant_id,bill_id,transaction_no,trade_type,source_method,amount,currency,balance_before,balance_after,trade_status,actor_type) values($1,$2,$3,$4,'recharge','offline',$5,'CNY',0,0,'success','system')",
        [transaction, scope.tenantId, invoice, `TXN-${transaction}`, amount],
      );
      await owner.query(
        "insert into billing.payments(id,tenant_id,bill_id,transaction_id,pay_order_no,pay_source,total_amount,paid_amount,pay_status,paid_at) values($1,$2,$3,$4,$5,'offline',$6,$6,'paid',now())",
        [id, scope.tenantId, invoice, transaction, `PAY-${id}`, amount],
      );
      return { id, invoice, transaction };
    }
    const key = () => randomUUID();
    const grant = (scope: WalletContext, cents = 1000) =>
      ledger.post(scope, {
        action: "bonus",
        amountCents: cents,
        idempotencyKey: key(),
      });

    // Card funding uses the same locked cash capacity as wallet principal.
    async function reserveCard(
      scope: WalletContext,
      source: { id: string },
      amountCents: number,
      commit = true,
    ) {
      const batchId = randomUUID(),
        voucherId = randomUUID();
      const funding = new PgRechargeCardFunding(runtime);
      const client = await runtime.connect();
      try {
        await client.query("begin");
        await funding.lockSource(client, {
          paymentId: source.id,
          tenantId: scope.tenantId,
          amountCents,
        });
        await client.query(
          `insert into promotion.voucher_batches(id,tenant_id,kind,name,effect,total_count,issued_count,valid_from,valid_until)
           values($1,$2,'recharge_card','S07 card funding',$3::jsonb,1,1,now()-interval '1 day',now()+interval '1 day')`,
          [
            batchId,
            scope.tenantId,
            JSON.stringify({
              effect_version: 1,
              currency: "CNY",
              face_value_cents: amountCents,
              bonus_cents: 0,
            }),
          ],
        );
        await client.query(
          "insert into promotion.vouchers(id,batch_id,code,funding_payment_id) values($1,$2,$3,$4)",
          [voucherId, batchId, `CARD-${voucherId}`, source.id],
        );
        await funding.reserve(client, {
          voucherId,
          paymentId: source.id,
          amountCents,
        });
        await client.query(commit ? "commit" : "rollback");
        return { batchId, voucherId };
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    }

    it("lists tenant-scoped cash capacity and reserves card principal through the funding service", async () => {
      const s = await fixture(),
        other = await fixture();
      const p = await payment(s),
        foreign = await payment(other);
      const funding = new PgRechargeCardFunding(runtime);
      expect(await funding.sources(s.tenantId)).toEqual([
        {
          id: p.id,
          paymentNo: `PAY-${p.id}`,
          paidAmount: "10.00",
          availableAmount: "10.00",
        },
      ]);
      await reserveCard(s, p, 600);
      expect(await funding.sources(s.tenantId)).toEqual([
        {
          id: p.id,
          paymentNo: `PAY-${p.id}`,
          paidAmount: "10.00",
          availableAmount: "4.00",
        },
      ]);
      await expect(reserveCard(s, foreign, 100)).rejects.toThrow("当前租户");
      await expect(
        ledger.post(s, {
          action: "principal",
          paymentId: p.id,
          amountCents: 500,
          idempotencyKey: key(),
        }),
      ).rejects.toThrow("可分配本金不足");
    });

    it("rolls back card funding, voucher and batch together in a caller-owned transaction", async () => {
      const s = await fixture(),
        p = await payment(s);
      const card = await reserveCard(s, p, 600, false);
      expect(
        (
          await owner.query(
            `select exists(select from promotion.voucher_batches where id=$1)
          or exists(select from promotion.vouchers where id=$2)
          or exists(select from billing.wallet_card_allocations where voucher_id=$2) as found`,
            [card.batchId, card.voucherId],
          )
        ).rows[0].found,
      ).toBe(false);
      expect(
        await new PgRechargeCardFunding(runtime).sources(s.tenantId),
      ).toMatchObject([{ availableAmount: "10.00" }]);
    });

    it("serializes card issuance against competing wallet principal without overspending cash", async () => {
      const s = await fixture(),
        p = await payment(s);
      const results = await Promise.allSettled([
        reserveCard(s, p, 600),
        ledger.post(s, {
          action: "principal",
          paymentId: p.id,
          amountCents: 600,
          idempotencyKey: key(),
        }),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(
        (
          await owner.query(
            `select ((select coalesce(sum(amount),0) from billing.wallet_lots where funding_payment_id=$1)
          +(select coalesce(sum(amount),0) from billing.wallet_card_allocations where payment_id=$1 and status='reserved'))::text as amount`,
            [p.id],
          )
        ).rows[0].amount,
      ).toBe("6.00");
    });

    it("releases revoked card capacity once and rolls back release of an active card", async () => {
      const s = await fixture(),
        p = await payment(s);
      const card = await reserveCard(s, p, 600);
      const funding = new PgRechargeCardFunding(runtime);
      const client = await runtime.connect();
      try {
        await client.query("begin");
        await funding.lockRelease(client, card.voucherId);
        await funding.release(client, card.voucherId);
        await expect(client.query("commit")).rejects.toThrow(
          "card cash evidence inconsistent",
        );
        await client.query("rollback");
        expect(await funding.sources(s.tenantId)).toMatchObject([
          { availableAmount: "4.00" },
        ]);
        await client.query("begin");
        await funding.lockRelease(client, card.voucherId);
        await client.query(
          "update promotion.vouchers set status='revoked' where id=$1",
          [card.voucherId],
        );
        await funding.release(client, card.voucherId);
        await client.query("commit");
        expect(await funding.sources(s.tenantId)).toMatchObject([
          { availableAmount: "10.00" },
        ]);
        const before = (
          await owner.query(
            "select to_jsonb(a) as row from billing.wallet_card_allocations a where voucher_id=$1",
            [card.voucherId],
          )
        ).rows[0].row;
        await client.query("begin");
        await funding.lockRelease(client, card.voucherId);
        await funding.release(client, card.voucherId);
        await client.query("commit");
        expect(
          (
            await owner.query(
              "select to_jsonb(a) as row from billing.wallet_card_allocations a where voucher_id=$1",
              [card.voucherId],
            )
          ).rows[0].row,
        ).toEqual(before);
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    });

    // =========================================================================
    // Source proof, exact allocations, idempotency and ownership.
    // =========================================================================
    it("keeps absent and unverified balances distinct, and never reclassifies legacy money", async () => {
      const s = await fixture();
      expect(await ledger.summary(s.tenantId)).toMatchObject({
        status: "absent",
        principalBalance: null,
      });
      await owner.query(
        "insert into billing.credits(tenant_id,balance) values($1,12.34)",
        [s.tenantId],
      );
      expect(await ledger.summary(s.tenantId)).toMatchObject({
        status: "unverified",
        balance: "12.34",
        principalBalance: null,
        bonusBalance: null,
      });
      await expect(grant(s)).rejects.toThrow("历史钱包");
      await expect(
        new PgTenantClosureRepository(runtime).getSnapshot(s.tenantId),
      ).rejects.toThrow("来源核对");
      expect(
        (
          await owner.query(
            "select count(*)::int n from billing.wallet_operations o join billing.credits c on c.id=o.credit_id where c.tenant_id=$1",
            [s.tenantId],
          )
        ).rows[0].n,
      ).toBe(0);
    });
    it("uses one proven cash receipt, segregates gift money and leaves receipt revenue unchanged", async () => {
      const s = await fixture(),
        p = await payment(s);
      await ledger.post(s, {
        action: "principal",
        paymentId: p.id,
        amountCents: 1000,
        idempotencyKey: key(),
      });
      await grant(s, 500);
      expect(await ledger.summary(s.tenantId)).toMatchObject({
        status: "ready",
        balance: "15.00",
        principalBalance: "10.00",
        bonusBalance: "5.00",
        availableBalance: "15.00",
      });
      const receipts = await owner.query(
        "select count(*)::int n,sum(amount)::text amount from billing.transactions where tenant_id=$1 and trade_type='recharge'",
        [s.tenantId],
      );
      expect(receipts.rows[0]).toEqual({ n: 1, amount: "10.00" });
      expect(
        await new PgTenantClosureRepository(runtime).getSnapshot(s.tenantId),
      ).toMatchObject({ paidBalance: "10.00", giftedBalance: "5.00" });
    });
    it("consumes gifts before principal and returns to the original sources", async () => {
      const s = await fixture(),
        p = await payment(s);
      await grant(s, 500);
      await ledger.post(s, {
        action: "principal",
        paymentId: p.id,
        amountCents: 1000,
        idempotencyKey: key(),
      });
      const spent = await ledger.post(s, {
        action: "consume",
        amountCents: 800,
        idempotencyKey: key(),
      });
      expect(await ledger.summary(s.tenantId)).toMatchObject({
        principalBalance: "7.00",
        bonusBalance: "0.00",
      });
      await ledger.post(s, {
        action: "restore",
        consumptionId: spent.operationId,
        amountCents: 800,
        idempotencyKey: key(),
      });
      expect(await ledger.summary(s.tenantId)).toMatchObject({
        principalBalance: "10.00",
        bonusBalance: "5.00",
      });
      await expect(
        ledger.post(s, {
          action: "restore",
          consumptionId: spent.operationId,
          amountCents: 1,
          idempotencyKey: key(),
        }),
      ).rejects.toThrow("未退金额");
    });
    it("partially restores without exceeding each original debit", async () => {
      const s = await fixture();
      await grant(s, 1001);
      const spent = await ledger.post(s, {
        action: "consume",
        amountCents: 1001,
        idempotencyKey: key(),
      });
      for (const n of [333, 333, 335])
        await ledger.post(s, {
          action: "restore",
          consumptionId: spent.operationId,
          amountCents: n,
          idempotencyKey: key(),
        });
      expect(await ledger.summary(s.tenantId)).toMatchObject({
        balance: "10.01",
        bonusBalance: "10.01",
      });
      await expect(
        ledger.post(s, {
          action: "restore",
          consumptionId: spent.operationId,
          amountCents: 1,
          idempotencyKey: key(),
        }),
      ).rejects.toThrow();
    });
    it("replays a concurrent request once and rejects changed amount, actor or currency", async () => {
      const s = await fixture(),
        cmd: WalletCommand = {
          action: "bonus",
          amountCents: 29,
          idempotencyKey: key(),
        };
      const [a, b] = await Promise.all([
        ledger.post(s, cmd),
        ledger.post(s, cmd),
      ]);
      expect(a).toEqual(b);
      for (const [scope, command] of [
        [s, { ...cmd, amountCents: 30 }],
        [{ ...s, actorId: randomUUID() }, cmd],
        [{ ...s, currency: "USD" }, cmd],
      ] as const)
        await expect(ledger.post(scope, command)).rejects.toThrow("请求标识");
      expect(await ledger.summary(s.tenantId)).toMatchObject({
        balance: "0.29",
      });
    });
    it("serializes competing debits without overdraft", async () => {
      const s = await fixture();
      await grant(s);
      const results = await Promise.allSettled(
        [1, 2].map(() =>
          ledger.post(s, {
            action: "consume",
            amountCents: 700,
            idempotencyKey: key(),
          }),
        ),
      );
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(await ledger.summary(s.tenantId)).toMatchObject({
        balance: "3.00",
      });
    });
    it("serializes competing restores without duplicating the original debit", async () => {
      const s = await fixture();
      await grant(s);
      const spent = await ledger.post(s, {
        action: "consume",
        amountCents: 1000,
        idempotencyKey: key(),
      });
      const results = await Promise.allSettled(
        [1, 2].map(() =>
          ledger.post(s, {
            action: "restore",
            consumptionId: spent.operationId,
            amountCents: 700,
            idempotencyKey: key(),
          }),
        ),
      );
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(await ledger.summary(s.tenantId)).toMatchObject({
        balance: "7.00",
      });
    });
    it("does not allocate one cash payment twice under different keys", async () => {
      const s = await fixture(),
        p = await payment(s);
      const results = await Promise.allSettled(
        [1, 2].map(() =>
          ledger.post(s, {
            action: "principal",
            paymentId: p.id,
            amountCents: 600,
            idempotencyKey: key(),
          }),
        ),
      );
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(await ledger.summary(s.tenantId)).toMatchObject({
        principalBalance: "6.00",
      });
    });
    it("rejects foreign payments, foreign consumption and principal reclamation", async () => {
      const s = await fixture(),
        other = await fixture(),
        p = await payment(s);
      const principal = await ledger.post(s, {
        action: "principal",
        paymentId: p.id,
        amountCents: 1000,
        idempotencyKey: key(),
      });
      const spent = await ledger.post(s, {
        action: "consume",
        amountCents: 100,
        idempotencyKey: key(),
      });
      await expect(
        ledger.post(other, {
          action: "principal",
          paymentId: p.id,
          amountCents: 100,
          idempotencyKey: key(),
        }),
      ).rejects.toThrow("当前租户");
      await expect(
        ledger.post(other, {
          action: "restore",
          consumptionId: spent.operationId,
          amountCents: 100,
          idempotencyKey: key(),
        }),
      ).rejects.toThrow("当前钱包");
      await expect(
        ledger.post(s, {
          action: "reclaim",
          lotId: principal.lotId!,
          idempotencyKey: key(),
        }),
      ).rejects.toThrow("赠额");
    });
    it.each(["pending", "voucher", "no-receipt", "subscription-invoice"])(
      "rejects unproven principal: %s",
      async (kind) => {
        const s = await fixture(),
          p = await payment(s);
        if (kind === "pending")
          await owner.query(
            "update billing.payments set pay_status='pending' where id=$1",
            [p.id],
          );
        if (kind === "voucher")
          await owner.query(
            "update billing.payments set pay_source='voucher' where id=$1",
            [p.id],
          );
        if (kind === "no-receipt")
          await owner.query(
            "update billing.payments set transaction_id=null where id=$1",
            [p.id],
          );
        if (kind === "subscription-invoice")
          await owner.query(
            "update billing.invoices set bill_type='normal' where id=$1",
            [p.invoice],
          );
        await expect(
          ledger.post(s, {
            action: "principal",
            paymentId: p.id,
            amountCents: 1000,
            idempotencyKey: key(),
          }),
        ).rejects.toThrow("真实已入账");
      },
    );

    // =========================================================================
    // Expiration never revives gifts; SQL and transaction failures retain evidence.
    // =========================================================================
    it("uses the earliest expiring gift before an unrestricted gift", async () => {
      const s = await fixture();
      const later = await grant(s, 100);
      const first = await ledger.post(s, {
        action: "bonus",
        amountCents: 100,
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        idempotencyKey: key(),
      });
      const spent = await ledger.post(s, {
        action: "consume",
        amountCents: 50,
        idempotencyKey: key(),
      });
      const used = (
        await owner.query(
          "select lot_id from billing.wallet_entries where operation_id=$1",
          [spent.operationId],
        )
      ).rows;
      expect(used).toEqual([{ lot_id: first.lotId }]);
      expect(first.lotId).not.toBe(later.lotId);
    });
    it("binds invoice references before insertion and rejects a changed replay invoice", async () => {
      const s = await fixture(),
        p = await payment(s),
        other = await payment(s);
      await grant(s);
      const command: WalletCommand = {
        action: "consume",
        amountCents: 300,
        idempotencyKey: key(),
        invoiceId: p.invoice,
      };
      const spent = await ledger.post(s, command);
      expect(
        (
          await owner.query(
            "select bill_id from billing.transactions where id=$1",
            [spent.transactionId],
          )
        ).rows[0].bill_id,
      ).toBe(p.invoice);
      expect(await ledger.post(s, command)).toEqual(spent);
      await expect(
        ledger.post(s, { ...command, invoiceId: other.invoice }),
      ).rejects.toThrow("已改变");
      await expect(
        ledger.post(s, {
          action: "restore",
          amountCents: 300,
          consumptionId: spent.operationId,
          invoiceId: other.invoice,
          idempotencyKey: key(),
        }),
      ).rejects.toThrow("消费记录");
      await ledger.post(s, {
        action: "restore",
        amountCents: 300,
        consumptionId: spent.operationId,
        invoiceId: p.invoice,
        idempotencyKey: key(),
      });
      expect(
        (
          await owner.query(
            "select total_consumed::text from billing.credits where tenant_id=$1",
            [s.tenantId],
          )
        ).rows[0].total_consumed,
      ).toBe("0.00");
    });
    it("rejects another tenant's invoice and an unknown invoice without a debit", async () => {
      const s = await fixture(),
        other = await fixture(),
        p = await payment(other);
      await grant(s);
      for (const invoiceId of [p.invoice, randomUUID()])
        await expect(
          ledger.post(s, {
            action: "consume",
            amountCents: 100,
            invoiceId,
            idempotencyKey: key(),
          }),
        ).rejects.toThrow("账单归属");
      expect((await ledger.summary(s.tenantId)).balance).toBe("10.00");
    });
    it("requires the complete expected remainder for a bound bonus reversal", async () => {
      const s = await fixture(),
        receipt = await grant(s);
      await ledger.post(s, {
        action: "consume",
        amountCents: 100,
        idempotencyKey: key(),
      });
      await expect(
        ledger.post(s, {
          action: "reclaim",
          lotId: receipt.lotId!,
          amountCents: 1000,
          idempotencyKey: key(),
        }),
      ).rejects.toThrow("剩余不足");
      expect((await ledger.summary(s.tenantId)).balance).toBe("9.00");
    });
    it("expires only unused gifts and does not revive expired consumption refunds", async () => {
      const s = await fixture(),
        p = await payment(s);
      await ledger.post(s, {
        action: "principal",
        paymentId: p.id,
        amountCents: 1000,
        idempotencyKey: key(),
      });
      await ledger.post(s, {
        action: "bonus",
        amountCents: 1000,
        expiresAt: new Date(Date.now() + 2000).toISOString(),
        idempotencyKey: key(),
      });
      const spent = await ledger.post(s, {
        action: "consume",
        amountCents: 1500,
        idempotencyKey: key(),
      });
      await owner.query("select pg_sleep(2.1)");
      const restored = await ledger.post(s, {
        action: "restore",
        consumptionId: spent.operationId,
        amountCents: 1500,
        idempotencyKey: key(),
      });
      expect(restored).toMatchObject({
        amount: "5.00",
        restoredAmount: "15.00",
        expiredAmount: "10.00",
      });
      expect(await ledger.summary(s.tenantId)).toMatchObject({
        principalBalance: "10.00",
        bonusBalance: "0.00",
      });
      expect(
        (
          await owner.query(
            "select total_consumed::text from billing.credits where tenant_id=$1",
            [s.tenantId],
          )
        ).rows[0].total_consumed,
      ).toBe("0.00");
    });
    it("excludes expired gifts from availability before the expiry posting", async () => {
      const s = await fixture();
      await ledger.post(s, {
        action: "bonus",
        amountCents: 123,
        expiresAt: new Date(Date.now() + 1500).toISOString(),
        idempotencyKey: key(),
      });
      await owner.query("select pg_sleep(1.6)");
      expect(await ledger.summary(s.tenantId)).toMatchObject({
        balance: "1.23",
        availableBalance: "0.00",
        expiredBonusBalance: "1.23",
      });
      await expect(
        ledger.post(s, {
          action: "consume",
          amountCents: 1,
          idempotencyKey: key(),
        }),
      ).rejects.toThrow("余额不足");
      const cmd: WalletCommand = { action: "expire", idempotencyKey: key() };
      const first = await ledger.post(s, cmd);
      expect(first).toMatchObject({ amount: "-1.23", balance: "0.00" });
      expect(await ledger.post(s, cmd)).toEqual(first);
      expect(
        await ledger.post(s, { action: "expire", idempotencyKey: key() }),
      ).toMatchObject({ amount: "0.00" });
    });
    it("reclaims only the unused part of a bonus", async () => {
      const s = await fixture(),
        bonus = await grant(s);
      await ledger.post(s, {
        action: "consume",
        amountCents: 700,
        idempotencyKey: key(),
      });
      expect(
        await ledger.post(s, {
          action: "reclaim",
          lotId: bonus.lotId!,
          idempotencyKey: key(),
        }),
      ).toMatchObject({ amount: "-3.00", balance: "0.00" });
    });
    it.each(["wallet_operations", "wallet_lots", "wallet_entries", "credits"])(
      "rolls back every effect after an injected %s failure and permits retry",
      async (table) => {
        const s = await fixture(),
          cmd: WalletCommand = {
            action: "bonus",
            amountCents: 456,
            idempotencyKey: key(),
          };
        await owner.query(
          "create or replace function billing.b10_inject_failure() returns trigger language plpgsql as $$ begin raise exception 'B10 injected';end $$",
        );
        await owner.query(
          `create trigger b10_failure before ${table === "credits" ? "update" : "insert"} on billing.${table} for each row execute function billing.b10_inject_failure()`,
        );
        try {
          await expect(ledger.post(s, cmd)).rejects.toThrow("B10 injected");
        } finally {
          await owner.query(`drop trigger b10_failure on billing.${table}`);
        }
        expect(await ledger.summary(s.tenantId)).toMatchObject({
          status: "absent",
        });
        expect(await ledger.post(s, cmd)).toMatchObject({ balance: "4.56" });
      },
    );
    it("rejects legacy balance-only writers and mutation of posted evidence", async () => {
      const s = await fixture(),
        result = await grant(s);
      await expect(
        runtime.query(
          "update billing.credits set balance=balance+1 where tenant_id=$1",
          [s.tenantId],
        ),
      ).rejects.toThrow("reconciliation");
      for (const table of [
        "wallet_lots",
        "wallet_operations",
        "wallet_entries",
        "wallet_accounts",
      ]) {
        await expect(
          owner.query(`delete from billing.${table}`),
        ).rejects.toThrow("immutable wallet evidence");
      }
      expect(await ledger.summary(s.tenantId)).toMatchObject({
        balance: result.balance,
      });
    });
    it("can compose with voucher evidence in a caller-owned transaction and roll back together", async () => {
      const s = await fixture(),
        client = await runtime.connect(),
        cmd: WalletCommand = {
          action: "bonus",
          amountCents: 987,
          idempotencyKey: key(),
        };
      try {
        await client.query("begin");
        await ledger.postInTransaction(client, s, cmd);
        await client.query("rollback");
      } finally {
        client.release();
      }
      expect(await ledger.summary(s.tenantId)).toMatchObject({
        status: "absent",
      });
      expect(await ledger.post(s, cmd)).toMatchObject({ balance: "9.87" });
    });
    it("rechecks expiry after waiting for the wallet lock", async () => {
      const s = await fixture();
      await ledger.post(s, {
        action: "bonus",
        amountCents: 100,
        expiresAt: new Date(Date.now() + 1500).toISOString(),
        idempotencyKey: key(),
      });
      const locker = await owner.connect();
      try {
        await locker.query("begin");
        await locker.query(
          "select id from billing.credits where tenant_id=$1 for update",
          [s.tenantId],
        );
        const pending = ledger.post(s, {
          action: "consume",
          amountCents: 100,
          idempotencyKey: key(),
        });
        // Attach the rejection before releasing the held lock.
        const result = Promise.allSettled([pending]);
        await locker.query("select pg_sleep(1.6)");
        await locker.query("commit");
        const [outcome] = await result;
        expect(outcome?.status).toBe("rejected");
        expect(await ledger.summary(s.tenantId)).toMatchObject({
          balance: "1.00",
          availableBalance: "0.00",
        });
      } finally {
        await locker.query("rollback");
        locker.release();
      }
    });
    it("does not reuse one receipt transaction across different payment rows", async () => {
      const s = await fixture(),
        p = await payment(s),
        other = randomUUID();
      await owner.query(
        "insert into billing.payments(id,tenant_id,bill_id,transaction_id,pay_order_no,pay_source,total_amount,paid_amount,pay_status,paid_at) values($1,$2,$3,$4,$5,'offline',10,10,'paid',now())",
        [other, s.tenantId, p.invoice, p.transaction, `PAY-${other}`],
      );
      for (const id of [p.id, other])
        await expect(
          ledger.post(s, {
            action: "principal",
            amountCents: 1000,
            paymentId: id,
            idempotencyKey: key(),
          }),
        ).rejects.toThrow("真实已入账");
    });
    async function reserveRefund(
      scope: WalletContext,
      p: { id: string; invoice: string },
      amount = "5.00",
    ) {
      const refund = randomUUID();
      await owner.query(
        "insert into billing.refunds(id,tenant_id,bill_id,pay_record_id,refund_no,refund_amount,created_by_type,created_by_id) values($1,$2,$3,$4,$5,$6,'customer',$7)",
        [
          refund,
          scope.tenantId,
          p.invoice,
          p.id,
          `REF-${refund}`,
          amount,
          scope.actorId,
        ],
      );
      await runtime.query(
        "insert into billing.refund_allocations(refund_id,payment_id,currency,amount) values($1,$2,'CNY',$3)",
        [refund, p.id, amount],
      );
      return refund;
    }
    it("subtracts pending refunds from principal allocation, then honors released capacity", async () => {
      const s = await fixture(),
        p = await payment(s),
        refund = await reserveRefund(s, p);
      await expect(
        ledger.post(s, {
          action: "principal",
          paymentId: p.id,
          amountCents: 600,
          idempotencyKey: key(),
        }),
      ).rejects.toThrow("本金不足");
      await runtime.query(
        "update billing.refund_allocations set status='released',updated_at=now() where refund_id=$1",
        [refund],
      );
      await owner.query(
        "update billing.refunds set audit_status='rejected' where id=$1",
        [refund],
      );
      expect(
        await ledger.post(s, {
          action: "principal",
          paymentId: p.id,
          amountCents: 600,
          idempotencyKey: key(),
        }),
      ).toMatchObject({ balance: "6.00" });
    });
    it("blocks cash refund reservations from taking principal already assigned to a wallet", async () => {
      const s = await fixture(),
        p = await payment(s);
      await ledger.post(s, {
        action: "principal",
        paymentId: p.id,
        amountCents: 600,
        idempotencyKey: key(),
      });
      await expect(reserveRefund(s, p)).rejects.toThrow("already allocated");
      expect(await ledger.summary(s.tenantId)).toMatchObject({
        principalBalance: "6.00",
      });
    });
    it("rejects past expiry, mismatched wallet currency and over-consumption without effects", async () => {
      const s = await fixture();
      await grant(s, 29);
      await expect(
        ledger.post(s, {
          action: "bonus",
          amountCents: 1,
          expiresAt: "2000-01-01T00:00:00Z",
          idempotencyKey: key(),
        }),
      ).rejects.toThrow("未来");
      await expect(
        ledger.post(
          { ...s, currency: "USD" },
          { action: "bonus", amountCents: 1, idempotencyKey: key() },
        ),
      ).rejects.toThrow("币种不一致");
      await expect(
        ledger.post(s, {
          action: "consume",
          amountCents: 30,
          idempotencyKey: key(),
        }),
      ).rejects.toThrow("余额不足");
      expect(await ledger.summary(s.tenantId)).toMatchObject({
        balance: "0.29",
      });
    });
    it("pages tenant-scoped history with original consumption and funding references", async () => {
      const s = await fixture(),
        p = await payment(s);
      await ledger.post(s, {
        action: "principal",
        amountCents: 1000,
        paymentId: p.id,
        idempotencyKey: key(),
      });
      const consumed = await ledger.post(s, {
        action: "consume",
        amountCents: 123,
        idempotencyKey: key(),
      });
      await ledger.post(s, {
        action: "restore",
        amountCents: 123,
        consumptionId: consumed.operationId,
        idempotencyKey: key(),
      });
      const history = await ledger.history(s.tenantId, 1, 2);
      expect(history).toMatchObject({ total: 3, page: 1, pageSize: 2 });
      expect(history.items).toHaveLength(2);
      const returned = history.items.find((row) => row.action === "restore")!;
      expect(returned.entries[0]).toMatchObject({
        kind: "principal",
        type: "restore",
        amount: "1.23",
        paymentNo: `PAY-${p.id}`,
      });
      expect(returned.entries[0]?.debitEntryId).toBeTruthy();
      expect(await ledger.history(s.tenantId, 9, 2)).toMatchObject({
        total: 3,
        items: [],
      });
      expect(await ledger.history((await fixture()).tenantId)).toMatchObject({
        total: 0,
        items: [],
      });
      await expect(ledger.history(s.tenantId, 0)).rejects.toThrow("分页非法");
    });
    it("runs the preflight read-only without changing a legacy balance", async () => {
      const s = await fixture();
      await owner.query(
        "insert into billing.credits(tenant_id,balance) values($1,1.23)",
        [s.tenantId],
      );
      const sql = readFileSync(
        fileURLToPath(
          new URL(
            "../../../../../deploy/database/verify/wallet-source-preflight.sql",
            import.meta.url,
          ),
        ),
        "utf8",
      );
      await owner.query(sql);
      expect(await ledger.summary(s.tenantId)).toMatchObject({
        status: "unverified",
        balance: "1.23",
      });
    });
    it("serves verified closure balances to the actual auth role with read-only wallet privileges", async () => {
      const s = await fixture();
      await grant(s, 345);
      const auth = new Pool({ ...runtime.options, user: "svc_auth_bff" });
      try {
        expect(
          await new PgTenantClosureRepository(auth).getSnapshot(s.tenantId),
        ).toMatchObject({ paidBalance: "0.00", giftedBalance: "3.45" });
        await expect(
          auth.query("delete from billing.wallet_entries"),
        ).rejects.toThrow("permission denied");
      } finally {
        await auth.end();
      }
    });
    it("blocks closure for reserved cards even before a wallet exists", async () => {
      const s = await fixture(),
        p = await payment(s),
        b = randomUUID(),
        v = randomUUID();
      const client = await owner.connect();
      try {
        await client.query("begin");
        await client.query(
          "insert into promotion.voucher_batches(id,tenant_id,kind,name,effect,total_count,issued_count,valid_from,valid_until) values($1,$2,'recharge_card','B11 closure','{\"effect_version\":1,\"currency\":\"CNY\",\"face_value_cents\":1000,\"bonus_cents\":0}',1,1,now()-interval '1 day',now()+interval '1 day')",
          [b, s.tenantId],
        );
        await client.query(
          "insert into promotion.vouchers(id,batch_id,code,funding_payment_id) values($1,$2,$3,$4)",
          [v, b, `CARD-${v}`, p.id],
        );
        await client.query(
          "insert into billing.wallet_card_allocations(voucher_id,payment_id,amount) values($1,$2,10)",
          [v, p.id],
        );
        await client.query("commit");
        const auth = new Pool({ ...runtime.options, user: "svc_auth_bff" });
        try {
          const closure = new PgTenantClosureRepository(auth);
          await expect(closure.getSnapshot(s.tenantId)).rejects.toThrow(
            "充值卡本金",
          );
          await owner.query(
            "insert into billing.credits(tenant_id) values($1)",
            [s.tenantId],
          );
          await expect(closure.getSnapshot(s.tenantId)).rejects.toThrow(
            "充值卡本金",
          );
          await client.query("begin");
          await client.query(
            "update promotion.vouchers set status='revoked' where id=$1",
            [v],
          );
          await client.query(
            "update billing.wallet_card_allocations set status='released' where voucher_id=$1",
            [v],
          );
          await client.query("commit");
          expect(await closure.getSnapshot(s.tenantId)).toMatchObject({
            balance: "0.00",
            paidBalance: "0.00",
          });
          await expect(
            auth.query("delete from billing.wallet_card_allocations"),
          ).rejects.toMatchObject({ code: "42501" });
        } finally {
          await auth.end();
        }
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    });
    it("serializes cash refunds racing with principal allocation", async () => {
      const s = await fixture(),
        p = await payment(s);
      const results = await Promise.allSettled([
        ledger.post(s, {
          action: "principal",
          paymentId: p.id,
          amountCents: 600,
          idempotencyKey: key(),
        }),
        reserveRefund(s, p, "6.00"),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const total = (
        await owner.query(
          "select ((select coalesce(sum(amount),0) from billing.wallet_lots where funding_payment_id=$1)+(select coalesce(sum(amount),0) from billing.refund_allocations where payment_id=$1 and status in ('reserved','succeeded')))::text amount",
          [p.id],
        )
      ).rows[0].amount;
      expect(total).toBe("6.00");
    });
    it("reapplies the additive migration without changing historical balances", async () => {
      const s = await fixture();
      await owner.query(
        "insert into billing.credits(tenant_id,balance) values($1,99.99)",
        [s.tenantId],
      );
      const sql = readFileSync(
        fileURLToPath(
          new URL(
            "../../../../../deploy/database/migrations/2026-12-10-wallet-source-ledger.sql",
            import.meta.url,
          ),
        ),
        "utf8",
      );
      await owner.query(sql);
      await owner.query(sql);
      expect(await ledger.summary(s.tenantId)).toMatchObject({
        status: "unverified",
        balance: "99.99",
      });
    });
  },
);
