/**
 * pg-notice.repository.spec.ts — 读侧筛选拼装 + 系统来源写路 + 全部标记已读，假 pool。
 *
 * 假 pool 不解析 SQL，所以这里分两半：
 *   · 谓词用**字面断言**钉住（与 dispatch 包的 DEDUPE_SQL 同一手法）——冲突目标写漏
 *     where 谓词时 Postgres 直接拒绝整条语句，而假 pool 对此毫无感觉；
 *   · 绑定顺序与结果翻译用行为断言。
 * 可见性谓词那一半在 operator-notices.itest.spec.ts 打真库。
 *
 * ── 为什么筛选拼装要逐句钉字面 ──
 * 「不给的筛选一个字都不出现」这件事，用行为测不出来：假 pool 对任何 SQL 都回同一批
 * 行，而真库对「出现但恒真」的谓词也一样给对答案——只是多扫一遍表。真正会出事的是
 * **反过来**：某一项在不该出现时出现了（比如 `source = $4` 恒在，而 `$4` 是 undefined，
 * pg 当场抛），或者占位符序号与 params 数组错位一位（那时筛选会静默筛错一档，没有
 * 任何东西会报错）。两者都只在语句文本上看得见。
 */
import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import {
  CREATE_SYSTEM_NOTICE_SQL,
  PgNoticeRepository,
  buildListQuery,
} from "./pg-notice.repository";
import type {
  CreateSystemNoticeInput,
  ListNoticesParams,
} from "../types/notice.types";

function fakePool(rows: { id: string }[]) {
  const query = vi.fn(async (_sql: string, _params?: unknown[]) => ({
    rows,
    rowCount: rows.length,
  }));
  return { pool: { query } as unknown as Pool, query };
}

/** 不给任何筛选的那一档；每个用例在它上面加自己要测的那一项。 */
const baseParams: ListNoticesParams = {
  plane: "admin",
  operatorId: "11111111-1111-4111-8111-111111111111",
  digest: false,
  limit: 20,
  offset: 0,
};

const flatten = (sql: string) => sql.replace(/\s+/g, " ").trim();

const flat = CREATE_SYSTEM_NOTICE_SQL.replace(/\s+/g, " ").trim();

const input: CreateSystemNoticeInput = {
  targetPlanes: ["admin"],
  severity: "warning",
  title: "客户申请退款 ¥99.00 · ORD-1",
  body: "租户 Acme · ¥99.00 · 客户收到：「退款申请已收到：订单 ORD-1」",
  link: "/orders/ORD-1",
  referenceType: "customer_event",
  referenceId: "refund.requested:refund:r-1:requested",
  expiresAt: null,
};

describe("CREATE_SYSTEM_NOTICE_SQL", () => {
  it("冲突目标原样照抄部分唯一索引 uq_operator_notices_system（列 + where 谓词）", () => {
    // 部分唯一索引只有谓词完全匹配时才被认作冲突仲裁；少了 where 整条语句报错。
    expect(flat).toContain(
      "on conflict (reference_type, reference_id) where source = 'system' and deleted_at is null do nothing",
    );
    // do nothing 而不是 do update：已播过的一件事不许被刷新到未读顶上。
    expect(flat).not.toContain("do update");
    expect(flat).toContain("returning id");
  });

  it("source 与 created_by 都不来自入参：source 恒 'system'，created_by 恒 null", () => {
    expect(flat).toContain(
      "values ($1::varchar(16)[], $2, $3, $4, $5, 'system', $6, $7, $8, null)",
    );
    expect(flat).toContain("insert into admin.operator_notices");
  });
});

