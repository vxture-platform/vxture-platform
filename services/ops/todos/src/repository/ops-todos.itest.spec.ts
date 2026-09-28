/**
 * ops-todos.itest.spec.ts — 待办 SQL 在**真库**上的行为（2026-09-28 根治批）。
 *
 * 假 pool 的 spec 只能钉字面；这里钉的是谓词本身：造一张 pending_verify 订单、一张 paid
 * 订单（顺带一张挂在它上面的 pending 退款单）、一张 pending_payment + 部分收款的订单、
 * 一个认证 pending 的租户、一张 open 工单，六类各命中一条；minAge 过滤成立；kinds 过滤
 * 成立；排序成立；租户属性与「已收多少」真的从库里读出来。
 *
 * 还钉一条别的地方钉不到的：**告警作业那个调用形状在 `svc_platform_api` 角色下跑得通**。
 * Postgres 对语句里出现过的每一个关系查权限——那一支返不返回行都一样——所以一条顺手
 * join 了 `account.users` 的待办查询在本机（owner 连库）畅通无阻，到生产（那个角色只有
 * 7 个 schema，见 97_service_roles.sql）就是 42501、整轮作业失败。静态守卫
 * （check-ops-todo-alerts 第 5 段）扫文本，这一条真跑。
 *
 * 整个 suite 跑在**一笔事务里并 ROLLBACK**（与 product-maintenance.itest 同款）：仓储拿到的
 * 「pool」其实是同一个 client，它发的每一条查询都在这笔事务里。造的用户 / 租户 / 订单 /
 * 账单 / 支付腿 / 退款 / 认证 / 工单全部随 rollback 消失，跑完库和跑前一样（最后一个用例回查）。
 *
 * Gated (needs a seeded platform DB):
 *   SUBSCRIPTION_ITEST=1 DATABASE_URL=postgresql://... pnpm --filter @vxture/service-ops-todos test
 * 加 SUBSCRIPTION_ITEST_TRACE=1 把每一步的查询结果打出来。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { OpsTodoRepository } from "./pg-ops-todo.repository";
import type { OpsTodo } from "../types";

const RUN = process.env.SUBSCRIPTION_ITEST === "1";
const TRACE = process.env.SUBSCRIPTION_ITEST_TRACE === "1";
const trace = (label: string, value: unknown): void => {
  if (TRACE)
    console.log(`[ops-todos-itest] ${label}: ${JSON.stringify(value)}`);
};

/** 每次跑一个新后缀：account / phone / *_no 都有唯一约束，rollback 之外的残留不该撞上。 */
const RUN_ID = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const NO = (prefix: string) => `ITEST-${prefix}-${RUN_ID}`;

