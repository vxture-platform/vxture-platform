/**
 * product-certification.spec.ts —— 认证编排：那条**新的入边**。
 *
 * 这个路由存在的唯一理由，是给「发布要验收 / 验收要订阅 / 订阅要已发布」那个环开一个
 * 口子：一条指向**未发布草稿版本**的订阅，不经过订单流。所以这里钉的不是「接口回了
 * 200」，而是几件错了**不会有任何外在症状**的事：
 *
 *  1. **订阅走的是和客户完全相同的那个方法**，差别只在三个入参。若有人为了省事改成
 *     裸 INSERT，配额池不会物化、开通事件不会发——认证照样「成功」，而它证明的东西
 *     全没了，且界面上看不出区别。
 *  2. **归属校验**。`productId` 与 `planVersionId` 是各自独立送来的两个字段。不校验
 *     的后果不是认错对象那么简单：台账会留下一条「A 产品在 B 套餐上认过」的假事实，
 *     而发布门只读结论、不看来历。
 *  3. **认的必须是草稿版本**。对已发布版本认证没有意义（它已经在卖），而这一步的
 *     全部价值在于「发布之前就把链跑通」。
 *  4. **重复发起要复用订阅**。`uidx_subscriptions_live_per_product` 是
 *     (workspace, product) 唯一——不复用的话第二次点就撞唯一索引，报一个和认证毫无
 *     关系的 23505。
 *  5. **产品没上线不给认证**。上线门证的是「对方接通了」；顺序颠倒会让认证在对方还
 *     没实现任何接口时去等五段痕迹，白等一场而运营不知道为什么。
 */
import { describe, expect, it, vi } from "vitest";
import type { Request } from "express";
import type { Pool, PoolClient } from "pg";
import type { RequestContext } from "../types/request-context";
import type { SubscriptionService } from "@vxture/service-subscription";

import { ProductCertificationRouter } from "./product-certification.router";

const PRODUCT_ID = "3d9f0c1e-0000-4000-8000-0000000000aa";
const VERSION_ID = "3d9f0c1e-0000-4000-8000-0000000000bb";
const WORKSPACE_ID = "3d9f0c1e-0000-4000-8000-0000000000cc";
const RUN_ID = "3d9f0c1e-0000-4000-8000-0000000000dd";
const CERT_TENANT = "00000000-0000-4000-a000-0000000000c2";

function makeReq(): Request & RequestContext {
  return {
    operator: { id: "op-1", displayName: null },
    capabilities: ["integration:product.manage"],
    headers: {},
  } as unknown as Request & RequestContext;
}

interface Fixture {
  productStatus?: string;
  productMissing?: boolean;
  versionStatus?: string;
  versionMissing?: boolean;
  /** 主组件是不是本产品；false = 归属对不上。 */
  owns?: boolean;
  /** 沙箱工作区已存在。 */
  workspaceExists?: boolean;
  /** 该沙箱里这个产品已有在活订阅。 */
  liveSubscription?: boolean;
}

function makeRouter(fx: Fixture) {
  const calls: { text: string; args: unknown[] }[] = [];
  const query = vi.fn(async (text: string, args?: unknown[]) => {
    calls.push({ text, args: args ?? [] });
    if (/FROM product\.products/.test(text)) {
      return {
        rows: fx.productMissing
          ? []
          : [{ product_code: "arda", status: fx.productStatus ?? "active" }],
      };
    }
    if (/FROM product\.plan_versions/.test(text)) {
      return {
        rows: fx.versionMissing
          ? []
          : [{ status: fx.versionStatus ?? "draft", owns: fx.owns ?? true }],
      };
    }
    if (/FROM tenancy\.workspaces/.test(text)) {
      return { rows: fx.workspaceExists ? [{ id: WORKSPACE_ID }] : [] };
    }
    if (/INSERT INTO tenancy\.workspaces/.test(text)) {
      return { rows: [{ id: WORKSPACE_ID }] };
    }
    if (/FROM metering\.subscriptions/.test(text)) {
      return { rows: fx.liveSubscription ? [{ id: "sub-1" }] : [] };
    }
    if (/FROM product\.plan_components/.test(text)) {
      return { rows: [{ line: "p|primary|pro|{}|{}" }] };
    }
    if (/INSERT INTO product\.certification_runs/.test(text)) {
      return {
        rows: [
          {
            id: RUN_ID,
            product_id: PRODUCT_ID,
            contract_version: "C1/C2/C3-2026-09",
            sandbox_workspace_id: WORKSPACE_ID,
            plan_version_id: VERSION_ID,
            component_fingerprint: "fp",
            segments: {},
            verdict: "running",
            stale_reason: null,
            certified_at: null,
            created_at: new Date("2026-09-23T00:00:00.000Z"),
          },
        ],
      };
    }
    if (/audit_logs/i.test(text)) return { rows: [] };
    throw new Error(`unexpected sql: ${text}`);
  });

  const client = { query, release: vi.fn() } as unknown as PoolClient;
  const pool = { query, connect: async () => client } as unknown as Pool;
  /* mock 必须带上入参签名：不带的话 `calls[0]` 的类型是空元组，
     `calls[0][0]` 连编译都过不去——而那正是本文件最要紧的那条断言。 */
  const createSubscription = vi.fn(async (_input: Record<string, unknown>) => ({
    id: "sub-new",
  }));
  const subscriptions = {
    createSubscription,
  } as unknown as SubscriptionService;
  const router = new ProductCertificationRouter(pool, pool, subscriptions);
  return { router, calls, createSubscription };
}

