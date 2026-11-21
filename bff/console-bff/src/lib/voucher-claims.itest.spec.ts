/**
 * voucher-claims.itest.spec.ts - Claim races and customer ledger on disposable PostgreSQL.
 * @package @vxture/bff-console
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-19
 */
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// ⚠️ 跨层引用: Exercise the public promotion domain using actual BFF database roles.
import {
  PgVoucherManagement,
  PgVoucherClaims,
  PgCustomerVoucherLedger,
  VoucherClaimCredentials,
  type VoucherScope,
} from "@vxture/service-promotion";

// ===========================================================================
// Only the runner-owned, marked loopback database is accepted.
// ===========================================================================
describe.skipIf(process.env["VOUCHER_CLAIMS_ITEST"] !== "1")(
  "B07 claims PostgreSQL",
  () => {
    const operator = "11111111-1111-4111-8111-111111111111",
      reviewer = "22222222-2222-4222-8222-222222222222";
    const credentials = new VoucherClaimCredentials({
      VOUCHER_CLAIM_ACTIVE_KEY: "k1",
      VOUCHER_CLAIM_KEYS: JSON.stringify({ k1: "1a".repeat(32) }),
    });
    let owner: Pool,
      admin: Pool,
      customer: Pool,
      management: PgVoucherManagement,
      claims: PgVoucherClaims,
      ledger: PgCustomerVoucherLedger;
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
      expect(url.pathname).toBe("/voucher_claims");
      expect(url.search + url.hash).toBe("");
      expect(Number(url.port)).toBeGreaterThan(0);
      const connection = {
        host: "127.0.0.1",
        port: Number(url.port),
        database: "voucher_claims",
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
          db: "voucher_claims",
          role: "postgres",
          marker: "codex-voucher-console:" + runId,
        },
      ]);
      admin = new Pool({ ...connection, user: "svc_admin_bff", max: 8 });
      customer = new Pool({ ...connection, user: "svc_console_bff", max: 8 });
      management = new PgVoucherManagement(admin);
      claims = new PgVoucherClaims(customer, credentials);
      ledger = new PgCustomerVoucherLedger(customer);
    }, 60000);
    afterAll(async () => {
      await customer?.end();
      await admin?.end();
      await owner?.end();
    }, 60000);
    const command = () => ({
      idempotencyKey: randomUUID(),
      reason: "B07 acceptance",
    });
    async function scope(existingUser?: string): Promise<VoucherScope> {
      const userId = existingUser ?? randomUUID(),
        tenantId = randomUUID(),
        workspaceId = randomUUID();
      if (!existingUser)
        await owner.query(
          "insert into account.users(id,account,phone,phone_verified_at) values($1::uuid,$1::text,$2,now())",
          [userId, `+${Date.now()}${Math.floor(Math.random() * 100000)}`],
        );
      await owner.query(
        "insert into tenancy.tenants(id,name,type,owner_user_id) values($1,'B07 tenant','organization',$2)",
        [tenantId, userId],
      );
      await owner.query(
        "insert into tenancy.workspaces(id,tenant_id,name,is_default) values($1,$2,'B07 workspace',true)",
        [workspaceId, tenantId],
      );
      return { userId, tenantId, workspaceId };
    }
    async function fixture(
      options: {
        tenantId?: string;
        perUserLimit?: number;
        perWorkspaceLimit?: number;
        perTenantLimit?: number;
        totalCount?: number;
        useValidDays?: number;
      } = {},
    ) {
      const result = await management.createBatch(operator, {
        ...command(),
        kind: "credit_voucher",
        name: "B07 credit",
        effect: { amount_cents: 1000 },
        totalCount: options.totalCount ?? 10,
        perUserLimit: options.perUserLimit ?? 5,
        ...(options.perWorkspaceLimit
          ? { perWorkspaceLimit: options.perWorkspaceLimit }
          : {}),
        ...(options.perTenantLimit
          ? { perTenantLimit: options.perTenantLimit }
          : {}),
        validFrom: new Date(Date.now() - 86400000).toISOString(),
        validUntil: new Date(Date.now() + 30 * 86400000).toISOString(),
        useValidDays: options.useValidDays ?? 7,
        tenantId: options.tenantId ?? null,
      });
      const revision = (
        await owner.query<{ revision: string }>(
          "select extract(epoch from updated_at)::text revision from promotion.voucher_batches where id=$1",
          [result.batchId],
        )
      ).rows[0]!.revision;
      await management.actOnBatch(reviewer, result.batchId, {
        ...command(),
        action: "review",
        expectedRevision: revision,
      });
      return result.batchId;
    }
    const issue = (batchId: string, count = 1) =>
      management.issueClaimCredentials(
        operator,
        batchId,
        { ...command(), count },
        credentials,
      );
    const claim = (
      s: VoucherScope,
      secret: string,
      target: "user" | "workspace" = "user",
      key = randomUUID(),
    ) => claims.claim(s, { secret, target, idempotencyKey: key });

    // =========================================================================
    // Credentials are delivered once, then only keyed digests and receipts persist.
    // =========================================================================
    it("recovers a receipt by key without disclosing another actor or context", async () => {
      const s = await scope(),
        other = await scope(),
        anotherContext = await scope(s.userId),
        issued = await issue(await fixture()),
        key = randomUUID();
      expect(await PgVoucherClaims.result(customer, s, key)).toBeNull();
      const result = await claim(
        s,
        issued.credentials[0]!.secret,
        "workspace",
        key,
      );
      expect(await PgVoucherClaims.result(customer, s, ` ${key} `)).toEqual(
        result,
      );
      expect(await PgVoucherClaims.result(customer, other, key)).toBeNull();
      expect(
        await PgVoucherClaims.result(customer, anotherContext, key),
      ).toBeNull();
      await expect(PgVoucherClaims.result(customer, s, "")).rejects.toThrow(
        "idempotencyKey",
      );
      await owner.query(
        "update tenancy.tenants set status='suspended' where id=$1",
        [s.tenantId],
      );
      await expect(PgVoucherClaims.result(customer, s, key)).rejects.toThrow(
        "不可访问",
      );
    });
    it("issues once, replays identities only, and never persists a secret", async () => {
      const batch = await fixture(),
        input = { ...command(), count: 2 };
      const first = await management.issueClaimCredentials(
          operator,
          batch,
          input,
          credentials,
        ),
        again = await management.issueClaimCredentials(
          operator,
          batch,
          input,
          credentials,
        );
      expect(first.credentials).toHaveLength(2);
      expect(again).toMatchObject({
        voucherIds: first.voucherIds,
        credentials: [],
        replayed: true,
      });
      const stored = await owner.query(
        "select row_to_json(v) data from promotion.vouchers v where batch_id=$1",
        [batch],
      );
      const receipts = await owner.query(
        "select result from promotion.voucher_operations where batch_id=$1",
        [batch],
      );
      const events = await owner.query(
        "select metadata from promotion.voucher_events where batch_id=$1",
        [batch],
      );
      for (const token of first.credentials) {
        expect(token.secret).toMatch(/^vx1\.k1\.[A-Za-z0-9_-]{43}$/);
        expect(
          JSON.stringify([stored.rows, receipts.rows, events.rows]),
        ).not.toContain(token.secret);
      }
      expect(stored.rows[0]!.data).toMatchObject({
        status: "issued",
        claimed_at: null,
        claim_key_version: "k1",
      });
      await expect(
        management.issueClaimCredentials(
          operator,
          batch,
          { ...input, count: 1 },
          credentials,
        ),
      ).rejects.toThrow("参数已改变");
    });
    it("serializes the last issuance budget", async () => {
      const batch = await fixture({ totalCount: 1 });
      const results = await Promise.allSettled([issue(batch), issue(batch)]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(
        (
          await owner.query(
            "select issued_count from promotion.voucher_batches where id=$1",
            [batch],
          )
        ).rows[0]!.issued_count,
      ).toBe(1);
    });
    it("previews without mutation and rejects visible codes with the same generic message", async () => {
      const s = await scope(),
        batch = await fixture(),
        token = (await issue(batch)).credentials[0]!;
      expect(await claims.preview(s, token.secret)).toMatchObject({
        code: token.code,
        tenantName: "B07 tenant",
        useValidDays: 7,
      });
      expect(
        (
          await owner.query(
            "select status,claimed_at from promotion.vouchers where id=$1",
            [token.voucherId],
          )
        ).rows[0],
      ).toEqual({ status: "issued", claimed_at: null });
      await expect(claims.preview(s, token.code)).rejects.toThrow(
        "领取凭证不可用",
      );
    });
    it("claims once, starts relative expiry and safely replays the exact confirmation", async () => {
      const s = await scope(),
        batch = await fixture(),
        token = (await issue(batch)).credentials[0]!,
        key = randomUUID();
      const [one, two] = await Promise.all([
        claim(s, token.secret, "user", key),
        claim(s, token.secret, "user", key),
      ]);
      expect(two).toEqual(one);
      expect(Date.parse(one.expiresAt) - Date.now()).toBeGreaterThan(
        6.9 * 86400000,
      );
      const stored = (
        await owner.query(
          "select status,assigned_tenant_id,assigned_user_id,claimed_at from promotion.vouchers where id=$1",
          [token.voucherId],
        )
      ).rows[0]!;
      expect(stored).toMatchObject({
        status: "assigned",
        assigned_tenant_id: s.tenantId,
        assigned_user_id: s.userId,
      });
      expect(stored.claimed_at).toBeInstanceOf(Date);
      expect(
        (
          await owner.query(
            "select count(*) n from promotion.voucher_events where voucher_id=$1 and event_type='voucher_claimed'",
            [token.voucherId],
          )
        ).rows[0]!.n,
      ).toBe("1");
      await expect(claim(s, token.secret, "workspace", key)).rejects.toThrow(
        "参数已改变",
      );
      await expect(claim(s, token.secret)).rejects.toThrow("领取凭证不可用");
    });
    it("lets exactly one of two customers bind the same credential", async () => {
      const a = await scope(),
        b = await scope(),
        batch = await fixture(),
        token = (await issue(batch)).credentials[0]!;
      const results = await Promise.allSettled([
        claim(a, token.secret),
        claim(b, token.secret),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    });
    it("binds personal ownership to the selected tenant and rejects context replay", async () => {
      const a = await scope(),
        b = await scope(a.userId),
        batch = await fixture(),
        token = (await issue(batch)).credentials[0]!,
        key = randomUUID();
      await claim(a, token.secret, "user", key);
      expect((await ledger.page(a)).total).toBe(1);
      expect((await ledger.page(b)).total).toBe(0);
      await expect(claim(b, token.secret, "user", key)).rejects.toThrow(
        "参数已改变",
      );
    });
    it("keeps workspace vouchers in that workspace and counts the claimant across targets", async () => {
      const s = await scope(),
        workspace2 = randomUUID();
      await owner.query(
        "insert into tenancy.workspaces(id,tenant_id,name) values($1,$2,'second')",
        [workspace2, s.tenantId],
      );
      const batch = await fixture({ perUserLimit: 1 }),
        tokens = (await issue(batch, 2)).credentials;
      await claim(s, tokens[0]!.secret, "workspace");
      expect((await ledger.page(s)).items[0]).toMatchObject({
        holderScope: "workspace",
        holderLabel: "B07 workspace",
      });
      expect((await ledger.page({ ...s, workspaceId: workspace2 })).total).toBe(
        0,
      );
      await expect(claim(s, tokens[1]!.secret)).rejects.toThrow(
        "领取凭证不可用",
      );
      await expect(
        management.assign(operator, {
          ...command(),
          batchId: batch,
          count: 1,
          targetTenantId: s.tenantId,
          targetUserId: s.userId,
        }),
      ).rejects.toThrow("累计发放上限");
    });
    it("does not let preissued credentials consume tenant claim limits before binding", async () => {
      const s = await scope(),
        batch = await fixture({ tenantId: s.tenantId, perTenantLimit: 2 });
      await issue(batch, 5);
      await expect(
        management.assign(operator, {
          ...command(),
          batchId: batch,
          count: 1,
          targetTenantId: s.tenantId,
          targetUserId: s.userId,
        }),
      ).resolves.toHaveProperty("codes");
    });
    it("serializes the final tenant claim allowance across distinct credentials", async () => {
      const s = await scope(),
        batch = await fixture({ perTenantLimit: 1 }),
        tokens = (await issue(batch, 2)).credentials;
      const results = await Promise.allSettled(
        tokens.map((t) => claim(s, t.secret)),
      );
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    });
    it("revoking a claimed voucher does not replenish cumulative user allowance", async () => {
      const s = await scope(),
        batch = await fixture({ perUserLimit: 1 }),
        tokens = (await issue(batch, 2)).credentials;
      await claim(s, tokens[0]!.secret);
      await management.revoke(operator, tokens[0]!.voucherId, command());
      await expect(claim(s, tokens[1]!.secret)).rejects.toThrow(
        "领取凭证不可用",
      );
      expect((await ledger.page(s, { status: "revoked" })).total).toBe(1);
    });
    it("blocks paused, archived, expired and deadline-equal claims", async () => {
      const s = await scope();
      for (const state of ["paused", "archived", "deadline", "expired"]) {
        const batch = await fixture(),
          token = (await issue(batch)).credentials[0]!;
        if (state === "paused" || state === "archived")
          await owner.query(
            "update promotion.voucher_batches set status=$2 where id=$1",
            [batch, state],
          );
        else if (state === "deadline")
          await owner.query(
            "update promotion.voucher_batches set claim_until=clock_timestamp() where id=$1",
            [batch],
          );
        else
          await owner.query(
            "update promotion.vouchers set expires_at=clock_timestamp() where id=$1",
            [token.voucherId],
          );
        await expect(claim(s, token.secret)).rejects.toThrow("领取凭证不可用");
      }
    });
    it("rejects cross-tenant batches and forged or inactive workspaces", async () => {
      const a = await scope(),
        b = await scope(),
        batch = await fixture({ tenantId: a.tenantId }),
        token = (await issue(batch)).credentials[0]!;
      await expect(claim(b, token.secret)).rejects.toThrow("领取凭证不可用");
      await expect(
        claim({ ...a, workspaceId: b.workspaceId }, token.secret),
      ).rejects.toThrow("不可访问");
      await owner.query(
        "update tenancy.workspaces set status='archived' where id=$1",
        [a.workspaceId],
      );
      await expect(claim(a, token.secret)).rejects.toThrow("不可访问");
    });
    it("rolls back ownership and receipt when the append-only audit insertion fails", async () => {
      const s = await scope(),
        batch = await fixture(),
        token = (await issue(batch)).credentials[0]!;
      await owner.query(`create function promotion.b07_fail_claim() returns trigger language plpgsql as $$begin if new.event_type='voucher_claimed' then raise exception 'b07 audit failure';end if;return new;end$$;
      create trigger b07_fail_claim before insert on promotion.voucher_events for each row execute function promotion.b07_fail_claim()`);
      try {
        await expect(claim(s, token.secret)).rejects.toThrow(
          "b07 audit failure",
        );
      } finally {
        await owner.query(
          "drop trigger b07_fail_claim on promotion.voucher_events;drop function promotion.b07_fail_claim()",
        );
      }
      expect(
        (
          await owner.query(
            "select status from promotion.vouchers where id=$1",
            [token.voucherId],
          )
        ).rows[0]!.status,
      ).toBe("issued");
      expect(
        (
          await owner.query(
            "select count(*) n from promotion.voucher_operations where actor_realm='customer' and batch_id=$1",
            [batch],
          )
        ).rows[0]!.n,
      ).toBe("0");
      await expect(claim(s, token.secret)).resolves.toHaveProperty("code");
    });
    it("retains old-key validity during rotation and fails closed for retired versions", async () => {
      const s = await scope(),
        batch = await fixture(),
        token = (await issue(batch)).credentials[0]!;
      const ring = new VoucherClaimCredentials({
        VOUCHER_CLAIM_ACTIVE_KEY: "k2",
        VOUCHER_CLAIM_KEYS: JSON.stringify({
          k1: "1a".repeat(32),
          k2: "2b".repeat(32),
        }),
      });
      await expect(
        new PgVoucherClaims(customer, ring).preview(s, token.secret),
      ).resolves.toHaveProperty("code");
      const retired = new VoucherClaimCredentials({
        VOUCHER_CLAIM_ACTIVE_KEY: "k2",
        VOUCHER_CLAIM_KEYS: JSON.stringify({ k2: "2b".repeat(32) }),
      });
      await expect(
        new PgVoucherClaims(customer, retired).preview(s, token.secret),
      ).rejects.toThrow("领取凭证不可用");
    });
    it("checks workspace and tenant limits across directed and claimed issuance", async () => {
      const s = await scope(),
        batch = await fixture({ perWorkspaceLimit: 1 });
      await management.assign(operator, {
        ...command(),
        batchId: batch,
        count: 1,
        targetWorkspaceId: s.workspaceId,
      });
      const token = (await issue(batch)).credentials[0]!;
      await expect(claim(s, token.secret, "workspace")).rejects.toThrow(
        "领取凭证不可用",
      );
      const platform = await fixture({ perTenantLimit: 1 }),
        legacy = randomUUID();
      await owner.query(
        "insert into promotion.vouchers(id,batch_id,code,status,assigned_user_id) values($1::uuid,$2,$1::text,'assigned',$3)",
        [legacy, platform, s.userId],
      );
      await expect(
        claim(s, (await issue(platform)).credentials[0]!.secret),
      ).rejects.toThrow("领取凭证不可用");
    });
    it("blocks claims after a concurrent pause acquires the batch lock", async () => {
      const s = await scope(),
        batch = await fixture(),
        token = (await issue(batch)).credentials[0]!,
        lock = await owner.connect();
      await lock.query("begin");
      await lock.query(
        "update promotion.voucher_batches set status='paused' where id=$1",
        [batch],
      );
      const pending = claim(s, token.secret).then(
        () => false,
        () => true,
      );
      await setTimeout(40);
      await lock.query("commit");
      lock.release();
      expect(await pending).toBe(true);
      expect(
        (
          await owner.query(
            "select status from promotion.vouchers where id=$1",
            [token.voucherId],
          )
        ).rows[0]!.status,
      ).toBe("issued");
    });
    it("takes the minimum of batch, instance and relative deadlines", async () => {
      const s = await scope(),
        batch = await fixture(),
        tokens = (await issue(batch, 2)).credentials;
      const short = new Date(Date.now() + 3600000);
      await owner.query(
        "update promotion.vouchers set expires_at=$2 where id=$1",
        [tokens[0]!.voucherId, short],
      );
      expect((await claim(s, tokens[0]!.secret)).expiresAt).toBe(
        short.toISOString(),
      );
      await owner.query(
        "update promotion.voucher_batches set valid_until=$2 where id=$1",
        [batch, short],
      );
      expect((await claim(s, tokens[1]!.secret)).expiresAt).toBe(
        short.toISOString(),
      );
    });
    it("requires a live workspace membership for a nonowner", async () => {
      const s = await scope(),
        other = await scope(),
        batch = await fixture(),
        token = (await issue(batch)).credentials[0]!;
      const roles = (
        await owner.query<{ id: string; scope: string }>(
          "select id,scope from access.roles where scope in ('tenant','workspace') order by scope",
        )
      ).rows;
      // Roles are reference fixtures, not production permission bypasses.
      const tenantRole = roles.find((r) => r.scope === "tenant")?.id,
        workspaceRole = roles.find((r) => r.scope === "workspace")?.id;
      if (!tenantRole || !workspaceRole) {
        // Empty DDL installations have no seeded roles; use isolated reference roles.
        await owner.query(
          "insert into access.roles(id,role_code,role_name,scope) values($1,'b07-tenant','B07','tenant'),($2,'b07-workspace','B07','workspace')",
          [randomUUID(), randomUUID()],
        );
      }
      const tr =
        tenantRole ??
        (
          await owner.query<{ id: string }>(
            "select id from access.roles where role_code='b07-tenant'",
          )
        ).rows[0]!.id;
      const wr =
        workspaceRole ??
        (
          await owner.query<{ id: string }>(
            "select id from access.roles where role_code='b07-workspace'",
          )
        ).rows[0]!.id;
      await owner.query(
        "insert into tenancy.tenant_memberships(tenant_id,user_id,role_id,role_scope) values($1,$2,$3,'tenant')",
        [s.tenantId, other.userId, tr],
      );
      const member = { ...s, userId: other.userId };
      await expect(claim(member, token.secret)).rejects.toThrow("不可访问");
      await owner.query(
        "insert into tenancy.workspace_memberships(workspace_id,tenant_id,user_id,role_id,role_scope) values($1,$2,$3,$4,'workspace')",
        [s.workspaceId, s.tenantId, other.userId, wr],
      );
      await expect(claim(member, token.secret)).resolves.toHaveProperty("code");
    });

    // =========================================================================
    // Customer pagination is complete beyond the legacy 100-row limit.
    // =========================================================================
    it("traces both durable and legacy holds, plus direct-order redemption", async () => {
      const s = await scope(),
        batch = await fixture(),
        tokens = (await issue(batch, 2)).credentials;
      for (const token of tokens) await claim(s, token.secret);
      const product = randomUUID(),
        plan = randomUUID(),
        version = randomUUID(),
        order = randomUUID(),
        invoice = randomUUID(),
        payment = randomUUID();
      await owner.query(
        "insert into product.products(id,product_code,product_name,product_type) values($1,$2,'B07 product','agent')",
        [product, product],
      );
      await owner.query(
        "insert into product.plans(id,plan_code,plan_name,is_public) values($1,$2,'B07 plan',false)",
        [plan, plan],
      );
      await owner.query(
        "insert into product.plan_versions(id,plan_id,version_no) values($1,$2,1)",
        [version, plan],
      );
      await owner.query(
        `insert into billing.orders(id,order_no,tenant_id,workspace_id,product_id,plan_version_id,intent,cycle_unit,list_amount,payable_amount,status,created_by_type)
        values($1,$2,$3,$4,$5,$6,'new','month',100,100,'cancelled','customer')`,
        [
          order,
          `B07-ORDER-${order}`,
          s.tenantId,
          s.workspaceId,
          product,
          version,
        ],
      );
      await owner.query(
        `insert into billing.invoices(id,tenant_id,bill_no,order_id,bill_cycle,cycle_start_date,cycle_end_date,created_by_type)
        values($1,$2,$3,$4,'202611',current_date,current_date,'customer')`,
        [invoice, s.tenantId, invoice, order],
      );
      await owner.query(
        `insert into billing.payments(id,tenant_id,bill_id,pay_order_no,total_amount,pay_status,channel_raw_data)
        values($1::uuid,$2,$3,$1::text,100,'pending_verify',$4::jsonb)`,
        [
          payment,
          s.tenantId,
          invoice,
          JSON.stringify({
            settlement: { creditVoucherId: tokens[1]!.voucherId },
          }),
        ],
      );
      await owner.query(
        "update promotion.vouchers set status='reserved',used_count=1,expires_at=now()-interval '1 day' where batch_id=$1",
        [batch],
      );
      const operation = (
        await owner.query<{ id: string }>(
          "select id from promotion.voucher_operations where batch_id=$1 and operation_type='voucher_claim' limit 1",
          [batch],
        )
      ).rows[0]!.id;
      await owner.query(
        `insert into promotion.voucher_reservations(voucher_id,order_id,invoice_id,tenant_id,workspace_id,user_id,operation_id,effect_snapshot,policy_snapshot)
        values($1,$2,$3,$4,$5,$6,$7,'{}','{}')`,
        [
          tokens[0]!.voucherId,
          order,
          invoice,
          s.tenantId,
          s.workspaceId,
          s.userId,
          operation,
        ],
      );
      const held = await ledger.page(s, { status: "reserved" });
      expect(held.items).toHaveLength(2);
      expect(held.items.every((v) => v.orderNo === `B07-ORDER-${order}`)).toBe(
        true,
      );
      expect(held.items.every((v) => v.availabilityStatus === "reserved")).toBe(
        true,
      );
      await owner.query(
        "update promotion.vouchers set status='redeemed',redeemed_at=now() where id=$1",
        [tokens[0]!.voucherId],
      );
      await owner.query(
        `insert into promotion.voucher_redemptions(redemption_no,voucher_id,tenant_id,workspace_id,user_id,kind,effect_snapshot,order_id)
        values($1,$2,$3,$4,$5,'credit_voucher','{}',$6)`,
        [
          `B07-REDEEM-${order}`,
          tokens[0]!.voucherId,
          s.tenantId,
          s.workspaceId,
          s.userId,
          order,
        ],
      );
      expect(
        (await ledger.page(s, { status: "redeemed" })).items[0],
      ).toMatchObject({
        orderNo: `B07-ORDER-${order}`,
        redemptionNo: `B07-REDEEM-${order}`,
        availabilityStatus: "redeemed",
      });
    });
    it("keeps malformed effects unavailable and future kinds disabled", async () => {
      const s = await scope(),
        batch = await fixture(),
        token = (await issue(batch)).credentials[0]!;
      await claim(s, token.secret);
      for (const effect of [
        { amount_cents: "bad" },
        { amount_cents: 100, currency: "USD" },
        { amount_cents: 100, effect_version: 2 },
        { discount_type: "bad", value: 10 },
      ]) {
        await owner.query(
          "update promotion.voucher_batches set effect=$2::jsonb,kind=$3 where id=$1",
          [
            batch,
            JSON.stringify(effect),
            "discount_type" in effect ? "discount" : "credit_voucher",
          ],
        );
        expect((await ledger.page(s, { status: "unavailable" })).total).toBe(1);
      }
      await owner.query(
        "update promotion.voucher_batches set kind='redemption' where id=$1",
        [batch],
      );
      expect((await ledger.page(s, { status: "unavailable" })).total).toBe(1);
    });
    it("pages and searches more than 100 owned rows with full summary counts", async () => {
      const s = await scope(),
        batch = await fixture({ totalCount: 200 });
      await owner.query(
        `insert into promotion.vouchers(batch_id,code,status,assigned_tenant_id,assigned_user_id,claimed_at)
      select $1::uuid,'B07-'||$1::text||'-'||lpad(n::text,3,'0'),'assigned',$2,$3,now() from generate_series(1,125) n`,
        [batch, s.tenantId, s.userId],
      );
      const first = await ledger.page(s, {
          status: "all",
          pageSize: 100,
          sort: "code",
        }),
        second = await ledger.page(s, {
          status: "all",
          pageSize: 100,
          page: 2,
          sort: "code",
        });
      expect(first).toMatchObject({
        total: 125,
        summary: { total: 125, available: 125 },
      });
      expect(first.items).toHaveLength(100);
      expect(second.items).toHaveLength(25);
      expect(
        new Set([...first.items, ...second.items].map((v) => v.voucherId)).size,
      ).toBe(125);
      expect((await ledger.page(s, { query: "-125" })).total).toBe(1);
      expect((await ledger.page(s, { query: "missing" })).summary.total).toBe(
        125,
      );
      await expect(ledger.page(s, { pageSize: 500 })).rejects.toThrow("非法");
      expect(JSON.stringify(first)).not.toMatch(
        /claim_token_digest|claim_key_version|secret/,
      );
    });
    it("hides unclaimed revoked instances and distinguishes pause from expiry", async () => {
      const s = await scope(),
        batch = await fixture({ tenantId: s.tenantId }),
        tokens = (await issue(batch, 2)).credentials;
      await management.revoke(operator, tokens[0]!.voucherId, command());
      expect((await ledger.page(s, { status: "all" })).total).toBe(0);
      await claim(s, tokens[1]!.secret);
      await management.actOnBatch(operator, batch, {
        ...command(),
        action: "pause",
      });
      expect(
        (await ledger.page(s, { status: "paused" })).items[0]!
          .availabilityStatus,
      ).toBe("paused");
      expect((await ledger.page(s, { status: "expired" })).total).toBe(0);
    });
  },
);
