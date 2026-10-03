/**
 * tenant-verification-notify.spec.ts — 租户实名审核的客户通知（批 5）。
 * @package @vxture/bff-admin
 *
 * 审核通过 / 驳回此前落库之后一句话都不发：客户交了资料，结果只能自己回那一页看。
 * 这里钉的是 tsc 与 lint 都看不见的五件事：
 *   1. 一次真实的审核**恰好**发一条，模板码按结果分两条；
 *   2. 文案参数里带可视码（tenant_no）且**一个 uuid 都没有**，去重锚也一样——它被
 *      客户收件箱的读路径原样投影给浏览器（console-bff 的 inbox.router），所以它同样
 *      在「客户端不出现 uuid」那条铁律的管辖内（2026-09-28 收尾改的）；
 *   3. 通知发在 commit **之后**——所以回滚的审核是静默的（事务炸了连读回都走不到）；
 *   4. 分发器抛异常既不让审核失败、也不回滚已提交的审核（best-effort）；
 *   5. 读回不到那条认证（loadVerification 404）时一句话不发。
 *
 * 为什么必须断言「notify 没被调用」而不是给一个会抛的替身：路由里的 emit 按设计
 * 吞异常，会抛的替身发不出任何信号，那种断言永远绿。
 */
import { describe, it, expect, vi } from "vitest";
import { NotFoundException } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import type { Request } from "express";
import type {
  NotificationDispatcher,
  NotifyInput,
} from "@vxture/service-notification";
import { TenantsRouter } from "./tenants.router";
import type { RequestContext } from "../types/console.types";

const OPERATOR_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const VERIFICATION_ID = "33333333-3333-4333-8333-333333333333";
/** 2026-10-03 拆门：实名审核三个入口判自己的码。 */
const MANAGE = ["tenant:verification.review"];
/** 读回那一行的 reviewed_at；去重锚的后半截就是它。 */
const REVIEWED_AT = "2026-09-28T02:30:00.000Z";
const TENANT_NO = "2012345678";
/** 去重锚 = 租户可视码 : 本次审核时刻（一个 uuid 都没有）。 */
const DEDUPE_REF = `${TENANT_NO}:${REVIEWED_AT}`;

/** 任何 uuid 形状。客户看的文案里出现它就是缺陷（可视码另有其列）。 */
const ANY_UUID =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function makeReq(capabilities: string[]): Request & RequestContext {
  return {
    user: { id: OPERATOR_ID },
    capabilities,
    ip: "127.0.0.1",
    headers: {},
    socket: { remoteAddress: "127.0.0.1" },
  } as unknown as Request & RequestContext;
}

/** TENANT_VERIFICATION_SELECT 的行形状（审核之后读回的那一条）。 */
function reviewedRow(over: Record<string, unknown> = {}) {
  return {
    id: VERIFICATION_ID,
    tenant_id: TENANT_ID,
    verification_type: "enterprise",
    verification_method: "documents",
    company_name: "示例科技有限公司",
    business_license_no: "91310000MA1FL00000",
    business_license_image_ref: null,
    legal_person_name: "陈立",
    status: "verified",
    reviewer_id: OPERATOR_ID,
    reviewed_at: REVIEWED_AT,
    reject_reason: null,
    created_at: "2026-09-20T02:30:00.000Z",
    updated_at: "2026-09-28T02:30:00.000Z",
    tenant_name: "示例科技有限公司",
    tenant_no: TENANT_NO,
    tenant_type: "organization",
    tenant_status: "active",
    ...over,
  };
}

interface HarnessOptions {
  /** 读回的那一行；`null` = 读不到（loadVerification 抛 404）。 */
  readBack?: Record<string, unknown> | null;
  /** 分发器抛异常。 */
  notifyThrows?: boolean;
  /** 事务内第二条 update 炸掉 → 整条审核回滚。 */
  txFails?: boolean;
}

