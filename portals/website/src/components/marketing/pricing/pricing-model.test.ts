import { describe, expect, it } from "vitest";
import type {
  ProductPlanOption,
  ProductPlansResponse,
} from "@/api/product-plans.api";
import { buildPricingModel } from "./pricing-model";

/*
 * 邀请档进阶梯（owner 2026-09-28）。此前 BFF 阶梯只回公开档，只有邀请档的产品在这里
 * 得到 null → 页面一块空态，档位、价格、权益全看不见。现在邀请档也是档：每档带 access，
 * 模型照建、阶梯照画，CTA 由卡片按 access 换。三面：只有邀请档 / 混卖 / 只有公开档。
 */

const PRODUCT: ProductPlansResponse["product"] = {
  code: "arda",
  name: "Arda",
  nick: null,
  releaseVersion: null,
  releaseStage: "stable",
};

function plan(
  tier: string,
  access: ProductPlanOption["access"],
): ProductPlanOption {
  return {
    planCode: `arda-${tier}`,
    planName: `Arda ${tier}`,
    description: null,
    tier,
    access,
    features: [],
    quota: null,
    seats: null,
    prices: [
      { cycleUnit: "month", cycleCount: 1, price: "9.00", currency: "CNY" },
    ],
  };
}

function response(
  plans: ProductPlanOption[],
  subscribeAccess: ProductPlansResponse["subscribeAccess"],
): ProductPlansResponse {
  return { product: PRODUCT, plans, subscribeAccess, maintenance: null };
}

describe("buildPricingModel · 邀请档", () => {
  it("只有邀请档 → 仍建出模型，档带 access invite（不再是空态）", () => {
    const model = buildPricingModel(
      response([plan("business", "invite")], "invite"),
      null,
    );
    expect(model).not.toBeNull();
    expect(model?.plans.map((p) => [p.tier, p.access])).toEqual([
      ["business", "invite"],
    ]);
  });

  it("公开档与邀请档并存 → 两种 access 各归各档，次序照 BFF", () => {
    const model = buildPricingModel(
      response([plan("pro", "public"), plan("business", "invite")], "public"),
      null,
    );
    expect(model?.plans.map((p) => [p.tier, p.access])).toEqual([
      ["pro", "public"],
      ["business", "invite"],
    ]);
  });

  it("只有公开档 → 与此前一样，access public", () => {
    const model = buildPricingModel(
      response([plan("pro", "public")], "public"),
      null,
    );
    expect(model?.plans.map((p) => p.access)).toEqual(["public"]);
  });

  it("一档都没有 → null（这才是空态该出现的唯一情形）", () => {
    expect(buildPricingModel(response([], "none"), null)).toBeNull();
  });

  it("preview 还没开卖 → null，哪怕阶梯里有邀请档", () => {
    const data = response([plan("business", "invite")], "none");
    expect(
      buildPricingModel(
        { ...data, product: { ...PRODUCT, releaseStage: "preview" } },
        null,
      ),
    ).toBeNull();
  });
});
