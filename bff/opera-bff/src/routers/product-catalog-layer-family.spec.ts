/**
 * product-catalog-layer-family.spec.ts —— 分层蕴含类型族，写入面先接住（决策 3，owner 2026-10-04）。
 *
 * 钉四件事，每一件错了都没有外在症状：
 *
 *  1. **登记时分层必填**，判式 `!body.layer?.trim()`——页面「未分类」送的是 null，只查空串会放过它。
 *     改时允许缺席（缺席即不改：umbra 这类刻意不占层的行改个描述不该被迫选层），送空值一律拒。
 *  2. **L2 ↔ platform 族、L3 ↔ agent 族、undefined 与任何层相容**，与 DDL `chk_products_layer_type_family`
 *     同一张真值表。库上拒是 23514 冒成 500；这里要的是 400 带 `field:"layer"`、消息点名该有的层。
 *  3. **改时组合取「送来的 ∪ 库里的」**：只改类型不动分层，同样是分叉，同样 400。
 *  4. **POST 不再静默丢 integrationMode**：此前 INSERT 列清单没有它，一个 login_only 的新产品被登记成
 *     platform_managed、回调判「待配置」，接口回 200。
 */
import type { PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";
import { PRODUCT_TYPES } from "@vxture/core-utils";
import type { ApiError } from "../errors/api-error";

vi.mock("@vxture/core-config", () => ({
  VxConfigService: class VxConfigService {},
}));

import {
  insertProductTx,
  layerTypeFamilyConflict,
  updateProductTx,
  validateWrite,
  type ProductWriteBody,
} from "./product-catalog.router";

const PRODUCT_ID = "3d9f0c1e-0000-4000-8000-00000000000b";

function envelope(fn: () => unknown): {
  status: number;
  code: string;
  field?: string;
  message: string;
} {
  try {
    fn();
  } catch (e) {
    const err = e as ApiError;
    const body = err.getResponse() as {
      code: string;
      field?: string;
      message: string;
    };
    return { status: err.getStatus(), ...body };
  }
  throw new Error("expected a throw");
}

async function envelopeAsync(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    const err = e as ApiError;
    const body = err.getResponse() as {
      code: string;
      field?: string;
      message: string;
    };
    return { status: err.getStatus(), ...body };
  }
  throw new Error("expected a reject");
}

const core = {
  productCode: "tenderforge",
  productName: "标书智能体",
};

describe("validateWrite —— 登记时分层必填（判式与 productType 同形）", () => {
  it("不送 layer → 400 VALIDATION_REQUIRED，字段 layer", () => {
    const e = envelope(() =>
      validateWrite(
        { ...core, productType: "industry_agent" },
        { requireCore: true },
      ),
    );
    expect(e.status).toBe(400);
    expect(e.code).toBe("VALIDATION_REQUIRED");
    expect(e.field).toBe("layer");
  });

  it("送 null（页面「未分类」的形状）→ 同样 400，不被当成「没送」放过", () => {
    const e = envelope(() =>
      validateWrite(
        { ...core, productType: "industry_agent", layer: null },
        { requireCore: true },
      ),
    );
    expect(e.code).toBe("VALIDATION_REQUIRED");
    expect(e.field).toBe("layer");
  });

  it("送空白串 → 400", () => {
    const e = envelope(() =>
      validateWrite(
        { ...core, productType: "industry_agent", layer: "  " },
        { requireCore: true },
      ),
    );
    expect(e.code).toBe("VALIDATION_REQUIRED");
    expect(e.field).toBe("layer");
  });

  it("改（requireCode:false）时缺席放行——缺席即不改，umbra 改描述不被迫选层", () => {
    expect(() =>
      validateWrite(
        { productType: "general_platform", productName: "umbra" },
        { requireCore: true, requireCode: false },
      ),
    ).not.toThrow();
  });

  it("改时显式送 null → 400：分层没有「清空」这条路", () => {
    const e = envelope(() =>
      validateWrite(
        { productType: "industry_agent", productName: "x", layer: null },
        { requireCore: true, requireCode: false },
      ),
    );
    expect(e.code).toBe("VALIDATION_REQUIRED");
    expect(e.field).toBe("layer");
  });
});

