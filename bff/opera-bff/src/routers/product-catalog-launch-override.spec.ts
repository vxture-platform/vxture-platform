/**
 * product-catalog-launch-override.spec.ts —— 带理由跳过上线闸门（2026-09-17）。
 *
 * owner 的目的是「先上线再联调」。调研结论是上线门六项**没有一项结构性锁死**
 * （三项自动检查产品后端各调一次就点亮，不需要客户 / 订阅 / 套餐），所以这一批
 * **不删不降级条件**，只多一条写明理由的路。钉四件，每一件错了都不会有外在症状：
 *
 *  1. **没理由照旧 409。** 要是跳过变成无条件的，这道门以后什么也证明不了。
 *  2. **空白理由等于没理由。** 一个空格就能过的话，必填是假的。
 *  3. **跳过时三列写入 + 写审计。** 缺了任一件，产品页的常驻提示就不会出现，
 *     或者「谁在什么时候以什么理由跳的」答不出来——两者都是静默失效。
 *  4. **没缺项时不写跳过痕迹。** 正常上线的产品不该被标成带缺项上线。
 *
 * ── 自带 harness，**不共用** retirement 那份 ──
 * 那份的假 pool 用一条 `/UPDATE product\.products/` 分支捕获所有产品更新，并把
 * `params[0]` 当作新状态推进 `writes`。而跳过那条 UPDATE 的 `params[0]` 是产品 id，
 * 共用会把它的断言污染成「写了一个叫 uuid 的状态」。
 */
import { describe, expect, it, vi } from "vitest";
import type { Request } from "express";
import type { Pool, PoolClient } from "pg";
import type { VxConfigService } from "@vxture/core-config";
import type { OperatorExchangeService } from "../auth/operator-exchange.service";
import type { RequestContext } from "../types/request-context";

vi.mock("@vxture/core-config", () => ({
  VxConfigService: class VxConfigService {},
}));

import { ProductCatalogRouter } from "./product-catalog.router";

const PRODUCT_ID = "3d9f0c1e-0000-4000-8000-0000000000aa";
const OPERATOR = "op-1";

function makeReq(): Request & RequestContext {
  return {
    operator: { id: OPERATOR, displayName: null },
    capabilities: ["integration:product.manage"],
    headers: {},
  } as unknown as Request & RequestContext;
}

/** 记下每一条语句与参数；断言按 SQL 特征取，不靠调用次序。 */
function makeRouter(pendingItems: string[]) {
  const calls: { text: string; args: unknown[] }[] = [];
  const client = {
    query: vi.fn(async (sql: string, args: unknown[] = []) => {
      calls.push({ text: sql, args });
      if (/^\s*(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return { rows: [] };
      if (/SELECT status/.test(sql)) {
        return { rows: [{ status: "draft" }], rowCount: 1 };
      }
      if (/FROM product\.launch_checklist_items/.test(sql)) {
        const rows = pendingItems.map((code) => ({
          item_code: code,
          item_name: code,
        }));
        return { rows, rowCount: rows.length };
      }
      if (/UPDATE product\.products/.test(sql)) {
        return { rows: [{ id: PRODUCT_ID, status: "active" }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }),
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
  /*
   * 判据取**赋值形态**而不是裸列名：`SELECT_COLUMNS` 里也写着
   * `launch_override_at`，而正常上线那条带 RETURNING 的 UPDATE 会把它带进 SQL 文本——
   * 拿裸列名匹配会把「没跳过」也判成「跳过了」，那是一个假阳性来源。
   */
  const find = (re: RegExp) => calls.find((c) => re.test(c.text));
  const overrideWrite = () =>
    calls.find((c) => /launch_override_at\s*=\s*now\(\)/.test(c.text));
  return { router, calls, find, overrideWrite };
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("预期被拒，但成功了");
}

describe("draft → active · 带理由跳过闸门", () => {
  it("没理由：照旧 409，且不写任何跳过痕迹", async () => {
    const t = makeRouter(["c1_s2s", "c1_identity"]);
    const error = await rejection(
      t.router.setState(makeReq(), PRODUCT_ID, { state: "active" }),
    );
    expect((error as { getStatus?: () => number }).getStatus?.()).toBe(409);
    expect(t.overrideWrite()).toBeUndefined();
    expect(t.find(/audit_logs/i)).toBeUndefined();
  });

  it("空白理由等于没理由", async () => {
    const t = makeRouter(["c1_s2s"]);
    const error = await rejection(
      t.router.setState(makeReq(), PRODUCT_ID, {
        state: "active",
        override: { reason: "   " },
      }),
    );
    expect((error as { getStatus?: () => number }).getStatus?.()).toBe(409);
    expect(t.overrideWrite()).toBeUndefined();
  });

  it("有理由：放行，三列写入，审计记下缺哪几项", async () => {
    const t = makeRouter(["c1_s2s", "c1_identity"]);
    await t.router.setState(makeReq(), PRODUCT_ID, {
      state: "active",
      override: { reason: "对方下周才接入联调" },
    });

    const ov = t.overrideWrite()!;
    expect(ov, "跳过时必须写三列").toBeDefined();
    expect(ov.text).toContain("launch_override_by");
    expect(ov.text).toContain("launch_override_pending");
    /* 第二个参数是操作者，第三个是缺项数组（jsonb 串）。 */
    expect(ov.args[1]).toBe(OPERATOR);
    expect(JSON.parse(String(ov.args[2]))).toEqual(["c1_s2s", "c1_identity"]);

    const audit = t.find(/audit_logs/i)!;
    expect(audit, "跳过必须留审计").toBeDefined();
    expect(audit.args).toContain("catalog.product.launch_override");
  });

  it("没缺项时不写跳过痕迹（正常上线不该被标成带缺项）", async () => {
    const t = makeRouter([]);
    await t.router.setState(makeReq(), PRODUCT_ID, {
      state: "active",
      override: { reason: "多余的理由" },
    });
    expect(t.overrideWrite()).toBeUndefined();
  });
});