function harness(options: HarnessOptions = {}) {
  const txCalls: string[] = [];
  const release = vi.fn();
  const clientQuery = vi.fn(async (sql: string) => {
    const lower = String(sql).trim().toLowerCase();
    txCalls.push(lower);
    if (options.txFails && lower.includes("update tenancy.tenants")) {
      throw new Error("tenants update exploded");
    }
    if (lower.includes("for update")) {
      return {
        rows: [
          {
            id: VERIFICATION_ID,
            tenant_id: TENANT_ID,
            status: "pending",
            company_name: "示例科技有限公司",
            verification_type: "enterprise",
          },
        ],
        rowCount: 1,
      };
    }
    return { rows: [], rowCount: 0 };
  });
  const client = { query: clientQuery, release } as unknown as PoolClient;
  const rwPool = {
    connect: vi.fn(async () => client),
    // 审计写走池而不是事务客户端（审计失败不回滚业务）。
    query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
  } as unknown as Pool;

  const rows =
    options.readBack === undefined
      ? [reviewedRow()]
      : options.readBack === null
        ? []
        : [options.readBack];
  const roQuery = vi.fn(async () => ({ rows }));
  const roPool = { query: roQuery } as unknown as Pool;

  /** 每次 notify 被调用时事务里已经跑过的语句——用来证明「发在 commit 之后」。 */
  const txCallsWhenNotified: string[][] = [];
  const notify = vi.fn(async (_input: NotifyInput) => {
    txCallsWhenNotified.push([...txCalls]);
    if (options.notifyThrows) throw new Error("dispatcher exploded");
    return {
      inboxCreated: 1,
      emailsSent: 0,
      emailsFailed: 0,
      smsSent: 0,
      smsFailed: 0,
      skipped: 0,
    };
  });
  const router = new TenantsRouter(roPool, rwPool, {
    notify,
  } as unknown as NotificationDispatcher);

  return { router, notify, txCalls, txCallsWhenNotified, roQuery };
}

/** 第一次 notify 的入参。 */
function firstInput(notify: ReturnType<typeof vi.fn>): NotifyInput {
  return notify.mock.calls[0]![0] as NotifyInput;
}

