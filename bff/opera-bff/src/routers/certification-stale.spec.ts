/**
 * certification-stale.spec.ts —— 认证失效的三条性质。
 *
 * 失效是**静默**的：标错了没有异常，只是一条本该拦住的发布被放行、或者一条本该有效
 * 的认证被作废让人白重跑一遍。所以这里钉的全是「错了不会报错」的事：
 *
 *  1. **只动当前有效的那一条。** 历史台账是历史，不该被后来的配置变更追溯改写——
 *     「这个产品曾经在什么时候、对哪个契约版本认过」是事后要答的问题。
 *  2. **没有有效认证时是 no-op，不抛。** 调用方是「改回调地址」这类正常运营动作，
 *     不能因为「这个产品还没认证过」就让保存失败。
 *  3. **值域不收 `upstream_grant_revoked`。** 那不是契约变更：认证那句「T 时刻这条链
 *     跑通过」仍然成立，断的是运行时，归运行健康。留一个没有写入方的值，正是
 *     `operator_grant` 当年那个坑——CHECK 里有、全仓零写入路径，于是一条注释理直气壮
 *     地写着两条并不存在的路。
 */
import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";

import {
  isWebhookUrlChanged,
  markCertificationStale,
  type CertificationStaleReason,
} from "./certification-stale";

const PRODUCT_ID = "3d9f0c1e-0000-4000-8000-0000000000aa";

function makePool(rowCount: number) {
  const calls: { text: string; args: unknown[] }[] = [];
  const query = vi.fn(async (text: string, args?: unknown[]) => {
    calls.push({ text, args: args ?? [] });
    return { rows: [], rowCount };
  });
  return { pool: { query } as unknown as Pool, calls };
}

describe("markCertificationStale", () => {
  it("只挑当前有效的那一条：certified + 未 stale + 最近的一条", async () => {
    const { pool, calls } = makePool(1);
    const n = await markCertificationStale(pool, PRODUCT_ID, "webhook_changed");
    expect(n).toBe(1);

    const sql = calls[0]!.text;
    /* 三个条件缺一不可：
       少了 verdict='certified' 会把一条还在跑的认证标成失效；
       少了 stale_reason IS NULL 会反复改写同一条的原因（最后一次覆盖第一次，
         而第一次才是真正让它失效的那件事）；
       少了 ORDER BY + LIMIT 1 会把这个产品的**全部**历史台账一次刷掉。 */
    expect(sql).toContain("verdict = 'certified'");
    expect(sql).toContain("stale_reason IS NULL");
    expect(sql).toContain("ORDER BY certified_at DESC");
    expect(sql).toContain("LIMIT 1");
    /* stale_reason 与 stale_at 必须一起写：DDL 上那条 CHECK 要求它们同生同灭。 */
    expect(sql).toContain("stale_at = now()");
    expect(calls[0]!.args).toEqual([PRODUCT_ID, "webhook_changed"]);
  });

  it("没有有效认证：回 0，不抛——改回调地址不该因此失败", async () => {
    const { pool } = makePool(0);
    await expect(
      markCertificationStale(pool, PRODUCT_ID, "redirect_uri_changed"),
    ).resolves.toBe(0);
  });

  it("值域里没有 upstream_grant_revoked", () => {
    /* 用类型层面钉：写得出来就说明有人把它加回了值域，而它没有写入方。
       这条断言在编译期就会红——`@ts-expect-error` 在那个值合法时反而报错。 */
    // @ts-expect-error 上游授权被撤不是契约变更，不是失效原因
    const bad: CertificationStaleReason = "upstream_grant_revoked";
    expect(bad).toBe("upstream_grant_revoked");
  });
});

/*
 * 「保存了一次」不等于「改了」。
 *
 * 运营在回调登记这张表单上按保存的次数，远多于真的换地址（改主页链接、改边缘域名、
 * 甚至只是点进去看一眼再保存）。每次都把认证标失效，等于让它随手作废——而作废一次
 * 就要拉着对方重跑一遍链路。所以判据是**值真的变了**，不是「这个端点被调用了」。
 *
 * 这条错了没有任何异常：认证悄悄变成「待复认证」，运营下次发布才发现，而且想不到
 * 是哪次保存干的。判据因此收在 certification-stale.ts 里、由这里直接钉住——
 * 在测试里抄一份出来测，测的就不是真的那一份了。
 */
describe("webhook 登记：保存 ≠ 改了", () => {
  const changed = isWebhookUrlChanged;

  it("地址没变：不标失效", () => {
    expect(
      changed(
        "https://a.test/api/webhooks/vxture",
        "https://a.test/api/webhooks/vxture",
      ),
    ).toBe(false);
  });

  it("地址变了：标失效", () => {
    expect(
      changed(
        "https://a.test/api/webhooks/vxture",
        "https://b.test/api/webhooks/vxture",
      ),
    ).toBe(true);
  });

  it("本来就没登记过（第一次填）：不标失效", () => {
    /* 从无到有不是「变更」——当初就没有一条链是按旧地址证过的。 */
    expect(changed(null, "https://a.test/api/webhooks/vxture")).toBe(false);
  });
});
