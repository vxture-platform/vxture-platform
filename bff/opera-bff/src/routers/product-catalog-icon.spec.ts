/**
 * product-catalog-icon.spec.ts —— 产品图标的四条判据（2026-09-11）。
 *
 * 图标改为平台托管之后，三个端点（传 / 取 / 删）各有一条**只会冒成 500** 的路径，
 * 而 500 在界面上和「保存失败」长得一模一样：
 *
 *   1. **SVG 要在入口就停**。它可以带 `<script>`，从 console 自己的域名发出去等于
 *      存储型 XSS 且带着客户会话。库上有 CHECK 兜底，但那是 500；这里要 400 且点名
 *      字段。**顺带钉住三种位图是收的**——只测拒绝的话，把 MIME 列表整个写错也是绿的。
 *
 *   2. **超限要按字节判，不是按 base64 长度判**。base64 比原文长 1/3，拿编码后的
 *      长度去比 256KB，会把一张 200KB 的合法图拒掉。
 *
 *   3. **垃圾 base64 判空才发现得了**。`Buffer.from(x, "base64")` 对非法输入
 *      **不抛**——它跳过非法字符返回一个短 buffer。不判空的话，一串乱码会被当成
 *      一张 0 字节的图写进库，库上的 `byte_size > 0` 再把它变成 500。
 *
 *   4. **路径参数先判形状再挑列**。三条都双接受 id 或产品码：把产品码喂给 `uuid`
 *      列是 `22P02`，那是**错误不是零行**，于是「查不到」变成 500。这一条尤其容易
 *      回潮——console 那边的同一张图是按产品码寻址的，两边不一致会诱人拿码来试。
 */
import { HttpException } from "@nestjs/common";
import type { Request } from "express";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import type { VxConfigService } from "@vxture/core-config";
import type { OperatorExchangeService } from "../auth/operator-exchange.service";
import type { RequestContext } from "../types/request-context";

vi.mock("@vxture/core-config", () => ({
  VxConfigService: class VxConfigService {},
}));

import { ProductCatalogRouter } from "./product-catalog.router";

const PRODUCT_ID = "3d9f0c1e-0000-4000-8000-00000000000a";
const PNG_1PX_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function makeReq(): Request & RequestContext {
  return {
    operator: { id: "op-1", displayName: null },
    capabilities: ["platform:product.manage"],
    operatorAccessToken: "operator-access-token",
    headers: {},
  } as unknown as Request & RequestContext;
}

