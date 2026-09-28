/**
 * operator-mirror.spec.ts — 25 个客户模板每个至少一条断言（严重度 / 标题 / 去重键），
 * 警告类再断言链接；镜像与写库 / 查库分开测：composeOperatorNotice 是纯函数，
 * OperatorMirror 用假 pool 只测解析与降级。
 *
 * CASES 的类型也是 Record<NotificationTemplateCode, …>：新加模板不但 OPERATOR_MIRROR
 * 编译不过，这里也编译不过——两处都得补，少一处就红。
 */
import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import type { CreateSystemNoticeInput } from "@vxture/service-notice";
import {
  MIRROR_ORDER_SQL,
  MIRROR_REFUND_SQL,
  MIRROR_TENANT_SQL,
  OPERATOR_MIRROR,
  OPERATOR_MIRROR_INFO_TTL_MS,
  OperatorMirror,
  composeOperatorNotice,
  mirrorDedupeKey,
  mirrorLink,
  type MirrorReference,
} from "./operator-mirror";
import {
  NOTIFICATION_TEMPLATES,
  render,
  type NotificationTemplateCode,
  type TemplateParams,
} from "./templates";

const ORDER_ID = "6f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const REFUND_ID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const TENANT_ID = "1a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

const orderRef: MirrorReference = { type: "order", id: ORDER_ID };
const refundRef = (stage: string): MirrorReference => ({
  type: "refund",
  id: `${REFUND_ID}:${stage}`,
});
const subRef: MirrorReference = {
  type: "subscription",
  id: "sub-1:2026-09-10",
};

const planParams = { productName: "Arda", planName: "Pro" };
const orderParams = { ...planParams, orderNo: "ORD-202609-1" };

interface Case {
  reference: MirrorReference;
  params: TemplateParams;
  severity: "info" | "warning";
  title: string;
  /** 警告类必须给：运营点开要能落到处理页。 */
  link?: string;
}

