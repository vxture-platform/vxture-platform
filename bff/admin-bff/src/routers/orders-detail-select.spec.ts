import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * orders-detail-select.spec.ts —— 订单详情查询必须把申报腿的列写进 SELECT。
 *
 * 2026-09-27 生产实单抓到：`ORDER_BASE_SQL` 把 `pending_verify` 现金腿 lateral join
 * 成 `declared`，SELECT 列表却一列都没投影，于是 `mapOrderRow` 里 `row.declared_at`
 * 恒为 undefined、接口的 `declaredPayment` 恒为 null——admin 上「客户申报」块与
 * 「驳回申报」按钮（都以它为条件）从上线那天起就没出现过，确认弹窗也锁不住申报金额。
 * SQL 里的 join 与 SELECT 是两处，漏一处不报错，只是接口少一块；这里按源码钉住。
 */
const SRC = readFileSync(resolve(__dirname, "orders.router.ts"), "utf8");

describe("订单详情 SELECT 投影申报腿", () => {
  it("ORDER_BASE_SQL 的 SELECT 列表含 declared.* 六列，且都在 from 之前", () => {
    const start = SRC.indexOf("const ORDER_BASE_SQL = `");
    const from = SRC.indexOf("from billing.orders ord", start);
    expect(start).toBeGreaterThan(-1);
    expect(from).toBeGreaterThan(start);
    const selectList = SRC.slice(start, from);
    for (const col of [
      "declared.declared_channel",
      "declared.declared_payer",
      "declared.declared_transaction_no",
      "declared.declared_remark",
      "declared.declared_amount",
      "declared.declared_at",
    ]) {
      expect(selectList).toContain(col);
    }
  });

  it("映射以 declared_at 为开关：SELECT 里的列名与映射读的列名一致", () => {
    /* 反面：SELECT 投影了却起了别的别名，映射仍然读不到——所以两头都要对。 */
    expect(SRC).toMatch(/declaredPayment: row\.declared_at/);
    for (const col of [
      "row.declared_channel",
      "row.declared_payer",
      "row.declared_transaction_no",
      "row.declared_remark",
      "row.declared_amount",
    ]) {
      expect(SRC).toContain(col);
    }
  });
});
