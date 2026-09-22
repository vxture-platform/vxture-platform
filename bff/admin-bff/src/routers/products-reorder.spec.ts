import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { BadRequestException, NotFoundException } from "@nestjs/common";

import { ProductsRouter } from "./products.router";
import { MANAGE, makeReq, makeTxClient, noDbPool } from "../testing/pool-mocks";

/**
 * 产品目录次序（owner 2026-09-22）。
 *
 * ── 补的是哪个盲区 ──
 * `products.sort` 这一列**从来没有写入方**：DDL 里写着「排序」，官网目录、appcenter、
 * console 推荐位全都按它排，而全仓没有一条 UPDATE 碰它。于是 17 个产品的 sort 全是
 * 默认值 0，实际顺序落到并列键 `product_code ASC`——**字母序**。
 * 字母序看起来像「有某种顺序」，所以一直没被当成缺陷。
 *
 * ── up/down 为什么要带 anchorCode ──
 * 第一版让服务端按**全集**取相邻行。上线当天 owner 报：置顶/置底正常，上移/下移
 * 偶尔生效、「提示说已经移到了但实际未移动」。两件事不是一回事：
 *   · 置顶/置底 → 全集端点，在任何筛选/分页的视图里**也**是端点 ⇒ 看着总是对的
 *   · 上移/下移 → 全集相邻行可能被筛掉或在另一页 ⇒ 库里换了位，屏幕上没动
 * 服务端确实移了，所以 moved:true、toast 照弹——报告成功却什么也没发生。
 */

const ORDER = ["alpha", "beta", "gamma", "delta"];

/** 按 (sort, product_code) 排好的全集；写入那条 UPDATE 回 rowCount。 */
function catalogTx(order: string[] = ORDER) {
  return makeTxClient((sql) => {
    if (sql.includes("from product.products") && sql.includes("for update"))
      return order.map((code) => ({ id: `id-${code}`, product_code: code }));
    return [];
  });
}

/** 那条 UPDATE 的第一个参数就是新次序（uuid[]），把它翻回产品码。 */
function writtenOrder(tx: { calls: string[]; params: unknown[][] }) {
  const at = tx.calls.findIndex((c) => c.includes("UPDATE product.products"));
  if (at < 0) return null;
  return (tx.params[at]?.[0] as string[]).map((id) => id.replace(/^id-/, ""));
}