const CASES: Record<NotificationTemplateCode, Case> = {
  "subscription.expiring_soon": {
    reference: subRef,
    params: { ...planParams, endAt: "2026-09-10", days: 3 },
    severity: "info",
    title: "客户订阅即将到期 Arda Pro（2026-09-10）",
  },
  "subscription.expired": {
    reference: subRef,
    params: { ...planParams, endAt: "2026-09-10" },
    severity: "info",
    title: "客户订阅已到期 Arda Pro",
  },
  "subscription.renewed": {
    reference: orderRef,
    params: { ...orderParams, endAt: "2027-09-10", amount: "¥199.00" },
    severity: "info",
    title: "客户已续费 Arda Pro · ORD-202609-1",
  },
  "order.fulfilled": {
    reference: orderRef,
    params: { ...orderParams, endAt: "2027-09-10", amount: "¥199.00" },
    severity: "info",
    title: "订阅已开通 Arda Pro · ORD-202609-1",
  },
  "order.renewal_created": {
    reference: orderRef,
    params: { ...orderParams, amount: "¥199.00", payBy: "2026-10-01" },
    severity: "info",
    title: "已生成续费订单待付款 Arda Pro · ORD-202609-1",
  },
  "refund.requested": {
    reference: refundRef("requested"),
    params: { orderNo: "ORD-202609-1", amount: "¥99.00" },
    severity: "warning",
    title: "客户申请退款 ¥99.00 · ORD-202609-1",
    link: "/orders/ORD-202609-1",
  },
  "refund.approved": {
    reference: refundRef("approved"),
    params: { orderNo: "ORD-202609-1", amount: "¥99.00", reason: "ok" },
    severity: "info",
    title: "退款已审核通过 ¥99.00 · ORD-202609-1",
  },
  "refund.rejected": {
    reference: refundRef("rejected"),
    params: { orderNo: "ORD-202609-1", amount: "¥99.00", reason: "超期" },
    severity: "info",
    title: "退款申请已驳回 · ORD-202609-1",
  },
  "refund.completed": {
    reference: refundRef("completed"),
    params: { orderNo: "ORD-202609-1", amount: "¥99.00" },
    severity: "info",
    title: "退款已完成 ¥99.00 · ORD-202609-1",
  },
  "announcement.published": {
    reference: { type: "announcement", id: "ann-1" },
    params: { title: "维护通知", content: "周六 02:00 升级。" },
    severity: "info",
    title: "公告已推送：维护通知",
  },
  "tenant.invitation": {
    reference: { type: "invitation", id: "inv-1" },
    params: {
      tenantName: "Acme",
      inviterName: "Ann",
      roleName: "member",
      expiresAt: "2026-09-12",
    },
    severity: "info",
    title: "Acme 邀请了新成员（member）",
  },
  "order.payment_declared": {
    reference: orderRef,
    params: { ...orderParams, amount: "¥199.00" },
    severity: "warning",
    title: "客户已申报付款 ¥199.00 · ORD-202609-1，待确认收款",
    link: "/orders/ORD-202609-1",
  },
  "order.cancelled": {
    reference: orderRef,
    params: orderParams,
    severity: "info",
    title: "客户取消订单 · ORD-202609-1（Arda）",
  },
  "order.expired": {
    reference: orderRef,
    params: orderParams,
    severity: "info",
    title: "订单付款超时关闭 · ORD-202609-1（Arda）",
  },
  "tenant.converted": {
    reference: { type: "tenant", id: TENANT_ID },
    params: { tenantName: "Acme" },
    severity: "info",
    title: "Acme 已升为组织租户",
  },
  "subscription.cancelled_refunded": {
    reference: subRef,
    params: { ...orderParams, amount: "¥99.00" },
    severity: "warning",
    title: "客户退订并申请退款 Arda Pro · ORD-202609-1",
    link: "/orders/ORD-202609-1",
  },
  "subscription.cancelled_no_charge": {
    reference: subRef,
    params: { ...orderParams, amount: "¥0.00" },
    severity: "info",
    title: "客户退订 Arda Pro · ORD-202609-1（¥0 无收费）",
  },
  "subscription.cancelled_no_refund": {
    reference: subRef,
    params: { ...orderParams, amount: "¥99.00" },
    severity: "info",
    title: "客户退订 Arda Pro · ORD-202609-1（未退款：已过退款窗口）",
  },
  "subscription.suspension_ended": {
    reference: subRef,
    params: { ...planParams, endAt: "2026-09-10" },
    severity: "info",
    title: "暂停超期，订阅已终止 Arda Pro",
  },
  "subscription.overdue": {
    reference: subRef,
    params: { ...planParams, endAt: "2026-09-10", payBy: "2026-09-17" },
    severity: "info",
    title: "客户订阅进入欠费宽限期 Arda Pro（2026-09-17 前付款）",
  },
  "subscription.suspended": {
    reference: subRef,
    params: { ...planParams, endAt: "2026-09-10" },
    severity: "info",
    title: "订阅已暂停 Arda Pro",
  },
  "subscription.resumed": {
    reference: subRef,
    params: { ...planParams, endAt: "2026-09-10" },
    severity: "info",
    title: "订阅已恢复 Arda Pro",
  },
  "order.payment_rejected": {
    reference: orderRef,
    params: { ...orderParams, reason: "金额不符" },
    severity: "info",
    title: "付款申报已驳回 · ORD-202609-1",
  },
  "order.restored": {
    reference: orderRef,
    params: { ...orderParams, amount: "¥199.00" },
    severity: "info",
    title: "订单已恢复付款 ¥199.00 · ORD-202609-1",
  },
  "refund.failed": {
    reference: refundRef("failed"),
    params: { orderNo: "ORD-202609-1", amount: "¥99.00" },
    severity: "warning",
    title: "退款执行失败 · RFD-202609-1",
    link: "/orders/ORD-202609-1",
  },
};

const NOW = new Date("2026-09-28T10:00:00Z");

function compose(code: NotificationTemplateCode) {
  const c = CASES[code];
  const rendered = render(code, c.params, null, "zh-CN");
  return composeOperatorNotice({
    code,
    reference: c.reference,
    params: c.params,
    customer: { title: rendered.title, body: rendered.body },
    tenant: { name: "Acme", no: "8800000012" },
    // refund_no 只有库里有：这里模拟解析结果，解析本身在下面的 OperatorMirror 组里测。
    resolved: {
      orderNo: null,
      refundNo: c.reference.type === "refund" ? "RFD-202609-1" : null,
    },
    now: NOW,
  });
}

