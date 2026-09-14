/**
 * runos-grants-all.spec.ts —— `grants/all` 读完整个能力目录（2026-09-14）。
 *
 * 权益配置页白屏的后端一半：`grants/all` 按裸数组读目录列表，runos 切到游标信封
 * （v0.26.0）之后 `.map` 落在对象上，整条 500。钉两件事：
 *
 *   · **每一页都读到**。只读第一页的表现是：那一页之外的能力全部被报成「没有授权」，
 *     而接口照样回 200——和真没有一模一样。
 *   · **超过页数上限就抛，并且在扇出之前抛**。交出半份目录比报错更糟。
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

const capability = (id: string) => ({
  capabilityId: id,
  primitiveType: "tool",
  providerId: "p",
  ownerRef: "o",
  title: id,
  admissionTier: "official",
  category: "crm",
});

const grant = (grantId: string, capabilityId: string) => ({
  grantId,
  subjectType: "product",
  subjectRef: "tenderforge",
  capabilityId,
  grantType: "direct",
  riskScope: "read",
  state: "active",
  quotaLimit: null,
});

/** `operatorRequest(cfg, "runos", req, path, opts, onStatus)`——路径是第 4 个参数。 */
function pathsCalled(): URL[] {
  return operatorRequest.mock.calls.map(
    (c) => new URL(String(c[3]), "http://runos.test"),
  );
}

describe("grants/all 读完整个能力目录", () => {
  it("按游标读到最后一页，每一页的能力都参与扇出", async () => {
    operatorRequest.mockReset();
    operatorRequest.mockImplementation(async (...args: unknown[]) => {
      const url = new URL(String(args[3]), "http://runos.test");
      if (url.pathname === "/capability/capabilities") {
        return url.searchParams.get("cursor") === "page-2"
          ? {
              items: [capability("b.two")],
              nextCursor: null,
              prevCursor: "page-1",
              total: 2,
            }
          : {
              items: [capability("a.one")],
              nextCursor: "page-2",
              prevCursor: null,
              total: 2,
            };
      }
      const capabilityId = url.searchParams.get("capabilityId") ?? "";
      return [grant(`g-${capabilityId}`, capabilityId)];
    });

    const result = await makeRouter().listAllGrants(makeReq());

    expect(result.capabilityCount).toBe(2);
    expect(result.failed).toEqual([]);
    expect(result.grants.map((g) => g["grantId"]).sort()).toEqual([
      "g-a.one",
      "g-b.two",
    ]);

    const listCalls = pathsCalled().filter(
      (u) => u.pathname === "/capability/capabilities",
    );
    expect(listCalls).toHaveLength(2);
    /* 一页取满（runos MAX_PAGE_LIMIT），第二页带着上一页给的游标。 */
    expect(listCalls[0]!.searchParams.get("limit")).toBe("1000");
    expect(listCalls[0]!.searchParams.get("cursor")).toBeNull();
    expect(listCalls[1]!.searchParams.get("cursor")).toBe("page-2");
  });

  it("页数超过上限：抛错，而且一次授权扇出都不发", async () => {
    operatorRequest.mockReset();
    let page = 0;
    operatorRequest.mockImplementation(async (...args: unknown[]) => {
      const url = new URL(String(args[3]), "http://runos.test");
      if (url.pathname === "/capability/capabilities") {
        page += 1;
        return {
          items: [capability(`c.p${page}`)],
          nextCursor: `page-${page + 1}`,
          prevCursor: null,
          total: 999999,
        };
      }
      return [];
    });

    await expect(makeRouter().listAllGrants(makeReq())).rejects.toThrow(
      /partial catalog/,
    );
    expect(
      pathsCalled().some((u) => u.pathname === "/commerce/capability-grants"),
    ).toBe(false);
  });
});
