/**
 * products-role-matrix.spec.ts — 角色 × 入口矩阵 + 定价第二道门（2026-10-04 拆门）。
 *
 * 角色的持码**从 seed 读**（deploy/database/seed/seed-catalog.mjs 的 OPERATOR_ROLE_PERMS），
 * 不在这里抄一份——抄本会跟着 seed 漂而不报错。期望矩阵则是手写的：它是「目录说谁能进」
 * 这句话的字面抄录，seed 改了绑定而这张表没改，用例就该红，那正是要抓的事。
 *
 * ── 拆门前的矩阵（2026-10-04 之前，写在这里当对照）──
 * 32 个入口全判遗留扁平码 platform.product.manage，由 auth.service 旧桥从 product:plan.manage
 * 合成。于是：持 plan.manage 的角色（administrator / operator）**全部 32 个入口全开**，含产品
 * 目录排序、建删解决方案、改价格；不持的角色（finance / engineer / auditor / support）**一个
 * 读入口都进不来**——哪怕目录里明写了 finance / auditor 持 plan.read + price.read、engineer /
 * auditor 持 capability.read。两头都错，与 #577 在租户 / 工单那边量出来的一模一样。
 *
 * ── 拆门后（本文件断言的）──
 * 读门收本线 .read | .manage，写门只收本线 .manage，价格在套餐草稿 PATCH 里按「改了哪个周期
 * 的价格」补判——不是按「请求里有没有 prices」：两个草稿编辑器每次保存都把详情里的价格原样
 * 回送，按字段判会让只授 plan.manage 的角色连改配额都 403（门拆成墙，2026-10-04 审查抓到）。
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ForbiddenException } from "@nestjs/common";
import type { Pool } from "pg";
import { ProductsRouter } from "./products.router";
import { makeReq, makeTxClient, noDbPool } from "../testing/pool-mocks";

const SEED = fileURLToPath(
  new URL("../../../../deploy/database/seed/seed-catalog.mjs", import.meta.url),
);
const seedSrc = readFileSync(SEED, "utf8");

/** 取 seed 里某个字面量（与 scripts/guardrails/check-operator-planes.mjs 同一个读法）。 */
function literalAfter(marker: string, scope: Record<string, unknown> = {}) {
  const at = seedSrc.indexOf(marker);
  if (at < 0) throw new Error(`seed 里找不到 ${marker}`);
  const openCh = marker.trim().endsWith("{") ? "{" : "[";
  const open = seedSrc.indexOf(openCh, at + marker.length - 1);
  const closeCh = openCh === "{" ? "}" : "]";
  let depth = 0;
  for (let i = open; i < seedSrc.length; i += 1) {
    const ch = seedSrc[i];
    if (ch === openCh) depth += 1;
    else if (ch === closeCh) {
      depth -= 1;
      if (depth === 0) {
        const names = Object.keys(scope);
        return new Function(...names, `return ${seedSrc.slice(open, i + 1)};`)(
          ...names.map((n) => scope[n]),
        );
      }
    }
  }
  throw new Error(`${marker} 的字面量没有闭合`);
}

const ALL_CODES: string[] = (
  literalAfter("const OPERATOR_PERMISSIONS = [") as unknown[][]
).map((row) => row[0] as string);
/* super_admin 在 seed 里写作 `[...OP_ALL]`；闭包（菜单码）与门无关，不必求。 */
const ROLE_PERMS = literalAfter("const OPERATOR_ROLE_PERMS = {", {
  OP_ALL: ALL_CODES,
}) as Record<string, string[]>;

const PLAN_ID = "33333333-3333-4333-8333-333333333333";
const VERSION_ID = "44444444-4444-4444-8444-444444444444";

/** 只读池：任何查询回空集——读入口过了门就会落到这里并正常返回。 */
function emptyRoPool(): Pool {
  return {
    query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
    connect: vi.fn(() => {
      throw new Error("read path must not take a client");
    }),
  } as unknown as Pool;
}

/** 库里这一版草稿已存的价格——详情下发的就是这个形状（numeric(12,2) 的字符串）。 */
const STORED_PRICES: { cycle_unit: string; price: string }[] = [
  { cycle_unit: "month", price: "99.00" },
  { cycle_unit: "year", price: "999.00" },
];

/**
 * 写池替身：答一版未锁定的草稿 + 已存价格，其余语句回空。价格门要先读库里的行才能判
 * （判据是「改没改」），所以写入口的 403 不再能用「没碰写池」证明——改证「403 之前没有
 * 任何一条写语句」（见 writesIn）。
 */