describe("OPERATOR_MIRROR 覆盖全部客户模板", () => {
  it("键集合与 NOTIFICATION_TEMPLATES 完全一致（类型之外再钉一次运行时）", () => {
    expect(Object.keys(OPERATOR_MIRROR).sort()).toEqual(
      Object.keys(NOTIFICATION_TEMPLATES).sort(),
    );
    expect(Object.keys(CASES).sort()).toEqual(
      Object.keys(NOTIFICATION_TEMPLATES).sort(),
    );
  });

  for (const code of Object.keys(CASES) as NotificationTemplateCode[]) {
    const c = CASES[code];
    it(`${code} → ${c.severity}：标题 / 去重键${c.link ? " / 链接" : ""}`, () => {
      const notice = compose(code);
      expect(notice.severity).toBe(c.severity);
      expect(notice.title).toBe(c.title);
      expect(notice.referenceType).toBe("customer_event");
      expect(notice.referenceId).toBe(
        `${code}:${c.reference.type}:${c.reference.id}`,
      );
      expect(notice.targetPlanes).toEqual(["admin"]);
      if (c.severity === "warning") {
        // 在等运营动手：不过期，直到处理。
        expect(notice.expiresAt).toBeNull();
        expect(notice.link).toBe(c.link);
      } else {
        expect(notice.expiresAt).toEqual(
          new Date(NOW.getTime() + OPERATOR_MIRROR_INFO_TTL_MS),
        );
      }
      // 完整一致：客户收到的那句话原文进正文。
      const rendered = render(code, c.params, null, "zh-CN");
      expect(notice.body).toContain(`客户收到：「${rendered.title}」`);
      expect(notice.body).toContain(rendered.body);
    });
  }
});

describe("composeOperatorNotice 正文与去重键", () => {
  it("正文 = 租户 · 产品 套餐 · 金额 · 客户原文，段间用「 · 」", () => {
    const notice = compose("refund.requested");
    expect(notice.body).toBe(
      "租户 Acme · ¥99.00 · 客户收到：「退款申请已收到：订单 ORD-202609-1」退款金额 ¥99.00，我们会尽快审核。",
    );
    const withPlan = compose("order.fulfilled");
    expect(withPlan.body.startsWith("租户 Acme · Arda Pro · ¥199.00 · ")).toBe(
      true,
    );
  });

  it("公告是广播：正文不带租户名", () => {
    const notice = compose("announcement.published");
    expect(notice.body).not.toContain("租户");
    expect(notice.body).toBe("客户收到：「维护通知」周六 02:00 升级。");
    expect(notice.link).toBeNull();
  });

  it("租户名查不到时正文从产品段开始，不留空段", () => {
    const c = CASES["order.fulfilled"];
    const rendered = render("order.fulfilled", c.params, null);
    const notice = composeOperatorNotice({
      code: "order.fulfilled",
      reference: c.reference,
      params: c.params,
      customer: rendered,
      tenant: { name: null, no: null },
      resolved: { orderNo: null, refundNo: null },
    });
    expect(notice.body.startsWith("Arda Pro · ¥199.00 · 客户收到")).toBe(true);
  });

  it("参数里没有 orderNo 时用解析出来的；有则参数优先", () => {
    const fromResolved = composeOperatorNotice({
      code: "order.cancelled",
      reference: orderRef,
      params: { productName: "Arda", planName: "Pro" },
      customer: { title: "t", body: "b" },
      tenant: { name: "Acme", no: "8800000012" },
      resolved: { orderNo: "ORD-RESOLVED", refundNo: null },
    });
    expect(fromResolved.title).toBe("客户取消订单 · ORD-RESOLVED（Arda）");
    expect(fromResolved.link).toBe("/orders/ORD-RESOLVED");

    const fromParams = composeOperatorNotice({
      code: "order.cancelled",
      reference: orderRef,
      params: { ...orderParams },
      customer: { title: "t", body: "b" },
      tenant: { name: "Acme", no: "8800000012" },
      resolved: { orderNo: "ORD-RESOLVED", refundNo: null },
    });
    expect(fromParams.link).toBe("/orders/ORD-202609-1");
  });

  it("refund.failed 没解析到 refund_no 时退回订单号，标题不留空", () => {
    const notice = composeOperatorNotice({
      code: "refund.failed",
      reference: refundRef("failed"),
      params: { orderNo: "ORD-202609-1", amount: "¥99.00" },
      customer: { title: "t", body: "b" },
      tenant: { name: null, no: null },
      resolved: { orderNo: null, refundNo: null },
    });
    expect(notice.title).toBe("退款执行失败 · ORD-202609-1");
  });

  it("去重键 = 模板:引用类型:引用id，最长组合仍在 reference_id varchar(128) 之内", () => {
    const longest = (Object.keys(CASES) as NotificationTemplateCode[]).reduce(
      (a, b) => (b.length > a.length ? b : a),
    );
    const key = mirrorDedupeKey(longest, refundRef("requested"));
    expect(key).toBe(`${longest}:refund:${REFUND_ID}:requested`);
    expect(key.length).toBeLessThanOrEqual(128);
  });

  it("链接规则：orderNo → /orders；租户引用 → /tenants；其余 null；只放可视码", () => {
    expect(mirrorLink("subscription", { orderNo: "ORD-1" }, "88")).toBe(
      "/orders/ORD-1",
    );
    expect(mirrorLink("tenant", {}, "8800000012")).toBe("/tenants/8800000012");
    expect(mirrorLink("tenant", {}, null)).toBeNull();
    expect(
      mirrorLink("subscription", { productName: "Arda" }, "88"),
    ).toBeNull();
    expect(mirrorLink("invitation", {}, "88")).toBeNull();
    // 租户引用带 orderNo 时订单页优先——它更具体。
    expect(mirrorLink("tenant", { orderNo: "ORD-1" }, "88")).toBe(
      "/orders/ORD-1",
    );
  });

  it("租户引用给租户页链接", () => {
    expect(compose("tenant.converted").link).toBe("/tenants/8800000012");
  });
});

