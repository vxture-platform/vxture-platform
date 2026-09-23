/**
 * product-catalog-webhook-path.spec.ts —— 回调地址的路径必须是通则规定的那一个
 * （2026-09-13）。
 *
 * ── 这一条钉的是一条「写下来了但没有强制点」的 MUST ──
 * 通则 §C3 下发 规定所有产品的回调路径都是 `/api/webhooks/vxture`，变的只有域名。
 * 而在补上这道闸门之前，`PUT :id/webhook` 只校验协议与长度（`normalizeUrl`），
 * 上线检查第五项也只问「填了没有」。实测结果：`/api/webhooks/vxture` 在**全组织
 * 零实现**——每个产品各自取了个名字，登记、检查、投递全程绿色。
 *
 * ── 为什么闸门要在登记处 ──
 * 投递处发现路径不对已经太晚。路径不匹配最常见的表现不是 404，是落到对方前端的
 * SPA catch-all 拿回 `index.html` 和 **HTTP 200**：投递被判为送达，产品什么都没
 * 收到，开通与档位变更静默消失，两侧都不报错。登记是这件事唯一的单一咽喉。
 *
 * ── 断言落在「拒绝的理由」上，不只是「拒绝了」 ──
 * 只断言抛异常的话，把路径判据删掉之后 `normalizeUrl` 的协议校验仍会让大部分用例
 * 保持红色——那条测试就测不到自己以为在测的东西。所以每条都核对错误码与字段，
 * 并且有一条专门用「协议合法、长度合法、只有路径不对」的地址来分辨这两道校验。
 */
