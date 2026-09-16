import { describe, it, expect } from "vitest";
import { humanRemark } from "./billing.router";

/**
 * billing-human-remark.spec.ts — 运营备注里的机读串不得露到界面。
 *
 * ── 为什么这块值得测 ──
 *
 * owner 2026-09-17 在 /billing 上看到「处理」列直接打印出
 * `{"intent":"upgrade","upgrade_of":"<uuid>"}`——里面裸着一个 uuid，撞「任何场景
 * 只展示可视码」那条铁律。病因是 `billing.invoices.operate_remark` 这一列被当成
 * 两用：DDL 注释写的是「运营手工出账/调整备注」（人写给人看），旧模型却把订单意图
 * 也塞了进去。
 *
 * 过滤放在 `mapBillingRow` 这个唯一投影入口，所以这个纯函数是**列表、详情、徽标
 * tooltip、搜索串**四条路径共同的闸门——它判错一次，四处一起错。而它判错了不报错，
 * 只会在界面上多露或少露一段文字，正是静态门禁看不见的那类。
 *
 * ── 两层判据故意不一致 ──
 *
 * 清存量的迁移只清含 `"intent"` 键且有订单可对照的行（数据层严，删错没得退）；
 * 这一层把**任何** JSON 对象都藏掉（展示层宽，藏错可改回）。所以库里留下的那些
 * "无订单可对照"的机读串，界面上照样不露。下面第 5 条用例钉的就是这个差异。
 */
describe("humanRemark", () => {
  it("空值一律当作没有备注", () => {
    expect(humanRemark(null)).toBeNull();
    expect(humanRemark("")).toBeNull();
  });

  it("人写的备注原样交出去", () => {
    const remark = "线下汇款已核实，客户要求本月出账";
    expect(humanRemark(remark)).toBe(remark);
  });

  it("真实脏数据被藏掉 —— 里面裸着 uuid", () => {
    const dirty =
      '{"intent":"upgrade","upgrade_of":"7d75b00a-0000-4000-a000-000000000100"}';
    expect(humanRemark(dirty)).toBeNull();
  });

  it("键后带空格的也认", () => {
    expect(humanRemark('{"intent": "renew"}')).toBeNull();
  });

  it("不含 intent 的 JSON 对象照样藏 —— 展示层比数据层宽，是有意的", () => {
    expect(humanRemark('{"note":"手工补录"}')).toBeNull();
    expect(humanRemark("{}")).toBeNull();
  });

  it("花括号包着的人写备注留得住 —— 它不是合法 JSON", () => {
    const remark = "{客户要求调整}";
    expect(humanRemark(remark)).toBe(remark);
  });

  it("前后有空白的机读串也认", () => {
    expect(humanRemark('  {"intent":"new"}  ')).toBeNull();
  });

  it("以花括号开头但解析失败的，一律当人写的留住", () => {
    const broken = '{"intent":"upgrade"';
    expect(humanRemark(broken)).toBe(broken);
  });

  it("JSON 标量不会被误判 —— 它们进不了以花括号开头这一关", () => {
    expect(humanRemark("42")).toBe("42");
    expect(humanRemark("null")).toBe("null");
  });
});