function draftTx(stored = STORED_PRICES) {
  return makeTxClient((sql) => {
    if (
      sql.includes("from product.plan_versions") &&
      sql.includes("for update")
    )
      return [{ status: "draft", is_locked: false }];
    if (sql.includes("from product.plan_prices")) return stored;
    return undefined;
  });
}

/** 事务里跑过的写语句（INSERT / UPDATE / DELETE），BEGIN / SELECT / ROLLBACK 不算。 */
function writesIn(calls: string[]): string[] {
  return calls.filter((c) => /^\s*(insert|update|delete)\b/i.test(c));
}

type Probe = (router: ProductsRouter, caps: string[]) => Promise<unknown>;

/** 每条线一读一写，外加价格那道门。 */
const PROBES: Record<string, Probe> = {
  capRead: (r, c) => r.listCapabilities(makeReq(c)),
  capWrite: (r, c) => r.moveProduct(makeReq(c), "karda", { direction: "up" }),
  solRead: (r, c) => r.listSolutions(makeReq(c)),
  solWrite: (r, c) =>
    r.createSolution(makeReq(c), { solutionCode: "x", solutionName: "X" }),
  planRead: (r, c) => r.listPlanMatrix(makeReq(c), undefined),
  planWrite: (r, c) => r.deprecatePlan(makeReq(c), PLAN_ID),
  priceWrite: (r, c) =>
    r.updateDraftVersion(makeReq(c), VERSION_ID, {
      prices: [{ cycleUnit: "month", price: 1 }],
    }),
};
const PROBE_NAMES = Object.keys(PROBES);

/**
 * 期望：✓ = 过门（读回空集，或写入口走到 rwPool 被桩拦下——总之不是 403），✗ = 403。
 * 顺序同 PROBE_NAMES：capRead capWrite solRead solWrite planRead planWrite priceWrite。
 */
const EXPECTED: Record<string, string> = {
  super_admin: "✓✓✓✓✓✓✓",
  administrator: "✓✓✓✓✓✓✓",
  operator: "✓✓✓✓✓✓✓",
  finance: "✗✗✗✗✓✗✗", // 目录给它 plan.read + price.read：读得到套餐，改不了任何东西
  engineer: "✓✗✗✗✗✗✗", // capability.read：读得到产品目录（拆门前 403）
  auditor: "✓✗✗✗✓✗✗", // capability.read + plan.read
  support: "✗✗✗✗✗✗✗",
};

async function outcome(probe: Probe, caps: string[]): Promise<"✓" | "✗"> {
  const rw = draftTx();
  const router = new ProductsRouter(emptyRoPool(), rw.pool);
  try {
    await probe(router, caps);
    return "✓";
  } catch (err) {
    if (err instanceof ForbiddenException) {
      expect(writesIn(rw.calls), "403 之前不许写").toEqual([]);
      return "✗";
    }
    /* 写入口过了门就落到替身上，之后缺行 404 / 读详情空集都算过门，不是失败。 */
    return "✓";
  }
}

describe("products.router 角色 × 入口矩阵（持码从 seed 读）", () => {
  it("seed 里的七个角色都在", () => {
    for (const role of Object.keys(EXPECTED)) {
      expect(ROLE_PERMS[role], role).toBeDefined();
    }
  });

  it.each(Object.entries(EXPECTED))("%s → %s", async (role, expected) => {
    const caps = ROLE_PERMS[role]!;
    const got: string[] = [];
    for (const name of PROBE_NAMES) {
      got.push(await outcome(PROBES[name]!, caps));
    }
    expect(got.join(""), PROBE_NAMES.join(" ")).toBe(expected);
  });

  /* 两头都错的那两头，各钉一条可以单独读懂的用例。 */
  it("finance 持 plan.read 却被粗门关在外面的那一页，现在读得到", async () => {
    expect(await outcome(PROBES.planRead!, ROLE_PERMS.finance!)).toBe("✓");
  });

  it("治理台只授 product:plan.manage 的自建角色：拆门前 32 个入口全开，现在只开套餐那一线", async () => {
    const caps = ["product:plan.manage"];
    expect(await outcome(PROBES.planWrite!, caps)).toBe("✓");
    expect(await outcome(PROBES.planRead!, caps)).toBe("✓");
    expect(await outcome(PROBES.capWrite!, caps)).toBe("✗");
    expect(await outcome(PROBES.solWrite!, caps)).toBe("✗");
    expect(await outcome(PROBES.capRead!, caps)).toBe("✗");
    expect(await outcome(PROBES.solRead!, caps)).toBe("✗");
    expect(await outcome(PROBES.priceWrite!, caps)).toBe("✗");
  });
});

