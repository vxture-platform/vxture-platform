/**
 * ops-notice.spec.ts —— 三样「热路径通告都要」的共同词汇，每一样都会**静默地坏**
 * （2026-09-28 第二批修补）。
 *
 *   · opsNoticeTenantLabel：少了 T- 前缀不报错，只是屏幕上多了一串分不出类别的十位数字；
 *   · redactUuids：错误原文里的 uuid 进了正文也不报错，页面照渲染，铁律照破；
 *   · opsNoticeDayKey：UTC 日与北京日只在每天那八小时里不一样——测试机在哪个时区都
 *     看不出来，必须拿定死的时刻钉。
 */
import { describe, expect, it, vi } from "vitest";
import {
  UUID_REDACTED_MARK,
  opsNoticeDayKey,
  opsNoticeReferenceId,
  opsNoticeTenantLabel,
  redactUuids,
  writeOpsNotice,
  type SystemNoticeWriter,
} from "./ops-notice";

describe("opsNoticeTenantLabel", () => {
  it("显示名 + T- 可视码；前缀来自 @shared 那一份实现", () => {
    expect(opsNoticeTenantLabel({ no: "2584353581", name: "示例科技" })).toBe(
      "示例科技（T-2584353581）",
    );
  });

  it("只有码：也带前缀（裸的十位数字分不出租户 / 工作空间）", () => {
    expect(opsNoticeTenantLabel({ no: "2584353581", name: null })).toBe(
      "租户 T-2584353581",
    );
  });

  it("只有名字 / 两样都没有：说得出什么说什么，绝不退回 uuid", () => {
    expect(opsNoticeTenantLabel({ no: null, name: "示例科技" })).toBe(
      "示例科技",
    );
    expect(opsNoticeTenantLabel({ no: null, name: "  " })).toBe("（租户未知）");
    expect(opsNoticeTenantLabel({ no: null, name: null })).toBe("（租户未知）");
  });
});

describe("redactUuids", () => {
  it("抹掉错误原文里的 uuid，留下痕迹让人知道这里原本有个 id", () => {
    const out = redactUuids(
      "ConflictException: 订阅 11111111-1111-4111-8111-111111111111 不存在",
    );
    expect(out).not.toContain("11111111-1111-4111-8111-111111111111");
    expect(out).toContain(UUID_REDACTED_MARK);
    // 句子的其余部分一个字不动——那是运营据以定位的东西。
    expect(out).toContain("ConflictException");
    expect(out).toContain("订阅");
    expect(out).toContain("不存在");
  });

  it("一段里有几个就抹几个，大小写都认", () => {
    const out = redactUuids(
      "duplicate key (subscription_id, plan_version_id)=" +
        "(11111111-1111-4111-8111-111111111111, 22222222-2222-4222-8222-ABCDEF222222)",
    );
    expect(out).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i);
    expect(out.match(/已隐去内部 id/g)).toHaveLength(2);
  });

  it("不碰可视码、订单号与 SQLSTATE（抹多了通告就没用了）", () => {
    const text =
      "42501 permission denied — 订单 SO202600100 / 租户 T-2584353581";
    expect(redactUuids(text)).toBe(text);
  });
});

describe("opsNoticeDayKey", () => {
  /*
   * 这四条都是同一个缺陷的两面：按 UTC 日算，北京 00:00–08:00 写的通告落进前一天那格，
   * 于是「一天一条」在每天早上八点前后各播一条。
   */
  it("北京 08:00（UTC 00:00）算当天，不算前一天", () => {
    expect(opsNoticeDayKey(new Date("2026-09-28T00:00:00.000Z"))).toBe(
      "2026-09-28",
    );
  });

  it("北京 00:30（UTC 前一天 16:30）算新的一天", () => {
    expect(opsNoticeDayKey(new Date("2026-09-27T16:30:00.000Z"))).toBe(
      "2026-09-28",
    );
  });

  it("北京 23:59:59 还是同一天（差一秒换格的那条边）", () => {
    expect(opsNoticeDayKey(new Date("2026-09-28T15:59:59.999Z"))).toBe(
      "2026-09-28",
    );
    expect(opsNoticeDayKey(new Date("2026-09-28T16:00:00.000Z"))).toBe(
      "2026-09-29",
    );
  });

  it("跨月跨年也是同一条规则", () => {
    expect(opsNoticeDayKey(new Date("2026-12-31T16:00:00.000Z"))).toBe(
      "2027-01-01",
    );
  });
});

describe("opsNoticeReferenceId", () => {
  it("128 以内原样（读的人要看得懂这条通告是哪件事）", () => {
    expect(opsNoticeReferenceId("quota_exhausted:ws:karda:doc.words")).toBe(
      "quota_exhausted:ws:karda:doc.words",
    );
  });

  it("超长截断并缀内容哈希：仍然一事一条，不会两件事撞成一条", () => {
    const a = opsNoticeReferenceId("k".repeat(200) + "a");
    const b = opsNoticeReferenceId("k".repeat(200) + "b");
    expect(a.length).toBeLessThanOrEqual(128);
    expect(b.length).toBeLessThanOrEqual(128);
    expect(a).not.toBe(b);
  });
});

describe("writeOpsNotice", () => {
  const input = {
    targetPlanes: ["admin"] as const,
    severity: "warning" as const,
    title: "t",
    body: "b",
    link: null,
    referenceType: "ops_signal",
    referenceId: "r",
    expiresAt: null,
  };

  it("写失败只记日志，绝不反过来打断业务路径", async () => {
    const warn = vi.fn();
    const writer = {
      createSystemNotice: vi.fn(async () => {
        throw new Error("42501 permission denied");
      }),
    } as unknown as SystemNoticeWriter;
    await expect(
      writeOpsNotice(writer, input, { warn }, "job_failed usage-rollup"),
    ).resolves.toBeUndefined();
    // label 必须进日志：「写通告失败」没有信息量，等于没记。
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain("job_failed usage-rollup");
  });
});
