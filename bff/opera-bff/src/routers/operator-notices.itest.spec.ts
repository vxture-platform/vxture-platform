/**
 * operator-notices.itest.spec.ts — 发布面那两条语句，打真库。
 *
 * 门控与 `@vxture/service-notice` 的同名文件一致（默认跳过，不打真库的 CI 不受影响）：
 *   OPERA_NOTICE_ITEST=1 DATABASE_URL=postgresql://... pnpm --filter @vxture/bff-opera test
 *
 * ── 为什么非得打真库 ──
 * 这两条语句的全部风险都在**跑起来才知道**的那一层，静态检查一条都看不见：
 *   · 三段 CTE 里的转型（`$4::varchar` / `$7::varchar(16)[]` / `cardinality(...)`）写错是
 *     42804/42883，而 tsc 与 eslint 全绿。
 *   · `ilike ... escape` 的反斜杠在 JS 模板串里要写两个才到得了 pg，写一个就是语法错。
 *   · 汇总那条比页行**正好少绑一个值**：多绑一个 pg 直接拒（08P01），而那条路径只有
 *     真正发一次请求才会走到。
 *   · 计数口径（total 在 scoped 上、counts 在 narrowed 上）用假 pool 只能对语句文本断言
 *     ——那是「字写对了」，不是「数算对了」。
 *
 * 用例自己造行、自己清行（标题带前缀）。不用事务包整个 describe：每条查询各自从池里
 * 取连接，事务绑在某一条连接上，包不住。
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import {
  LIST_SQL,
  LIST_SUMMARY_SQL,
  READBACK_SQL,
  noticeListValues,
  normalizeListFilters,
  type NoticeListQueryInput,
} from "./operator-notices.router";

const RUN = process.env.OPERA_NOTICE_ITEST === "1";
const TITLE_PREFIX = "ITEST-OPERA-NOTICE-";
const PLANE = "opera";

interface SummaryRow {
  total_count: string;
  matched_count: string;
  info_count: string;
  warning_count: string;
  critical_count: string;
}

describe.skipIf(!RUN)("发布面的两条语句（真库）", () => {
  let pool: Pool;
  let operatorId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const { rows } = await pool.query<{ id: string }>(
      `select id from admin.operator_account order by created_at limit 1`,
    );
    const first = rows[0];
    // 已读关系上挂着真 FK，没有运营账号就没法造已读行——那时这一组断言无从谈起，
    // 抛比跳过好：跳过会在日志里留一行「通过」。
    if (!first) throw new Error("admin.operator_account 是空的，无法造已读行");
    operatorId = first.id;
  });

  afterEach(async () => {
    await pool.query(
      `delete from admin.operator_notices where title like $1 || '%'`,
      [TITLE_PREFIX],
    );
  });

  afterAll(async () => {
    await pool.end();
  });

  /** 造一条通告，回它的 id。`planes` 空数组 = 三个平面都可见。 */
  const insert = async (fields: {
    title: string;
    planes: string[];
    severity?: string;
    body?: string;
    expiresAt?: string | null;
  }): Promise<string> => {
    const { rows } = await pool.query<{ id: string }>(
      `insert into admin.operator_notices
         (target_planes, severity, title, body, expires_at, created_by)
       values ($1::varchar(16)[], $2, $3, $4, $5, $6)
       returning id`,
      [
        fields.planes,
        fields.severity ?? "info",
        fields.title,
        fields.body ?? "itest",
        fields.expiresAt ?? null,
        operatorId,
      ],
    );
    return rows[0]!.id;
  };

  const markRead = async (noticeId: string): Promise<void> => {
    await pool.query(
      `insert into admin.operator_notice_reads (notice_id, operator_id)
       values ($1::uuid, $2::uuid)
       on conflict (notice_id, operator_id) do nothing`,
      [noticeId, operatorId],
    );
  };

  const run = async (query: NoticeListQueryInput) => {
    const values = noticeListValues(
      PLANE,
      operatorId,
      normalizeListFilters(query),
    );
    const [page, summary] = await Promise.all([
      pool.query<{ id: string; title: string; on_this_plane: boolean }>(
        LIST_SQL,
        [...values, 500],
      ),
      pool.query<SummaryRow>(LIST_SUMMARY_SQL, values),
    ]);
    const totals = summary.rows[0]!;
    return {
      /** 只看本用例造的那些，库里的存量不参与断言。 */
      titles: page.rows
        .filter((r) => r.title.startsWith(TITLE_PREFIX))
        .map((r) => r.title),
      onPlane: new Map(
        page.rows.map((r) => [r.title, r.on_this_plane] as const),
      ),
      matched: Number(totals.matched_count),
      total: Number(totals.total_count),
      counts: {
        info: Number(totals.info_count),
        warning: Number(totals.warning_count),
        critical: Number(totals.critical_count),
      },
    };
  };

  it("两条语句都跑得通，且页行少的那一个值是 limit", async () => {
    await insert({ title: `${TITLE_PREFIX}A`, planes: [] });
    const result = await run({});
    expect(result.titles).toContain(`${TITLE_PREFIX}A`);
    expect(result.matched).toBeGreaterThan(0);
  });

  /* 发布面列三个平面的全部——投给 admin 的那条也要在，只是 on_this_plane 为假。
     漏掉它的话，opera 看不见自己刚发给 admin 的通告，而发布者正是 opera。 */
  it("别的平面的通告也列，但 on_this_plane 为假", async () => {
    await insert({ title: `${TITLE_PREFIX}ADMIN`, planes: ["admin"] });
    await insert({ title: `${TITLE_PREFIX}OPERA`, planes: ["opera"] });
    await insert({ title: `${TITLE_PREFIX}ALL`, planes: [] });
    const result = await run({});
    expect(result.onPlane.get(`${TITLE_PREFIX}ADMIN`)).toBe(false);
    expect(result.onPlane.get(`${TITLE_PREFIX}OPERA`)).toBe(true);
    // 空数组 = 全部平面，这一句写漏的话全平面通告在每个平面都消失。
    expect(result.onPlane.get(`${TITLE_PREFIX}ALL`)).toBe(true);
  });

  /* 「只看未读」= 未读 且 投到本平面 且 没过期。少任一条，这个筛选就会比铃铛角标
     （收件面算的）多出一批行，而两个数同屏。 */
  it("只看未读：排除已读、别的平面、以及已过期", async () => {
    await insert({ title: `${TITLE_PREFIX}UNREAD`, planes: ["opera"] });
    const read = await insert({ title: `${TITLE_PREFIX}READ`, planes: [] });
    await markRead(read);
    await insert({ title: `${TITLE_PREFIX}OTHER`, planes: ["arche"] });
    await insert({
      title: `${TITLE_PREFIX}GONE`,
      planes: ["opera"],
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });

    const live = await run({ unread: "true" });
    expect(live.titles).toEqual([`${TITLE_PREFIX}UNREAD`]);

    // 含已过期档下也一样：过期的通告不再需要谁去看它。
    const withExpired = await run({ unread: "true", includeExpired: "true" });
    expect(withExpired.titles).toEqual([`${TITLE_PREFIX}UNREAD`]);
  });

  /* counts 算在 narrowed 上（除严重度以外都筛过）：勾了「紧急」之后另两档还报得出数。
     算在 matched 上时这三个数会变成当前筛选的回声，而**静态断言那一条照样全过**。 */
  it("勾了一档严重度，另两档的计数还在", async () => {
    await insert({
      title: `${TITLE_PREFIX}C`,
      planes: [],
      severity: "critical",
    });
    await insert({
      title: `${TITLE_PREFIX}W`,
      planes: [],
      severity: "warning",
    });
    await insert({ title: `${TITLE_PREFIX}I`, planes: [], severity: "info" });

    const all = await run({ q: TITLE_PREFIX });
    expect(all.counts).toEqual({ critical: 1, warning: 1, info: 1 });

    const onlyCritical = await run({ q: TITLE_PREFIX, severity: "critical" });
    expect(onlyCritical.titles).toEqual([`${TITLE_PREFIX}C`]);
    expect(onlyCritical.matched).toBe(1);
    // 这一行就是那排数字能不能当入口用的全部理由。
    expect(onlyCritical.counts).toEqual({ critical: 1, warning: 1, info: 1 });
  });

  /* total 在 scoped 上：它是「一共有多少条」，筛选一动它就跟着动的话，「3 / 3」会在
     每一次收紧之后出现，于是没人知道自己筛掉了多少。 */
  it("total 不随四项筛选变，matched 才变", async () => {
    await insert({
      title: `${TITLE_PREFIX}C`,
      planes: [],
      severity: "critical",
    });
    await insert({ title: `${TITLE_PREFIX}I`, planes: [], severity: "info" });
    const before = await run({});
    const after = await run({ severity: "critical" });
    expect(after.total).toBe(before.total);
    expect(after.matched).toBeLessThan(before.matched);
  });

  /* 通配符是运营者要找的字符，不是「随便多少个字」。转义漏了的话搜「100%」会命中全表，
     而一屏全是结果看起来就像搜对了。 */
  it("关键词里的百分号按字面搜", async () => {
    await insert({ title: `${TITLE_PREFIX}100%off`, planes: [] });
    await insert({ title: `${TITLE_PREFIX}plain`, planes: [] });
    const hit = await run({ q: "100%off" });
    expect(hit.titles).toEqual([`${TITLE_PREFIX}100%off`]);
    const miss = await run({ q: "100%zzz" });
    expect(miss.titles).toEqual([]);
  });

  /* 正文也进关键词：系统播报把「为什么」写在正文里，只搜标题等于搜不到原因。 */
  it("关键词也搜正文", async () => {
    await insert({
      title: `${TITLE_PREFIX}BODY`,
      planes: [],
      body: "webhook 死信堆积 37 条",
    });
    const result = await run({ q: "死信堆积" });
    expect(result.titles).toEqual([`${TITLE_PREFIX}BODY`]);
  });

  /* 回读那条走同一段 CTE，但 $8 是 uuid 而不是 limit——两个用途共用一个位次，
     一旦有人往筛选里加第八个绑定值，这条会当场 42804 而不是静默错。 */
  it("回读语句取得到刚插的那一行，即使它一出生就过期", async () => {
    const id = await insert({
      title: `${TITLE_PREFIX}EXPIRED-AT-BIRTH`,
      planes: [],
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    const values = noticeListValues(PLANE, operatorId, {
      includeExpired: true,
      severities: [],
      source: null,
      unreadOnly: false,
      keyword: "",
    });
    const { rows } = await pool.query<{ id: string }>(READBACK_SQL, [
      ...values,
      id,
    ]);
    expect(rows).toHaveLength(1);
  });
});
