/**
 * ops-todos.itest.spec.ts — 待办 SQL 在**真库**上的行为（2026-09-28 根治批 + 第三批）。
 *
 * 假 pool 的 spec 只能钉字面；这里钉的是谓词本身。第一批造六类各一条；2026-09-28
 * 第三批把**十九类全部**造出来——十八类在 fixture 里各一行（`risk` 那一类要把租户改成
 * suspended，会连带影响别的用例，所以它在自己的 savepoint 里点亮），逐一断言
 * 「恰好出一条、字段按契约」：
 * 三张订单（待确认 / 已收款未开通 / 部分收款）+ 一张挂着没人付的单、四格退款
 * （待审 / 审过没退 / 卡在处理中 / 失败）、一条欠费订阅 + 它的状态历史、两档发票、
 * 一张加油包单、两个注销中的账号、一个超时的维护窗口、一张认证 pending 的租户、
 * 一张未结工单 + 一张首响超时的工单。
 * 另钉三件事：minAge 过滤、kinds 过滤、升档边界（越过阈值才升，级数按倍数）。
 *
 * 还钉一条别的地方钉不到的：**告警作业那个调用形状在 `svc_platform_api` 角色下跑得通**。
 * Postgres 对语句里出现过的每一个关系查权限——那一支返不返回行都一样——所以一条顺手
 * join 了 `account.users` 的待办查询在本机（owner 连库）畅通无阻，到生产（那个角色只有
 * 7 个 schema + 逐表例外，见 97_service_roles.sql）就是 42501、整轮作业失败。静态守卫
 * （check-ops-todo-alerts 第 5 段）扫文本，这一条真跑。第三批把 ALERT_KINDS 扩到九类，
 * 其中 `ticket_sla` 碰 `support.tickets`、`maintenance_overdue` 碰
 * `admin.maintenance_windows`——两张都是 97 末尾的表级例外（2026-11-23 那份迁移灌的），
 * 所以这一条现在还顺带证明那两张例外真的够用。
 *
 * 整个 suite 跑在**一笔事务里并 ROLLBACK**（与 product-maintenance.itest 同款）：仓储拿到的
 * 「pool」其实是同一个 client，它发的每一条查询都在这笔事务里。造的用户 / 租户 / 订单 /
 * 账单 / 支付腿 / 退款 / 订阅 / 发票 / 加油包 / 认证 / 工单 / 维护窗口全部随 rollback 消失，
 * 跑完库和跑前一样（最后一个用例回查）。
 *
 * Gated (needs a seeded platform DB):
 *   SUBSCRIPTION_ITEST=1 DATABASE_URL=postgresql://... pnpm --filter @vxture/service-ops-todos test
 * 加 SUBSCRIPTION_ITEST_TRACE=1 把每一步的查询结果打出来。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { OpsTodoRepository } from "./pg-ops-todo.repository";
import type { OpsTodo, OpsTodoKind } from "../types";

const RUN = process.env.SUBSCRIPTION_ITEST === "1";
const TRACE = process.env.SUBSCRIPTION_ITEST_TRACE === "1";
const trace = (label: string, value: unknown): void => {
  if (TRACE)
    console.log(`[ops-todos-itest] ${label}: ${JSON.stringify(value)}`);
};

/** 每次跑一个新后缀：account / phone / *_no 都有唯一约束，rollback 之外的残留不该撞上。 */
const RUN_ID = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const NO = (prefix: string) => `ITEST-${prefix}-${RUN_ID}`;
const DIGITS = RUN_ID.replace(/\D/g, "").padEnd(8, "7").slice(0, 8);
/** 三个用户各要一个唯一手机号（account.users.phone 是强锚点 + 唯一）。 */
const phoneFor = (index: number) => `+8613${DIGITS}${index}`;

/** 作业实扫的九类，逐字同 bff/platform-api 的 ALERT_KINDS（一致性由守卫对账）。 */
const ALERT_KINDS: readonly OpsTodoKind[] = [
  "confirm_payment",
  "reprovision",
  "refund_audit",
  "refund_execute",
  "refund_processing_stuck",
  "refund_failed",
  "addon_pending_confirm",
  "ticket_sla",
  "maintenance_overdue",
];