describe("validateWrite —— 分层蕴含类型族", () => {
  const reg = (over: Partial<ProductWriteBody>) =>
    validateWrite({ ...core, ...over }, { requireCore: true });

  it("L3 + general_platform → 400 VALIDATION_INVALID_VALUE，字段 layer，消息点名「域平台必须是 L2」", () => {
    const e = envelope(() =>
      reg({ productType: "general_platform", layer: "L3" }),
    );
    expect(e.status).toBe(400);
    expect(e.code).toBe("VALIDATION_INVALID_VALUE");
    expect(e.field).toBe("layer");
    expect(e.message).toContain("域平台必须是 L2");
    expect(e.message).toContain("general_platform");
  });

  it("L2 + industry_agent → 400，消息点名「智能体必须是 L3」", () => {
    const e = envelope(() =>
      reg({ productType: "industry_agent", layer: "L2" }),
    );
    expect(e.code).toBe("VALIDATION_INVALID_VALUE");
    expect(e.field).toBe("layer");
    expect(e.message).toContain("智能体必须是 L3");
    expect(e.message).toContain("industry_agent");
  });

  it("L3 + industry_agent / L2 + general_platform → 放行", () => {
    expect(() =>
      reg({ productType: "industry_agent", layer: "L3" }),
    ).not.toThrow();
    expect(() =>
      reg({ productType: "general_agent", layer: "L3" }),
    ).not.toThrow();
    expect(() =>
      reg({ productType: "general_platform", layer: "L2" }),
    ).not.toThrow();
    expect(() =>
      reg({ productType: "industry_platform", layer: "L2" }),
    ).not.toThrow();
  });

  it("undefined 型与任何层相容（D10 吸收）", () => {
    expect(() => reg({ productType: "undefined", layer: "L3" })).not.toThrow();
    expect(() => reg({ productType: "undefined", layer: "L2" })).not.toThrow();
  });

  it("值域错误先于蕴含错误：layer=L1 仍是「不可选」而不是「族不符」", () => {
    const e = envelope(() =>
      reg({ productType: "general_platform", layer: "L1" }),
    );
    expect(e.code).toBe("VALIDATION_INVALID_VALUE");
    expect(e.message).toContain("L2, L3");
  });
});

describe("layerTypeFamilyConflict —— 与受管枚举对表", () => {
  it("除 undefined 外，每个受管类型恰有一个相容的可选层", () => {
    for (const t of PRODUCT_TYPES) {
      if (t === "undefined") continue;
      const ok = ["L2", "L3"].filter(
        (l) => layerTypeFamilyConflict(l, t) === null,
      );
      expect(ok, t).toHaveLength(1);
    }
  });

  it("任一边为空 ⇒ 相容（必填由别处管）", () => {
    expect(layerTypeFamilyConflict(null, "industry_agent")).toBeNull();
    expect(layerTypeFamilyConflict("L3", undefined)).toBeNull();
    expect(layerTypeFamilyConflict("", "")).toBeNull();
  });

  it("历史裸值 agent 归 agent 族（与 productTypeFamily 同判）；枚举外无族的值挂层 → 点名推不出", () => {
    expect(layerTypeFamilyConflict("L3", "agent")).toBeNull();
    expect(layerTypeFamilyConflict("L2", "agent")).toContain("智能体必须是 L3");
    expect(layerTypeFamilyConflict("L3", "foo")).toContain("推不出");
  });
});

