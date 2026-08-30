/**
 * product-health.spec.ts — 服务状态页数据侧的单测。
 *
 * 三组：
 *   1. `groupProductChannels`：清单以 product.products 为主表这条口径（2026-08-30，
 *      40-product-registry.md §4）——没有客户端的产品必须出现、渠道只认
 *      release_channel、层级只认 product_type。这些都是"漏了不报错、只是表少一行"
 *      的那类缺陷，所以钉在测试里。
 *   2. `readinessFromBody`、3. `readChecks`：就绪探测里两条**翻译**。词表对不齐的表现
 *      是「页面绿着 / 栏目空着」，不是报错。两条都由 2026-08-23 的 atlas / runos
 *      联调实测反推：atlas `/readyz` 恒回 HTTP 200，坏了也只体现在 body 的
 *      `status: "blocked"`；atlas 的 `checks` 值是对象（`{status,latencyMs}`）。
 */

import { describe, expect, it } from "vitest";

import {
  groupProductChannels,
  layerFromProductType,
  readChecks,
  readinessFromBody,
  type ProductChannelRow,
  channelProbeMode,
  notApplicableChannel,
} from "./product-health.router";

function row(
  overrides: Partial<ProductChannelRow> & { product_code: string },
): ProductChannelRow {
  return {
    product_id: `id-${overrides.product_code}`,
    product_name: overrides.product_code,
    product_type: null,
    product_status: "active",
    client_id: null,
    release_channel: null,
    redirect_uris: null,
    ...overrides,
  };
}