describe("定价第二道门：套餐草稿 PATCH 改了已存价格才另判 product:price.manage", () => {
  const PLAN_ONLY = makeReq(["product:plan.manage"]);

  it("只有 plan.manage：月价与已存不同 → 403，事务里没有任何写语句，已回滚", async () => {
    const rw = draftTx();
    const router = new ProductsRouter(emptyRoPool(), rw.pool);
    await expect(
      router.updateDraftVersion(PLAN_ONLY, VERSION_ID, {
        prices: [{ cycleUnit: "month", price: 100 }],
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(writesIn(rw.calls)).toEqual([]);
    expect(rw.outcome()).toMatchObject({ rolledBack: true, released: true });
  });

  it("只有 plan.manage：编辑器的保存形状（已存价格原样回送 + 改配额）→ 过门，配额写入并提交", async () => {
    /* PlanDraftEditorPage.draftBody() / PlanVersionsPage.readDraftBody() 每次保存都把
       hydrate 进表单的 "99.00" / "999.00" 以 Number 回送——这就是审查里那堵墙。 */
    const rw = draftTx();
    const router = new ProductsRouter(emptyRoPool(), rw.pool);
    await expect(
      router.updateDraftVersion(PLAN_ONLY, VERSION_ID, {
        prices: [
          { cycleUnit: "month", price: Number("99.00") },
          { cycleUnit: "year", price: Number("999.00") },
        ],
        quota: { "doc.words": 2000 },
      }),
    ).rejects.not.toBeInstanceOf(ForbiddenException);
    const writes = writesIn(rw.calls);
    expect(writes.some((w) => /update product\.plan_components/i.test(w))).toBe(
      true,
    );
    expect(rw.outcome()).toMatchObject({ committed: true, rolledBack: false });
  });

  it("只有 plan.manage：多送一个库里没有的周期 → 那是新价格，403", async () => {
    const rw = draftTx([{ cycle_unit: "month", price: "99.00" }]);
    const router = new ProductsRouter(emptyRoPool(), rw.pool);
    await expect(
      router.updateDraftVersion(PLAN_ONLY, VERSION_ID, {
        prices: [
          { cycleUnit: "month", price: 99 },
          { cycleUnit: "year", price: 999 },
        ],
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(writesIn(rw.calls)).toEqual([]);
  });

  it("只有 plan.manage：不带价格（只改配额）→ 过门（别把门拆成墙）", async () => {
    const rw = draftTx();
    const router = new ProductsRouter(emptyRoPool(), rw.pool);
    await expect(
      router.updateDraftVersion(PLAN_ONLY, VERSION_ID, {
        quota: { "doc.words": 1000 },
      }),
    ).rejects.not.toBeInstanceOf(ForbiddenException);
    expect(rw.outcome()).toMatchObject({ committed: true });
  });

  it("只有 plan.manage：prices 是空数组 → 不算改价格，过门", async () => {
    const rw = draftTx();
    const router = new ProductsRouter(emptyRoPool(), rw.pool);
    await expect(
      router.updateDraftVersion(PLAN_ONLY, VERSION_ID, { prices: [] }),
    ).rejects.not.toBeInstanceOf(ForbiddenException);
    expect(rw.outcome()).toMatchObject({ committed: true });
  });

  it("plan.manage + price.manage：改价 → 过门，价格写入并提交", async () => {
    const rw = draftTx();
    const router = new ProductsRouter(emptyRoPool(), rw.pool);
    await expect(
      router.updateDraftVersion(
        makeReq(["product:plan.manage", "product:price.manage"]),
        VERSION_ID,
        { prices: [{ cycleUnit: "month", price: 100 }] },
      ),
    ).rejects.not.toBeInstanceOf(ForbiddenException);
    expect(
      writesIn(rw.calls).some((w) =>
        /insert into product\.plan_prices/i.test(w),
      ),
    ).toBe(true);
    expect(rw.outcome()).toMatchObject({ committed: true });
  });

  it("只有 price.manage：改不了草稿（第二道门不替代第一道），且没碰写池", async () => {
    const rw = noDbPool();
    const router = new ProductsRouter(emptyRoPool(), rw.pool);
    await expect(
      router.updateDraftVersion(makeReq(["product:price.manage"]), VERSION_ID, {
        prices: [{ cycleUnit: "month", price: 100 }],
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(rw.connect).not.toHaveBeenCalled();
  });
});
