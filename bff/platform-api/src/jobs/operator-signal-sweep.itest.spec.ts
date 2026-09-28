/**
 * operator-signal-sweep.itest.spec.ts —— 两条巡检在**真库**上的行为。
 *
 * 门控与兄弟包一致（services/ops/todos 的 itest 同款）：
 *   SUBSCRIPTION_ITEST=1 DATABASE_URL=postgresql://vxture:localdev@localhost:5433/platform_main \
 *     pnpm --filter @vxture/bff-platform-api test
 *   加 SUBSCRIPTION_ITEST_TRACE=1 把每一步的结果打出来。
 *
 * ── 为什么非得打真库 ──
 * 假 pool 的 spec 只能钉字面：它不解析 SQL，所以列名写错、谓词写反、join 到不存在的
 * 表、或者少一张表的 SELECT 权限，它一条都看不出来。而这一批的判据恰恰全在 SQL 里：
 *   · 12 条 SQL 的每一个列名与谓词（`redeemed_at` 不是 created_at、
 *     `deletion_requested_at` 不是 created_at、addon 的 price 才是钱）；
 *   · 去重：同一批行扫第二遍必须 0 新增（`on conflict do nothing` 打在部分唯一索引上）；
 *   · 审计巡检的主体谓词：同一张 `support.audit_logs` 里还有 console-bff 写的客户自助
 *     动作，两边的码真的撞（`tenant.member.remove`）。客户那一行必须一条通告都不出，
 *     而这件事只有在真库上按 `actor_type` 过滤过才证得了；
 *   · 真实数据下标题 / 正文 / 链接里一个 UUID 都没有。
 *
 * 整个 suite 跑在**一笔事务里并 ROLLBACK**：仓储拿到的「pool」其实是同一个 client，
 * 它发的每一条查询都在这笔事务里。造的用户 / 租户 / 订单 / 发票 / 券 / 工单 / 审计行，
 * 连同巡检写出的通告，全部随 rollback 消失。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { PgNoticeRepository } from "@vxture/service-notice";
import {
  runAuditEventSweep,
  runBusinessEventSweep,
} from "./operator-signal-sweep.job";

const RUN = process.env.SUBSCRIPTION_ITEST === "1";
const TRACE = process.env.SUBSCRIPTION_ITEST_TRACE === "1";
const trace = (label: string, value: unknown): void => {
  if (TRACE)
    console.log(`[signal-sweep-itest] ${label}: ${JSON.stringify(value)}`);
};

/** 每次跑一个新后缀：account / phone / *_no / 单号都有唯一约束。 */
const RUN_ID = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const NO = (prefix: string) => `ITEST-${prefix}-${RUN_ID}`;

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const OPTS = { lookbackMinutes: 30, limit: 200 };

interface NoticeRow {
  reference_type: string;
  reference_id: string;
  severity: string;
  title: string;
  body: string;
  link: string | null;
}