describe("groupProductChannels —— 清单以产品目录为主表", () => {
  it("没有任何客户端的产品也在清单里，三个渠道都为空（未接入，不是不存在）", () => {
    const groups = groupProductChannels([
      row({ product_code: "demo-insight", product_status: "draft" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.state).toBe("draft");
    expect(groups[0]?.channels).toEqual({
      stable: null,
      beta: null,
      canary: null,
    });
  });

  it("渠道只认 release_channel；origin 是回调地址去掉路径", () => {
    const groups = groupProductChannels([
      row({
        product_code: "arda",
        client_id: "arda",
        release_channel: "stable",
        redirect_uris: ["https://arda.vxture.com/auth/callback"],
      }),
      row({
        product_code: "arda",
        client_id: "arda-beta",
        release_channel: "beta",
        redirect_uris: ["https://beta-arda.vxture.com/auth/callback"],
      }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.channels.stable).toEqual({
      clientId: "arda",
      origin: "https://arda.vxture.com",
    });
    expect(groups[0]?.channels.beta).toEqual({
      clientId: "arda-beta",
      origin: "https://beta-arda.vxture.com",
    });
    expect(groups[0]?.channels.canary).toBeNull();
  });

  /** 派生路径已退役：回调白名单里多一个地址，不等于登记了一个渠道。 */
  it("stable 客户端的第二个 redirect_uri 不再被读成 beta", () => {
    const groups = groupProductChannels([
      row({
        product_code: "runos",
        client_id: "runos",
        release_channel: "stable",
        redirect_uris: [
          "https://runos.vxture.com/auth/callback",
          "https://beta-runos.vxture.com/auth/callback",
        ],
      }),
    ]);
    expect(groups[0]?.channels.stable?.origin).toBe("https://runos.vxture.com");
    expect(groups[0]?.channels.beta).toBeNull();
  });

  it("同一渠道多个客户端时取行集里先到的（SQL 已按登记时间升序）", () => {
    const groups = groupProductChannels([
      row({
        product_code: "karda",
        client_id: "karda",
        release_channel: "stable",
        redirect_uris: ["https://karda.vxture.com/auth/callback"],
      }),
      row({
        product_code: "karda",
        client_id: "karda-web2",
        release_channel: "stable",
        redirect_uris: ["https://karda2.vxture.com/auth/callback"],
      }),
    ]);
    expect(groups[0]?.channels.stable?.clientId).toBe("karda");
  });

  it("回调地址解析不出 origin 时渠道保留客户端、origin 为 null（登记了但没法探）", () => {
    const groups = groupProductChannels([
      row({
        product_code: "vxtpl",
        client_id: "vxtpl",
        release_channel: "stable",
        redirect_uris: ["not a url"],
      }),
    ]);
    expect(groups[0]?.channels.stable).toEqual({
      clientId: "vxtpl",
      origin: null,
    });
  });

  it("多个产品各自成组，顺序随行集", () => {
    const groups = groupProductChannels([
      row({ product_code: "atlas", product_type: "model_platform" }),
      row({ product_code: "ruyin", product_type: "client" }),
    ]);
    expect(groups.map((g) => g.productCode)).toEqual(["atlas", "ruyin"]);
  });
});

describe("layerFromProductType —— 层级只由 product_type 判定", () => {
  it("矩阵 §2 的六类各归其位，agent 是 L3", () => {
    expect(layerFromProductType("model_platform")).toBe("L1");
    expect(layerFromProductType("capability_platform")).toBe("L1");
    expect(layerFromProductType("data_platform")).toBe("L2");
    expect(layerFromProductType("knowledge_platform")).toBe("L2");
    expect(layerFromProductType("agent")).toBe("L3");
    expect(layerFromProductType("client")).toBe("client");
    expect(layerFromProductType("external")).toBe("external");
  });

  it("没填或填了矩阵外的类型 → 未分类，没有按产品码的回退表", () => {
    expect(layerFromProductType(null)).toBe("unclassified");
    expect(layerFromProductType("something")).toBe("unclassified");
  });
});

describe("readinessFromBody —— 产品自报的就绪词 → 本页三档", () => {
  it("认 025 标准的三个词", () => {
    expect(readinessFromBody("ready", 200)).toBe("ready");
    expect(readinessFromBody("degraded", 200)).toBe("degraded");
    expect(readinessFromBody("blocked", 200)).toBe("fail");
  });

  /**
   * 这条是整个函数存在的理由。atlas 的 `/readyz` handler 不改状态码，所以数据库挂了
   * 也是 **HTTP 200 + `status:"blocked"`**；旧实现不认 `blocked`，落到状态码兜底，
   * 把它判成 `ready`——服务状态页对着一个坏掉的 atlas 显示「就绪」。
   */
  it("blocked 但 HTTP 200（atlas 的形状）判成 fail，不是 ready", () => {
    expect(readinessFromBody("blocked", 200)).toBe("fail");
  });

  it("runos 的形状（blocked + 503）也是 fail", () => {
    expect(readinessFromBody("blocked", 503)).toBe("fail");
  });

  it("`fail` 继续认——它是本页对外的档位名", () => {
    expect(readinessFromBody("fail", 200)).toBe("fail");
  });

  it("没有可辨认的自报状态时才回落到 HTTP 状态码", () => {
    expect(readinessFromBody(null, 200)).toBe("ready");
    expect(readinessFromBody(null, 503)).toBe("fail");
    expect(readinessFromBody("something-else", 500)).toBe("fail");
  });
});

describe("readChecks —— 逐依赖明细", () => {
  /** atlas 的真实形状：值是对象。旧实现只收字符串，于是整栏恒为空。 */
  it("对象形状的 check 取 status，并带上延迟", () => {
    expect(
      readChecks({
        checks: {
          database: { status: "pass", latencyMs: 2 },
          modelRegistry: { status: "pass", latencyMs: 109, activeModels: 87 },
        },
      }),
    ).toEqual({ database: "pass 2ms", modelRegistry: "pass 109ms" });
  });

  it("字符串形状原样收（另一种合法写法）", () => {
    expect(readChecks({ checks: { redis: "pass" } })).toEqual({
      redis: "pass",
    });
  });

  it("没有 status 的对象跳过，不编一个出来", () => {
    expect(readChecks({ checks: { weird: { latencyMs: 3 } } })).toBeNull();
  });

  it("没有 checks / 形状不对时回 null，不是空对象", () => {
    expect(readChecks(null)).toBeNull();
    expect(readChecks({})).toBeNull();
    expect(readChecks({ checks: ["a"] })).toBeNull();
  });
});

describe("channelProbeMode —— client 型产品不探测", () => {
  const registered = { clientId: "ruyin", origin: "http://127.0.0.1" };

  it("client 层 + 已登记渠道 → 不适用（回调是 loopback，探到的是自己）", () => {
    expect(channelProbeMode("client", registered)).toBe("not_applicable");
  });

  it("client 层 + 未登记渠道 → 照常走 probe（结果是未配置，登记与否是另一个事实）", () => {
    expect(channelProbeMode("client", null)).toBe("probe");
  });

  it("其它层一律探测，包括未分类", () => {
    for (const layer of [
      "L1",
      "L2",
      "L3",
      "external",
      "unclassified",
    ] as const) {
      expect(channelProbeMode(layer, registered)).toBe("probe");
    }
  });
});

describe("notApplicableChannel —— 形状与探测结果同构", () => {
  it("两列都是 not_applicable，保留 clientId/origin，不带路径与错误", () => {
    const out = notApplicableChannel({
      clientId: "ruyin-beta",
      origin: "http://127.0.0.1",
    });
    expect(out.clientId).toBe("ruyin-beta");
    expect(out.origin).toBe("http://127.0.0.1");
    expect(out.health.status).toBe("not_applicable");
    expect(out.status.status).toBe("not_applicable");
    expect(out.health.path).toBeNull();
    expect(out.health.error).toBeNull();
    expect(out.status.checks).toBeNull();
    expect(out.health.checkedAt).toBe(out.status.checkedAt);
  });
});