import type { Request } from "express";
import type { Pool, PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";
import type { VxConfigService } from "@vxture/core-config";
import type { OperatorExchangeService } from "../auth/operator-exchange.service";
import type { RequestContext } from "../types/request-context";

vi.mock("@vxture/core-config", () => ({
  VxConfigService: class VxConfigService {},
}));

import { ProductCatalogRouter } from "./product-catalog.router";

const PRODUCT_ID = "3d9f0c1e-0000-4000-8000-00000000000b";
const STANDARD = "/api/webhooks/vxture";

function makeReq(): Request & RequestContext {
  return {
    operator: { id: "op-1", displayName: null },
    capabilities: ["integration:product.manage"],
    operatorAccessToken: "operator-access-token",
    headers: {},
  } as unknown as Request & RequestContext;
}

/**
 * `productCode` 决定这个产品在不在存量登记里——闸门按产品码放行旧路径。
 * 这里让 `SELECT product_code` 回什么，就等于在测哪个产品。
 */
function makeRouter(productCode: string) {
  let written: unknown[] = [];
  const client = {
    query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
    release: vi.fn(),
  };
  const pool = {
    connect: vi.fn(async () => client as unknown as PoolClient),
    query: vi.fn(async (text: string, args?: unknown[]) => {
      if (/SELECT product_code FROM product\.products/.test(text)) {
        return { rows: [{ product_code: productCode }], rowCount: 1 };
      }
      if (/INSERT INTO product\.product_webhooks|product_webhooks/.test(text)) {
        written = args ?? [];
        return {
          rows: [
            {
              home_url: null,
              webhook_url: (args ?? [])[2] ?? null,
              webhook_secret_ref: null,
              edge_upstream: null,
              edge_domain: null,
              has_secret: false,
            },
          ],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    }),
  } as unknown as Pool;

  const router = new ProductCatalogRouter(
    pool,
    {
      platform: {
        ATLAS_API_URL: "http://atlas.test/",
        RUNOS_API_URL: "http://runos.test/",
      },
    } as unknown as VxConfigService,
    {
      getToken: vi.fn(async () => "obo"),
    } as unknown as OperatorExchangeService,
  );

  return { router, written: () => written };
}

/**
 * 把抛出来的东西摊平成 `{ code, field, message }`，不关心它是哪种异常壳。
 *
 * 两个可选字段显式带上 `| undefined`：本仓开着 `exactOptionalPropertyTypes`，
 * 「键可以不在」与「键在但值是 undefined」是两件事，而这里返回的正是后者
 * ——`inner.code ?? any.code` 两边都可能是 undefined。
 */
function captured(error: unknown): {
  code?: string | undefined;
  field?: string | undefined;
  message: string;
} {
  const any = error as {
    code?: string;
    field?: string;
    message?: string;
    response?: { code?: string; field?: string; message?: string };
    body?: { code?: string; field?: string; message?: string };
  };
  const inner = any.response ?? any.body ?? any;
  return {
    code: inner.code ?? any.code,
    field: inner.field ?? any.field,
    message: String(inner.message ?? any.message ?? error),
  };
}

async function put(productCode: string, webhookUrl: string | null) {
  const t = makeRouter(productCode);
  return t.router.putWebhook(makeReq(), PRODUCT_ID, { webhookUrl });
}

describe("PUT :id/webhook · 回调路径必须是通则规定的那一个", () => {
  it("标准路径放行", async () => {
    await expect(
      put("tenderforge", `https://tenderforge.vxture.com${STANDARD}`),
    ).resolves.toBeTruthy();
  });

  it("空值仍然放行——先存一半是这个入口的既有语义", async () => {
    await expect(put("tenderforge", null)).resolves.toBeTruthy();
  });

  /**
   * 本仓自己踩过的那个值。协议合法、长度合法、URL 也 parse 得动——
   * **只有路径不对**，所以它能把这道闸门与 `normalizeUrl` 的协议校验分辨开。
   */
  it("协议与长度都合法、只有路径不对的地址被拒，且说得出是哪个字段", async () => {
    let thrown: unknown;
    try {
      await put(
        "tenderforge",
        "https://tenderforge.vxture.com/provisioning/webhook",
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown, "路径不对必须被拒").toBeDefined();
    const e = captured(thrown);
    expect(e.code).toBe("VALIDATION_INVALID_VALUE");
    expect(e.field).toBe("webhookUrl");
    /* 报文里要出现标准路径本身——运营者读到的应当是「该填什么」，不是「这个不行」。 */
    expect(e.message).toContain(STANDARD);
  });

  it("旧的 /api/platform/... 形状同样被拒", async () => {
    await expect(
      put(
        "tenderforge",
        "https://x.vxture.com/api/platform/provisioning/webhook",
      ),
    ).rejects.toBeDefined();
  });

  it("路径对但多一段、或大小写不同，都不算命中", async () => {
    await expect(
      put("tenderforge", `https://x.vxture.com${STANDARD}/v2`),
    ).rejects.toBeDefined();
    await expect(
      put("tenderforge", "https://x.vxture.com/api/webhooks/Vxture"),
    ).rejects.toBeDefined();
  });

  it("域名随便换，路径对就行——通则说变的只有域名", async () => {
    for (const host of ["a.vxture.com", "b.example.org", "127.0.0.1:3000"]) {
      await expect(
        put("tenderforge", `http://${host}${STANDARD}`),
      ).resolves.toBeTruthy();
    }
  });

  describe("存量登记", () => {
    /* 这里写死一份名单，**是对名单的复制，不是对性质的断言**——名单少一个，
       这个用例照样绿。2026-09-23 就是这么漏的：seed 把 arda / karda 的回调也写成
       `/provisioning/webhook`，而豁免名单里没有它们，于是那两个产品的产品页
       原样按一次保存就 400，而全套测试全绿。
       真正管用的判据是「seed 登记在旧路径上的产品，都在豁免名单里」——它要同时读
       seed 与这份名单，不在本文件的视野内。补它是 follow-up。 */
    it("vxtpl / yucer / arda / karda 可以保留自己那一个旧路径", async () => {
      for (const code of ["vxtpl", "yucer", "arda", "karda"]) {
        await expect(
          put(code, `https://${code}.vxture.com/provisioning/webhook`),
        ).resolves.toBeTruthy();
      }
    });

    it("存量产品也不能改成第三个路径——豁免的是那一个值，不是「随便填」", async () => {
      let thrown: unknown;
      try {
        await put("vxtpl", "https://vxtpl.vxture.com/hooks/platform");
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeDefined();
      expect(captured(thrown).message).toContain(STANDARD);
    });

    it("存量产品迁到标准路径当然放行——这是它的迁移终点", async () => {
      await expect(
        put("vxtpl", `https://vxtpl.vxture.com${STANDARD}`),
      ).resolves.toBeTruthy();
    });

    it("不在登记里的产品一律按新规则判（D-2：新产品没有存量迁移档）", async () => {
      let thrown: unknown;
      try {
        await put(
          "some-new-agent",
          "https://x.vxture.com/provisioning/webhook",
        );
      } catch (error) {
        thrown = error;
      }
      expect(thrown, "没登记的产品不该跟着蹭豁免").toBeDefined();
      /* 报文要告诉运营者「让产品迁」，而不是暗示「来平台加一行」。 */
      expect(captured(thrown).message).toContain("迁到标准路径");
    });
  });

  it("产品不存在时报 404，不是 400——先报路径错会让人去查地址而不是查产品码", async () => {
    const client = {
      query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
      release: vi.fn(),
    };
    const pool = {
      connect: vi.fn(async () => client as unknown as PoolClient),
      query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
    } as unknown as Pool;
    const router = new ProductCatalogRouter(
      pool,
      {
        platform: {
          ATLAS_API_URL: "http://atlas.test/",
          RUNOS_API_URL: "http://runos.test/",
        },
      } as unknown as VxConfigService,
      {
        getToken: vi.fn(async () => "obo"),
      } as unknown as OperatorExchangeService,
    );
    let thrown: unknown;
    try {
      await router.putWebhook(makeReq(), PRODUCT_ID, {
        webhookUrl: "https://x.vxture.com/provisioning/webhook",
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeDefined();
    expect(captured(thrown).code).toBe("CATALOG_PRODUCT_NOT_FOUND");
  });
});