describe("PgNoticeRepository.createSystemNotice", () => {
  it("八个参数按占位顺序绑定；回行 → inserted:true 带 id", async () => {
    const f = fakePool([{ id: "n-1" }]);
    const repo = new PgNoticeRepository(f.pool);

    const out = await repo.createSystemNotice(input);

    expect(out).toEqual({ inserted: true, id: "n-1" });
    expect(f.query).toHaveBeenCalledTimes(1);
    expect(f.query).toHaveBeenCalledWith(CREATE_SYSTEM_NOTICE_SQL, [
      ["admin"],
      "warning",
      input.title,
      input.body,
      "/orders/ORD-1",
      "customer_event",
      "refund.requested:refund:r-1:requested",
      null,
    ]);
  });

  it("link / expiresAt 缺省绑成 null，不是 undefined（pg 对 undefined 会抛）", async () => {
    const f = fakePool([{ id: "n-2" }]);
    const repo = new PgNoticeRepository(f.pool);
    await repo.createSystemNotice({
      targetPlanes: input.targetPlanes,
      severity: input.severity,
      title: input.title,
      body: input.body,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
    });

    const params = f.query.mock.calls[0]![1] as unknown[];
    expect(params[4]).toBeNull();
    expect(params[7]).toBeNull();
  });

  it("targetPlanes 拷贝成普通数组，不把 readonly 入参原样交给 pg", async () => {
    const f = fakePool([{ id: "n-3" }]);
    const repo = new PgNoticeRepository(f.pool);
    const planes = ["admin", "opera"] as const;

    await repo.createSystemNotice({ ...input, targetPlanes: planes });

    const params = f.query.mock.calls[0]![1] as unknown[];
    expect(params[0]).toEqual(["admin", "opera"]);
    expect(params[0]).not.toBe(planes);
  });

  it("冲突不回行 → inserted:false、id:null，不抛（重放不是错误）", async () => {
    const f = fakePool([]);
    const repo = new PgNoticeRepository(f.pool);

    await expect(repo.createSystemNotice(input)).resolves.toEqual({
      inserted: false,
      id: null,
    });
  });

  it("expiresAt 给 Date 时原样绑定（info 类 30 天后退出列表）", async () => {
    const f = fakePool([{ id: "n-4" }]);
    const repo = new PgNoticeRepository(f.pool);
    const expiresAt = new Date("2026-10-28T00:00:00Z");

    await repo.createSystemNotice({ ...input, severity: "info", expiresAt });

    const params = f.query.mock.calls[0]![1] as unknown[];
    expect(params[1]).toBe("info");
    expect(params[7]).toBe(expiresAt);
  });
});
// ─────────────────────────────────────────────────────────────────────────────
// 读侧：筛选拼装
// ─────────────────────────────────────────────────────────────────────────────

/** 摘要档那一条恒在（它是个恒定形状的开关，由 $3 关掉），所以它是「零筛选」的基线。 */
const DIGEST_ONLY =
  "where (not $3::bool or read_at is null or read_at >= date_trunc('day', now())) )";

describe("buildListQuery：不给的筛选一个字都不出现", () => {
  it("零筛选 → filtered 只有摘要档那一条，scoped 一条 where 都没有", () => {
    const flat = flatten(buildListQuery(baseParams).sql);

    // 整段写死：多一条谓词、少一条谓词都对不上，而「大致包含」抓不到多出来的那条。
    expect(flat).toContain(
      `), filtered as ( select * from visible ${DIGEST_ONLY}, scoped as ( select * from filtered ) select s.*`,
    );
    // 占位符只到 limit / offset——没有一个筛选值占位。
    expect(flat).toContain("limit $4 offset $5");
    expect(buildListQuery(baseParams).params).toEqual([
      "admin",
      baseParams.operatorId,
      false,
      20,
      0,
    ]);
  });

  it("空数组的 severities 与不给等价——不长出 `where severity = any(...)`", () => {
    const flat = flatten(buildListQuery({ ...baseParams, severities: [] }).sql);
    expect(flat).toContain(
      "), scoped as ( select * from filtered ) select s.*",
    );
    expect(flat).not.toContain("severity = any(");
  });

  it("unreadOnly 不占位（它没有值），进 filtered 而不是 scoped", () => {
    const q = buildListQuery({ ...baseParams, unreadOnly: true });
    expect(flatten(q.sql)).toContain(
      "date_trunc('day', now())) and read_at is null )",
    );
    // 没有值要绑，所以 limit / offset 仍然是 $4 / $5。
    expect(flatten(q.sql)).toContain("limit $4 offset $5");
    expect(q.params).toHaveLength(5);
  });

  it("unreadOnly: false 与不给等价——不许出现「未读」那一条", () => {
    // `unreadOnly === true` 而不是 truthy 判断：false 是一个明确的「不筛」，
    // 写成 `if (params.unreadOnly)` 时它恰好也对，但 `?? true` 这类写法一改就翻面。
    const flat = flatten(
      buildListQuery({ ...baseParams, unreadOnly: false }).sql,
    );
    expect(flat).toContain(
      `), filtered as ( select * from visible ${DIGEST_ONLY}`,
    );
  });

  it("source 与 keyword 各占一个位，keyword 的占位符在标题与正文上复用同一个", () => {
    const q = buildListQuery({
      ...baseParams,
      source: "system",
      keyword: "退款",
    });
    const flat = flatten(q.sql);
    expect(flat).toContain("and source = $4");
    expect(flat).toContain(
      "and (title ilike $5 escape '\\' or body ilike $5 escape '\\')",
    );
    expect(q.params).toEqual([
      "admin",
      baseParams.operatorId,
      false,
      "system",
      "%退款%",
      20,
      0,
    ]);
  });

  it("keyword 的通配符被转义——搜「100%」不等于搜「100 开头的一切」", () => {
    const q = buildListQuery({ ...baseParams, keyword: " 100%_x " });
    // 两侧空白先 trim（运营者从别处粘过来常带空格），% 与 _ 逐个转义。
    expect(q.params[3]).toBe("%100\\%\\_x%");
  });

  it("全空白的 keyword 与不给等价——不长出一条恒真的 ilike '%%'", () => {
    const flat = flatten(buildListQuery({ ...baseParams, keyword: "   " }).sql);
    expect(flat).not.toContain("ilike");
  });

  it("severities 进 scoped（晚一步），值绑定成数组并显式转型", () => {
    const q = buildListQuery({
      ...baseParams,
      severities: ["warning", "critical"],
    });
    expect(flatten(q.sql)).toContain(
      "), scoped as ( select * from filtered where severity = any($4::varchar(16)[]) )",
    );
    expect(q.params[3]).toEqual(["warning", "critical"]);
  });

  it("四项全给时占位符按 source→keyword→severities→limit→offset 顺序不错位", () => {
    const q = buildListQuery({
      ...baseParams,
      unreadOnly: true,
      source: "manual",
      keyword: "ORD-1",
      severities: ["critical"],
    });
    const flat = flatten(q.sql);
    expect(flat).toContain("and source = $4");
    expect(flat).toContain("title ilike $5");
    expect(flat).toContain("severity = any($6::varchar(16)[])");
    expect(flat).toContain("limit $7 offset $8");
    expect(q.params).toEqual([
      "admin",
      baseParams.operatorId,
      false,
      "manual",
      "%ORD-1%",
      ["critical"],
      20,
      0,
    ]);
  });
});