describe.runIf(RUN)("ops todos — repository SQL (live DB, rolled back)", () => {
  let pool: Pool;
  let client: PoolClient;
  let repo: OpsTodoRepository;
  let userId: string;
  let tenantNo: string;
  const orderNoVerify = NO("ORD-V");
  const orderNoPaid = NO("ORD-P");
  const orderNoPartial = NO("ORD-B");
  const refundNo = NO("RFD");
  const ticketNo = NO("TCK");

  /** 只看本 suite 造的那些行——库里可能本来就有真实待办。 */
  const mine = (items: OpsTodo[]) =>
    items.filter(
      (i) =>
        i.subject.no === orderNoVerify ||
        i.subject.no === orderNoPaid ||
        i.subject.no === orderNoPartial ||
        i.subject.no === refundNo ||
        i.subject.no === ticketNo ||
        (i.subject.type === "tenant" && i.subject.no === tenantNo),
    );

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    client = await pool.connect();
    await client.query("begin");
    repo = new OpsTodoRepository(client as unknown as Pool);

    // 申报人（也是租户 owner）。user_no 由 95 的触发器取号。
    const user = await client.query<{ id: string }>(
      `insert into account.users (account, email, phone, phone_verified_at, source)
       values ($1, $2, $3, now(), 'web') returning id`,
      [
        `itest-${RUN_ID}`,
        `itest-${RUN_ID}@example.com`,
        `+8613${RUN_ID.replace(/\D/g, "").padEnd(9, "7").slice(0, 9)}`,
      ],
    );
    userId = user.rows[0]!.id;
    await client.query(
      `insert into account.user_profiles (user_id, display_name) values ($1, $2)`,
      [userId, "ITEST 申报人"],
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
    // 三个工作区：uidx_orders_open_per_product 只允许每个 (workspace, product) 一张在途单，
    // 而下面要同时挂 pending_verify / paid / pending_payment 三张。
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
    // 已付腿 + 挂在这张单上的 pending 退款单。
    const billPaid = await insertInvoice(orderPaidId, "paid", 99);
    const payPaid = await insertPayment(billPaid, "paid");
    await client.query(
      `insert into billing.refunds
         (tenant_id, bill_id, pay_record_id, order_id, refund_no, refund_amount, currency,
          refund_reason, audit_status, refund_status, created_by_type, created_by_id)
       values ($1, $2, $3, $4, $5, 99, 'CNY', 'itest', 'pending', 'pending', 'customer', $6)`,
      [tenantId, billPaid, payPaid, orderPaidId, refundNo, userId],
    );
    // 尾款挂账：最近账单 partial，已收 30。
    await insertInvoice(orderPartialId, "partial", 30);

    // open 工单，p1 → amber / 10。
    await client.query(
      `insert into support.tickets (tenant_id, ticket_no, title, priority, status, reporter_name)
       values ($1, $2, 'ITEST 登录不了', 'p1', 'open', 'ITEST 报单人')`,
      [tenantId, ticketNo],
    );
    trace("fixture", {
      userId,
      tenantId,
      tenantNo,
      orderVerifyId,
      orderPaidId,
      orderPartialId,
    });
  });

  afterAll(async () => {
    // 最后一个用例已经 rollback；这里再保一道（没有事务时只是一条 WARNING）。
    await client.query("rollback");
    client.release();
    await pool.end();
  });

  it("全量：六类各命中一条，字段按契约（只有可视码，金额 / 产品 / 申报人 / 租户属性各归各）", async () => {
    const items = mine(await repo.list());
    trace("all", items);
    const byKind = new Map(items.map((i) => [i.kind, i]));
    expect([...byKind.keys()].sort()).toEqual(
      [
        "confirm_payment",
        "follow_up_balance",
        "refund_audit",
        "reprovision",
        "ticket",
        "verification",
      ].sort(),
    );

    const confirm = byKind.get("confirm_payment")!;
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
        email: `itest-${RUN_ID}@example.com`,
      },
      amount: { value: "99.00", currency: "CNY", paid: null },
      progress: "pendingVerify",
      href: `/orders/${orderNoVerify}`,
    });
    expect(confirm.product?.code).toBeTruthy();
    // 等待起点 = declared_at（30 分钟前），不是 updated_at（刚才）。
    const waited = Date.now() - new Date(confirm.waitingSince).getTime();
    expect(waited).toBeGreaterThan(25 * 60_000);

    expect(byKind.get("reprovision")).toMatchObject({
      progress: "paidUnprovisioned",
      priority: 3,
      href: `/orders/${orderNoPaid}`,
    });

    // 尾款挂账：应收 99、已收 30——「已收多少」是客服打电话时要说的那个数。
    expect(byKind.get("follow_up_balance")).toMatchObject({
      id: `follow_up_balance:${orderNoPartial}`,
      severity: "amber",
      priority: 15,
      progress: "partialPending",
      amount: { value: "99.00", currency: "CNY", paid: "30.00" },
      href: `/orders/${orderNoPartial}`,
    });

    expect(byKind.get("refund_audit")).toMatchObject({
      id: `refund_audit:${refundNo}`,
      severity: "rose",
      priority: 2,
      subject: { type: "refund", no: refundNo },
      amount: { value: "99.00", currency: "CNY", paid: null },
      progress: "refundAudit",
      href: `/orders/${orderNoPaid}`,
      applicant: { name: "ITEST 申报人" },
    });

    expect(byKind.get("verification")).toMatchObject({
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

    expect(byKind.get("ticket")).toMatchObject({
      severity: "amber",
      priority: 10,
      subject: { type: "ticket", no: ticketNo },
      progress: "ticketOpen",
      href: `/tickets/${ticketNo}`,
      applicant: { name: "ITEST 报单人", email: null, phone: null },
      // status 是库里的原值，不在 SQL 里归一。
      ticket: { title: "ITEST 登录不了", priority: "p1", status: "open" },
    });

    // 任何一条都不带 UUID 形状的值。
    const uuid =
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    expect(JSON.stringify(items)).not.toMatch(uuid);
  });

  it("工单 reopened 仍算未结，且与 p0 同进 rose", async () => {
    await client.query("savepoint reopen_probe");
    await client.query(
      `update support.tickets set status = 'reopened' where ticket_no = $1`,
      [ticketNo],
    );
    const reopened = mine(await repo.list({ kinds: ["ticket"] }));
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
      expect(mine(await repo.list({ kinds: ["ticket"] }))).toEqual([]);
    }

    // 处理中的两个状态 → ticketProcessing。
    for (const working of ["in_progress", "pending"]) {
      await client.query(
        `update support.tickets set status = $2 where ticket_no = $1`,
        [ticketNo, working],
      );
      const items = mine(await repo.list({ kinds: ["ticket"] }));
      expect(items[0]).toMatchObject({
        progress: "ticketProcessing",
        ticket: { status: working },
      });
    }
    await client.query("rollback to savepoint reopen_probe");
  });

  it("minAge：只留在当前状态里停够久的（申报 30 分钟前 / 到账 20 分钟前留下，刚造的掉出）", async () => {
    const aged = mine(await repo.list({ minAgeMinutes: 10 }));
    trace(
      "minAge=10",
      aged.map((i) => i.kind),
    );
    expect(aged.map((i) => i.kind).sort()).toEqual([
      "confirm_payment",
      "reprovision",
    ]);

    const older = mine(await repo.list({ minAgeMinutes: 25 }));
    expect(older.map((i) => i.kind)).toEqual(["confirm_payment"]);

    expect(mine(await repo.list({ minAgeMinutes: 60 }))).toEqual([]);
  });

  it("kinds：告警作业那三类之外的一条都不回", async () => {
    const alerting = mine(
      await repo.list({
        kinds: ["confirm_payment", "reprovision", "refund_audit"],
      }),
    );
    expect(alerting.map((i) => i.kind).sort()).toEqual([
      "confirm_payment",
      "refund_audit",
      "reprovision",
    ]);
    const onlyRefund = mine(await repo.list({ kinds: ["refund_audit"] }));
    expect(onlyRefund.map((i) => i.id)).toEqual([`refund_audit:${refundNo}`]);
  });

  it("排序：rose 在前；同档按优先级；同优先级等得最久的在前", async () => {
    const items = mine(await repo.list());
    const order = items.map((i) => i.kind);
    trace("sorted", order);
    // rose：confirm_payment(2, 30 分钟前) → refund_audit(2, 刚才) → reprovision(3)；
    // amber：ticket(10) → follow_up_balance(15) → verification(20)。
    expect(order).toEqual([
      "confirm_payment",
      "refund_audit",
      "reprovision",
      "ticket",
      "follow_up_balance",
      "verification",
    ]);
  });

  /**
   * 生产上的权限面：告警作业连库用的是 `svc_platform_api`（97_service_roles.sql 的 7 个
   * schema + 一张表级例外），不是 owner。Postgres 对语句里**出现过的每一个关系**查权限，
   * 所以只要文本里有一个 `account.` / `admin.` 的 join，这一条就 42501——而本机以 owner
   * 跑的所有别的用例都不会发现它。
   *
   * 角色本机应当已由 97 建好；万一没有（没供给过 TD-020），就在这笔事务里临时建一个、
   * 按 97 的同一张授权面授权，跟着 rollback 一起消失。
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
      }
      await client.query(`set role svc_platform_api`);
      // 逐字就是 OpsTodoAlertJob.pass() 的那一套参数。
      executed = await repo.list({
        kinds: ["confirm_payment", "reprovision", "refund_audit"],
        minAgeMinutes: 15,
        limit: 50,
        includeApplicant: false,
      });
      // 同一角色下再取一遍不限 50 条的，好在共享的本机库里稳定地找到本 suite 造的行。
      scoped = await repo.list({
        kinds: ["confirm_payment", "reprovision", "refund_audit"],
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
    trace("svc_platform_api", ours);
    expect(ours.map((i) => i.kind).sort()).toEqual([
      "confirm_payment",
      "reprovision",
    ]);
    for (const todo of ours) {
      // 富化块整块不要：申报人为 null，风险档为 null；租户名照常（tenancy 有权）。
      expect(todo.applicant).toBeNull();
      expect(todo.tenant?.riskLevel).toBeNull();
      expect(todo.tenant?.name).toBe(`ITEST 简称 ${RUN_ID}`);
      expect(todo.tenant?.status).toBe("active");
    }
    // 角色已复位：后面的用例还以 owner 跑。
    const who = await client.query<{ role: string }>(
      `select current_user as role`,
    );
    expect(who.rows[0]!.role).not.toBe("svc_platform_api");
  });

  it("rollback 之后库和跑前一样：订单、退款、工单、租户都不在", async () => {
    await client.query("rollback");
    const check = async (sql: string, params: unknown[]) =>
      (await pool.query(sql, params)).rowCount;
    expect(
      await check(
        `select 1 from billing.orders where order_no in ($1, $2, $3)`,
        [orderNoVerify, orderNoPaid, orderNoPartial],
      ),
    ).toBe(0);
    expect(
      await check(`select 1 from billing.refunds where refund_no = $1`, [
        refundNo,
      ]),
    ).toBe(0);
    expect(
      await check(`select 1 from support.tickets where ticket_no = $1`, [
        ticketNo,
      ]),
    ).toBe(0);
    expect(
      await check(
        `select 1 from tenancy.tenants where tenant_no = $1::bigint`,
        [tenantNo],
      ),
    ).toBe(0);
    expect(
      await check(`select 1 from account.users where id = $1`, [userId]),
    ).toBe(0);
  });
});