/**
 * 假 pool：只装三条查询与一个写侧。未知 SQL 一律抛——多出一条查询不该静默变成
 * 「查不到」。
 */
function fakePool(opts: {
  tenant?: { tenant_no: string; tenant_name: string | null } | null;
  order?: { order_no: string } | null;
  refund?: { refund_no: string; order_no: string | null } | null;
  failTenant?: boolean;
}) {
  const seen = { tenant: 0, order: 0, refund: 0 };
  const query = vi.fn(async (sql: string, _params: unknown[] = []) => {
    if (sql === MIRROR_TENANT_SQL) {
      seen.tenant += 1;
      if (opts.failTenant) throw new Error("tenants unreachable");
      return { rows: opts.tenant ? [opts.tenant] : [], rowCount: 0 };
    }
    if (sql === MIRROR_ORDER_SQL) {
      seen.order += 1;
      return { rows: opts.order ? [opts.order] : [], rowCount: 0 };
    }
    if (sql === MIRROR_REFUND_SQL) {
      seen.refund += 1;
      return { rows: opts.refund ? [opts.refund] : [], rowCount: 0 };
    }
    throw new Error(`unexpected sql: ${sql}`);
  });
  return { pool: { query } as unknown as Pool, query, seen };
}

function writer(impl?: () => Promise<never>) {
  const written: CreateSystemNoticeInput[] = [];
  const createSystemNotice = vi.fn(async (input: CreateSystemNoticeInput) => {
    if (impl) await impl();
    written.push(input);
    return { inserted: true, id: `n-${written.length}` };
  });
  return { notices: { createSystemNotice }, written, createSystemNotice };
}

const customer = { title: "客户标题", body: "客户正文" };
const silent = { warn: () => {} };

