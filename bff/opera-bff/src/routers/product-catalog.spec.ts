/**
 * product-catalog.spec.ts —— 接入检查单的两根轴：归属（owner）与门（gate）。
 *
 * ── 这份 spec 为什么要重写（2026-09-17）──
 *
 * 归属此前是代码里的一个字面量集合（`ADMIN_OWNED_ITEM_CODES`），这份 spec 的旧版
 * 钉的就是那个集合与 seed 的一致性。归属与门现在是**表上的两列**
 * （2026-10-07-checklist-gate-owner.sql），字面量已删，旧断言随之失去对象。
 *
 * 新版钉的是**SQL 口径**：四处查询分别按哪一列过滤。这类回归的表现是「检查单少一项
 * / 多一项」或「本不该卡上线的项把上线卡住了」，两者都不报错、守卫也看不见。
 *
 * ── 两个口径有意不同，这是本文件最要紧的一条 ──
 *
 *   展示 / 写入归属 → `owner = 'opera'`   回答「这一项归谁勾」
 *   上线门槛        → `gate  = 'launch'`  回答「这一项卡哪一道」
 *
 两根轴当初是为 `acceptance` 分开的：它归 opera 但卡 publish，而卡在上线门上就是
 * 循环自锁。2026-11-03 起它已退出这张表，于是**表里只剩 launch/opera 一类**——
 * 两根轴因此此刻恒等。
 *
 * 轴不删：它们守的是「这张表只答一个问题」。往里加一个别的 gate 或别的 owner 的项，
 * 这张表就又在同时回答两件事了，而下面那条断言会当场红。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROUTER_SRC = readFileSync(
  resolve(__dirname, "product-catalog.router.ts"),
  "utf8",
);

/**
 * seed-catalog.mjs 里 launch_checklist_items 的全部行（sort 升序）与它们的两根轴。
 *
 * 这张表**只剩上线门那一类**了，三次退役各有各的理由：
 *   10/20  verification_policy / pricing_set  2026-10-29 —— 归 admin，而全仓没有任何
 *          人能勾上它们（opera 的端点写死 owner='opera'、admin-bff 只有 SELECT）。
 *          而且这两件本来就是发布时一查就知道的**事实**，不是勾。
 *   70     data_plane                          2026-10-09 —— 同一项三处定义矛盾。
 *   80     acceptance                          2026-11-03 —— 检查照跑，退的是它在这张
 *          表上的席位：检查单答「还差哪几件才能上线」，而它不办也能上线。
 *          结果改由「运行健康」呈现（三态，没有「未通过」这个说法）。
 */
const SEEDED_ITEMS = [
  { code: "catalog_registered", owner: "opera", gate: "launch" }, //   30
  { code: "c1_identity", owner: "opera", gate: "launch" }, //          40
  { code: "c1_s2s", owner: "opera", gate: "launch" }, //               45
  { code: "c3_metering", owner: "opera", gate: "launch" }, //          50
  { code: "c2_entitlement", owner: "opera", gate: "launch" }, //       60
] as const;

