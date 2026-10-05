/**
 * layer-field.test.ts —— 「产品分层」必填这件事在页面上有三半：选项里没有空档、类型会把层
 * 预选上、空值不送（owner 2026-10-04，决策 3 D2）。三半各缺一半的表现都不是报错：
 * 缺第一半是运营能选「未分类」然后被登记处 400；缺第二半是每个智能体都要手选一次 L3；
 * 缺第三半是送 null 在登记时被拒、在改 umbra 时被拒——「未分类」成了一个按下去就失败的死控件。
 */
import { describe, expect, it } from "vitest";
import { PRODUCT_TYPES } from "@vxture/core-utils";
import { PRODUCT_LAYER_CHOICES } from "@vxture-platform/shared";
import { impliedLayerForType, layerOptions, layerPayload } from "./layer-field";

const LABELS = { unclassified: "未分类" };

describe("layerOptions —— 登记时没有「未分类」", () => {
  it("新建：只有可选的层，没有空档；中文", () => {
    const opts = layerOptions(
      { isCreate: true, currentLayer: null },
      "zh",
      LABELS,
    );
    expect(opts.map((o) => o.value)).toEqual([...PRODUCT_LAYER_CHOICES]);
    expect(opts.some((o) => o.value === "")).toBe(false);
    expect(opts.map((o) => o.label)).toEqual(["L2 · 域平台", "L3 · 智能体"]);
  });

  it("新建：英文标签同一份值域", () => {
    const opts = layerOptions({ isCreate: true, currentLayer: null }, "en", {
      unclassified: "Uncategorized",
    });
    expect(opts.map((o) => o.label)).toEqual([
      "L2 · Domain platform",
      "L3 · Agent",
    ]);
    expect(opts.some((o) => o.value === "")).toBe(false);
  });

  it("改一个已分层的产品：没有「未分类」——分层没有清空这条路", () => {
    const opts = layerOptions(
      { isCreate: false, currentLayer: "L3" },
      "zh",
      LABELS,
    );
    expect(opts.map((o) => o.value)).toEqual([...PRODUCT_LAYER_CHOICES]);
  });

  it("改一个还没分层的产品（umbra 的形状）：「未分类」作为现值排首位，两种语言都按调用方给的词", () => {
    const zh = layerOptions(
      { isCreate: false, currentLayer: null },
      "zh",
      LABELS,
    );
    expect(zh[0]).toEqual({ value: "", label: "未分类" });
    expect(zh.slice(1).map((o) => o.value)).toEqual([...PRODUCT_LAYER_CHOICES]);
    const en = layerOptions({ isCreate: false, currentLayer: "" }, "en", {
      unclassified: "Uncategorized",
    });
    expect(en[0]).toEqual({ value: "", label: "Uncategorized" });
  });

  it("L1 永远不在下拉里（活着的产品不能是 L1）", () => {
    for (const ctx of [
      { isCreate: true, currentLayer: null },
      { isCreate: false, currentLayer: null },
      { isCreate: false, currentLayer: "L2" },
    ]) {
      expect(
        layerOptions(ctx, "zh", LABELS).some((o) => o.value === "L1"),
      ).toBe(false);
    }
  });
});

describe("impliedLayerForType —— 类型蕴含层，与 DDL chk_products_layer_type_family 同一张表", () => {
  it("智能体族 ⇒ L3，平台族 ⇒ L2，undefined 推不出", () => {
    expect(impliedLayerForType("general_agent")).toBe("L3");
    expect(impliedLayerForType("industry_agent")).toBe("L3");
    expect(impliedLayerForType("general_platform")).toBe("L2");
    expect(impliedLayerForType("industry_platform")).toBe("L2");
    expect(impliedLayerForType("undefined")).toBeNull();
    expect(impliedLayerForType("")).toBeNull();
  });

  it("受管枚举里除 undefined 外每个值都推得出层——新加一个推不出的类型，这里红", () => {
    for (const t of PRODUCT_TYPES) {
      if (t === "undefined") continue;
      expect(impliedLayerForType(t), t).not.toBeNull();
    }
  });
});

describe("layerPayload —— 空值缺席，不送 null", () => {
  it("有值带键", () => {
    expect(layerPayload("L3")).toEqual({ layer: "L3" });
    expect(layerPayload(" L2 ")).toEqual({ layer: "L2" });
  });

  it("空串 / 空白 ⇒ 没有 layer 键（缺席即不改，umbra 改描述不被迫选层）", () => {
    expect(layerPayload("")).toEqual({});
    expect("layer" in layerPayload("   ")).toBe(false);
  });
});
