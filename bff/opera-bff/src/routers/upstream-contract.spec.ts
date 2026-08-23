/**
 * upstream-contract.spec.ts — **两张词表之间**的约束。
 *
 * 机制本身（形状声明、形状变更检出、空集合、未知资源）已随机制搬去
 * `@vxture-platform/shared`，测试也跟着走了——机制住哪，它的反向验证就住哪。
 * 留在这里的只有一件事：**两个上游的词表必须互相对得上**，而那是本仓的事实。
 */

import { describe, expect, it } from "vitest";

import { ATLAS_CONTRACT } from "./atlas-contract";
import { RUNOS_CONTRACT } from "./runos-contract";

/**
 * 这一组是 `product_251` A-4 收敛的**验收条件**，写成测试而不是写成备注。
 *
 * `rowsKey` 这个参数存在，是因为两个上游曾经各说各话（atlas `items` / runos `rows`）。
 * 那时这张表同时在**当翻译**和**当检查**，而当翻译正是 P4 点名否掉的「先做映射表过渡」。
 * 上游收敛后它退回纯检查——**但只有当两张表里的行键真的只剩一个值时才成立**。
 *
 * 所以这里不检查「等于 items」，检查的是「**只有一个值**」：前者只钉住了当前答案，
 * 后者钉住的是「不许再分叉」这件事本身。
 */
describe("A-4 验收：两个上游的载荷形状已经收敛", () => {
  const shapes = [
    ...Object.entries(ATLAS_CONTRACT),
    ...Object.entries(RUNOS_CONTRACT),
  ];

  it("所有分页信封的行键收敛为单一值", () => {
    const keys = new Set(
      shapes
        .map(([, c]) => c.shape)
        .filter((s) => s.kind === "page")
        .map((s) => (s as { rowsKey: string }).rowsKey),
    );
    expect([...keys]).toEqual(["items"]);
  });

  it("没有任何一条读还在用退役的行键", () => {
    const retired = shapes.filter(
      ([, c]) =>
        c.shape.kind === "page" &&
        ["rows", "data", "byGroup", "records"].includes(
          (c.shape as { rowsKey: string }).rowsKey,
        ),
    );
    expect(retired.map(([name]) => name)).toEqual([]);
  });

  /** 信封存在的唯一理由就是装服务端解析结果；一个都不查的信封声明是漏配。 */
  it("每个分页信封都至少钉了一个信封字段", () => {
    const unchecked = shapes.filter(
      ([, c]) =>
        c.shape.kind === "page" &&
        !(
          (c.shape as { envelopeFields?: readonly string[] }).envelopeFields
            ?.length ?? 0
        ),
    );
    expect(unchecked.map(([name]) => name)).toEqual([]);
  });
});
