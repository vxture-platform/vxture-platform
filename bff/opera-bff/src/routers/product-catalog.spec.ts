/**
 * product-catalog.spec.ts —— 接入检查单的归属规则（2026-08-30，清单由正向改反向）。
 *
 * 字典表 `product.launch_checklist_items` 没有归属列，opera 拿哪些项靠代码里的一条
 * 规则。规则改过一次形状（六个技术项的正向清单 → 排除 admin 两项的反向清单），
 * 行为必须和改之前一模一样：当前 seed 的八行经规则过滤，得到的正是原来那六项。
 * 这类回归的表现是「检查单少一项 / 多一项」，不报错，守卫脚本看不见，所以钉在这里。
 *
 * 八个码抄自 `deploy/database/seed/seed-catalog.mjs` 的两段 INSERT（顺序按 sort）。
 * seed 改了这里要跟着改——那正是本测试要抓的事。
 */
import { describe, expect, it } from "vitest";
import {
  ADMIN_OWNED_ITEM_CODES,
  isOperaChecklistItem,
} from "./product-catalog.router";

/** seed-catalog.mjs 里 launch_checklist_items 的全部行，按 sort 升序。 */
const SEEDED_ITEM_CODES = [
  "verification_policy", // 10  商业前置，admin
  "pricing_set", //         20  商业前置，admin
  "catalog_registered", //  30  ┐
  "c1_identity", //         40  │
  "c3_metering", //         50  │ product_200 §7 六步技术接入，opera
  "c2_entitlement", //      60  │
  "data_plane", //          70  │
  "acceptance", //          80  ┘
] as const;

/** 改反向之前 `TECH_ITEM_CODES` 的原样（顺序已按 sort 排好）。 */
const FORMER_TECH_ITEM_CODES = [
  "catalog_registered",
  "c1_identity",
  "c3_metering",
  "c2_entitlement",
  "data_plane",
  "acceptance",
] as const;

describe("opera 的检查单 = 字典表全部行 − admin 那两项", () => {
  it("当前 seed 的八行过滤后正是原来的六个技术项，顺序不变", () => {
    expect(SEEDED_ITEM_CODES.filter(isOperaChecklistItem)).toEqual([
      ...FORMER_TECH_ITEM_CODES,
    ]);
  });

  it("被排除的恰好是 seed 里的两项商业前置，一项不多", () => {
    const excluded = SEEDED_ITEM_CODES.filter(
      (code) => !isOperaChecklistItem(code),
    );
    expect(excluded).toEqual([...ADMIN_OWNED_ITEM_CODES]);
    /* 排除集里的每一个码都必须真的在 seed 里：排除一个不存在的码不报错，
       只会让人以为它被处理了。 */
    for (const code of ADMIN_OWNED_ITEM_CODES) {
      expect(SEEDED_ITEM_CODES).toContain(code);
    }
  });

  /* 反向清单的意义就在这一条：DDL 说「新增检查项 = INSERT 一行」，新技术项不改
     代码就该出现在 opera。正向清单时这个断言不成立。 */
  it("字典里新增的技术项不改代码即归 opera", () => {
    expect(isOperaChecklistItem("c4_observability")).toBe(true);
  });

  /* 规则只回答「归不归 opera」，不回答「字典里有没有」——后者由接口查库判 404。
     这里钉住边界，免得有人把它当成存在性校验用。 */
  it("规则不判存在性：未知码同样判为 opera 的", () => {
    expect(isOperaChecklistItem("no_such_item")).toBe(true);
  });
});