describe.runIf(RUN)("运营侧信号巡检（真库，跑完 rollback）", () => {
  let pool: Pool;
  let client: PoolClient;
  let db: Pool;
  let notices: PgNoticeRepository;

  /** 事件码 → 期望的 reference_id 后半段（可视码或行 id）。 */
  const expected = new Map<string, string>();
  const auditIds: string[] = [];
  /** 不该出通告的审计行（客户自助动作，码与运营动作撞）。 */
  const skippedAuditIds: string[] = [];
  let tenantNo = "";
  let productCode = "";
  let memberUserNo = "";

  const orderNo = NO("ORD");
  const addonOrderNo = NO("ADDON");
  const invoiceNo = NO("INV");
  const redemptionNo = NO("RDM");
  const ticketNo = NO("TCK");

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    client = await pool.connect();
    await client.query("begin");
    // 仓储与巡检都拿这一个 client 当 pool：全部落在同一笔事务里。
    db = client as unknown as Pool;
    notices = new PgNoticeRepository(db);

    // ── 注册用户（user.signed_up）+ 申请注销用户（account.deletion_requested）──
    const phone = (seq: string) =>
      `+8613${RUN_ID.replace(/\D/g, "").padEnd(7, "7").slice(0, 7)}${seq}`;
    const signup = await client.query<{ id: string; user_no: string }>(
      `insert into account.users (account, email, phone, phone_verified_at, source)
       values ($1, $2, $3, now(), 'web') returning id, user_no::text`,
      [`itest-a-${RUN_ID}`, `itest-a-${RUN_ID}@example.com`, phone("01")],
    );
    const userId = signup.rows[0]!.id;
    memberUserNo = signup.rows[0]!.user_no;
    expected.set("user.signed_up", signup.rows[0]!.user_no);
    await client.query(
      `insert into account.user_profiles (user_id, display_name) values ($1, $2)`,
      [userId, "ITEST 注册用户"],
    );

    const leaving = await client.query<{ id: string; user_no: string }>(
      `insert into account.users
         (account, email, phone, phone_verified_at, source, status, deletion_requested_at)
       values ($1, $2, $3, now(), 'web', 'deleting', now()) returning id, user_no::text`,
      [`itest-b-${RUN_ID}`, `itest-b-${RUN_ID}@example.com`, phone("02")],
    );
    expected.set("account.deletion_requested", leaving.rows[0]!.user_no);
    await client.query(
      `insert into account.user_profiles (user_id, display_name) values ($1, $2)`,
      [leaving.rows[0]!.id, "ITEST 注销用户"],
    );

    // ── 组织租户（tenant.created）+ 认证申请（tenant.verification_submitted）──
    const tenant = await client.query<{ id: string; tenant_no: string }>(
      `insert into tenancy.tenants (name, display_name, type, owner_user_id, verification_status)
       values ($1, $2, 'organization', $3, 'pending') returning id, tenant_no::text`,
      [`ITEST 认证名 ${RUN_ID}`, `ITEST 简称 ${RUN_ID}`, userId],
    );
    const tenantId = tenant.rows[0]!.id;
    tenantNo = tenant.rows[0]!.tenant_no;
    expected.set("tenant.created", tenantNo);

    const verification = await client.query<{ id: string }>(
      `insert into kyc.tenant_verifications
         (tenant_id, verification_type, verification_method, company_name, status)
       values ($1, 'enterprise', 'documents', $2, 'pending') returning id::text as id`,
      [tenantId, `ITEST 科技有限公司 ${RUN_ID}`],
    );
    expected.set("tenant.verification_submitted", verification.rows[0]!.id);

    const workspace = await client.query<{ id: string }>(
      `insert into tenancy.workspaces (tenant_id, name, is_default)
       values ($1, 'ITEST WS', true) returning id`,
      [tenantId],
    );
    const workspaceId = workspace.rows[0]!.id;

    // ── 一个已锁定套餐版本及其主组件产品（seed 里有）───────────────────────────
    const pv = await client.query<{
      id: string;
      product_id: string;
      product_code: string;
    }>(
      `select pv.id, pc.product_id, p.product_code
         from product.plan_versions pv
         join product.plan_components pc
           on pc.plan_version_id = pv.id and pc.component_role = 'primary'
         join product.products p on p.id = pc.product_id
        where pv.is_locked = true
        limit 1`,
    );
    expect(pv.rows).toHaveLength(1);
    const planVersionId = pv.rows[0]!.id;
    const productId = pv.rows[0]!.product_id;
    productCode = pv.rows[0]!.product_code;

    // ── 待付款订单（order.created）─────────────────────────────────────────────
    const order = await client.query<{ id: string }>(
      `insert into billing.orders
         (order_no, tenant_id, workspace_id, product_id, plan_version_id, intent, cycle_unit,
          list_amount, payable_amount, currency, status, created_by_type, created_by_id)
       values ($1, $2, $3, $4, $5, 'new', 'month', 99, 99, 'CNY', 'pending_payment',
               'customer', $6)
       returning id`,
      [orderNo, tenantId, workspaceId, productId, planVersionId, userId],
    );
    const orderId = order.rows[0]!.id;
    expected.set("order.created", orderNo);

    // ── 加油包待付款（addon.created）──────────────────────────────────────────
    const pack = await client.query<{
      id: string;
      pack_code: string;
      pack_name: string;
      metric_key: string;
      amount: string;
      validity_days: number;
      price: string;
    }>(
      `select id, pack_code, pack_name, metric_key, amount::text, validity_days, price::text
         from product.addon_packs limit 1`,
    );
    expect(pack.rows).toHaveLength(1);
    const p = pack.rows[0]!;
    await client.query(
      `insert into metering.addon_purchases
         (tenant_id, workspace_id, pack_id, pack_code, pack_name, metric_key, amount,
          validity_days, price, currency, order_no, status, created_by_type, created_by_id)
       values ($1, $2, $3, $4, $5, $6, $7::bigint, $8, $9::numeric, 'CNY', $10,
               'pending_payment', 'customer', $11)`,
      [
        tenantId,
        workspaceId,
        p.id,
        p.pack_code,
        p.pack_name,
        p.metric_key,
        p.amount,
        p.validity_days,
        p.price,
        addonOrderNo,
        userId,
      ],
    );
    expected.set("addon.created", addonOrderNo);

    // ── 开票申请（invoice.applied）：先要一张账单 ───────────────────────────────
    const bill = await client.query<{ id: string }>(
      `insert into billing.invoices
         (tenant_id, bill_no, order_id, bill_cycle, cycle_start_date, cycle_end_date,
          total_amount, payable_amount, paid_amount, bill_status, created_by_type)
       values ($1, $2, $3, 'month', current_date, current_date + 30, 99, 99, 99, 'paid',
               'customer')
       returning id`,
      [tenantId, NO("BILL"), orderId],
    );
    await client.query(
      `insert into billing.invoice_receipts
         (tenant_id, bill_id, invoice_no, invoice_type, invoice_tax_type, invoice_title,
          company_info, invoice_amount, currency, invoice_status, created_by_type, created_by_id)
       values ($1, $2, $3, 'electronic_special', 'special', $4, $5::jsonb, 99, 'CNY',
               'applying', 'customer', $6)`,
      [
        tenantId,
        bill.rows[0]!.id,
        invoiceNo,
        `ITEST 科技有限公司 ${RUN_ID}`,
        JSON.stringify({ title: "ITEST 科技有限公司" }),
        userId,
      ],
    );
    expected.set("invoice.applied", invoiceNo);

    // ── 订阅 + 关自动续费历史（subscription.autorenew_off）─────────────────────
    const subscription = await client.query<{ id: string }>(
      `insert into metering.subscriptions
         (tenant_id, workspace_id, plan_version_id, subscription_kind, cycle_unit,
          start_at, end_at, status, auto_renew, product_id, current_order_id,
          created_by_type, created_by_id)
       values ($1, $2, $3, 'paid', 'month', now(), now() + interval '30 days', 'active',
               false, $4, $5, 'customer', $6)
       returning id`,
      [tenantId, workspaceId, planVersionId, productId, orderId, userId],
    );
    const subscriptionId = subscription.rows[0]!.id;
    const history = await client.query<{ id: string }>(
      `insert into metering.subscription_histories
         (tenant_id, subscription_id, change_type, from_status, to_status, actor_type,
          actor_id, remark)
       values ($1, $2, 'auto_renew_off', 'active', 'active', 'customer', $3,
               'customer opted out of renewal')
       returning id::text as id`,
      [tenantId, subscriptionId, userId],
    );
    expected.set("subscription.autorenew_off", history.rows[0]!.id);

    // ── 客户评价（review.submitted）：价格 2 分 → warning ──────────────────────
    const review = await client.query<{ id: string }>(
      `insert into support.product_reviews
         (tenant_id, account_id, product_id, subscription_id, product_score, price_score,
          service_score, comment)
       values ($1, $2, $3, $4, 5, 2, 4, 'ITEST 价格偏高')
       returning id::text as id`,
      [tenantId, userId, productId, subscriptionId],
    );
    expected.set("review.submitted", review.rows[0]!.id);

    // ── 邀请档核销（voucher.redeemed）──────────────────────────────────────────
    const batch = await client.query<{ id: string }>(
      `insert into promotion.voucher_batches
         (tenant_id, kind, name, effect, total_count, valid_from, valid_until)
       values ($1, 'invite', $2, $3::jsonb, 10, now() - interval '1 day',
               now() + interval '30 days')
       returning id`,
      [
        tenantId,
        `ITEST 邀请批次 ${RUN_ID}`,
        JSON.stringify({ type: "invite" }),
      ],
    );
    const voucher = await client.query<{ id: string }>(
      `insert into promotion.vouchers (batch_id, code, status, max_uses, used_count)
       values ($1, $2, 'redeemed', 1, 1) returning id`,
      [batch.rows[0]!.id, NO("VCH")],
    );
    await client.query(
      `insert into promotion.voucher_redemptions
         (redemption_no, voucher_id, tenant_id, workspace_id, user_id, kind,
          effect_snapshot, redeemed_at)
       values ($1, $2, $3, $4, $5, 'invite', $6::jsonb, now())`,
      [
        redemptionNo,
        voucher.rows[0]!.id,
        tenantId,
        workspaceId,
        userId,
        JSON.stringify({ type: "invite" }),
      ],
    );
    expected.set("voucher.redeemed", redemptionNo);

    // ── 新工单（ticket.created）────────────────────────────────────────────────
    await client.query(
      `insert into support.tickets
         (tenant_id, account_id, ticket_no, category, priority, source, status, title,
          reporter_name)
       values ($1, $2, $3, 'account', 'p1', 'console', 'open', 'ITEST 登录不了',
               'ITEST 报单人')`,
      [tenantId, userId, ticketNo],
    );
    expected.set("ticket.created", ticketNo);

    // ── 两行运营审计：一条解得出租户（admin 单平面，有链接），一条是可视码（双平面，无链接）
    const auditTenant = await client.query<{ id: string }>(
      `insert into support.audit_logs
         (actor_type, actor_console, actor_id, tenant_id, action, resource_type, resource_id)
       values ('operator', 'admin', gen_random_uuid(), $1::uuid, 'tenant.suspend', 'tenant', $2::varchar)
       returning id::text as id`,
      // 同一个值喂两列，但必须是两个占位符：一个 $1 同时当 uuid 和 varchar 用，
      // pg 会以 "inconsistent types deduced for parameter $1" 拒掉。
      [tenantId, tenantId],
    );
    auditIds.push(auditTenant.rows[0]!.id);
    const auditProduct = await client.query<{ id: string }>(
      `insert into support.audit_logs
         (actor_type, actor_console, actor_id, action, resource_type, resource_id)
       values ('operator', 'opera', gen_random_uuid(), 'catalog.product.delete', 'product', $1)
       returning id::text as id`,
      [`itest-gone-${RUN_ID}`],
    );
    auditIds.push(auditProduct.rows[0]!.id);

    // 第三行：运营改租户成员角色。resource_type 是 tenant_member（不是 account_user），
    // resource_id 是那个成员的 user id ——宾语要同时说得出租户和这个人。
    const auditMember = await client.query<{ id: string }>(
      `insert into support.audit_logs
         (actor_type, actor_console, actor_id, tenant_id, action, resource_type, resource_id)
       values ('operator', 'admin', gen_random_uuid(), $1::uuid,
               'tenant.member.role_change', 'tenant_member', $2::varchar)
       returning id::text as id`,
      [tenantId, userId],
    );
    auditIds.push(auditMember.rows[0]!.id);

    // 第四行**不是**运营做的：console-bff 的客户自助写的同一个动作码
    // （actor_type='customer' / actor_console='console'）。它一条通告都不该出——
    // 出了就是把客户自己移除成员说成「运营移除了成员」。
    const auditCustomer = await client.query<{ id: string }>(
      `insert into support.audit_logs
         (actor_type, actor_console, actor_id, tenant_id, action, resource_type, resource_id)
       values ('customer', 'console', $1::uuid, $2::uuid, 'tenant.member.remove',
               'member', $3::varchar)
       returning id::text as id`,
      [userId, tenantId, userId],
    );
    skippedAuditIds.push(auditCustomer.rows[0]!.id);

    trace("fixture", {
      tenantId,
      tenantNo,
      productCode,
      memberUserNo,
      expected: [...expected],
      auditIds,
      skippedAuditIds,
    });
  });

  afterAll(async () => {
    // 最后一个用例已经 rollback 过；这里再保一道（没有事务时只是一条 WARNING）。
    await client.query("rollback");
    client.release();
    await pool.end();
  });

  /** 只读本 suite 期望的那些通告——库里本来就有真实通告。 */
  const mine = async (): Promise<NoticeRow[]> => {
    const refs = [
      ...[...expected].map(([code, key]) => `${code}:${key}`),
      ...auditIds.map((id) => `audit:${id}`),
    ];
    const { rows } = await client.query<NoticeRow>(
      `select reference_type, reference_id, severity, title, body, link
         from admin.operator_notices
        where source = 'system' and deleted_at is null and reference_id = any($1::text[])
        order by reference_id`,
      [refs],
    );
    return rows;
  };

  it("第一遍：十一类业务事件 + 两行审计各写一条，零失败", async () => {
    const business = await runBusinessEventSweep(db, notices, OPTS);
    const audit = await runAuditEventSweep(db, notices, OPTS);
    trace("first-pass", { business, audit });

    // 失败列表必须是空的：一条 SQL 的列名 / 谓词 / 授权面出错都会落在这里。
    expect(business.failures).toEqual([]);
    expect(audit.failures).toEqual([]);
    expect(business.scanned).toBeGreaterThanOrEqual(expected.size);
    expect(audit.scanned).toBeGreaterThanOrEqual(auditIds.length);

    const rows = await mine();
    trace("notices", rows);
    expect(rows.map((r) => r.reference_id).sort()).toEqual(
      [
        ...[...expected].map(([code, key]) => `${code}:${key}`),
        ...auditIds.map((id) => `audit:${id}`),
      ].sort(),
    );
  });

  it("第二遍：一条都不新增（去重键挡住重扫）", async () => {
    const before = (await mine()).length;
    const business = await runBusinessEventSweep(db, notices, OPTS);
    const audit = await runAuditEventSweep(db, notices, OPTS);
    trace("second-pass", { business, audit });
    expect(business.inserted).toBe(0);
    expect(audit.inserted).toBe(0);
    // 扫到的行数不变（回看窗口还在），只是都命中了去重。
    expect(business.scanned).toBeGreaterThan(0);
    expect((await mine()).length).toBe(before);
  });

  it("真实数据下的文案：可视码、前缀、severity、链接各归各", async () => {
    const byRef = new Map((await mine()).map((r) => [r.reference_id, r]));

    const order = byRef.get(`order.created:${orderNo}`);
    expect(order?.severity).toBe("info");
    expect(order?.title).toContain(orderNo);
    expect(order?.title).toContain("¥99.00");
    expect(order?.link).toBe(`/orders/${encodeURIComponent(orderNo)}`);

    const signup = byRef.get(
      `user.signed_up:${expected.get("user.signed_up")}`,
    );
    expect(signup?.title).toContain("ITEST 注册用户");
    expect(signup?.title).toContain(`U-${expected.get("user.signed_up")}`);

    const tenant = byRef.get(`tenant.created:${tenantNo}`);
    expect(tenant?.title).toContain(`T-${tenantNo}`);
    expect(tenant?.link).toBe(`/tenants/${tenantNo}`);

    // 认证 / 开票 / 评价（价格 2 分）/ 工单（p1）都在等人处理 → warning 不过期。
    expect(
      byRef.get(
        `tenant.verification_submitted:${expected.get("tenant.verification_submitted")}`,
      )?.severity,
    ).toBe("warning");
    expect(byRef.get(`invoice.applied:${invoiceNo}`)?.severity).toBe("warning");
    expect(
      byRef.get(`review.submitted:${expected.get("review.submitted")}`)
        ?.severity,
    ).toBe("warning");
    expect(byRef.get(`ticket.created:${ticketNo}`)?.severity).toBe("warning");

    // 关自动续费：产品 + 套餐名从库里真的读出来了，链接落在订阅的订单号上。
    const autorenew = byRef.get(
      `subscription.autorenew_off:${expected.get("subscription.autorenew_off")}`,
    );
    expect(autorenew?.title).toContain("客户关闭自动续费");
    expect(autorenew?.link).toBe(
      `/subscriptions/${encodeURIComponent(orderNo)}`,
    );

    // 邀请档单独一句。
    expect(byRef.get(`voucher.redeemed:${redemptionNo}`)?.title).toBe(
      `邀请订阅已核销：${redemptionNo}`,
    );

    // 审计：单平面那条给链接，双平面那条不给。
    const auditTenant = byRef.get(`audit:${auditIds[0]}`);
    expect(auditTenant?.title).toContain("租户已暂停");
    expect(auditTenant?.title).toContain(`T-${tenantNo}`);
    expect(auditTenant?.link).toBe(`/tenants/${tenantNo}`);
    expect(auditTenant?.body).toContain("运营台操作员 于 ");

    const auditProduct = byRef.get(`audit:${auditIds[1]}`);
    expect(auditProduct?.title).toBe(`产品已删除：itest-gone-${RUN_ID}`);
    expect(auditProduct?.link).toBeNull();

    // 成员类：租户从 tenant_id 解出来，U- 码从 resource_id（成员的 user id）解出来
    // ——两个 join 都得真的命中，标题里两个主体都在。
    const auditMember = byRef.get(`audit:${auditIds[2]}`);
    expect(auditMember?.title).toContain("租户成员角色已变更");
    expect(auditMember?.title).toContain(`T-${tenantNo}`);
    expect(auditMember?.title).toContain(`U-${memberUserNo}`);
    expect(auditMember?.link).toBe(`/tenants/${tenantNo}`);
  });

  it("客户自助那一行一条都没写 —— 码撞了，谓词按 actor_type 分得开", async () => {
    const refs = skippedAuditIds.map((id) => `audit:${id}`);
    expect(refs.length).toBeGreaterThan(0);
    const { rows } = await client.query<{ reference_id: string }>(
      `select reference_id from admin.operator_notices
        where reference_id = any($1::text[])`,
      [refs],
    );
    trace("skipped-audit", { refs, found: rows });
    expect(rows).toEqual([]);
  });

  it("标题 / 正文 / 链接里一个 UUID 都没有（真实数据，不是构造的行）", async () => {
    const rows = await mine();
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.title, r.reference_id).not.toMatch(UUID_RE);
      expect(r.body, r.reference_id).not.toMatch(UUID_RE);
      expect(r.link ?? "", r.reference_id).not.toMatch(UUID_RE);
    }
    // 反过来：有四类的去重锚**就是**行 id，那里放 uuid 是对的（它不上屏）。
    expect(
      rows.some((r) => UUID_RE.test(r.reference_id)),
      "没有一条通告的 reference_id 是行 id —— 是不是把 dedupe_key 改成可视码了？",
    ).toBe(true);
  });

  it("跑完回滚，库回到跑前（本 suite 的通告与造的行都不留）", async () => {
    await client.query("rollback");
    const { rows } = await client.query<{ n: string }>(
      `select count(*)::text as n from admin.operator_notices
        where reference_id like $1`,
      [`%${RUN_ID}%`],
    );
    expect(rows[0]?.n).toBe("0");
    const users = await client.query<{ n: string }>(
      `select count(*)::text as n from account.users where account like $1`,
      [`itest-%${RUN_ID}`],
    );
    expect(users.rows[0]?.n).toBe("0");
  });
});