describe("buildListQuery：三个计数各在哪个集合上数", () => {
  it("unread 数 visible、counts 数 filtered、total 数 scoped", () => {
    const flat = flatten(buildListQuery(baseParams).summarySql);
    // unread 恒按全部算：铃铛角标要的是「还有几条没看」，不是「这一屏有几条」。
    expect(flat).toContain(
      "(select count(*) from visible where read_at is null)::text as unread_count",
    );
    // counts 在 filtered 上：所以它随关键词 / 只看未读动，不随严重度动。
    expect(flat).toContain(
      "(select count(*) from filtered where severity = 'info')::text as info_count",
    );
    expect(flat).toContain(
      "(select count(*) from filtered where severity = 'warning')::text as warning_count",
    );
    expect(flat).toContain(
      "(select count(*) from filtered where severity = 'critical')::text as critical_count",
    );
    expect(flat).toContain(
      "(select count(*) from scoped)::text as total_count",
    );
  });

  it("勾了严重度之后 counts 仍在 filtered 上——另两档还报得出数", () => {
    const flat = flatten(
      buildListQuery({ ...baseParams, severities: ["critical"] }).summarySql,
    );
    // 严重度的 where 长在 scoped 上，counts 三条一条都不引用 scoped。
    expect(flat).toContain(
      "), scoped as ( select * from filtered where severity = any($4::varchar(16)[]) )",
    );
    expect(flat).toContain("from filtered where severity = 'warning'");
  });

  it("汇总语句不带 limit / offset，且 summaryParams 比 params 少那两个", () => {
    const q = buildListQuery({ ...baseParams, limit: 5, offset: 40 });
    // 多绑两个值，pg 会直接拒整条语句（bind message supplies 7, requires 5）。
    expect(q.summarySql).not.toContain("limit");
    expect(q.summarySql).not.toContain("offset");
    expect(q.summaryParams).toEqual(["admin", baseParams.operatorId, false]);
    expect(q.params).toEqual(["admin", baseParams.operatorId, false, 5, 40]);
  });

  it("两条语句共用同一段 CTE——筛选不会只对其中一条生效", () => {
    const q = buildListQuery({ ...baseParams, source: "system" });
    const cte = (sql: string) =>
      flatten(sql).slice(0, flatten(sql).indexOf(") select"));
    expect(cte(q.summarySql)).toBe(cte(q.sql));
  });
});

/**
 * 页行与汇总走两条语句，所以假 pool 要按语句分派。
 * 判据：**页空了汇总照样回数**——那正是筛出 0 条时最需要看见的东西。
 */
function fakeListPool(
  pageRows: Record<string, unknown>[],
  summaryRow: Record<string, string> | undefined,
) {
  const query = vi.fn(async (sql: string, _params?: unknown[]) => {
    const rows = sql.includes("total_count")
      ? summaryRow
        ? [summaryRow]
        : []
      : pageRows;
    return { rows, rowCount: rows.length };
  });
  return { pool: { query } as unknown as Pool, query };
}

const summary = {
  total_count: "7",
  unread_count: "12",
  info_count: "30",
  warning_count: "5",
  critical_count: "2",
};

