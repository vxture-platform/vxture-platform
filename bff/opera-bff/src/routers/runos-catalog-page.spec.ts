/**
 * runos-catalog-page.spec.ts —— 目录列表在 BFF 这一层的形状与参数转发（#306）。
 *
 * X-4 三步迁移已走完，本文件跟着收了两条:「上游发裸数组」与「两种形状键一致」都删了
 * ——**`from` 分支不在了，那两条测的是不存在的行为**。留着会让人以为线上还可能收到
 * 裸数组。
 *
 * 剩下的仍然是这一层真正要守的:
 *   · `total` 是上游说的匹配数，不是本页长度——照 `items.length` 算，翻页时「共 N 条」
 *     会跟着页走，而操作员正是靠那个数判断还有多少没看。
 *   · `?limit=` / `?cursor=` 原样转交，不在本层兜底成默认值。
 *   · `?primitiveType=` / `?q=` 必须下推——留在浏览器里就只搜当前页，而「搜不到」和
 *     「不存在」在界面上一模一样。
 *   · `?tag=` 是可重复的 AND，用 append 不用 set。
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
    query.dir as string | undefined,
  );
  /* `operatorRequest(cfg, "runos", req, path, opts, onStatus)`——路径是第 4 个参数。 */
  const path = String(operatorRequest.mock.calls[0]?.[3] ?? "");
  return { page, url: new URL(path, "http://runos.test") };
}

/** 空的一页。`[]` 不再是合法载荷——目录列表自 #306 第 3 步起只有信封一种形状。 */
const EMPTY_PAGE = { items: [], nextCursor: null, prevCursor: null, total: 0 };

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
  it("上游退回裸数组 → 拒收，不再顺着解析", async () => {
    /* **第 3 步的不变式。** 迁移期这里是合法输入，走 `from` 分支;现在不是了。
       这条测的不是「某种错误输入」，是「那条退路真的撤掉了」——`from` 还在的话它会绿，
       而线上到底是哪一种形状就又变成看不出来的了。 */
    operatorRequest.mockReset();
    operatorRequest.mockResolvedValue([row("a.one")]);
    const router = makeRouter();

    await expect(
      router.listCapabilities(
        makeReq(),
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
      ),
    ).rejects.toMatchObject({
      response: { code: "RUNOS_CONTRACT_SHAPE_CHANGED" },
    });
  });

  it("上游发信封 → 原样保留，包括 total 与游标", async () => {
    const upstream = {
      items: [row("a.one")],
      nextCursor: "ZDF8YS5vbmU",
      prevCursor: null,
      total: 886,
    };

    const { page } = await listWith(upstream);

    expect(page).toEqual(upstream);
  });

  it("total 报的是上游说的匹配数，不是这一页的长度", async () => {
    /* 决定性的一条。若照 items.length 算，翻页时「共 N 条」会跟着页走——而操作员
       正是靠那个数判断还有多少没看。 */
    const { page } = await listWith({
      items: [row("a.one")],
      nextCursor: "c",
      prevCursor: "p",
      total: 886,
    });

    expect(page.total).toBe(886);
    expect(page.items).toHaveLength(1);
  });

  it("把 limit 与 cursor 原样转交，不在本层兜底成默认值", async () => {
    /* `?limit=abc` 该由 runos 回 REGISTRY_INVALID_LIMIT。BFF 替它挑一个数，等于把
       调用方的错误变成一个它以为自己要到了的页。 */
    const { url } = await listWith(EMPTY_PAGE, {
      limit: "abc",
      cursor: "ZDF8eA",
    });

    expect(url.searchParams.get("limit")).toBe("abc");
    expect(url.searchParams.get("cursor")).toBe("ZDF8eA");
  });

  it("把 primitiveType 与 q 下推——留在浏览器里会让搜索只搜当前页", async () => {
    const { url } = await listWith(EMPTY_PAGE, {
      primitiveType: "tool",
      q: "invoice",
    });

    expect(url.searchParams.get("primitiveType")).toBe("tool");
    expect(url.searchParams.get("q")).toBe("invoice");
  });

  it("把 dir 原样转交——不送的话「上一页」会安静地答成下一页", async () => {
    /* runos 的 `dir` 默认 `after`。BFF 丢掉它，一次「给我上一页」就会拿着前一行的
       游标往后取，取回来的正是当前这一页——**界面上表现为按钮点了没反应，不是报错**，
       没人会去查一个查询参数。 */
    const { url } = await listWith(EMPTY_PAGE, { dir: "before" });

    expect(url.searchParams.get("dir")).toBe("before");
  });

  it("本层不替 runos 校验 dir，也不兜底", async () => {
    /* 第三个值该由 runos 回 REGISTRY_INVALID_DIRECTION。BFF 替它当成 after，等于把
       调用方的错误变成一个它以为自己要到了的页。 */
    const { url } = await listWith(EMPTY_PAGE, { dir: "sideways" });

    expect(url.searchParams.get("dir")).toBe("sideways");
  });

  it("prevCursor 原样带下去——末页靠它才不是死胡同", async () => {
    const { page } = await listWith({
      items: [row("a.one")],
      nextCursor: null,
      prevCursor: "p",
      total: 878,
    });

    expect(page.prevCursor).toBe("p");
    expect(page.nextCursor).toBeNull();
  });

  it("?tag= 仍是可重复的 AND，不被 set 压成一个", async () => {
    const { url } = await listWith(EMPTY_PAGE, { tag: ["preset", "official"] });

    expect(url.searchParams.getAll("tag")).toEqual(["preset", "official"]);
  });
});