describe.runIf(RUN)("ops todos — repository SQL (live DB, rolled back)", () => {
  let pool: Pool;
  let client: PoolClient;
  let repo: OpsTodoRepository;
  let userId: string;
  let tenantNo: string;
  let userNoDeleting: string;
  let userNoPurge: string;
  const orderNoVerify = NO("ORD-V");
  const orderNoPaid = NO("ORD-P");
  const orderNoPartial = NO("ORD-B");
  const orderNoAging = NO("ORD-A");
  const orderNoSub = NO("ORD-S");
  const refundNo = NO("RFD");
  const refundNoExec = NO("RFD-X");
  const refundNoStuck = NO("RFD-K");
  const refundNoFailed = NO("RFD-F");
  const invoiceNoApplying = NO("INV-A");
  const invoiceNoApproved = NO("INV-P");
  const addonOrderNo = NO("ADDON");
  const ticketNo = NO("TCK");
  const ticketNoSla = NO("TCK-S");
  const windowTitle = `ITEST 维护窗口 ${RUN_ID}`;
  /** 窗口主键：维护窗口那一类的待办身份取它（title 上没有唯一约束）。 */
  let windowId: string;

  /** 只看本 suite 造的那些行——库里可能本来就有真实待办。 */
  const mine = (items: OpsTodo[]) => {
    const codes = new Set([
      orderNoVerify,
      orderNoPaid,
      orderNoPartial,
      orderNoAging,
      orderNoSub,
      refundNo,
      refundNoExec,
      refundNoStuck,
      refundNoFailed,
      invoiceNoApplying,
      invoiceNoApproved,
      addonOrderNo,
      ticketNo,
      ticketNoSla,
      windowTitle,
      userNoDeleting,
      userNoPurge,
    ]);
    return items.filter(
      (i) =>
        codes.has(i.subject.no) ||
        (i.subject.type === "tenant" && i.subject.no === tenantNo),
    );
  };

  const byKind = (items: OpsTodo[]) => new Map(items.map((i) => [i.kind, i]));

  /** uuid 形状：用来证明「除了 id，哪儿都没有它」。 */
  const UUID_SHAPE =
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    client = await pool.connect();
    await client.query("begin");
    repo = new OpsTodoRepository(client as unknown as Pool);

    // 申报人（也是租户 owner）。user_no 由 95 的触发器取号。
    const insertUser = async (
      index: number,
      extra: { status?: string; deletionDaysAgo?: number } = {},
    ): Promise<{ id: string; userNo: string }> => {
      const r = await client.query<{ id: string; user_no: string }>(
        `insert into account.users
           (account, email, phone, phone_verified_at, source, status, deletion_requested_at)
         values ($1, $2, $3, now(), 'web', $4,
                 case when $5::int is null then null
                      else now() - make_interval(days => $5::int) end)
         returning id, user_no::text`,
        [
          `itest-${RUN_ID}-${index}`,
          `itest-${RUN_ID}-${index}@example.com`,
          phoneFor(index),
          extra.status ?? "active",
          extra.deletionDaysAgo ?? null,
        ],
      );
      return { id: r.rows[0]!.id, userNo: r.rows[0]!.user_no };
    };
    const owner = await insertUser(0);
    userId = owner.id;
    await client.query(
      `insert into account.user_profiles (user_id, display_name) values ($1, $2)`,
      [userId, "ITEST 申报人"],
    );
    // 注销中的两个账号：5 天前申请（还在保留期中段）/ 28 天前申请（27 天线已过 → 即将清除）。
    const deleting = await insertUser(1, {
      status: "deleting",
      deletionDaysAgo: 5,
    });
    const purging = await insertUser(2, {
      status: "deleting",
      deletionDaysAgo: 28,
    });
    userNoDeleting = deleting.userNo;
    userNoPurge = purging.userNo;
    await client.query(
      `insert into account.user_profiles (user_id, display_name) values ($1, $2)`,
      [deleting.id, "ITEST 要注销的人"],
    );

    // 认证 pending 的租户（tenant_no 由触发器取号）+ 一条认证提交记录。
    const tenant = await client.query<{ id: string; tenant_no: string }>(
      `insert into tenancy.tenants (name, display_name, type, owner_user_id, verification_status)
       values ($1, $2, 'organization', $3, 'pending') returning id, tenant_no::text`,
      [`ITEST 认证名 ${RUN_ID}`, `ITEST 简称 ${RUN_ID}`, userId],
    );
    const tenantId = tenant.rows[0]!.id;
    tenantNo = tenant.rows[0]!.tenant_no;
    // 租户资料：region / industry / scale 三列的来源（region 无 province/city 源列，
    // 取 address 再退 country_code——与 tenants.router 同源）。
    await client.query(
      `insert into tenancy.tenant_profiles (tenant_id, industry, scale, country_code, address)
       values ($1, 'manufacturing', '50-200', 'CN', 'ITEST 上海市浦东新区')`,
      [tenantId],
    );
    await client.query(
      `insert into kyc.tenant_verifications (tenant_id, verification_type, status)
       values ($1, 'enterprise', 'pending')`,
      [tenantId],
    );
    // 五个工作区：uidx_orders_open_per_product 只允许每个 (workspace, product) 一张在途单，
    // 而下面要同时挂 pending_verify / paid / pending_payment(部分收款) / pending_payment(挂着)
    // 四张；第五个给欠费订阅（uidx_subscriptions_live_per_product 同理，overdue 也占槽位）。
    const insertWorkspace = async (name: string, isDefault: boolean) => {
      const r = await client.query<{ id: string }>(
        `insert into tenancy.workspaces (tenant_id, name, is_default)
         values ($1, $2, $3) returning id`,
        [tenantId, name, isDefault],
      );
      return r.rows[0]!.id;
    };
    const workspaceId = await insertWorkspace("ITEST WS", true);
    const workspaceId2 = await insertWorkspace("ITEST WS 2", false);
    const workspaceId3 = await insertWorkspace("ITEST WS 3", false);
    const workspaceId4 = await insertWorkspace("ITEST WS 4", false);
    const workspaceId5 = await insertWorkspace("ITEST WS 5", false);

    // 一个已锁定套餐版本及其主组件产品（seed 里有）。
    const pv = await client.query<{ id: string; product_id: string }>(
      `select pv.id, pc.product_id
         from product.plan_versions pv
         join product.plan_components pc
           on pc.plan_version_id = pv.id and pc.component_role = 'primary'
        where pv.is_locked = true
        limit 1`,
    );
    expect(pv.rows).toHaveLength(1);
    const { id: planVersionId, product_id: productId } = pv.rows[0]!;

    // 等待起点那一列（declared_at / paid_at）按 $8 分钟前打戳；两列都写，用不到的那列是 null。
    const insertOrder = async (
      orderNo: string,
      status: "pending_verify" | "paid" | "pending_payment",
      minutesAgo: number,
      workspace: string,
    ): Promise<string> => {
      const r = await client.query<{ id: string }>(
        `insert into billing.orders
           (order_no, tenant_id, workspace_id, product_id, plan_version_id, intent, cycle_unit,
            list_amount, payable_amount, currency, status, created_by_type, created_by_id,
            declared_at, paid_at)
         values ($1, $2, $3, $4, $5, 'new', 'month', 99, 99, 'CNY', $6::text, 'customer', $7,
                 case when $6::text = 'pending_verify' then now() - make_interval(mins => $8::int) end,
                 case when $6::text = 'paid'           then now() - make_interval(mins => $8::int) end)
         returning id`,
        [
          orderNo,
          tenantId,
          workspace,
          productId,
          planVersionId,
          status,
          userId,
          minutesAgo,
        ],
      );
      return r.rows[0]!.id;
    };
    // 客户 30 分钟前申报 → confirm_payment，等待起点 = declared_at。
    const orderVerifyId = await insertOrder(
      orderNoVerify,
      "pending_verify",
      30,
      workspaceId,
    );
    // 20 分钟前到账没开通 → reprovision，等待起点 = paid_at。
    const orderPaidId = await insertOrder(
      orderNoPaid,
      "paid",
      20,
      workspaceId2,
    );
    // 部分收款、尾款挂账 → follow_up_balance，等待起点 = updated_at（刚才）。
    const orderPartialId = await insertOrder(
      orderNoPartial,
      "pending_payment",
      0,
      workspaceId3,
    );
    // 30 小时前下的单，从没申报过、也没账单 → order_pending_payment_aging
    // （默认阈值 24h，等待起点 = created_at）。
    const orderAgingId = await insertOrder(
      orderNoAging,
      "pending_payment",
      0,
      workspaceId4,
    );
    await client.query(
      `update billing.orders set created_at = now() - interval '30 hours' where id = $1`,
      [orderAgingId],
    );

    const insertInvoice = async (
      orderId: string,
      billStatus: string,
      paidAmount: number,
    ) => {
      const r = await client.query<{ id: string }>(
        `insert into billing.invoices
           (tenant_id, bill_no, order_id, bill_cycle, cycle_start_date, cycle_end_date,
            total_amount, payable_amount, paid_amount, bill_status, created_by_type)
         values ($1, $2, $3, 'month', current_date, current_date + 30, 99, 99,
                 $5, $4, 'customer')
         returning id`,
        [
          tenantId,
          NO(`BILL-${orderId.slice(0, 4)}`),
          orderId,
          billStatus,
          paidAmount,
        ],
      );
      return r.rows[0]!.id;
    };
    const insertPayment = async (billId: string, payStatus: string) => {
      const r = await client.query<{ id: string }>(
        `insert into billing.payments
           (tenant_id, bill_id, pay_order_no, pay_source, pay_channel, total_amount,
            paid_amount, pay_status, actor_type, actor_id)
         values ($1, $2, $3, 'offline', 'bank_transfer', 99,
                 case when $4 = 'paid' then 99 else 0 end, $4, 'customer', $5)
         returning id`,
        [tenantId, billId, NO(`PAY-${billId.slice(0, 4)}`), payStatus, userId],
      );
      return r.rows[0]!.id;
    };
    // 申报腿（pending_verify）——申报人从这条腿的 actor 解出来。
    const billVerify = await insertInvoice(orderVerifyId, "paying", 0);
    await insertPayment(billVerify, "pending_verify");
    // 已付腿 + 挂在这张单上的四张退款单（四格状态各一张）。
    const billPaid = await insertInvoice(orderPaidId, "paid", 99);
    const payPaid = await insertPayment(billPaid, "paid");
    /**
     * 四格退款。DDL 的 chk_refunds_execute_needs_approval：离开 pending 的必须已 approved，
     * 所以后两张的 audit_status 只能是 approved。`audit_at` / `updated_at` 就是各自的等待起点。
     */
    const insertRefund = async (
      refundNoValue: string,
      auditStatus: string,
      refundStatus: string,
      hoursAgo: number,
    ) => {
      await client.query(
        `insert into billing.refunds
           (tenant_id, bill_id, pay_record_id, order_id, refund_no, refund_amount, currency,
            refund_reason, audit_status, refund_status, created_by_type, created_by_id,
            audit_at, updated_at)
         values ($1, $2, $3, $4, $5, 99, 'CNY', 'itest', $6::text, $7, 'customer', $8,
                 case when $6::text = 'pending' then null
                      else now() - make_interval(hours => $9::int) end,
                 now() - make_interval(hours => $9::int))`,
        [
          tenantId,
          billPaid,
          payPaid,
          orderPaidId,
          refundNoValue,
          auditStatus,
          refundStatus,
          userId,
          hoursAgo,
        ],
      );
    };
    // 待审：等待起点 = created_at（刚才），所以 minAge 会把它滤掉——这正是下面那条用例要的。
    await insertRefund(refundNo, "pending", "pending", 0);
    await insertRefund(refundNoExec, "approved", "pending", 2);
    await insertRefund(refundNoStuck, "approved", "processing", 6);
    await insertRefund(refundNoFailed, "approved", "failed", 3);
    // 尾款挂账：最近账单 partial，已收 30。
    await insertInvoice(orderPartialId, "partial", 30);

    // 两档开票：applying 等待自 created_at（3 小时前）、approved 等待自 audit_at（2 小时前）。
    const insertReceipt = async (
      invoiceNo: string,
      status: string,
      hoursAgo: number,
    ) => {
      await client.query(
        `insert into billing.invoice_receipts
           (tenant_id, bill_id, invoice_no, invoice_type, invoice_tax_type, invoice_title,
            company_info, invoice_amount, currency, invoice_status,
            created_by_type, created_by_id, audit_at, created_at)
         values ($1, $2, $3, 'electronic_general', 'general', $4,
                 '{"title":"ITEST"}'::jsonb, 99, 'CNY', $5::text, 'customer', $6,
                 case when $5::text = 'approved' then now() - make_interval(hours => $7::int) end,
                 now() - make_interval(hours => $7::int))`,
        [
          tenantId,
          billPaid,
          invoiceNo,
          `ITEST 抬头 ${RUN_ID}`,
          status,
          userId,
          hoursAgo,
        ],
      );
    };
    await insertReceipt(invoiceNoApplying, "applying", 3);
    await insertReceipt(invoiceNoApproved, "approved", 2);

    // 加油包单：目录侧的包取 seed 里现成的一只（pack_id 有跨 schema 真 FK）。
    const pack = await client.query<{
      id: string;
      pack_code: string;
      pack_name: string;
      metric_key: string;
      amount: string;
      validity_days: number;
      price: string;
      currency: string;
    }>(
      `select id, pack_code, pack_name, metric_key, amount::text, validity_days,
              price::text, currency
         from product.addon_packs
        where status = 'active'
        limit 1`,
    );
    expect(pack.rows).toHaveLength(1);
    const packRow = pack.rows[0]!;
    await client.query(
      `insert into metering.addon_purchases
         (tenant_id, workspace_id, pack_id, pack_code, pack_name, metric_key, amount,
          validity_days, price, currency, order_no, status, created_by_type, created_by_id,
          created_at)
       values ($1, $2, $3, $4, $5, $6, $7::bigint, $8, $9::numeric, $10, $11,
               'pending_payment', 'customer', $12, now() - interval '2 hours')`,
      [
        tenantId,
        workspaceId,
        packRow.id,
        packRow.pack_code,
        packRow.pack_name,
        packRow.metric_key,
        packRow.amount,
        packRow.validity_days,
        packRow.price,
        packRow.currency,
        addonOrderNo,
        userId,
      ],
    );

    /*
     * 欠费订阅 + 它的「进入 overdue」那一条历史。顺序有讲究：订阅先建（current_order_id
     * 先空），再建那张已履约的订单（chk_orders_fulfilled 要求 fulfilled 的单必须已挂订阅），
     * 最后把订单回填到 current_order_id——那一列才是 subject 与详情链接的来源。
     */
    const sub = await client.query<{ id: string }>(
      `insert into metering.subscriptions
         (tenant_id, workspace_id, plan_version_id, subscription_kind, cycle_unit, cycle_count,
          start_at, end_at, status, created_by_type, created_by_id)
       values ($1, $2, $3, 'paid', 'month', 1,
               now() - interval '40 days', now() - interval '10 days',
               'overdue', 'customer', $4)
       returning id`,
      [tenantId, workspaceId5, planVersionId, userId],
    );
    const subscriptionId = sub.rows[0]!.id;
    const subOrder = await client.query<{ id: string }>(
      `insert into billing.orders
         (order_no, tenant_id, workspace_id, product_id, plan_version_id, intent, cycle_unit,
          list_amount, payable_amount, currency, status, created_by_type, created_by_id,
          paid_at, fulfilled_at, subscription_id)
       values ($1, $2, $3, $4, $5, 'new', 'month', 99, 99, 'CNY', 'fulfilled', 'customer', $6,
               now() - interval '40 days', now() - interval '40 days', $7)
       returning id`,
      [
        orderNoSub,
        tenantId,
        workspaceId5,
        productId,
        planVersionId,
        userId,
        subscriptionId,
      ],
    );
    await client.query(
      `update metering.subscriptions set current_order_id = $2 where id = $1`,
      [subscriptionId, subOrder.rows[0]!.id],
    );
    // 5 天前进入 overdue —— 等待起点取的就是这一条（不是 end_at 的 10 天前）。
    await client.query(
      `insert into metering.subscription_histories
         (tenant_id, subscription_id, change_type, from_status, to_status, actor_type, created_at)
       values ($1, $2, 'updated', 'active', 'overdue', 'system', now() - interval '5 days')`,
      [tenantId, subscriptionId],
    );

    // open 工单，p1 → amber / 10。刚建的，所以首响 SLA（p1 4 小时）还没破。
    await client.query(
      `insert into support.tickets (tenant_id, ticket_no, title, priority, status, reporter_name)
       values ($1, $2, 'ITEST 登录不了', 'p1', 'open', 'ITEST 报单人')`,
      [tenantId, ticketNo],
    );
    // 5 小时前建的 p1 工单、从没回过 → 首响 SLA 破（4 小时线），报 ticket_sla。
    await client.query(
      `insert into support.tickets
         (tenant_id, ticket_no, title, priority, status, reporter_name, created_at)
       values ($1, $2, 'ITEST 支付页打不开', 'p1', 'open', 'ITEST 报单人',
               now() - interval '5 hours')`,
      [tenantId, ticketNoSla],
    );

    // 进行中的维护窗口，计划 2 小时前就该结束了。created_by 是运营裸值（无 FK）。
    const windowRow = await client.query<{ id: string }>(
      `insert into admin.maintenance_windows
         (severity, status, title, start_at, end_at, created_by)
       values ('minor', 'in_progress', $1,
               now() - interval '4 hours', now() - interval '2 hours', gen_random_uuid())
       returning id`,
      [windowTitle],
    );
    windowId = windowRow.rows[0]!.id;

    trace("fixture", {
      userId,
      tenantId,
      tenantNo,
      windowId,
      orderVerifyId,
      orderPaidId,
      orderPartialId,
      orderAgingId,
      subscriptionId,
      userNoDeleting,
      userNoPurge,
    });
  });

  afterAll(async () => {
    // 最后一个用例已经 rollback；这里再保一道（没有事务时只是一条 WARNING）。
    await client.query("rollback");
    client.release();
    await pool.end();
  });

  it("全量：造出十八类各恰好一条（risk 那一类由单独一条用例点亮）", async () => {
    const items = mine(await repo.list());
    trace(
      "all",
      items.map((i) => [i.kind, i.subject.no]),
    );
    const counts = new Map<string, number>();
    for (const item of items) {
      counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
    }
    // 十九类各一条：`risk` 不在此列（本 suite 的租户没有未复核风险记录、也没被停用），
    // 所以造出来的是十八类——`risk` 那一类的谓词由下面单独一条用例点亮。
    expect([...counts.keys()].sort()).toEqual(
      [
        "confirm_payment",
        "reprovision",
        "follow_up_balance",
        "order_pending_payment_aging",
        "refund_audit",
        "refund_execute",
        "refund_processing_stuck",
        "refund_failed",
        "subscription_overdue",
        "invoice_applying",
        "invoice_approved",
        "addon_pending_confirm",
        "verification",
        "ticket",
        "ticket_sla",
        "maintenance_overdue",
        "deletion_pending",
        "purge_imminent",
      ].sort(),
    );
    for (const [kind, count] of counts) {
      expect(count, `${kind} 出了 ${count} 条`).toBe(1);
    }

    /*
     * 上屏的每一处都不带 UUID 形状的值。`id` 单独摘出来判——它是**身份**不是称呼，
     * 维护窗口那一类取窗口主键（标题不唯一，见下面「同名的两个维护窗口」那条），
     * 约定是「只当键用、任何场景不上屏」。所以这里两句话一起说：
     *   · 去掉 id 之后整份契约里一个 uuid 都没有；
     *   · 带 uuid 的 id 有且只有维护窗口那一条。
     */
    const withoutIds = items.map(({ id: _id, ...rest }) => rest);
    expect(JSON.stringify(withoutIds)).not.toMatch(UUID_SHAPE);
    expect(
      items.filter((i) => UUID_SHAPE.test(i.id)).map((i) => i.kind),
    ).toEqual(["maintenance_overdue"]);
    // 一条都没升档：本 suite 的等待时长都在默认阈值之内，除了下面单独试的那两条。
    expect(items.filter((i) => i.escalated).map((i) => i.kind)).toEqual([]);
  });

  it("首批六类的字段按契约（只有可视码，金额 / 产品 / 申报人 / 租户属性各归各）", async () => {
    const items = mine(await repo.list());
    const kinds = byKind(items);

    const confirm = kinds.get("confirm_payment")!;
    expect(confirm).toMatchObject({
      id: `confirm_payment:${orderNoVerify}`,
      severity: "rose",
      priority: 2,
      subject: { type: "order", no: orderNoVerify },
      tenant: {
        no: tenantNo,
        name: `ITEST 简称 ${RUN_ID}`,
        type: "company",
        // 库里读出来的四样（风险档没有未复核记录 → null，不兜 'normal'）。
        status: "active",
        riskLevel: null,
        region: "ITEST 上海市浦东新区",
        industry: "manufacturing",
        scale: "50-200",
      },
      applicant: {
        name: "ITEST 申报人",
        email: `itest-${RUN_ID}-0@example.com`,
      },
      amount: { value: "99.00", currency: "CNY", paid: null },
      progress: "pendingVerify",
      href: `/orders/${orderNoVerify}`,
      escalated: false,
      escalationStep: 0,
    });
    expect(confirm.product?.code).toBeTruthy();
    // 等待起点 = declared_at（30 分钟前），不是 updated_at（刚才）。
    const waited = Date.now() - new Date(confirm.waitingSince).getTime();
    expect(waited).toBeGreaterThan(25 * 60_000);

    expect(kinds.get("reprovision")).toMatchObject({
      progress: "paidUnprovisioned",
      priority: 3,
      href: `/orders/${orderNoPaid}`,
    });

    // 尾款挂账：应收 99、已收 30——这是客服打电话时要说的那个数。
    expect(kinds.get("follow_up_balance")).toMatchObject({
      id: `follow_up_balance:${orderNoPartial}`,
      severity: "amber",
      priority: 15,
      progress: "partialPending",
      amount: { value: "99.00", currency: "CNY", paid: "30.00" },
      href: `/orders/${orderNoPartial}`,
    });

    expect(kinds.get("refund_audit")).toMatchObject({
      id: `refund_audit:${refundNo}`,
      severity: "rose",
      priority: 2,
      subject: { type: "refund", no: refundNo },
      amount: { value: "99.00", currency: "CNY", paid: null },
      progress: "refundAudit",
      href: `/orders/${orderNoPaid}`,
      applicant: { name: "ITEST 申报人" },
    });

    expect(kinds.get("verification")).toMatchObject({
      severity: "amber",
      priority: 20,
      subject: { type: "tenant", no: tenantNo },
      amount: null,
      product: null,
      progress: "verification",
      href: "/verifications",
      applicant: { name: "ITEST 申报人" },
      tenant: { status: "active", riskLevel: null, industry: "manufacturing" },
    });

    expect(kinds.get("ticket")).toMatchObject({
      severity: "amber",
      priority: 10,
      subject: { type: "ticket", no: ticketNo },
      progress: "ticketOpen",
      href: `/tickets/${ticketNo}`,
      applicant: { name: "ITEST 报单人", email: null, phone: null },
      // status 是库里的原值，不在 SQL 里归一。
      ticket: { title: "ITEST 登录不了", priority: "p1", status: "open" },
    });
  });

  it("第三批新类别的字段按契约（等待起点各归各、链接落到能办事的那一页）", async () => {
    const items = mine(await repo.list());
    const kinds = byKind(items);
    const hoursWaited = (todo: OpsTodo) =>
      (Date.now() - new Date(todo.waitingSince).getTime()) / 3_600_000;

    // 挂着没人付的单：等待自 created_at（30 小时前），一般档。
    const aging = kinds.get("order_pending_payment_aging")!;
    expect(aging).toMatchObject({
      id: `order_pending_payment_aging:${orderNoAging}`,
      severity: "blue",
      priority: 40,
      progress: "orderAging",
      href: `/orders/${orderNoAging}`,
      amount: { value: "99.00", currency: "CNY", paid: null },
    });
    expect(hoursWaited(aging)).toBeGreaterThan(29);

    // 审过没退：等待自 audit_at（2 小时前），不是 created_at。
    const exec = kinds.get("refund_execute")!;
    expect(exec).toMatchObject({
      id: `refund_execute:${refundNoExec}`,
      severity: "rose",
      priority: 3,
      subject: { type: "refund", no: refundNoExec },
      progress: "refundExecute",
      href: `/orders/${orderNoPaid}`,
      amount: { value: "99.00", currency: "CNY", paid: null },
    });
    expect(hoursWaited(exec)).toBeGreaterThan(1.5);
    expect(hoursWaited(exec)).toBeLessThan(3);

    // 卡在处理中：6 小时前动过（默认阈值 4 小时，所以它成立）。
    const stuck = kinds.get("refund_processing_stuck")!;
    expect(stuck).toMatchObject({
      id: `refund_processing_stuck:${refundNoStuck}`,
      severity: "rose",
      priority: 6,
      progress: "refundProcessing",
    });
    expect(hoursWaited(stuck)).toBeGreaterThan(5.5);

    expect(kinds.get("refund_failed")).toMatchObject({
      id: `refund_failed:${refundNoFailed}`,
      severity: "rose",
      priority: 4,
      progress: "refundFailed",
      href: `/orders/${orderNoPaid}`,
    });

    // 欠费订阅：主体与链接都走「当前履约订单」的单号；等待自 history 那一行（5 天前），
    // 不是 end_at（10 天前）；金额**不给**（欠的是续费单上的钱）。
    const overdue = kinds.get("subscription_overdue")!;
    expect(overdue).toMatchObject({
      id: `subscription_overdue:${orderNoSub}`,
      severity: "amber",
      priority: 12,
      subject: { type: "subscription", no: orderNoSub },
      progress: "subscriptionOverdue",
      href: `/subscriptions/${orderNoSub}`,
      amount: null,
    });
    expect(overdue.product?.code).toBeTruthy();
    expect(hoursWaited(overdue)).toBeGreaterThan(4 * 24);
    expect(hoursWaited(overdue)).toBeLessThan(6 * 24);

    // 两档发票：applying 自 created_at（3h）、approved 自 audit_at（2h）；都去 /invoices。
    expect(kinds.get("invoice_applying")).toMatchObject({
      id: `invoice_applying:${invoiceNoApplying}`,
      severity: "amber",
      priority: 18,
      subject: { type: "invoice", no: invoiceNoApplying },
      progress: "invoiceApplying",
      href: "/invoices",
      amount: { value: "99.00", currency: "CNY", paid: null },
      product: null,
    });
    expect(kinds.get("invoice_approved")).toMatchObject({
      id: `invoice_approved:${invoiceNoApproved}`,
      priority: 19,
      progress: "invoiceApproved",
      href: "/invoices",
    });
    expect(hoursWaited(kinds.get("invoice_applying")!)).toBeGreaterThan(2.5);

    // 加油包待核销：产品位放的是包的快照（pack_code / pack_name）。
    const addon = kinds.get("addon_pending_confirm")!;
    expect(addon).toMatchObject({
      id: `addon_pending_confirm:${addonOrderNo}`,
      severity: "rose",
      priority: 7,
      subject: { type: "addon", no: addonOrderNo },
      progress: "addonPendingConfirm",
      href: "/addon-orders",
    });
    expect(addon.product?.code).toBeTruthy();
    expect(addon.amount?.value).toBeTruthy();

    // 注销两档：主体是用户号，没有租户块，「谁在等」是本人。
    expect(kinds.get("deletion_pending")).toMatchObject({
      id: `deletion_pending:${userNoDeleting}`,
      severity: "blue",
      priority: 45,
      subject: { type: "user", no: userNoDeleting },
      tenant: null,
      progress: "deletionPending",
      href: `/accounts/${userNoDeleting}`,
      applicant: { name: "ITEST 要注销的人" },
    });
    expect(kinds.get("purge_imminent")).toMatchObject({
      id: `purge_imminent:${userNoPurge}`,
      severity: "amber",
      priority: 16,
      subject: { type: "user", no: userNoPurge },
      progress: "purgeImminent",
      href: `/accounts/${userNoPurge}`,
    });

    // 工单首响超时：另一类、紧急档、等待自建单时刻（5 小时前，不是 updated_at）。
    const sla = kinds.get("ticket_sla")!;
    expect(sla).toMatchObject({
      id: `ticket_sla:${ticketNoSla}`,
      severity: "rose",
      // p1 破线 → 6（未破线的 p1 是 10）。
      priority: 6,
      subject: { type: "ticket", no: ticketNoSla },
      progress: "ticketSla",
      href: `/tickets/${ticketNoSla}`,
      ticket: { title: "ITEST 支付页打不开", priority: "p1", status: "open" },
    });
    expect(hoursWaited(sla)).toBeGreaterThan(4.5);

    // 维护窗口：主体是标题，**没有链接**（出路在运维台），租户 / 金额 / 产品整块为 null。
    // id 是**身份**（窗口主键）而不是称呼：标题上没有唯一约束，见下一条用例。
    expect(kinds.get("maintenance_overdue")).toMatchObject({
      id: `maintenance_overdue:${windowId}`,
      severity: "rose",
      priority: 9,
      subject: { type: "maintenance", no: windowTitle },
      tenant: null,
      applicant: null,
      amount: null,
      product: null,
      progress: "maintenanceOverdue",
      href: null,
    });
    expect(hoursWaited(kinds.get("maintenance_overdue")!)).toBeGreaterThan(1.5);
  });

  /**
   * 两个同名窗口同时超时。`admin.maintenance_windows.title` 上没有唯一约束，运营反复用
   * 「例行维护」这种名字是常态；此前待办身份按标题算，两条会撞成同一个 id——页面上少一行
   * （React key 重复），告警的去重键也只剩一个，而且都不报错。
   *
   * 同一条用例顺带把铁律那一半也钉在真库上：窗口主键是 UUID，所以除了 `id`，契约里
   * 任何一处（subject.no / href / 租户 / 金额 / 产品 / 进度）都不许出现它。
   */
  it("同名的两个维护窗口是两条待办，且 uuid 只出现在 id 里", async () => {
    await client.query("savepoint window_twin");
    const twin = await client.query<{ id: string }>(
      `insert into admin.maintenance_windows
         (severity, status, title, start_at, end_at, created_by)
       values ('minor', 'in_progress', $1,
               now() - interval '5 hours', now() - interval '3 hours', gen_random_uuid())
       returning id`,
      [windowTitle],
    );
    const twinId = twin.rows[0]!.id;
    const windows = mine(await repo.list({ kinds: ["maintenance_overdue"] }));
    trace(
      "window twins",
      windows.map((i) => i.id),
    );
    expect(windows).toHaveLength(2);
    expect(new Set(windows.map((i) => i.id)).size).toBe(2);
    expect(windows.map((i) => i.id).sort()).toEqual(
      [
        `maintenance_overdue:${windowId}`,
        `maintenance_overdue:${twinId}`,
      ].sort(),
    );
    for (const todo of windows) {
      // 称呼一样是对的——那正是运营给它们起的同一个名字。
      expect(todo.subject.no).toBe(windowTitle);
      const { id, ...rest } = todo;
      expect(id).toMatch(UUID_SHAPE);
      expect(JSON.stringify(rest)).not.toMatch(UUID_SHAPE);
    }
    await client.query("rollback to savepoint window_twin");
  });

  it("同一张工单只出一条：首响回了就退回 ticket，SLA 那一类当场消失", async () => {
    await client.query("savepoint sla_probe");
    await client.query(
      `update support.tickets set first_response_at = now() where ticket_no = $1`,
      [ticketNoSla],
    );
    const after = mine(await repo.list({ kinds: ["ticket", "ticket_sla"] }));
    const forThatTicket = after.filter((i) => i.subject.no === ticketNoSla);
    expect(forThatTicket).toHaveLength(1);
    expect(forThatTicket[0]).toMatchObject({ kind: "ticket", priority: 10 });
    await client.query("rollback to savepoint sla_probe");
  });

  it("挂着没人付的单：账单变成部分收款后改报 follow_up_balance，不出两条", async () => {
    await client.query("savepoint aging_probe");
    const order = await client.query<{ id: string }>(
      `select id from billing.orders where order_no = $1`,
      [orderNoAging],
    );
    await client.query(
      `insert into billing.invoices
         (tenant_id, bill_no, order_id, bill_cycle, cycle_start_date, cycle_end_date,
          total_amount, payable_amount, paid_amount, bill_status, created_by_type)
       values ((select tenant_id from billing.orders where id = $2), $1, $2,
               'month', current_date, current_date + 30, 99, 99, 40, 'partial', 'customer')`,
      [NO("BILL-AGE"), order.rows[0]!.id],
    );
    const after = mine(await repo.list()).filter(
      (i) => i.subject.no === orderNoAging,
    );
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({
      kind: "follow_up_balance",
      amount: { paid: "40.00" },
    });
    await client.query("rollback to savepoint aging_probe");
  });

  it("成熟期：退款刚进 processing 还不算卡住，订单刚下还不算挂着", async () => {
    await client.query("savepoint ripen_probe");
    await client.query(
      `update billing.refunds set updated_at = now() where refund_no = $1`,
      [refundNoStuck],
    );
    await client.query(
      `update billing.orders set created_at = now() where order_no = $1`,
      [orderNoAging],
    );
    const after = mine(await repo.list());
    expect(after.map((i) => i.kind)).not.toContain("refund_processing_stuck");
    expect(after.map((i) => i.kind)).not.toContain(
      "order_pending_payment_aging",
    );
    // 阈值调小到 1 小时 / 1 小时，它们还是不成立（刚刚才发生）。
    const tighter = mine(
      await repo.list({
        thresholds: { refundStuckHours: 1, orderAgingHours: 1 },
      }),
    );
    expect(tighter.map((i) => i.kind)).not.toContain("refund_processing_stuck");
    await client.query("rollback to savepoint ripen_probe");
  });

  it("工单 reopened 仍算未结，且与 p0 同进 rose", async () => {
    await client.query("savepoint reopen_probe");
    await client.query(
      `update support.tickets set status = 'reopened' where ticket_no = $1`,
      [ticketNo],
    );
    const reopened = mine(await repo.list({ kinds: ["ticket"] })).filter(
      (i) => i.subject.no === ticketNo,
    );
    expect(reopened.map((i) => i.id)).toEqual([`ticket:${ticketNo}`]);
    expect(reopened[0]).toMatchObject({
      severity: "rose",
      progress: "ticketOpen",
      ticket: { status: "reopened" },
    });

    // 已解决 / 已取消不是待办。
    for (const closedish of ["resolved", "closed", "cancelled"]) {
      await client.query(
        `update support.tickets set status = $2 where ticket_no = $1`,
        [ticketNo, closedish],
      );
      expect(
        mine(await repo.list({ kinds: ["ticket"] })).filter(
          (i) => i.subject.no === ticketNo,
        ),
      ).toEqual([]);
    }

    // 处理中的两个状态 → ticketProcessing。
    for (const working of ["in_progress", "pending"]) {
      await client.query(
        `update support.tickets set status = $2 where ticket_no = $1`,
        [ticketNo, working],
      );
      const items = mine(await repo.list({ kinds: ["ticket"] })).filter(
        (i) => i.subject.no === ticketNo,
      );
      expect(items[0]).toMatchObject({
        progress: "ticketProcessing",
        ticket: { status: working },
      });
    }
    await client.query("rollback to savepoint reopen_probe");
  });

  it("风险那一类：停用租户即成立，rose / 5 或 25", async () => {
    await client.query("savepoint risk_probe");
    await client.query(
      `update tenancy.tenants set status = 'suspended' where tenant_no = $1::bigint`,
      [tenantNo],
    );
    const risk = mine(await repo.list({ kinds: ["risk"] }));
    expect(risk).toHaveLength(1);
    expect(risk[0]).toMatchObject({
      kind: "risk",
      severity: "rose",
      subject: { type: "tenant", no: tenantNo },
      href: `/tenants/${tenantNo}`,
      progress: "risk",
    });
    await client.query("rollback to savepoint risk_probe");
  });

  it("升档：越过阈值才升，级数按倍数，rose 已是顶档就只置位", async () => {
    // 已收款未开通那条等了 20 分钟。阈值 21 分钟 → 没越过；20 分钟 → 越过一次。
    const notYet = mine(
      await repo.list({
        kinds: ["reprovision"],
        thresholds: { reprovisionMinutes: 21 },
      }),
    );
    expect(notYet).toHaveLength(1);
    expect(notYet[0]).toMatchObject({
      escalated: false,
      escalationStep: 0,
      severity: "rose",
    });

    const crossed = mine(
      await repo.list({
        kinds: ["reprovision"],
        thresholds: { reprovisionMinutes: 20 },
      }),
    );
    expect(crossed[0]).toMatchObject({ escalated: true, severity: "rose" });
    expect(crossed[0]!.escalationStep).toBeGreaterThanOrEqual(1);

    // 5 分钟阈值 → 20/5 = 4 级（每跨一个倍数播一条通告的那个级数）。
    const fourth = mine(
      await repo.list({
        kinds: ["reprovision"],
        thresholds: { reprovisionMinutes: 5 },
      }),
    );
    expect(fourth[0]!.escalationStep).toBe(4);

    // 封顶 12：阈值 1 分钟时 20/1 = 20，报 12。
    const capped = mine(
      await repo.list({
        kinds: ["reprovision"],
        thresholds: { reprovisionMinutes: 1 },
      }),
    );
    expect(capped[0]!.escalationStep).toBe(12);
  });

  it("升档把关注档升成紧急档，并跟着换排序档位", async () => {
    await client.query("savepoint escalate_probe");
    // 认证提交挪到 5 天前；阈值 1 天 → 升档：amber → rose。
    await client.query(
      `update kyc.tenant_verifications
          set created_at = now() - interval '5 days'
        where tenant_id = (select id from tenancy.tenants where tenant_no = $1::bigint)`,
      [tenantNo],
    );
    const escalated = mine(
      await repo.list({
        kinds: ["verification"],
        thresholds: { verificationDays: 1 },
      }),
    );
    expect(escalated).toHaveLength(1);
    expect(escalated[0]).toMatchObject({
      kind: "verification",
      severity: "rose",
      escalated: true,
    });
    expect(escalated[0]!.escalationStep).toBeGreaterThanOrEqual(5);

    // 同一行在阈值 30 天下不升档，仍是 amber。
    const calm = mine(
      await repo.list({
        kinds: ["verification"],
        thresholds: { verificationDays: 30 },
      }),
    );
    expect(calm[0]).toMatchObject({ severity: "amber", escalated: false });

    // 升了档就要跟着换排序档位：与一条 blue 同列时排在前面。
    const mixed = mine(
      await repo.list({
        kinds: ["verification", "deletion_pending"],
        thresholds: { verificationDays: 1 },
      }),
    );
    expect(mixed.map((i) => i.kind)).toEqual([
      "verification",
      "deletion_pending",
    ]);
    await client.query("rollback to savepoint escalate_probe");
  });

  it("minAge：只留在当前状态里停够久的（刚造的那几条掉出）", async () => {
    const aged = mine(await repo.list({ minAgeMinutes: 10 }));
    trace(
      "minAge=10",
      aged.map((i) => i.kind),
    );
    // 刚造的三条掉出：follow_up_balance（updated_at 就是刚才）、refund_audit（created_at
    // 刚才）、ticket（updated_at 刚才）；verification 的等待起点是刚插的认证记录。
    expect(aged.map((i) => i.kind).sort()).toEqual(
      [
        "confirm_payment",
        "reprovision",
        "order_pending_payment_aging",
        "refund_execute",
        "refund_processing_stuck",
        "refund_failed",
        "subscription_overdue",
        "invoice_applying",
        "invoice_approved",
        "addon_pending_confirm",
        "ticket_sla",
        "maintenance_overdue",
        "deletion_pending",
        "purge_imminent",
      ].sort(),
    );

    // 25 分钟以上：只剩申报（30 分钟前）与那些按小时 / 天计的。
    const older = mine(await repo.list({ minAgeMinutes: 25 }));
    expect(older.map((i) => i.kind)).toContain("confirm_payment");
    expect(older.map((i) => i.kind)).not.toContain("reprovision");

    // 60 天以上：一条都不剩。
    expect(mine(await repo.list({ minAgeMinutes: 60 * 24 * 60 }))).toEqual([]);
  });

  it("kinds：告警作业那九类之外的一条都不回", async () => {
    const alerting = mine(await repo.list({ kinds: [...ALERT_KINDS] }));
    expect(alerting.map((i) => i.kind).sort()).toEqual(
      [
        "confirm_payment",
        "reprovision",
        "refund_audit",
        "refund_execute",
        "refund_processing_stuck",
        "refund_failed",
        "addon_pending_confirm",
        "ticket_sla",
        "maintenance_overdue",
      ].sort(),
    );
    const onlyRefund = mine(await repo.list({ kinds: ["refund_audit"] }));
    expect(onlyRefund.map((i) => i.id)).toEqual([`refund_audit:${refundNo}`]);
  });

  it("排序：rose 在前；同档按优先级；同优先级等得最久的在前", async () => {
    const items = mine(await repo.list());
    const rank = (s: string) => (s === "rose" ? 0 : s === "amber" ? 1 : 2);
    trace(
      "sorted",
      items.map((i) => [i.kind, i.severity, i.priority]),
    );
    for (let i = 1; i < items.length; i += 1) {
      const prev = items[i - 1]!;
      const cur = items[i]!;
      const prevKey = [
        rank(prev.severity),
        prev.priority,
        new Date(prev.waitingSince).getTime(),
      ];
      const curKey = [
        rank(cur.severity),
        cur.priority,
        new Date(cur.waitingSince).getTime(),
      ];
      expect(
        prevKey[0]! < curKey[0]! ||
          (prevKey[0] === curKey[0] &&
            (prevKey[1]! < curKey[1]! ||
              (prevKey[1] === curKey[1] && prevKey[2]! <= curKey[2]!))),
        `${prev.kind}(${prev.severity}/${prev.priority}) 不该排在 ${cur.kind}(${cur.severity}/${cur.priority}) 前面`,
      ).toBe(true);
    }
    // 同优先级 2 的两条：申报等了 30 分钟，退款申请是刚才 → 申报在前。
    const twos = items.filter((i) => i.priority === 2).map((i) => i.kind);
    expect(twos).toEqual(["confirm_payment", "refund_audit"]);
  });

  /**
   * 生产上的权限面：告警作业连库用的是 `svc_platform_api`（97_service_roles.sql 的 7 个
   * schema + 逐条表级例外），不是 owner。Postgres 对语句里**出现过的每一个关系**查权限，
   * 所以只要文本里有一个越界的 join，这一条就 42501——而本机以 owner 跑的所有别的用例都
   * 不会发现它。第三批的九类里有两类落在表级例外上（support.tickets /
   * admin.maintenance_windows），这一条同时证明那两张例外真的够用。
   *
   * 角色本机应当已由 97 建好；万一没有（没供给过 TD-020），就在这笔事务里临时建一个、
   * 按 97 的同一张授权面授权（含末尾那几条表级例外），跟着 rollback 一起消失。
   */
  it("作业那个调用形状在 svc_platform_api 角色下真跑得通（生产权限面）", async () => {
    await client.query("savepoint svc_role");
    let executed: OpsTodo[] | null = null;
    let scoped: OpsTodo[] | null = null;
    let failure: unknown = null;
    try {
      const present = await client.query(
        `select 1 from pg_roles where rolname = 'svc_platform_api'`,
      );
      if (present.rowCount === 0) {
        await client.query(`create role svc_platform_api nologin`);
        await client.query(
          `grant usage on schema metering, product, sharing, provisioning, tenancy, billing, promotion to svc_platform_api`,
        );
        await client.query(
          `grant select, insert, update, delete on all tables in schema metering, product, sharing, provisioning, tenancy, billing, promotion to svc_platform_api`,
        );
        // 97 末尾的表级例外（2026-11-23 那份迁移同款）：作业那一拼要读这两张。
        await client.query(`grant usage on schema support to svc_platform_api`);
        await client.query(`grant usage on schema admin to svc_platform_api`);
        await client.query(
          `grant select on support.tickets to svc_platform_api`,
        );
        await client.query(
          `grant select on admin.maintenance_windows to svc_platform_api`,
        );
      }
      await client.query(`set role svc_platform_api`);
      // 逐字就是 OpsTodoAlertJob.pass() 的那一套参数。
      executed = await repo.list({
        kinds: [...ALERT_KINDS],
        minAgeMinutes: 15,
        limit: 50,
        includeApplicant: false,
      });
      // 同一角色下再取一遍不限 50 条的，好在共享的本机库里稳定地找到本 suite 造的行。
      scoped = await repo.list({
        kinds: [...ALERT_KINDS],
        minAgeMinutes: 15,
        includeApplicant: false,
      });
    } catch (error) {
      failure = error;
    }
    // 事务在失败后是 aborted 态，`rollback to savepoint` 仍然可用（reset role 不一定）。
    await client.query("rollback to savepoint svc_role");
    await client.query("reset role");
    if (failure) throw failure;

    expect(Array.isArray(executed)).toBe(true);
    const ours = mine(scoped!);
    trace(
      "svc_platform_api",
      ours.map((i) => i.kind),
    );
    // refund_audit 的等待起点是刚才，被 minAge=15 滤掉；其余八类都在。
    expect(ours.map((i) => i.kind).sort()).toEqual(
      [
        "confirm_payment",
        "reprovision",
        "refund_execute",
        "refund_processing_stuck",
        "refund_failed",
        "addon_pending_confirm",
        "ticket_sla",
        "maintenance_overdue",
      ].sort(),
    );
    for (const todo of ours) {
      // 富化块整块不要：申报人为 null，风险档为 null。
      expect(todo.applicant, todo.kind).toBeNull();
      expect(todo.tenant?.riskLevel ?? null, todo.kind).toBeNull();
      // 租户名照常（tenancy 有权）——维护窗口没有租户，那一条整块为 null。
      if (todo.kind === "maintenance_overdue") {
        expect(todo.tenant).toBeNull();
      } else {
        expect(todo.tenant?.name, todo.kind).toBe(`ITEST 简称 ${RUN_ID}`);
        expect(todo.tenant?.status, todo.kind).toBe("active");
      }
    }
    // 角色已复位：后面的用例还以 owner 跑。
    const who = await client.query<{ role: string }>(
      `select current_user as role`,
    );
    expect(who.rows[0]!.role).not.toBe("svc_platform_api");
  });

  it("rollback 之后库和跑前一样：订单、退款、发票、加油包、订阅、工单、窗口、账号都不在", async () => {
    await client.query("rollback");
    const check = async (sql: string, params: unknown[]) =>
      (await pool.query(sql, params)).rowCount;
    expect(
      await check(
        `select 1 from billing.orders where order_no in ($1, $2, $3, $4, $5)`,
        [orderNoVerify, orderNoPaid, orderNoPartial, orderNoAging, orderNoSub],
      ),
    ).toBe(0);
    expect(
      await check(
        `select 1 from billing.refunds where refund_no in ($1, $2, $3, $4)`,
        [refundNo, refundNoExec, refundNoStuck, refundNoFailed],
      ),
    ).toBe(0);
    expect(
      await check(
        `select 1 from billing.invoice_receipts where invoice_no in ($1, $2)`,
        [invoiceNoApplying, invoiceNoApproved],
      ),
    ).toBe(0);
    expect(
      await check(
        `select 1 from metering.addon_purchases where order_no = $1`,
        [addonOrderNo],
      ),
    ).toBe(0);
    expect(
      await check(`select 1 from support.tickets where ticket_no in ($1, $2)`, [
        ticketNo,
        ticketNoSla,
      ]),
    ).toBe(0);
    expect(
      await check(`select 1 from admin.maintenance_windows where title = $1`, [
        windowTitle,
      ]),
    ).toBe(0);
    expect(
      await check(
        `select 1 from tenancy.tenants where tenant_no = $1::bigint`,
        [tenantNo],
      ),
    ).toBe(0);
    expect(
      await check(
        `select 1 from account.users where user_no in ($1::bigint, $2::bigint)`,
        [userNoDeleting, userNoPurge],
      ),
    ).toBe(0);
    expect(
      await check(`select 1 from account.users where id = $1`, [userId]),
    ).toBe(0);
  });
});