describe("PgNoticeRepository.list", () => {
  it("计数来自汇总语句；页上一行都没有时三档数字照样是真数", async () => {
    const f = fakeListPool([], summary);
    const repo = new PgNoticeRepository(f.pool);

    const out = await repo.list({ ...baseParams, severities: ["critical"] });

    expect(out.items).toEqual([]);
    expect(out.total).toBe(7);
    expect(out.unread).toBe(12);
    // 写成页行的附加列时这一排会一起变成 0——而「按紧急筛完没了」恰恰是最需要
    // 看见「重要还有 5 条」的时刻。
    expect(out.counts).toEqual({ info: 30, warning: 5, critical: 2 });
  });

  it("汇总也读不到时三档回 0，不回 undefined（前端会把它画成「—」）", async () => {
    const f = fakeListPool([], undefined);
    const repo = new PgNoticeRepository(f.pool);

    const out = await repo.list(baseParams);

    expect(out).toEqual({
      items: [],
      total: 0,
      unread: 0,
      counts: { info: 0, warning: 0, critical: 0 },
    });
  });

  it("两条语句各按自己的 params 发出，页那条多 limit / offset 两个值", async () => {
    const f = fakeListPool([], summary);
    const repo = new PgNoticeRepository(f.pool);

    await repo.list({ ...baseParams, keyword: "退款", limit: 10, offset: 20 });

    expect(f.query).toHaveBeenCalledTimes(2);
    const calls = f.query.mock.calls;
    const page = calls.find(([sql]) => !sql.includes("total_count"));
    const sum = calls.find(([sql]) => sql.includes("total_count"));
    expect(page?.[1]).toEqual([
      "admin",
      baseParams.operatorId,
      false,
      "%退款%",
      10,
      20,
    ]);
    expect(sum?.[1]).toEqual(["admin", baseParams.operatorId, false, "%退款%"]);
  });

  it("行按 OperatorNoticeView 翻译，不回 created_by 那个 uuid", async () => {
    const f = fakeListPool(
      [
        {
          id: "n-1",
          severity: "warning",
          title: "客户申请退款",
          body: "ORD-1",
          link: "/orders/ORD-1",
          source: "system",
          published_at: new Date("2026-09-28T02:00:00Z"),
          read_at: null,
          created_by_name: null,
        },
      ],
      summary,
    );
    const repo = new PgNoticeRepository(f.pool);

    const out = await repo.list(baseParams);

    expect(out.items[0]).toEqual({
      id: "n-1",
      severity: "warning",
      title: "客户申请退款",
      body: "ORD-1",
      link: "/orders/ORD-1",
      source: "system",
      publishedAt: "2026-09-28T02:00:00.000Z",
      readAt: null,
      createdByName: null,
    });
    expect(Object.keys(out.items[0] ?? {})).not.toContain("createdBy");
  });
});

describe("PgNoticeRepository.markAllRead", () => {
  it("一条语句、两个绑定值，回 rowCount = 真的记上了几条", async () => {
    const query = vi.fn(async () => ({ rows: [], rowCount: 9 }));
    const repo = new PgNoticeRepository({ query } as unknown as Pool);

    const marked = await repo.markAllRead(
      "admin",
      "22222222-2222-4222-8222-222222222222",
    );

    expect(marked).toBe(9);
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(params).toEqual(["admin", "22222222-2222-4222-8222-222222222222"]);
    const flat = flatten(sql);
    // 作用域必须字面等于铃铛角标数的那个集合：可见 + 未读，不含摘要档、不含筛选。
    expect(flat).toContain(
      "where n.deleted_at is null and (n.expires_at is null or n.expires_at > now()) and (n.target_planes = '{}' or $1 = any(n.target_planes)) and r.read_at is null",
    );
    expect(flat).not.toContain("date_trunc");
    // 并发下同一条可能被另一个请求先记上；那不是错误。
    expect(flat).toContain("on conflict (notice_id, operator_id) do nothing");
  });

  it("一条未读都没有时回 0，不抛——「已经全读过了」不是错误", async () => {
    const query = vi.fn(async () => ({ rows: [], rowCount: 0 }));
    const repo = new PgNoticeRepository({ query } as unknown as Pool);

    await expect(
      repo.markAllRead("opera", "22222222-2222-4222-8222-222222222222"),
    ).resolves.toBe(0);
  });

  it("rowCount 为 null 时回 0，不回 NaN（角标会显示 NaN）", async () => {
    const query = vi.fn(async () => ({ rows: [], rowCount: null }));
    const repo = new PgNoticeRepository({ query } as unknown as Pool);

    await expect(
      repo.markAllRead("admin", "22222222-2222-4222-8222-222222222222"),
    ).resolves.toBe(0);
  });
});
