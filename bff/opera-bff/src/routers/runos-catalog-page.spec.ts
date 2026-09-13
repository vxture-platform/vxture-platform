/**
 * runos-catalog-page.spec.ts —— 目录列表在 BFF 这一层归一（vxture-platform#306）。
 *
 * ── 这一条钉的是 X-4 三步迁移里最容易漏掉的那半步 ──
 *
 * 第 1 步是「消费方先能读两种形状」。契约层（`runos-contract.ts` 的
 * `kind: "migrating"`）已经两种都认了——但**认得出不等于用得了**。这条路由此前是
 * 原样透传，于是 runos 一切，控制台收到的就是它读不懂的信封。
 *
 * 更危险的是另一种改法:拆开信封只回 `items`。那是 886 里的 100，**正是 A-3 在同一条
 * 里禁的静默截断**——「这些对象没有数据」和「查到了但被砍掉」在界面上一模一样，而
 * 接口回 200，控制台一切正常。
 *
 * 所以这里的断言全都围着一件事:**下游拿到的形状与上游发的是哪种无关**。
 */
import type { Request } from "express";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import type { VxConfigService } from "@vxture/core-config";
import type { OperatorExchangeService } from "../auth/operator-exchange.service";
import type { RequestContext } from "../types/request-context";

vi.mock("@vxture/core-config", () => ({
  VxConfigService: class VxConfigService {},
}));

const operatorRequest = vi.fn();
vi.mock("../lib/upstream-grants", () => ({
  operatorRequest: (...args: unknown[]) => operatorRequest(...args),
}));

import { RunosRouter } from "./runos.router";

function makeReq(): Request & RequestContext {
  return {
    operator: { id: "op-1", displayName: null },
    capabilities: ["capability:runos.read"],
    operatorAccessToken: "operator-access-token",
    headers: {},
  } as unknown as Request & RequestContext;
}

function makeRouter() {
  const config = {
    platform: { RUNOS_API_URL: "http://runos.test" },
  } as unknown as VxConfigService;
  return new RunosRouter(
    config,
    { exchange: vi.fn() } as unknown as OperatorExchangeService,
    { query: vi.fn() } as unknown as Pool,
  );
}

/** 上游发什么，以及这次请求实际带了哪些查询参数。 */
async function listWith(
  upstream: unknown,
  query: Record<string, string | string[] | undefined> = {},
) {
  operatorRequest.mockReset();
  operatorRequest.mockResolvedValue(upstream);
  const router = makeRouter();
  const page = await router.listCapabilities(
    makeReq(),
    query.category as string | undefined,
    query.tag,
    query.primitiveType as string | undefined,
    query.q as string | undefined,
    query.limit as string | undefined,
    query.cursor as string | undefined,
  );
  /* `operatorRequest(cfg, "runos", req, path, opts, onStatus)`——路径是第 4 个参数。 */
  const path = String(operatorRequest.mock.calls[0]?.[3] ?? "");
  return { page, url: new URL(path, "http://runos.test") };
}

const row = (id: string) => ({
  capabilityId: id,
  primitiveType: "tool",
  providerId: "p",
  ownerRef: "o",
  title: id,
  admissionTier: "official",
  category: "crm",
});

describe("目录列表在 BFF 归一", () => {
  it("上游发裸数组 → 下游拿到信封，且 nextCursor 是 null 不是缺席", async () => {
    /* `null` 与「这个键不存在」要能分开:缺键读起来是「上游没告诉我」，而 `null`
       说的是「我告诉你了，没有下一页」。今天上游一次给全，所以这是真话。 */
    const { page } = await listWith([row("a.one"), row("a.two")]);

    expect(page).toEqual({
      items: [row("a.one"), row("a.two")],
      nextCursor: null,
      total: 2,
    });
    expect(Object.hasOwn(page, "nextCursor")).toBe(true);
  });

  it("上游发信封 → 原样保留，包括 total 与游标", async () => {
    const upstream = {
      items: [row("a.one")],
      nextCursor: "ZDF8YS5vbmU",
      total: 886,
    };

    const { page } = await listWith(upstream);

    expect(page).toEqual(upstream);
  });

  it("两种上游形状下，下游拿到的键完全一致", async () => {
    /* 写成性质而不是两组字面断言:这一步要防的就是两条分支各自演化，而把两边的键
       拿来比，是唯一看得见那件事的断言。 */
    const { page: fromArray } = await listWith([row("a.one")]);
    const { page: fromEnvelope } = await listWith({
      items: [row("a.one")],
      nextCursor: null,
      total: 1,
    });

    expect(Object.keys(fromArray).sort()).toEqual(
      Object.keys(fromEnvelope).sort(),
    );
  });

  it("total 报的是上游说的匹配数，不是这一页的长度", async () => {
    /* 决定性的一条。若照 items.length 算，翻页时「共 N 条」会跟着页走——而操作员
       正是靠那个数判断还有多少没看。 */
    const { page } = await listWith({
      items: [row("a.one")],
      nextCursor: "c",
      total: 886,
    });

    expect(page.total).toBe(886);
    expect(page.items).toHaveLength(1);
  });

  it("把 limit 与 cursor 原样转交，不在本层兜底成默认值", async () => {
    /* `?limit=abc` 该由 runos 回 REGISTRY_INVALID_LIMIT。BFF 替它挑一个数，等于把
       调用方的错误变成一个它以为自己要到了的页。 */
    const { url } = await listWith([], { limit: "abc", cursor: "ZDF8eA" });

    expect(url.searchParams.get("limit")).toBe("abc");
    expect(url.searchParams.get("cursor")).toBe("ZDF8eA");
  });

  it("把 primitiveType 与 q 下推——留在浏览器里会让搜索只搜当前页", async () => {
    const { url } = await listWith([], { primitiveType: "tool", q: "invoice" });

    expect(url.searchParams.get("primitiveType")).toBe("tool");
    expect(url.searchParams.get("q")).toBe("invoice");
  });

  it("?tag= 仍是可重复的 AND，不被 set 压成一个", async () => {
    const { url } = await listWith([], { tag: ["preset", "official"] });

    expect(url.searchParams.getAll("tag")).toEqual(["preset", "official"]);
  });
});
