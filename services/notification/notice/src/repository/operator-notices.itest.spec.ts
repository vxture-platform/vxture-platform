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
 * ── 第四批（2026-09-28）新增的三条 ──
 *   · 四项筛选各自只在给了的时候生效 → 拼装那一步的字面断言在 pg-notice.repository.spec.ts；
 *     这里验的是**它们真的筛对了**（`ilike` 的转义、`= any()` 的数组转型、摘要档与
 *     「只看未读」叠加时谁收谁）。
 *   · `counts` 在 `filtered` 上数 → 勾了一档严重度之后另两档还报得出数。这是那排数字
 *     能不能当入口用的全部理由；写在 `scoped` 上时它会退化成当前筛选的回声，而**六条
 *     旧测试一条都不会红**。
 *   · `markAllRead` 的作用域 = 铃铛角标的作用域 → 按完 `unread` 必须归零。按别的平面
 *     不许动到本平面的行。
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
import type {
  NoticeFilters,
  NoticePlane,
  NoticeSeverity,
  NoticeSource,
} from "../types/notice.types";

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
    severity?: NoticeSeverity;
    body?: string;
    /**
     * `system` 来源。表上 `chk_operator_notices_reference` 要求 source='system' 与
     * 去重锚两列**同时**成立，所以这里一并给——只改 source 会吃一条 23514。
     */
    source?: NoticeSource;
  }): Promise<string> => {
    const source = fields.source ?? "manual";
    const isSystem = source === "system";
    const { rows } = await pool.query<{ id: string }>(
      `insert into admin.operator_notices
         (target_planes, severity, title, body, source,
          reference_type, reference_id, expires_at, deleted_at, created_by)
       values ($1::varchar(16)[], $2, $3, $4, $5, $6, $7, $8, $9, $10)
       returning id`,
      [
        fields.planes,
        fields.severity ?? "info",
        TITLE_PREFIX + fields.title,
        fields.body ?? "itest",
        source,
        isSystem ? "itest" : null,
        isSystem ? TITLE_PREFIX + fields.title : null,
        fields.expiresAt ?? null,
        fields.deleted ? new Date().toISOString() : null,
        // system 来源没有运营账号；读侧对 null 回 createdByName=null。
        isSystem ? null : operatorId,
      ],
    );
    const row = rows[0];
    if (!row) throw new Error("插入没有回行");
    return row.id;
  };

  /** 只数本测试造的那些行——库里本来就有真实通告，不能按总数断言。 */
  const listMine = async (
    plane: NoticePlane,
    digest: boolean,
    filters: NoticeFilters = {},
  ) => {
    const result = await repo.list({
      plane,
      operatorId,
      digest,
      limit: 200,
      offset: 0,
      ...filters,
    });
    return {
      ...result,
      items: result.items.filter((i) => i.title.startsWith(TITLE_PREFIX)),
    };
  };

  /** 本测试造的那些行的标题（去掉前缀），按列表顺序。 */
  const titlesOf = (items: readonly { title: string }[]) =>
    items.map((i) => i.title.slice(TITLE_PREFIX.length));

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
    const first = await repo.markRead(id, operatorId, "admin");
    expect(first?.id).toBe(id);
    // 重复标记不报错，只把时间刷新——「我又看了一次」不是错误。
    const second = await repo.markRead(id, operatorId, "admin");
    expect(second).not.toBeNull();

    const gone = await insert({ planes: [], title: "撤回过", deleted: true });
    expect(await repo.markRead(gone, operatorId, "admin")).toBeNull();
  });

  /*
   * **动作作用域必须字面等于视图作用域**（见仓储里 VISIBLE_WHERE 那段注释）。
   *
   * 2026-10-02 之前 MARK_READ_SQL 只校验 `deleted_at is null`，**少了平面谓词**：
   * admin 平面拿一个只投给 opera/arche 的通告 uuid 调它，会落一行 read 并回 200 + read_at。
   * 不泄露内容，但 200 vs 404 是个弱探针，更要紧的是「全部标记已读」拄着 VISIBLE_WHERE、
   * 单条却没有 —— 同一个判据长在一条分支上，另一条就是门没关。
   *
   * 这一条只有真库验得出：平面谓词在 SQL 里，桩没有它。
   */
  it("本平面看不见的通告：标记已读回 null，不是 200", async () => {
    const otherPlane = await insert({ planes: ["opera"], title: "只投 opera" });
    expect(await repo.markRead(otherPlane, operatorId, "admin")).toBeNull();
    /* 而本来该看得见的那一条照常能标 —— 不然这道门就成了墙。 */
    const mine = await insert({ planes: ["admin"], title: "投 admin" });
    expect((await repo.markRead(mine, operatorId, "admin"))?.id).toBe(mine);
    /* 过期的同样回 null（VISIBLE_WHERE 的另一半，一并钉住）。 */
    const expired = await insert({
      planes: [],
      title: "过期了",
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    expect(await repo.markRead(expired, operatorId, "admin")).toBeNull();
  });

  it("摘要档留下当天已读，隔天的掉出去", async () => {
    const today = await insert({ planes: [], title: "今天读的" });
    await repo.markRead(today, operatorId, "admin");

    const older = await insert({ planes: [], title: "昨天读的" });
    await repo.markRead(older, operatorId, "admin");
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
  it("severities 筛选：只回勾中的那几档，counts 仍报得出另两档", async () => {
    await insert({ planes: [], title: "一般", severity: "info" });
    await insert({ planes: [], title: "重要", severity: "warning" });
    await insert({ planes: [], title: "紧急", severity: "critical" });

    const before = await listMine("admin", false);

    const onlyCritical = await listMine("admin", false, {
      severities: ["critical"],
    });
    expect(titlesOf(onlyCritical.items)).toEqual(["紧急"]);

    // 这一条是本批的核心：勾了「紧急」之后，「重要」那一档**还报得出数**。
    // counts 写在 scoped 上时这里会是 0，而上面那条断言照样通过。
    expect(onlyCritical.counts.warning).toBe(before.counts.warning);
    expect(onlyCritical.counts.info).toBe(before.counts.info);

    const two = await listMine("admin", false, {
      severities: ["warning", "critical"],
    });
    expect(titlesOf(two.items).sort()).toEqual(["紧急", "重要"]);
  });

  it("source 筛选：人发的与系统播的分得开", async () => {
    await insert({ planes: [], title: "人发的", source: "manual" });
    await insert({ planes: [], title: "系统播的", source: "system" });

    const system = await listMine("admin", false, { source: "system" });
    expect(titlesOf(system.items)).toEqual(["系统播的"]);
    // system 来源没有发布人，读侧回 null，前端画「系统」。
    expect(system.items[0]?.createdByName).toBeNull();

    const manual = await listMine("admin", false, { source: "manual" });
    expect(titlesOf(manual.items)).toEqual(["人发的"]);
  });

  it("keyword 同时搜标题与正文，且 % 当字符搜不当通配符", async () => {
    await insert({ planes: [], title: "标题里有退款" });
    await insert({ planes: [], title: "正文里有", body: "这条讲的是退款执行" });
    await insert({ planes: [], title: "毫不相干", body: "无关" });
    await insert({ planes: [], title: "折扣 100% 的那条" });

    const hit = await listMine("admin", false, { keyword: "退款" });
    expect(titlesOf(hit.items).sort()).toEqual(
      ["标题里有退款", "正文里有"].sort(),
    );

    // 转义没做的话 `%100%%` 会匹配到上面全部四条——绑定参数挡不住这一层。
    const pct = await listMine("admin", false, { keyword: "100%" });
    expect(titlesOf(pct.items)).toEqual(["折扣 100% 的那条"]);

    // 大小写不敏感（ILIKE），两侧空白先 trim。
    const trimmed = await listMine("admin", false, { keyword: "  退款  " });
    expect(trimmed.items).toHaveLength(2);
  });

  it("unreadOnly 收掉摘要档留下的「当天已读」，且 counts 跟着动", async () => {
    const read = await insert({ planes: [], title: "今天读过" });
    await repo.markRead(read, operatorId, "admin");
    await insert({ planes: [], title: "没读过" });

    // 摘要档本来要留着当天已读那条（免得点完「知道了」它当场消失）。
    const digest = await listMine("admin", true);
    expect(titlesOf(digest.items).sort()).toEqual(["今天读过", "没读过"]);

    // 「只看未读」把它收掉——两者不是一回事，所以是两个开关。
    const unread = await listMine("admin", true, { unreadOnly: true });
    expect(titlesOf(unread.items)).toEqual(["没读过"]);
    // counts 在 filtered 上，所以它随「只看未读」动：少了那条已读的。
    expect(unread.counts.info).toBe(digest.counts.info - 1);
    // unread 反过来不动——它恒按全部算，角标不该因为勾了个筛选就变。
    expect(unread.unread).toBe(digest.unread);
  });

  it("筛到 0 条时 counts 照样报得出数（空页不许把整排数字归零）", async () => {
    await insert({ planes: [], title: "只有一般档", severity: "info" });

    const none = await listMine("admin", false, { severities: ["critical"] });
    expect(none.items).toHaveLength(0);
    // 计数走的是不带 limit/offset 的汇总语句；写成页行的附加列时这里会是 0。
    expect(none.counts.info).toBeGreaterThan(0);
  });

  it("offset 翻过末页时 total 仍是真数，不塌成 0", async () => {
    await insert({ planes: [], title: "唯一一条" });
    const all = await repo.list({
      plane: "admin",
      operatorId,
      digest: false,
      limit: 200,
      offset: 0,
    });
    const past = await repo.list({
      plane: "admin",
      operatorId,
      digest: false,
      limit: 200,
      offset: all.total + 10,
    });
    expect(past.items).toHaveLength(0);
    expect(past.total).toBe(all.total);
    expect(past.unread).toBe(all.unread);
  });

  it("markAllRead 把本平面全部未读一次记上，按完 unread 归零；再按回 0", async () => {
    /* 这个用例会记上库里**本来就有**的那些通告（它的作用域就是这样定的），
       所以先记下这个人此前读过哪些，末尾把多出来的读记删掉，库回到原样。 */
    const { rows: readBefore } = await pool.query<{ notice_id: string }>(
      `select notice_id from admin.operator_notice_reads where operator_id = $1`,
      [operatorId],
    );
    const keep = readBefore.map((r) => r.notice_id);

    try {
      await insert({ planes: [], title: "未读甲" });
      await insert({ planes: [], title: "未读乙" });
      await insert({ planes: ["arche"], title: "别的平面" });

      const before = await repo.list({
        plane: "admin",
        operatorId,
        digest: false,
        limit: 1,
        offset: 0,
      });
      expect(before.unread).toBeGreaterThanOrEqual(2);

      const marked = await repo.markAllRead("admin", operatorId);
      // 记上的条数 = 刚才角标上那个数。少一条都说明两处的作用域分了岔。
      expect(marked).toBe(before.unread);

      const after = await repo.list({
        plane: "admin",
        operatorId,
        digest: false,
        limit: 1,
        offset: 0,
      });
      expect(after.unread).toBe(0);

      // 幂等：再按一次 0 条，不抛——「已经全读过了」不是错误。
      expect(await repo.markAllRead("admin", operatorId)).toBe(0);

      // 只发给 arche 的那条不在 admin 的作用域里，所以它还是未读。
      const arche = await repo.list({
        plane: "arche",
        operatorId,
        digest: false,
        limit: 200,
        offset: 0,
      });
      expect(
        arche.items.find((i) => i.title === TITLE_PREFIX + "别的平面")?.readAt,
      ).toBeNull();
    } finally {
      await pool.query(
        `delete from admin.operator_notice_reads
          where operator_id = $1 and notice_id <> all($2::uuid[])`,
        [operatorId, keep],
      );
    }
  });
});
