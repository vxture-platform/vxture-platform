/**
 * operator-notices.itest.spec.ts — 可见性谓词的不变式，打真库。
 *
 * 门控与兄弟包一致：
 *   NOTICE_ITEST=1 DATABASE_URL=postgresql://... pnpm --filter @vxture/service-notice test
 *
 * ── 为什么这几条要有测试 ──
 * 这个包的全部意义就是**一条可见性谓词只有一处**。而那条谓词的正确性整个落在
 * SQL 的 WHERE 子句里，没有一条会在类型层报错：
 *   · `target_planes = '{}'` 是「全部平面」的唯一表示 → 这一句写漏，全平面通告
 *     在每个平面都消失，而三个平面同时消失看起来像「还没人发过」。
 *   · 软删与过期各是一条 → 少一条，撤回过的通告继续出现在收件箱里。
 *   · digest 档是「当天已读 + 所有未读」→ 边界写成 `>` 还是 `>=`、用不用
 *     `date_trunc`，差别只在跨零点那一刻显形。
 *   · `unread` 数的是**全部未读**，不是本页列出的未读 → 写成跟着分页走的话，
 *     铃铛角标会变成「本页有几条没看」，翻一页数字就跳。
 *
 * ── 一条被证伪的判据（留着，免得有人再写一次）──
 * 初版我断言「unread 按 visible 算 ≠ 按 scoped 算」，并声称改成 scoped 会让两档
 * 的数字分岔。把 SQL 真改成 scoped 之后 6 条测试**照样全过**——因为 scoped 的条件
 * 是「未读 OR 当天已读」，它恒含全部未读，`count(*) where read_at is null` 在两者
 * 上是恒等的。那不是一个能出错的地方，所以也测不出东西。下面换成了 limit 那条。
 *
 * 每个用例清掉自己造的行。不用事务包整个 describe：仓储方法各自从池里取连接，
 * 事务绑在某一条连接上，包不住。
 */
import { afterAll, beforeAll, afterEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { PgNoticeRepository } from "./pg-notice.repository";
import type { NoticePlane } from "../types/notice.types";

const RUN = process.env.NOTICE_ITEST === "1";
const TITLE_PREFIX = "ITEST-NOTICE-";

describe.skipIf(!RUN)("admin.operator_notices 可见性谓词（真库）", () => {
  let pool: Pool;
  let repo: PgNoticeRepository;
  let operatorId: string;

  const insert = async (fields: {
    planes: NoticePlane[];
    title: string;
    deleted?: boolean;
    expiresAt?: string | null;
  }): Promise<string> => {
    const { rows } = await pool.query<{ id: string }>(
      `insert into admin.operator_notices
         (target_planes, severity, title, body, expires_at, deleted_at, created_by)
       values ($1::varchar(16)[], 'info', $2, 'itest', $3, $4, $5)
       returning id`,
      [
        fields.planes,
        TITLE_PREFIX + fields.title,
        fields.expiresAt ?? null,
        fields.deleted ? new Date().toISOString() : null,
        operatorId,
      ],
    );
    const row = rows[0];
    if (!row) throw new Error("插入没有回行");
    return row.id;
  };

  /** 只数本测试造的那些行——库里本来就有真实通告，不能按总数断言。 */
  const listMine = async (plane: NoticePlane, digest: boolean) => {
    const result = await repo.list({
      plane,
      operatorId,
      digest,
      limit: 200,
      offset: 0,
    });
    return {
      ...result,
      items: result.items.filter((i) => i.title.startsWith(TITLE_PREFIX)),
    };
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    repo = new PgNoticeRepository(pool);
    const { rows } = await pool.query<{ id: string }>(
      `select id from admin.operator_account where username = 'systemadmin'`,
    );
    const row = rows[0];
    // 读不到就抛，不是跳过——「没有基础数据」和「不变式不成立」是两回事。
    if (!row) throw new Error("找不到 systemadmin 锚点账号");
    operatorId = row.id;
  });

  afterEach(async () => {
    await pool.query(`delete from admin.operator_notices where title like $1`, [
      TITLE_PREFIX + "%",
    ]);
  });

  afterAll(async () => {
    await pool.end();
  });

  it("空 target_planes 对三个平面都可见", async () => {
    await insert({ planes: [], title: "全平面" });
    for (const plane of ["admin", "opera", "arche"] as const) {
      const { items } = await listMine(plane, false);
      expect(items.map((i) => i.title)).toEqual([TITLE_PREFIX + "全平面"]);
    }
  });

  it("指定平面只对那个平面可见", async () => {
    await insert({ planes: ["arche"], title: "仅治理" });
    expect((await listMine("arche", false)).items).toHaveLength(1);
    expect((await listMine("admin", false)).items).toHaveLength(0);
    expect((await listMine("opera", false)).items).toHaveLength(0);
  });

  it("软删与过期都不出现", async () => {
    await insert({ planes: [], title: "已撤回", deleted: true });
    await insert({
      planes: [],
      title: "已过期",
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    await insert({ planes: [], title: "还在" });
    const { items } = await listMine("admin", false);
    expect(items.map((i) => i.title)).toEqual([TITLE_PREFIX + "还在"]);
  });

  it("markRead 幂等，且对已撤回的通告回 null", async () => {
    const id = await insert({ planes: [], title: "标记" });
    const first = await repo.markRead(id, operatorId);
    expect(first?.id).toBe(id);
    // 重复标记不报错，只把时间刷新——「我又看了一次」不是错误。
    const second = await repo.markRead(id, operatorId);
    expect(second).not.toBeNull();

    const gone = await insert({ planes: [], title: "撤回过", deleted: true });
    expect(await repo.markRead(gone, operatorId)).toBeNull();
  });

  it("摘要档留下当天已读，隔天的掉出去", async () => {
    const today = await insert({ planes: [], title: "今天读的" });
    await repo.markRead(today, operatorId);

    const older = await insert({ planes: [], title: "昨天读的" });
    await repo.markRead(older, operatorId);
    await pool.query(
      `update admin.operator_notice_reads
          set read_at = now() - interval '2 days'
        where notice_id = $1 and operator_id = $2`,
      [older, operatorId],
    );

    // 当天读过的仍在摘要里——否则刚点完「知道了」它就消失，人会以为点错了。
    const digest = await listMine("admin", true);
    expect(digest.items.map((i) => i.title)).toEqual([
      TITLE_PREFIX + "今天读的",
    ]);

    // 全部档两条都在。
    const all = await listMine("admin", false);
    expect(all.items).toHaveLength(2);
  });

  it("未读数是全部未读，不跟着分页走", async () => {
    // 库里本来就有真实通告，所以只能比相对量。
    const before = await repo.list({
      plane: "admin",
      operatorId,
      digest: false,
      limit: 200,
      offset: 0,
    });

    await insert({ planes: [], title: "未读一" });
    await insert({ planes: [], title: "未读二" });
    await insert({ planes: [], title: "未读三" });

    // limit 1：只列一条，但未读数必须还是三条都算上。写成跟着分页走的话，
    // 这里会变成 before.unread + 1。
    const paged = await repo.list({
      plane: "admin",
      operatorId,
      digest: false,
      limit: 1,
      offset: 0,
    });
    expect(paged.items).toHaveLength(1);
    expect(paged.unread).toBe(before.unread + 3);
    // total 同理：它是当前档下的总条数，不是本页条数。
    expect(paged.total).toBe(before.total + 3);
  });
});
