/**
 * operator-alerts.itest.spec.ts — 运营告警的**去重回环**在真 Postgres 上的验证（#231）。
 *
 * Run: OPS_ALERT_ITEST=1 DATABASE_URL=postgresql://... pnpm test
 *
 * ── 为什么非要连真库 ──
 * operator-alerts.spec.ts 用的是假 pool，它**用 JS 重算了一遍去重语义**，所以那一组
 * 测不到真 SQL：2026-09-08 做变异测试时，把 `status in ('sent','delivered')` 改成含
 * 'failed'，29 条测试照样全绿。真正要证的是这个回环——
 *
 *     发一条 → 账本里落一行 → 下一次调用被这一行压住
 *
 * 而它横跨 TS 与 SQL 两边：列的 NOT NULL / CHECK 约束、varchar 长度、
 * `max(...) filter (...)` 的读回，任何一环不对都只在运行时现形，而这个作业跑在后台，
 * 现形了也没人看见。所以钉在这里，用真表跑一遍。
 *
 * 全程在一个事务里，末尾 ROLLBACK：不留任何脏数据。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import {
  OPS_ALERT_RETRY_BACKOFF_MS,
  OperatorAlertDispatcher,
  type OperatorAlertInput,
} from "./operator-alerts";

const RUN = process.env.OPS_ALERT_ITEST === "1";
const CONN = process.env.DATABASE_URL ?? "";

const REF_ID = `itest-${Date.now()}`;
const input: OperatorAlertInput = {
  code: "ops.order.paid_unprovisioned",
  reference: { type: "order", id: REF_ID },
  subject: "ITEST 已收款但权益未开通",
  lines: ["集成测试用，不会提交。"],
  link: "https://y.vxture.com/orders/ITEST",
};

describe.runIf(RUN)("运营告警去重回环（live DB）", () => {
  let pool: Pool;
  let tx: PoolClient;
  const sent: string[] = [];

  /** 事务内的 client 冒充 Pool——dispatcher 只用到 .query。 */
  const asPool = () => tx as unknown as Pool;
  const dispatcher = () =>
    new OperatorAlertDispatcher(asPool(), {
      mail: {
        send: async (m) => {
          sent.push(m.to);
        },
      },
      logger: { warn: (m) => console.warn(m) },
    });

  beforeAll(async () => {
    pool = new Pool({ connectionString: CONN });
    tx = await pool.connect();
    await tx.query("begin");

    // 造一个可达的运营账号。角色表里挑一个现成的，没有就建一个。
    const role = await tx.query<{ id: string }>(
      `select id from admin.operator_role order by sort limit 1`,
    );
    const roleId =
      role.rows[0]?.id ??
      (
        await tx.query<{ id: string }>(
          `insert into admin.operator_role (role_code, role_name)
           values ('itest_role', 'ITEST') returning id`,
        )
      ).rows[0]!.id;

    await tx.query(
      `insert into admin.operator_account
         (role_id, username, email, email_verified, display_name, status)
       values ($1, $2, $3, true, 'ITEST 运营', 'active')`,
      [roleId, `itest_${Date.now()}`, "itest@example.com"],
    );
  });

  afterAll(async () => {
    await tx?.query("rollback");
    tx?.release();
    await pool?.end();
  });

  it("首次发出，并在 support.notification_logs 真落一行", async () => {
    const r = await dispatcher().alert(input);
    // 库里可能本来就有别的在用运营账号（本机 dev 通常没有），所以只断言「至少发了我造的那个」。
    expect(r.suppressed).toBe(false);
    expect(r.noRecipient).toBe(false);
    expect(sent).toContain("itest@example.com");
    expect(r.sent).toBeGreaterThanOrEqual(1);

    const logs = await tx.query<{ n: string }>(
      `select count(*) as n from support.notification_logs
        where template_code = $1 and reference_id = $2 and status = 'sent'`,
      [input.code, REF_ID],
    );
    expect(Number(logs.rows[0]!.n)).toBe(r.sent);
  });

  it("第二次被自己刚写的那行压住（4h 静默窗口，真 SQL 读回）", async () => {
    const before = sent.length;
    const r = await dispatcher().alert(input);
    expect(r).toMatchObject({ suppressed: true, sent: 0 });
    expect(sent).toHaveLength(before);
  });

  it("把成功行改成失败并推到退避期外 → 恢复发送（失败不占 4h 窗口）", async () => {
    await tx.query(
      `update support.notification_logs
          set status = 'failed',
              created_at = now() - make_interval(secs => $3)
        where template_code = $1 and reference_id = $2`,
      [input.code, REF_ID, OPS_ALERT_RETRY_BACKOFF_MS / 1000 + 60],
    );
    const r = await dispatcher().alert(input);
    expect(r).toMatchObject({ suppressed: false });
    expect(r.sent).toBeGreaterThanOrEqual(1);
  });

  it("另一张单不受影响（去重按业务引用分开）", async () => {
    const r = await dispatcher().alert({
      ...input,
      reference: { type: "order", id: `${REF_ID}-other` },
    });
    expect(r).toMatchObject({ suppressed: false });
    expect(r.sent).toBeGreaterThanOrEqual(1);
  });
});