async function status(promise: Promise<unknown>): Promise<number> {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeTruthy();
  return (err as { getStatus(): number }).getStatus();
}

describe("POST /api/products/:id/certification/run", () => {
  it("正常发起：建沙箱工作区 → 走客户那条 createSubscription → 开一条 running 台账", async () => {
    const { router, calls, createSubscription } = makeRouter({});
    const out = await router.run(makeReq(), PRODUCT_ID, {
      planVersionId: VERSION_ID,
    });

    expect(out.verdict).toBe("running");
    expect(out.sandboxWorkspaceId).toBe(WORKSPACE_ID);

    /* 差别只有三个入参——这是整套机制的立足点：认证走特殊路径就证明不了
       生产路径能跑通。任何一个被改掉，这条断言当场红。 */
    expect(createSubscription).toHaveBeenCalledTimes(1);
    const input = createSubscription.mock.calls[0]?.[0] as unknown as Record<
      string,
      unknown
    >;
    expect(input).toBeTruthy();
    expect(input.activationMethod).toBe("operator_grant");
    expect(input.subscriptionKind).toBe("free");
    expect(input.createdByType).toBe("operator");
    /* 指向的是**未发布的草稿版本本身**，不是另造的认证套餐。 */
    expect(input.planVersionId).toBe(VERSION_ID);
    expect(input.tenantId).toBe(CERT_TENANT);
    expect(input.workspaceId).toBe(WORKSPACE_ID);
    expect(input.payAmount).toBe(0);

    expect(
      calls.some((c) => /INSERT INTO tenancy\.workspaces/.test(c.text)),
    ).toBe(true);
    expect(calls.some((c) => /audit_logs/i.test(c.text))).toBe(true);
  });

  it("沙箱工作区已存在：复用，不再建一个", async () => {
    const { router, calls } = makeRouter({ workspaceExists: true });
    await router.run(makeReq(), PRODUCT_ID, { planVersionId: VERSION_ID });
    expect(
      calls.some((c) => /INSERT INTO tenancy\.workspaces/.test(c.text)),
    ).toBe(false);
  });

  it("该沙箱里已有在活订阅：复用，不重复建（否则撞 (workspace,product) 唯一索引）", async () => {
    const { router, createSubscription } = makeRouter({
      workspaceExists: true,
      liveSubscription: true,
    });
    const out = await router.run(makeReq(), PRODUCT_ID, {
      planVersionId: VERSION_ID,
    });
    expect(createSubscription).not.toHaveBeenCalled();
    /* 但台账照开：重跑一次认证是一件独立的事，它要有自己的一行。 */
    expect(out.verdict).toBe("running");
  });

  it("版本的主组件不是本产品：400，且一条订阅都不建", async () => {
    const { router, createSubscription } = makeRouter({ owns: false });
    expect(
      await status(
        router.run(makeReq(), PRODUCT_ID, { planVersionId: VERSION_ID }),
      ),
    ).toBe(400);
    expect(createSubscription).not.toHaveBeenCalled();
  });

  it("版本已发布：409——认证针对的是待发布的草稿版本", async () => {
    const { router, createSubscription } = makeRouter({
      versionStatus: "published",
    });
    expect(
      await status(
        router.run(makeReq(), PRODUCT_ID, { planVersionId: VERSION_ID }),
      ),
    ).toBe(409);
    expect(createSubscription).not.toHaveBeenCalled();
  });

  it("产品还没上线：409——上线门在前，认证在后", async () => {
    const { router, createSubscription } = makeRouter({
      productStatus: "developing",
    });
    expect(
      await status(
        router.run(makeReq(), PRODUCT_ID, { planVersionId: VERSION_ID }),
      ),
    ).toBe(409);
    expect(createSubscription).not.toHaveBeenCalled();
  });

  it("产品不存在：404", async () => {
    const { router } = makeRouter({ productMissing: true });
    expect(
      await status(
        router.run(makeReq(), PRODUCT_ID, { planVersionId: VERSION_ID }),
      ),
    ).toBe(404);
  });

  it("版本不存在：404", async () => {
    const { router } = makeRouter({ versionMissing: true });
    expect(
      await status(
        router.run(makeReq(), PRODUCT_ID, { planVersionId: VERSION_ID }),
      ),
    ).toBe(404);
  });

  it("没给 planVersionId：400，不靠「随便挑一个草稿」兜底", async () => {
    /* 兜底挑一个的后果是台账记下一条运营从没打算认的版本，而它看起来一切正常。 */
    const { router } = makeRouter({});
    expect(await status(router.run(makeReq(), PRODUCT_ID, {}))).toBe(400);
  });
});