/** 捕获 INSERT / UPDATE 的 SQL 与参数；其余查询回空。 */
function captureClient(opts: {
  stored?: { product_type: string; layer: string | null };
  failWrite?: { code: string; constraint?: string };
}) {
  let sql = "";
  let params: unknown[] = [];
  let writes = 0;
  const client = {
    query: vi.fn(async (text: string, args?: unknown[]) => {
      if (/SELECT product_code, status, product_type, layer/.test(text)) {
        return {
          rows: [
            {
              product_code: "vxtpl",
              status: "draft",
              product_type: opts.stored?.product_type ?? "general_agent",
              /* 不用 ?? ：库里 NULL 层是 umbra 的真实形状，不能被兜成 L3。 */
              layer: opts.stored ? opts.stored.layer : "L3",
            },
          ],
          rowCount: 1,
        };
      }
      if (
        /INSERT INTO product\.products/.test(text) ||
        /UPDATE product\.products/.test(text)
      ) {
        writes += 1;
        sql = text;
        params = args ?? [];
        if (opts.failWrite) {
          throw Object.assign(new Error("check"), opts.failWrite);
        }
        const im =
          text.includes("integration_mode") && /INSERT/.test(text)
            ? (params[15] as string)
            : "platform_managed";
        return {
          rows: [{ id: PRODUCT_ID, integration_mode: im, surfaces: [] }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    }),
    release: vi.fn(),
  };
  return {
    client: client as unknown as PoolClient,
    get sql() {
      return sql;
    },
    get params() {
      return params;
    },
    get writes() {
      return writes;
    },
  };
}

describe("insertProductTx —— POST 不再静默丢 integrationMode", () => {
  const body: ProductWriteBody = {
    ...core,
    productType: "industry_agent",
    layer: "L3",
  };

  it("INSERT 列清单含 integration_mode，login_only 原样落参并读回", async () => {
    const c = captureClient({});
    const rec = await insertProductTx(
      c.client,
      { ...body, integrationMode: "login_only" },
      "op-1",
    );
    expect(c.sql).toMatch(/integration_mode/);
    /* 列清单与 VALUES 的编号对位：integration_mode 是第 16 个占位符。 */
    const cols = /INSERT INTO product\.products \(([\s\S]*?)\)/
      .exec(c.sql)![1]!
      .split(",")
      .map((s) => s.trim());
    expect(cols.indexOf("integration_mode")).toBe(17);
    expect(c.params[15]).toBe("login_only");
    expect(rec.integrationMode).toBe("login_only");
  });

  it("不送 integrationMode → 落默认 platform_managed（与 updateProductTx 同一个默认值）", async () => {
    const c = captureClient({});
    await insertProductTx(c.client, body, "op-1");
    expect(c.params[15]).toBe("platform_managed");
  });

  it("库上 chk_products_layer_type_family 拒了 → 400 字段 layer，不冒 500", async () => {
    const c = captureClient({
      failWrite: {
        code: "23514",
        constraint: "chk_products_layer_type_family",
      },
    });
    const e = await envelopeAsync(insertProductTx(c.client, body, "op-1"));
    expect(e.status).toBe(400);
    expect(e.field).toBe("layer");
    expect(e.message).toContain("chk_products_layer_type_family");
  });

  it("别的 CHECK 拒了照样原样抛（不替别的约束翻译）", async () => {
    const c = captureClient({
      failWrite: { code: "23514", constraint: "chk_products_origin" },
    });
    await expect(insertProductTx(c.client, body, "op-1")).rejects.toMatchObject(
      {
        constraint: "chk_products_origin",
      },
    );
  });
});

describe("updateProductTx —— 组合取「送来的 ∪ 库里的」", () => {
  it("库里 L3，只把类型改成 general_platform（不送 layer）→ 400 字段 layer，UPDATE 没发出去", async () => {
    const c = captureClient({
      stored: { product_type: "general_agent", layer: "L3" },
    });
    const e = await envelopeAsync(
      updateProductTx(
        c.client,
        PRODUCT_ID,
        { productType: "general_platform", productName: "x" },
        "op-1",
      ),
    );
    expect(e.status).toBe(400);
    expect(e.code).toBe("VALIDATION_INVALID_VALUE");
    expect(e.field).toBe("layer");
    expect(e.message).toContain("域平台必须是 L2");
    expect(c.writes).toBe(0);
  });

  it("库里 L3，类型改成另一个智能体型 → 放行", async () => {
    const c = captureClient({
      stored: { product_type: "general_agent", layer: "L3" },
    });
    await updateProductTx(
      c.client,
      PRODUCT_ID,
      { productType: "industry_agent", productName: "x" },
      "op-1",
    );
    expect(c.writes).toBe(1);
  });

  it("类型与层一起改成相容的组合 → 放行（送来的覆盖库里的）", async () => {
    const c = captureClient({
      stored: { product_type: "general_agent", layer: "L3" },
    });
    await updateProductTx(
      c.client,
      PRODUCT_ID,
      { productType: "general_platform", productName: "x", layer: "L2" },
      "op-1",
    );
    expect(c.writes).toBe(1);
  });

  it("库里没分层（umbra 的形状），改类型 → 放行（NULL 层与任何类型相容）", async () => {
    const c = captureClient({
      stored: { product_type: "general_platform", layer: null },
    });
    await updateProductTx(
      c.client,
      PRODUCT_ID,
      { productType: "industry_platform", productName: "umbra" },
      "op-1",
    );
    expect(c.writes).toBe(1);
  });

  it("库上 CHECK 拒了 → 400 字段 layer", async () => {
    const c = captureClient({
      stored: { product_type: "general_agent", layer: "L3" },
      failWrite: {
        code: "23514",
        constraint: "chk_products_layer_type_family",
      },
    });
    const e = await envelopeAsync(
      updateProductTx(
        c.client,
        PRODUCT_ID,
        { productType: "industry_agent", productName: "x" },
        "op-1",
      ),
    );
    expect(e.status).toBe(400);
    expect(e.field).toBe("layer");
  });
});