/** 记下真跑过的 SQL：「拦住了」等于写没发生，只看状态码会漏掉「报了也写了」。 */
function makePool(opts: { readonly found?: boolean } = {}) {
  const sqls: string[] = [];
  const params: unknown[][] = [];
  const pool = {
    query: vi.fn(async (sql: string, args?: unknown[]) => {
      sqls.push(sql);
      params.push(args ?? []);
      if (opts.found === false) return { rows: [], rowCount: 0 };
      if (/INSERT INTO product\.product_icons/.test(sql)) {
        return {
          rows: [{ byte_size: 70, mime_type: "image/png" }],
          rowCount: 1,
        };
      }
      if (/FROM product\.product_icons/.test(sql)) {
        return {
          rows: [
            {
              mime_type: "image/png",
              bytes: Buffer.from("x"),
              checksum: "abc123",
            },
          ],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 1 };
    }),
  };
  return { pool: pool as unknown as Pool, sqls, params };
}

function makeRouter(pool: Pool) {
  return new ProductCatalogRouter(
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
}

/** 假的 express Response：只需要 `set` 被调到，以及能读回头。 */
function makeRes() {
  const headers: Record<string, string> = {};
  return {
    headers,
    res: {
      set: (h: Record<string, string>) => Object.assign(headers, h),
    } as never,
  };
}

async function expectHttp(
  run: () => Promise<unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  try {
    await run();
  } catch (e) {
    const err = e as HttpException;
    expect(err).toBeInstanceOf(HttpException);
    return {
      status: err.getStatus(),
      body: err.getResponse() as Record<string, unknown>,
    };
  }
  throw new Error("本该抛，却过了");
}

describe("产品图标 · 上传", () => {
  it("SVG 被拒，400 且点名 mimeType，一行都没写", async () => {
    const { pool, sqls } = makePool();
    const out = await expectHttp(() =>
      makeRouter(pool).putIcon(makeReq(), PRODUCT_ID, {
        mimeType: "image/svg+xml",
        dataBase64: Buffer.from("<svg/>").toString("base64"),
      }),
    );
    expect(out.status).toBe(400);
    expect(out.body["field"]).toBe("mimeType");
    /* 关键：没有任何一条 SQL 跑过。库上的 CHECK 是兜底，不是第一道。 */
    expect(sqls).toHaveLength(0);
  });

  /* 只测「SVG 被拒」的话，把 MIME 列表整个写错（比如漏掉 webp）也是绿的。 */
  it.each(["image/png", "image/webp", "image/jpeg"])("%s 收", async (mime) => {
    const { pool } = makePool();
    await expect(
      makeRouter(pool).putIcon(makeReq(), PRODUCT_ID, {
        mimeType: mime,
        dataBase64: PNG_1PX_B64,
      }),
    ).resolves.toMatchObject({ mimeType: "image/png" });
  });

  it("超限按解码后的字节判——base64 比原文长 1/3，按编码长度判会误拒合法图", async () => {
    const { pool, sqls } = makePool();
    /* 原文 200KB（合法），base64 之后约 267KB（> 256KB）。
       按编码长度判的实现会在这里把它拒掉。 */
    const ok200kb = Buffer.alloc(200 * 1024, 7).toString("base64");
    expect(ok200kb.length).toBeGreaterThan(262144);
    await expect(
      makeRouter(pool).putIcon(makeReq(), PRODUCT_ID, {
        mimeType: "image/png",
        dataBase64: ok200kb,
      }),
    ).resolves.toBeDefined();

    /* 原文 300KB：这个才该拒。 */
    const tooBig = Buffer.alloc(300 * 1024, 7).toString("base64");
    const before = sqls.length;
    const out = await expectHttp(() =>
      makeRouter(pool).putIcon(makeReq(), PRODUCT_ID, {
        mimeType: "image/png",
        dataBase64: tooBig,
      }),
    );
    expect(out.status).toBe(400);
    expect(out.body["field"]).toBe("dataBase64");
    expect(sqls).toHaveLength(before);
  });

  it("垃圾 base64 → 400，不会被当成 0 字节的图写进库", async () => {
    const { pool, sqls } = makePool();
    const out = await expectHttp(() =>
      makeRouter(pool).putIcon(makeReq(), PRODUCT_ID, {
        mimeType: "image/png",
        dataBase64: "!!!!",
      }),
    );
    expect(out.status).toBe(400);
    expect(out.body["field"]).toBe("dataBase64");
    expect(sqls).toHaveLength(0);
  });

  it("产品不存在 → 404，而不是外键违例的 500", async () => {
    const { pool } = makePool({ found: false });
    const out = await expectHttp(() =>
      makeRouter(pool).putIcon(makeReq(), PRODUCT_ID, {
        mimeType: "image/png",
        dataBase64: PNG_1PX_B64,
      }),
    );
    expect(out.status).toBe(404);
  });
});

describe("产品图标 · 路径参数双接受", () => {
  /* 这三条各覆盖一个端点：同一个判据在三处各写了一遍，漏掉任何一处都是 500。 */
  it.each([
    [
      "上传",
      (r: ProductCatalogRouter, k: string) =>
        r.putIcon(makeReq(), k, {
          mimeType: "image/png",
          dataBase64: PNG_1PX_B64,
        }),
    ],
    [
      "取",
      (r: ProductCatalogRouter, k: string) =>
        r.getIcon(makeReq(), k, makeRes().res),
    ],
    ["删", (r: ProductCatalogRouter, k: string) => r.deleteIcon(makeReq(), k)],
  ])("%s：uuid 走 p.id，产品码走 p.product_code", async (_name, call) => {
    for (const [key, column] of [
      [PRODUCT_ID, "p.id = $1"],
      ["vxtpl", "p.product_code = $1"],
    ] as const) {
      const { pool, sqls, params } = makePool();
      await call(makeRouter(pool), key);
      const sql = sqls.join("\n");
      expect(sql).toContain(column);
      /* 反面也钉住：判成 uuid 就不该出现按码查的那一支，反之亦然。
         两支都拼进去的实现（比如 `OR`）在 22P02 上照样炸。 */
      expect(sql).not.toContain(
        column === "p.id = $1" ? "p.product_code = $1" : "p.id = $1",
      );
      /* 值始终走参数，不进 SQL 文本。 */
      expect(params[0]?.[0]).toBe(key);
      expect(sql).not.toContain(key);
    }
  });
});

describe("产品图标 · 取", () => {
  it("带 immutable 缓存、ETag 与 nosniff", async () => {
    const { pool } = makePool();
    const { res, headers } = makeRes();
    await makeRouter(pool).getIcon(makeReq(), PRODUCT_ID, res);
    /* 地址上带内容哈希，所以同一个地址的内容永不改变——这是能缓存一年的前提。 */
    expect(headers["Cache-Control"]).toContain("immutable");
    expect(headers["ETag"]).toBe('"abc123"');
    /* 用户上传的字节从我们自己的域名发出去，必须禁止浏览器改判类型。 */
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
  });

  it("没传过图 → 404（界面据此回落到字母牌）", async () => {
    const { pool } = makePool({ found: false });
    const out = await expectHttp(() =>
      makeRouter(pool).getIcon(makeReq(), PRODUCT_ID, makeRes().res),
    );
    expect(out.status).toBe(404);
  });
});
