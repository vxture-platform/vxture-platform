import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** 递归列出目录下的 .ts 文件（测试与声明文件不算）。 */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (entry.endsWith(".ts") && !/\.(spec|test|d)\.ts$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

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
   * 目录次序的读者必须逐字一致，否则「排了不生效」：
   *   1. 移动时锁全集的那句（算的就是这个次序）
   *   2. admin 产品清单（运营眼前那张表——按别的键排，就是在看不见的次序上按上移）
   *   3. 官网 /appcenter（这条线存在的目的）
   *   4. opera 产品接入页（owner 2026-09-22 报：admin 顺序变了、opera 没变）
   *
   * 第 4 处是上一版漏掉的读者。当时我把判据写死成「三处」，而真实读者有四个——
   * 一个自己数出来的数字不是范围，得去数**谁在读这张表**。
   *
   * 四句都是拼死的 SQL 文本，对不上时**没有任何一处会报错**，只会安静地各排各的。
   * 所以这里直接比源码里的那句，不比运行结果。
   */
  it("四处 ORDER BY 逐字一致（移动 / admin / 官网 / opera）", () => {
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
    const opera = read(
      "../../../opera-bff/src/routers/product-catalog.router.ts",
    );

    // admin 里两句都要在：清单（带别名）与移动（不带别名）。
    expect(admin).toContain(EXPECTED);
    expect(admin).toContain(MOVE);
    expect(website).toContain(EXPECTED);
    expect(opera).toContain(EXPECTED);
  });

  /*
   * 唯一写入方（owner 2026-09-22：「排序的控制权只留一个，在 admin，其他都为跟随，
   * 这个排序是营销运营人员管理，影响页面显示」）。
   *
   * `products.sort` 原本**一个写入方都没有**——DDL 里写着「排序」，三个门户按它排，
   * 全仓没有一条 UPDATE 碰它。这类列一旦开了口子，第二个写入方进来时不会报错，
   * 只会让「我在 admin 排的顺序自己变了」，而那时已经查不出是谁改的。
   *
   * 所以这里直接扫源码：admin-bff 之外，任何 BFF 都不许出现改 sort 的 UPDATE。
   * 新建产品时把 sort 置成 max+1（opera）**不算**——那是落位默认值，没有次序的
   * 选择权，新产品一律去末尾；排到哪由营销运营在 admin 决定。
   */
  it("products.sort 的写入方只有 admin-bff（owner：控制权只留一处）", () => {
    const bffDir = join(__dirname, "../../..");
    const offenders: string[] = [];

    for (const bff of readdirSync(bffDir, { withFileTypes: true })) {
      if (!bff.isDirectory() || bff.name === "admin-bff") continue;
      const src = join(bffDir, bff.name, "src");
      if (!existsSync(src)) continue;

      for (const file of walk(src)) {
        const text = readFileSync(file, "utf8").toLowerCase();
        /*
         * 按 `;` 切成语句，再逐段查四个词——不用跨行正则。
         *
         * 上一版写的是 `/update[^;]{0,200}?product\.products.../s`，而 heredoc 把
         * `\\b` 吃成了**字面退格符**（0x08）落进正则里：终端不显示、`re.source`
         * 打出来也看不出，于是它恒假——**一个瞎掉的守卫和通过长得一模一样**。
         * 换成一眼看得出对的写法：守卫的价值全在「它真的看得见」。
         */
        const hit = text
          .split(";")
          .some(
            (stmt) =>
              stmt.includes("update") &&
              stmt.includes("product.products") &&
              stmt.includes("set") &&
              /sort\s*=/.test(stmt),
          );
        if (hit) offenders.push(file.slice(bffDir.length + 1));
      }
    }

    expect(offenders).toEqual([]);
  });
});