describe("检查单的两根轴：展示按 owner，上线门槛按 gate", () => {
  it("字面量集合与 helper 已删干净（不再有第二份归属事实）", () => {
    /* 归属搬进库以后，代码里再留一份就会漂——而漂的症状是「库里说归 admin、
       代码说归 opera」，两边都不报错。 */
    expect(ROUTER_SRC).not.toMatch(/export const ADMIN_OWNED_ITEM_CODES/);
    expect(ROUTER_SRC).not.toMatch(/export function isOperaChecklistItem/);
  });

  it("展示与写入归属按 owner 过滤，且没有任何一处仍按 item_code 排除", () => {
    /* 只数 **SQL 里的** 过滤：谓词前必有 WHERE / AND。
       不加这个前缀会把本文件与 router 注释里写的 `i.owner = 'opera'` 也算进来——
       那等于让注释替 SQL 站岗，这条断言就废了（第一版正是这么写的，实测多出一处
       来自 router 尾部那段解释性注释）。 */
    const ownerFilters =
      ROUTER_SRC.match(/(?:WHERE|AND)\s+i\.owner = 'opera'/g) ?? [];
    /* 两处展示查询：checklist-summary（跨产品汇总）与 :id/checklist（单产品）。 */
    expect(ownerFilters.length).toBe(2);
    /* 旧口径的残留会让某一处仍按代码常量过滤，而那个常量已经不存在了。 */
    expect(ROUTER_SRC).not.toMatch(/item_code <> ALL/);
  });

  it("上线门槛只看 gate='launch' —— 环在这一处断", () => {
    expect(ROUTER_SRC).toMatch(/i\.gate = 'launch'/);
    /* 门槛那段必须同时保留 is_required 与 coalesce(...,false)：
       前者是「必填才卡」，后者是「没写过 = 未满足」（LEFT JOIN 的 NULL）。 */
    const gateBlock = ROUTER_SRC.slice(
      ROUTER_SRC.indexOf("i.gate = 'launch'") - 400,
      ROUTER_SRC.indexOf("i.gate = 'launch'") + 200,
    );
    expect(gateBlock).toMatch(/i\.is_required/);
    expect(gateBlock).toMatch(/coalesce\(s\.is_satisfied, false\)/);
  });

  it("这张表只答一个问题：清一色 gate='launch' + owner='opera'", () => {
    /* 这是「三屏三个问题」在数据层的直接断言（owner 2026-09-23 走查：
       「几个环节的认证还混淆在一个页面」）。
         检查单       还差哪几件才能上线
         认证台账     这条链在沙箱里证过没有  → product.certification_runs
         运行健康     最近还正常吗            → 派生，不落表
       往这张表里加一个 gate='publish' 或 owner='admin' 的项，它就又在同时回答两件事。
       那种回退不会报错，只会让某一屏重新变成一个装着几类东西的袋子——所以钉在这里。 */
    expect(SEEDED_ITEMS.every((i) => i.gate === "launch")).toBe(true);
    expect(SEEDED_ITEMS.every((i) => i.owner === "opera")).toBe(true);
  });

  it("上线门槛就是这五项技术检查，退役的三项一个不剩", () => {
    const codes = SEEDED_ITEMS.map((i) => i.code);
    expect(codes).toEqual([
      "catalog_registered",
      "c1_identity",
      "c1_s2s",
      "c3_metering",
      "c2_entitlement",
    ]);
    for (const retired of [
      "acceptance",
      "data_plane",
      "verification_policy",
      "pricing_set",
    ]) {
      expect(codes).not.toContain(retired);
    }
  });

  it("字典新增项按 DDL 默认值落地：归 opera、卡上线，不改代码即生效", () => {
    /* DDL 的原话是「新增检查项 = INSERT 一行，不改表结构」。两列的默认值
       （opera / launch）让这句话继续成立——新技术项不写 owner/gate 也归 opera
       且卡上线，与加列之前的行为一致。 */
    const ddl = readFileSync(
      resolve(__dirname, "../../../../deploy/database/ddl/40_product.sql"),
      "utf8",
    );
    expect(ddl).toMatch(/owner\s+varchar\(16\)\s+NOT NULL DEFAULT 'opera'/);
    expect(ddl).toMatch(/gate\s+varchar\(16\)\s+NOT NULL DEFAULT 'launch'/);
  });

  it("写入归属改为查库：查不到或非 opera 都是 404，不再查代码常量", () => {
    expect(ROUTER_SRC).toMatch(
      /SELECT owner FROM product\.launch_checklist_items WHERE item_code = \$1/,
    );
    expect(ROUTER_SRC).toMatch(/known\.rows\[0\]!\.owner !== "opera"/);
  });
});