describe("OperatorMirror（解析与降级）", () => {
  it("订单引用、参数缺 orderNo → 按 uuid 查一次 order_no，进标题与链接", async () => {
    const f = fakePool({
      tenant: { tenant_no: "8800000012", tenant_name: "Acme" },
      order: { order_no: "ORD-DB" },
    });
    const w = writer();
    await new OperatorMirror(f.pool, w.notices, silent).mirror(
      {
        tenantId: TENANT_ID,
        templateCode: "order.restored",
        reference: orderRef,
        params: { productName: "Arda", planName: "Pro", amount: "¥1.00" },
      },
      customer,
    );
    expect(f.query).toHaveBeenCalledWith(MIRROR_ORDER_SQL, [ORDER_ID]);
    expect(w.written[0]!.title).toBe("订单已恢复付款 ¥1.00 · ORD-DB");
    expect(w.written[0]!.link).toBe("/orders/ORD-DB");
    expect(w.written[0]!.body).toContain("租户 Acme");
  });

  it("订单引用、参数已带 orderNo → 不查订单表", async () => {
    const f = fakePool({ tenant: { tenant_no: "1", tenant_name: "Acme" } });
    const w = writer();
    await new OperatorMirror(f.pool, w.notices, silent).mirror(
      {
        tenantId: TENANT_ID,
        templateCode: "order.cancelled",
        reference: orderRef,
        params: orderParams,
      },
      customer,
    );
    expect(f.seen.order).toBe(0);
    expect(w.written[0]!.link).toBe("/orders/ORD-202609-1");
  });

  it("退款引用 `{uuid}:{阶段}` → 拆出 uuid 查退款单；refund_no 进「退款执行失败」标题", async () => {
    const f = fakePool({
      tenant: { tenant_no: "1", tenant_name: "Acme" },
      refund: { refund_no: "RFD-DB", order_no: "ORD-DB" },
    });
    const w = writer();
    await new OperatorMirror(f.pool, w.notices, silent).mirror(
      {
        tenantId: TENANT_ID,
        templateCode: "refund.failed",
        reference: refundRef("failed"),
        params: { orderNo: "ORD-202609-1", amount: "¥99.00" },
      },
      customer,
    );
    expect(f.query).toHaveBeenCalledWith(MIRROR_REFUND_SQL, [REFUND_ID]);
    expect(w.written[0]!.title).toBe("退款执行失败 · RFD-DB");
    // 参数里的 orderNo 优先于库里查到的。
    expect(w.written[0]!.link).toBe("/orders/ORD-202609-1");
    expect(w.written[0]!.severity).toBe("warning");
    expect(w.written[0]!.expiresAt).toBeNull();
  });

  it("形状不像 uuid 的引用不查库（免得 22P02），链接为 null", async () => {
    const f = fakePool({ tenant: { tenant_no: "1", tenant_name: "Acme" } });
    const w = writer();
    await new OperatorMirror(f.pool, w.notices, silent).mirror(
      {
        tenantId: TENANT_ID,
        templateCode: "subscription.expired",
        reference: subRef,
        params: planParams,
      },
      customer,
    );
    expect(f.seen.order + f.seen.refund).toBe(0);
    expect(w.written[0]!.link).toBeNull();
  });

  it("租户引用 → /tenants/{tenant_no}", async () => {
    const f = fakePool({
      tenant: { tenant_no: "8800000012", tenant_name: "Acme" },
    });
    const w = writer();
    await new OperatorMirror(f.pool, w.notices, silent).mirror(
      {
        tenantId: TENANT_ID,
        templateCode: "tenant.converted",
        reference: { type: "tenant", id: TENANT_ID },
        params: { tenantName: "Acme" },
      },
      customer,
    );
    expect(w.written[0]!.link).toBe("/tenants/8800000012");
  });

  it("公告不查租户", async () => {
    const f = fakePool({ tenant: { tenant_no: "1", tenant_name: "Acme" } });
    const w = writer();
    await new OperatorMirror(f.pool, w.notices, silent).mirror(
      {
        tenantId: TENANT_ID,
        templateCode: "announcement.published",
        reference: { type: "announcement", id: "ann-1" },
        params: { title: "维护", content: "c" },
      },
      customer,
    );
    expect(f.seen.tenant).toBe(0);
    expect(w.written).toHaveLength(1);
  });

  it("租户查询抛 → 记日志、照样写通告（只是不带租户名）", async () => {
    const f = fakePool({ failTenant: true });
    const w = writer();
    const warn = vi.fn();
    await new OperatorMirror(f.pool, w.notices, { warn }).mirror(
      {
        tenantId: TENANT_ID,
        templateCode: "order.cancelled",
        reference: orderRef,
        params: orderParams,
      },
      customer,
    );
    expect(w.written).toHaveLength(1);
    expect(w.written[0]!.body).not.toContain("租户");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain("tenant lookup failed");
  });

  it("写库抛 → 记日志、不抛出", async () => {
    const f = fakePool({ tenant: { tenant_no: "1", tenant_name: "Acme" } });
    const w = writer(async () => {
      throw new Error("operator_notices down");
    });
    const warn = vi.fn();
    await expect(
      new OperatorMirror(f.pool, w.notices, { warn }).mirror(
        {
          tenantId: TENANT_ID,
          templateCode: "refund.requested",
          reference: refundRef("requested"),
          params: { orderNo: "ORD-1", amount: "¥99.00" },
        },
        customer,
      ),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain(
      "operator mirror skipped for refund.requested:refund:",
    );
  });
});

describe("镜像查询谓词", () => {
  it("租户名取 display_name 回落 name；tenant_no 转 text", () => {
    expect(MIRROR_TENANT_SQL).toContain(
      "coalesce(nullif(display_name, ''), name) as tenant_name",
    );
    expect(MIRROR_TENANT_SQL).toContain("tenant_no::text as tenant_no");
    expect(MIRROR_TENANT_SQL).toContain("from tenancy.tenants");
  });
  it("退款查询同时取 refund_no 与所属订单的 order_no", () => {
    expect(MIRROR_REFUND_SQL).toContain("select r.refund_no, o.order_no");
    expect(MIRROR_REFUND_SQL).toContain(
      "left join billing.orders o on o.id = r.order_id",
    );
    expect(MIRROR_ORDER_SQL).toBe(
      "select order_no from billing.orders where id = $1",
    );
  });
});