describe("租户实名审核 → 客户通知", () => {
  it("通过：恰好一条 tenant.verification_approved，带可视码且无 uuid", async () => {
    const h = harness();

    await h.router.approveTenantVerification(makeReq(MANAGE), VERIFICATION_ID);

    expect(h.notify).toHaveBeenCalledTimes(1);
    const input = firstInput(h.notify);
    expect(input.templateCode).toBe("tenant.verification_approved");
    expect(input.tenantId).toBe(TENANT_ID);
    /* 去重锚 = 这一次审核，不是这个租户（重新提交要能再收到一条），而它的两半都是
       可视值：租户可视码 + 审核时刻。**不是认证行的 uuid**——reference_id 会被客户
       收件箱的读路径原样投影给浏览器。 */
    expect(input.reference).toEqual({ type: "tenant", id: DEDUPE_REF });
    expect(input.reference.id).not.toMatch(ANY_UUID);
    // 列宽 varchar(128)：10 + 1 + 24 = 35，运营镜像再前缀 36 共 71。
    expect(input.reference.id.length).toBeLessThanOrEqual(128);
    expect(input.link).toBe("/tenant/verification");
    expect(input.params.tenantCode).toBe("2012345678");
    expect(input.params.tenantName).toBe("示例科技有限公司");
    // Asia/Shanghai 的日历日，不是 ISO 时刻。
    expect(input.params.reviewedAt).toBe("2026-09-28");
    for (const [key, value] of Object.entries(input.params)) {
      expect(String(value), `params.${key} 里出现了 uuid`).not.toMatch(
        ANY_UUID,
      );
    }
    expect(input.link ?? "").not.toMatch(ANY_UUID);
  });

  it("驳回：发 tenant.verification_rejected 并把原因交给 {{reason}}", async () => {
    const h = harness({
      readBack: reviewedRow({
        status: "rejected",
        reject_reason: "营业执照照片不清晰，请重新上传",
      }),
    });

    await h.router.rejectTenantVerification(makeReq(MANAGE), VERIFICATION_ID, {
      reason: "营业执照照片不清晰，请重新上传",
    });

    expect(h.notify).toHaveBeenCalledTimes(1);
    const input = firstInput(h.notify);
    expect(input.templateCode).toBe("tenant.verification_rejected");
    expect(input.params.reason).toBe("营业执照照片不清晰，请重新上传");
    expect(input.params.tenantCode).toBe("2012345678");
  });

  it("通知发在 commit 之后（所以回滚的审核只能是静默的）", async () => {
    const h = harness();

    await h.router.approveTenantVerification(makeReq(MANAGE), VERIFICATION_ID);

    expect(h.txCallsWhenNotified).toHaveLength(1);
    expect(h.txCallsWhenNotified[0]).toContain("commit");
    expect(h.txCallsWhenNotified[0]).not.toContain("rollback");
  });

  it("事务回滚 → 一句话不发，也没去读回", async () => {
    const h = harness({ txFails: true });

    await expect(
      h.router.approveTenantVerification(makeReq(MANAGE), VERIFICATION_ID),
    ).rejects.toThrow("tenants update exploded");

    expect(h.txCalls).toContain("rollback");
    expect(h.txCalls).not.toContain("commit");
    expect(h.notify).not.toHaveBeenCalled();
    expect(h.roQuery).not.toHaveBeenCalled();
  });

  it("读回不到那条认证 → 404 且一句话不发", async () => {
    const h = harness({ readBack: null });

    await expect(
      h.router.approveTenantVerification(makeReq(MANAGE), VERIFICATION_ID),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(h.notify).not.toHaveBeenCalled();
  });

  it("分发器抛异常：审核照常返回，事务不回滚", async () => {
    const h = harness({ notifyThrows: true });

    const record = await h.router.approveTenantVerification(
      makeReq(MANAGE),
      VERIFICATION_ID,
    );

    expect(record.id).toBe(VERIFICATION_ID);
    expect(record.status).toBe("verified");
    expect(h.notify).toHaveBeenCalledTimes(1);
    expect(h.txCalls).toContain("commit");
    expect(h.txCalls).not.toContain("rollback");
  });

  it("可视码解不出来时说「未知」，不把空值当成一个编码送出去", async () => {
    const h = harness({ readBack: reviewedRow({ tenant_no: null }) });

    await h.router.approveTenantVerification(makeReq(MANAGE), VERIFICATION_ID);

    expect(firstInput(h.notify).params.tenantCode).toBe("未知");
    // 可视码解不出来也不许回落成 uuid：键里那一段只会是「未知」。
    expect(firstInput(h.notify).reference.id).not.toMatch(ANY_UUID);
  });

  /*
   * 去重锚里那个审核时刻的全部用处：同一个租户驳回后重新提交、再审一次是**另一件事**，
   * 客户要再收到一条。只锚租户（或锚一个不变的值）的话，第二轮会被收件箱唯一键
   * （account × 模板 × 引用类型 × 引用 id）吞掉，而吞掉是静默的。
   */
  it("同一租户的第二次审核是另一个锚 —— 否则第二条被唯一键吞掉", async () => {
    const first = harness();
    await first.router.approveTenantVerification(
      makeReq(MANAGE),
      VERIFICATION_ID,
    );

    const second = harness({
      readBack: reviewedRow({ reviewed_at: "2026-10-09T08:15:00.000Z" }),
    });
    await second.router.approveTenantVerification(
      makeReq(MANAGE),
      VERIFICATION_ID,
    );

    expect(firstInput(second.notify).reference.id).not.toBe(
      firstInput(first.notify).reference.id,
    );
    expect(firstInput(second.notify).reference.id).toBe(
      `${TENANT_NO}:2026-10-09T08:15:00.000Z`,
    );
  });

  it("审核时刻读不到也照发，只是锚退回「此刻」（宁可多一条，不要少一条）", async () => {
    const h = harness({ readBack: reviewedRow({ reviewed_at: null }) });

    await h.router.approveTenantVerification(makeReq(MANAGE), VERIFICATION_ID);

    expect(h.notify).toHaveBeenCalledTimes(1);
    const id = firstInput(h.notify).reference.id;
    expect(id.startsWith(`${TENANT_NO}:`)).toBe(true);
    expect(id).not.toMatch(ANY_UUID);
    // 日期那一半渲染成「—」（formatNotifyDate 的空值口径），不是空串。
    expect(firstInput(h.notify).params.reviewedAt).toBe("—");
  });
});