describe("PATCH capabilities/:code/move —— 目录次序", () => {
  it.each([
    ["up", "gamma", "beta", ["alpha", "gamma", "beta", "delta"]],
    ["down", "beta", "gamma", ["alpha", "gamma", "beta", "delta"]],
    ["top", "delta", "", ["delta", "alpha", "beta", "gamma"]],
    ["bottom", "alpha", "", ["beta", "gamma", "delta", "alpha"]],
  ] as const)("%s：%s → %j", async (direction, code, anchor, expected) => {
    const tx = catalogTx();
    const router = new ProductsRouter(noDbPool().pool, tx.pool);
    const res = await router.moveProduct(makeReq(MANAGE), code, {
      direction,
      ...(anchor ? { anchorCode: anchor } : {}),
    });

    expect(res.moved).toBe(true);
    expect(writtenOrder(tx)).toEqual(expected);
    expect(tx.outcome().committed).toBe(true);
  });

  /*
   * 本次缺陷的回归用例。运营筛掉了 beta，屏幕上是 alpha / gamma / delta；
   * 对 gamma 点「上移」，看得见的邻居是 alpha。
   *
   * 旧行为：服务端取全集相邻行 beta，把 gamma 挪到 beta 之前 ⇒ 全集变成
   *   alpha, gamma, beta, delta，而**筛选后的视图仍是 alpha, gamma, delta**——
   *   一模一样。moved:true、toast 弹出、屏幕纹丝不动。
   * 现在：anchor=alpha ⇒ gamma 落到 alpha 之前，视图当场变成 gamma, alpha, delta。
   */
  it("邻居被筛掉时，上移跟的是**看得见**的那一个（回归）", async () => {
    const tx = catalogTx();
    const router = new ProductsRouter(noDbPool().pool, tx.pool);
    const res = await router.moveProduct(makeReq(MANAGE), "gamma", {
      direction: "up",
      anchorCode: "alpha",
    });

    expect(res.moved).toBe(true);
    expect(writtenOrder(tx)).toEqual(["gamma", "alpha", "beta", "delta"]);
  });

  it("下移同理：跨过被筛掉的行，落到看得见的那个之后", async () => {
    const tx = catalogTx();
    const router = new ProductsRouter(noDbPool().pool, tx.pool);
    await router.moveProduct(makeReq(MANAGE), "alpha", {
      direction: "down",
      anchorCode: "gamma",
    });

    expect(writtenOrder(tx)).toEqual(["beta", "gamma", "alpha", "delta"]);
  });

  /* 不给 anchor 就 400。兜底回「按全集取相邻」正是本次的缺陷本身，所以不留兜底。 */
  it.each(["up", "down"] as const)(
    "%s 不带 anchorCode → 400，且一次都不查库",
    async (direction) => {
      const tx = catalogTx();
      const router = new ProductsRouter(noDbPool().pool, tx.pool);
      await expect(
        router.moveProduct(makeReq(MANAGE), "gamma", { direction }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(tx.calls).toHaveLength(0);
    },
  );

  it("anchorCode 就是自己 → 400", async () => {
    const tx = catalogTx();
    const router = new ProductsRouter(noDbPool().pool, tx.pool);
    await expect(
      router.moveProduct(makeReq(MANAGE), "gamma", {
        direction: "up",
        anchorCode: "gamma",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.calls).toHaveLength(0);
  });

  it("anchorCode 指向不存在的产品 → 404 且回滚", async () => {
    const tx = catalogTx();
    const router = new ProductsRouter(noDbPool().pool, tx.pool);
    await expect(
      router.moveProduct(makeReq(MANAGE), "gamma", {
        direction: "up",
        anchorCode: "nope",
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.outcome().rolledBack).toBe(true);
  });

  /*
   * 已在端点时**不写库**。写了的话每次点「上移」都会重排一遍全表、并在审计里留一条
   * 什么也没改的记录——而运营点到顶部之后还会再点一下确认自己到顶了。
   */
  it.each([
    ["up", "beta", "gamma"],
    ["top", "alpha", ""],
    ["down", "gamma", "beta"],
    ["bottom", "delta", ""],
  ] as const)(
    "位置没变：%s %s → 不写库、不写审计",
    async (direction, code, anchor) => {
      const tx = catalogTx();
      const router = new ProductsRouter(noDbPool().pool, tx.pool);
      const res = await router.moveProduct(makeReq(MANAGE), code, {
        direction,
        ...(anchor ? { anchorCode: anchor } : {}),
      });

      expect(res.moved).toBe(false);
      expect(writtenOrder(tx)).toBeNull();
      expect(
        tx.calls.some((c) => c.includes("insert into support.audit_logs")),
      ).toBe(false);
    },
  );

  it("整份次序一起写，不是只改动的那两行", async () => {
    const tx = catalogTx();
    const router = new ProductsRouter(noDbPool().pool, tx.pool);
    await router.moveProduct(makeReq(MANAGE), "gamma", {
      direction: "up",
      anchorCode: "beta",
    });

    /* sort 全 0 的存量数据没有可交换的号；归一化重排才让结果与「当前看到的顺序」
       一致，不留空洞或重号。 */
    expect(writtenOrder(tx)).toHaveLength(ORDER.length);
  });

  it("方向非法 → 400，且一次都不查库", async () => {
    const tx = catalogTx();
    const router = new ProductsRouter(noDbPool().pool, tx.pool);
    await expect(
      router.moveProduct(makeReq(MANAGE), "alpha", { direction: "sideways" }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.calls).toHaveLength(0);
  });

  it("产品不存在 → 404 且回滚", async () => {
    const tx = catalogTx();
    const router = new ProductsRouter(noDbPool().pool, tx.pool);
    await expect(
      router.moveProduct(makeReq(MANAGE), "nope", {
        direction: "up",
        anchorCode: "alpha",
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.outcome().rolledBack).toBe(true);
  });

  /*
   * 三处次序必须逐字一致，否则「排了不生效」：
   *   1. 移动时锁全集的那句（算的就是这个次序）
   *   2. admin 产品清单（运营眼前那张表——按别的键排，就是在看不见的次序上按上移）
   *   3. 官网 /appcenter（这条线存在的目的）
   * 三句都是拼死的 SQL 文本，对不上时**没有任何一处会报错**，只会安静地各排各的。
   * 所以这里直接比源码里的那句，不比运行结果。
   */
  it("三处 ORDER BY 逐字一致（移动 / admin 清单 / 官网目录）", () => {
    const norm = (sql: string) => sql.toLowerCase().replace(/\s+/g, " ").trim();
    const EXPECTED = norm("ORDER BY p.sort ASC, p.product_code ASC");
    // 移动那句不带表别名（单表 FOR UPDATE），去掉 `p.` 后应当同形。
    const MOVE = norm("ORDER BY sort ASC, product_code ASC");
    expect(MOVE).toBe(EXPECTED.replace(/p\./g, ""));

    const read = (rel: string) =>
      norm(readFileSync(join(__dirname, rel), "utf8"));
    const admin = read("./products.router.ts");
    const website = read(
      "../../../website-bff/src/routers/product-catalog.router.ts",
    );

    // admin 里两句都要在：清单（带别名）与移动（不带别名）。
    expect(admin).toContain(EXPECTED);
    expect(admin).toContain(MOVE);
    expect(website).toContain(EXPECTED);
  });
});
