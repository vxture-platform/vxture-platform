/**
 * audit-event-signals.spec.ts —— 运营动作巡检的纯映射：一行审计 → 一条通告。
 *
 * 这里钉五件在别处钉不到的事：
 *   · 白名单外的码**静默跳过**（返回 null）——审计表里天天有新码，当失败会让巡检
 *     天天红，而红的原因跟它自己无关；
 *   · **不是运营做的那一行不出通告**：同一张审计表还装着 console-bff 写的客户自助
 *     动作，两边的码真的撞（`tenant.member.remove`）。真库上的谓词由 itest 钉，这里
 *     钉纯函数那一道门；
 *   · 标题的宾语只能是可视码 / 名称，一个 UUID 都不许上屏（审计行的 resource_id
 *     有时是 uuid、有时是可视码，这正是最容易漏的地方）；
 *   · 多平面通告不给 link——同一件事在 opera 与 admin 的路由不是同一条，给了就有
 *     一半人点出 404；
 *   · 排除哪些族是**判断**（写在 audit-event-signals.ts 头注里），所以在这里钉住：
 *     哪天有人顺手把 atlas.* 加进去，得先看见这条测试。
 */
import { describe, expect, it } from "vitest";
import { NOTICE_PLANES, NOTICE_SEVERITIES } from "@vxture/service-notice";
import {
  AUDIT_ACTION_RULES,
  AUDIT_INFO_TTL_MS,
  AUDIT_REFERENCE_TYPE,
  AUDIT_SWEEP_SQL,
  AUDIT_WHITELIST_CODES,
  auditActorLabel,
  auditDedupeKey,
  auditDisplayKey,
  composeAuditNotice,
  type AuditSignalRow,
} from "./audit-event-signals";

const NOW = new Date("2026-09-28T12:00:00.000Z");
const UUID = "0198c4de-1f2b-4d3e-8a91-77b0c5e6d412";

const row = (over: Partial<AuditSignalRow>): AuditSignalRow => ({
  id: UUID,
  action: "tenant.suspend",
  actor_type: "operator",
  actor_console: "admin",
  occurred_text: "2026-09-28 20:00:00",
  ...over,
});

describe("运营动作巡检 —— 白名单不变式", () => {
  it("每条规则都有标题、合法平面、合法严重度；不占 critical 档", () => {
    for (const [code, rule] of Object.entries(AUDIT_ACTION_RULES)) {
      expect(rule.title.length, code).toBeGreaterThan(0);
      expect(rule.planes.length, code).toBeGreaterThan(0);
      for (const plane of rule.planes) {
        expect(NOTICE_PLANES, code).toContain(plane);
      }
      expect(NOTICE_SEVERITIES, code).toContain(rule.severity);
      // critical 留给运维事故；一次运营动作再重要也不占那一档。
      expect(rule.severity, code).not.toBe("critical");
    }
  });

  it("导出给 SQL 的码数组就是规则表的键", () => {
    expect([...AUDIT_WHITELIST_CODES].sort()).toEqual(
      Object.keys(AUDIT_ACTION_RULES).sort(),
    );
    for (const code of AUDIT_WHITELIST_CODES) {
      expect(code, code).toMatch(/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/);
    }
  });

  it("契约五个族的代表码都在", () => {
    for (const code of [
      "governance.maintenance.start",
      "catalog.product.delete",
      "product.plan_version.publish",
      "tenant.verification.approve",
      "governance.risk.create",
      "account.disable",
    ]) {
      expect(AUDIT_ACTION_RULES[code], code).toBeDefined();
    }
  });

  it("有意排除的族确实不在（改这条等于改判断，见文件头注）", () => {
    const excluded = AUDIT_WHITELIST_CODES.filter(
      (c) =>
        c.startsWith("atlas.") ||
        c.startsWith("runos.") ||
        c.startsWith("operator.") ||
        c.startsWith("platform.setting") ||
        c.startsWith("governance.feature_flag.") ||
        c.startsWith("governance.compliance.") ||
        c.startsWith("governance.operator_notice.") ||
        c.startsWith("subscription.") ||
        c.startsWith("order."),
    );
    expect(excluded).toEqual([]);
  });

  it("逐个排除的码也不在：无租户的风险三兄弟 / 客户自助的邀请 / 仓里不存在的码", () => {
    // arche-bff 的审计写入没有 tenant_id 列，这三处的 after 里也没有 tenantId：
    // 收进来只会产出说不出是哪个租户的通告。要收，先让 arche-bff 补 tenantId。
    for (const code of [
      "governance.risk.update",
      "governance.risk.review",
      "governance.risk.delete",
    ]) {
      expect(AUDIT_ACTION_RULES[code], code).toBeUndefined();
    }
    // 只有 console-bff 的客户自助写它，admin-bff 没有邀请成员的端点。
    expect(AUDIT_ACTION_RULES["tenant.member.invite"]).toBeUndefined();
    // 契约提过但仓里 0 命中；产品上线 / 停用 / 退役走 product.content.update 的
    // before/after.release_stage，那个码在白名单里——所以不是漏了一族。
    expect(AUDIT_ACTION_RULES["catalog.product.state"]).toBeUndefined();
    expect(AUDIT_ACTION_RULES["product.content.update"]).toBeDefined();
  });
});

describe("运营动作巡检 —— SQL", () => {
  it("三个绑定参数各就各位，不拼串", () => {
    expect(AUDIT_SWEEP_SQL.includes("${")).toBe(false);
    expect(AUDIT_SWEEP_SQL).toContain("make_interval(mins => $1::int)");
    expect(AUDIT_SWEEP_SQL).toContain("a.action = any($2::text[])");
    expect(AUDIT_SWEEP_SQL).toContain("limit $3::int");
  });

  it("只取成功的行 —— denied / failure 照这套标题会说成事情发生了", () => {
    expect(AUDIT_SWEEP_SQL).toContain("a.result = 'success'");
  });

  it("只取运营做的那些行 —— 同一张表还装着 console-bff 的客户自助动作", () => {
    expect(AUDIT_SWEEP_SQL).toContain("a.actor_type = 'operator'");
    // 客户主体的真名 join 已经拆掉：一行都匹配不到的 join 只会误导读代码的人。
    expect(AUDIT_SWEEP_SQL).not.toContain("actor_name");
    expect(AUDIT_SWEEP_SQL).not.toContain("k.actor_type = 'customer'");
  });

  it("解 U- 码的 join 收两个 resource_type（成员类写的是 tenant_member）", () => {
    expect(AUDIT_SWEEP_SQL).toContain(
      "k.resource_type in ('account_user', 'tenant_member')",
    );
  });

  it("时刻串在库里拼（Asia/Shanghai，到秒），进程侧不手搓日期格式", () => {
    expect(AUDIT_SWEEP_SQL).toContain("at time zone 'Asia/Shanghai'");
    expect(AUDIT_SWEEP_SQL).toContain("YYYY-MM-DD HH24:MI:SS");
  });

  it("resource_id 先挡形状再转 uuid —— 可视码那些行直接 ::uuid 会抛 22P02", () => {
    expect(AUDIT_SWEEP_SQL).toContain("[0-9a-f]{8}");
    expect(AUDIT_SWEEP_SQL).toContain("as resource_uuid");
  });
});

describe("运营动作巡检 —— 主语", () => {
  it("运营主体按控制台给称谓（真名读不到，见头注）", () => {
    expect(auditActorLabel(row({ actor_console: "opera" }))).toBe(
      "运维台操作员",
    );
    expect(auditActorLabel(row({ actor_console: "admin" }))).toBe(
      "运营台操作员",
    );
    expect(auditActorLabel(row({ actor_console: "arche" }))).toBe(
      "治理台操作员",
    );
    expect(auditActorLabel(row({ actor_console: null }))).toBe("运营人员");
    expect(auditActorLabel(row({ actor_console: "something-new" }))).toBe(
      "运营人员",
    );
  });

  it("system / api / 无名客户 / 未知各有称谓", () => {
    expect(auditActorLabel(row({ actor_type: "system" }))).toBe("系统");
    expect(auditActorLabel(row({ actor_type: "api" }))).toBe("接口调用方");
    expect(auditActorLabel(row({ actor_type: "customer" }))).toBe("客户");
    expect(auditActorLabel(row({ actor_type: "ghost" }))).toBe("未知主体");
  });
});

describe("运营动作巡检 —— 宾语", () => {
  it("优先用审计行自己写下的可视键", () => {
    expect(
      auditDisplayKey(row({ literal_key: "atlas", product_code: "karda" })),
    ).toBe("atlas");
  });

  it("其次窗口标题 → 产品码 → U- 码 → 租户名（T- 码）", () => {
    expect(auditDisplayKey(row({ window_title: "九月例行维护" }))).toBe(
      "九月例行维护",
    );
    expect(auditDisplayKey(row({ product_code: "karda" }))).toBe("karda");
    expect(auditDisplayKey(row({ user_no: "1799729056" }))).toBe(
      "U-1799729056",
    );
    expect(
      auditDisplayKey(
        row({ tenant_no: "2143889307", tenant_name: "示例科技" }),
      ),
    ).toBe("示例科技（T-2143889307）");
    expect(auditDisplayKey(row({ tenant_no: "2143889307" }))).toBe(
      "T-2143889307",
    );
  });

  it("成员类（resource_type='tenant_member'）两个主体一起说", () => {
    expect(
      auditDisplayKey(
        row({
          action: "tenant.member.role_change",
          resource_type: "tenant_member",
          user_no: "1799729056",
          tenant_no: "2143889307",
          tenant_name: "示例科技",
        }),
      ),
    ).toBe("示例科技（T-2143889307）的成员 U-1799729056");
    // 租户解不出来时退回只说人，不硬凑一句半截话。
    expect(
      auditDisplayKey(
        row({ resource_type: "tenant_member", user_no: "1799729056" }),
      ),
    ).toBe("U-1799729056");
    // 处置账号那类的 resource_type 是 account_user，宾语就是那个人（admin-bff 没写
    // tenant_id，所以本来也没有租户可说）。
    expect(
      auditDisplayKey(
        row({
          action: "account.disable",
          resource_type: "account_user",
          user_no: "1799729056",
        }),
      ),
    ).toBe("U-1799729056");
  });

  it("一个都解不出就 null —— 标题只剩主句，绝不退而求其次放 uuid", () => {
    expect(auditDisplayKey(row({}))).toBeNull();
    expect(composeAuditNotice(row({}), NOW)?.title).toBe("租户已暂停");
  });
});

describe("运营动作巡检 —— 通告", () => {
  it("白名单外的码返回 null（静默跳过，不是错误）", () => {
    expect(
      composeAuditNotice(row({ action: "atlas.model.create" }), NOW),
    ).toBeNull();
    expect(
      composeAuditNotice(row({ action: "brand.new.code" }), NOW),
    ).toBeNull();
  });

  it("客户自助那一行一条都不出 —— 码撞了，主体没撞", () => {
    // console-bff 的 auditCustomerAction 写的就是这个形状：客户在控制台自己移除
    // 团队成员，actor_type='customer' / actor_console='console'，动作码与运营代
    // 租户移除成员**一模一样**。它要是出了通告，运营板上会多一条「运营移除了成员」，
    // 而那件事没人做过。
    for (const action of [
      "tenant.member.remove",
      "tenant.member.suspend",
      "tenant.suspend",
    ]) {
      expect(
        composeAuditNotice(
          row({
            action,
            actor_type: "customer",
            actor_console: "console",
            resource_type: "member",
            tenant_no: "2143889307",
            tenant_name: "示例科技",
          }),
          NOW,
        ),
        action,
      ).toBeNull();
    }
    // system（auth-bff 的后台换票）与 api 同理。
    expect(composeAuditNotice(row({ actor_type: "system" }), NOW)).toBeNull();
    expect(composeAuditNotice(row({ actor_type: "api" }), NOW)).toBeNull();
  });

  it("运营移除成员：宾语同时说租户和那个人，链接落租户详情（成员名单在那一页）", () => {
    const notice = composeAuditNotice(
      row({
        action: "tenant.member.remove",
        resource_type: "tenant_member",
        user_no: "1799729056",
        tenant_no: "2143889307",
        tenant_name: "示例科技",
      }),
      NOW,
    );
    expect(notice?.severity).toBe("warning");
    expect(notice?.title).toBe(
      "租户成员已移除：示例科技（T-2143889307）的成员 U-1799729056",
    );
    expect(notice?.link).toBe("/tenants/2143889307");
  });

  it("维护开始：warning、opera + admin 双平面、因此不给链接", () => {
    const notice = composeAuditNotice(
      row({
        action: "governance.maintenance.start",
        actor_console: "opera",
        window_title: "九月例行维护",
      }),
      NOW,
    );
    expect(notice).not.toBeNull();
    expect(notice?.severity).toBe("warning");
    expect(notice?.targetPlanes).toEqual(["opera", "admin"]);
    expect(notice?.title).toBe("维护开始：九月例行维护");
    expect(notice?.body).toBe(
      "运维台操作员 于 2026-09-28 20:00:00 执行 维护开始 · 对象 九月例行维护",
    );
    expect(notice?.link).toBeNull();
    expect(notice?.expiresAt).toBeNull();
  });

  it("产品内容更新：只投 opera，链接落 opera 的产品详情页", () => {
    const notice = composeAuditNotice(
      row({
        action: "product.content.update",
        actor_console: "admin",
        literal_key: "karda",
      }),
      NOW,
    );
    expect(notice?.targetPlanes).toEqual(["opera"]);
    expect(notice?.severity).toBe("info");
    expect(notice?.title).toBe("产品内容已更新：karda");
    expect(notice?.link).toBe("/product/catalog/karda");
    expect(notice?.expiresAt).toEqual(
      new Date(NOW.getTime() + AUDIT_INFO_TTL_MS),
    );
  });

  it("套餐类只投 opera 但那里没有详情页 —— 不给链接", () => {
    const notice = composeAuditNotice(
      row({ action: "product.plan.delete", literal_key: "karda-pro" }),
      NOW,
    );
    expect(notice?.severity).toBe("warning");
    expect(notice?.title).toBe("套餐已删除：karda-pro");
    expect(notice?.link).toBeNull();
  });

  it("产品删除：opera + admin，warning，宾语是审计行留下的产品码", () => {
    const notice = composeAuditNotice(
      row({ action: "catalog.product.delete", literal_key: "retired-product" }),
      NOW,
    );
    expect(notice?.severity).toBe("warning");
    expect(notice?.title).toBe("产品已删除：retired-product");
    expect(notice?.link).toBeNull();
  });

  it("租户暂停：只投 admin，链接走 tenant_no", () => {
    const notice = composeAuditNotice(
      row({
        action: "tenant.suspend",
        tenant_no: "2143889307",
        tenant_name: "示例科技",
      }),
      NOW,
    );
    expect(notice?.targetPlanes).toEqual(["admin"]);
    expect(notice?.severity).toBe("warning");
    expect(notice?.title).toBe("租户已暂停：示例科技（T-2143889307）");
    expect(notice?.body).toContain("租户 示例科技");
    expect(notice?.link).toBe("/tenants/2143889307");
  });

  it("客户账号停用：链接走 user_no（account_user 的 resource_id 是 uuid）", () => {
    const notice = composeAuditNotice(
      row({ action: "account.disable", user_no: "1799729056" }),
      NOW,
    );
    expect(notice?.title).toBe("客户账号已停用：U-1799729056");
    expect(notice?.link).toBe("/accounts/1799729056");
  });

  it("风险标记：warning，落 admin 的租户详情（契约 B 段第 5 行的「风险变更」）", () => {
    const notice = composeAuditNotice(
      row({
        action: "governance.risk.create",
        actor_console: "arche",
        tenant_no: "2143889307",
        tenant_name: "示例科技",
      }),
      NOW,
    );
    expect(notice?.severity).toBe("warning");
    expect(notice?.title).toBe("租户风险标记已建立：示例科技（T-2143889307）");
    expect(notice?.body).toContain("治理台操作员 于 2026-09-28 20:00:00 执行");
    expect(notice?.link).toBe("/tenants/2143889307");
  });

  it("去重锚是 audit:{审计行 id}，且 uuid 只出现在那里", () => {
    const notice = composeAuditNotice(row({}), NOW);
    expect(notice?.referenceType).toBe(AUDIT_REFERENCE_TYPE);
    expect(notice?.referenceId).toBe(`audit:${UUID}`);
    expect(auditDedupeKey(UUID)).toBe(`audit:${UUID}`);
    expect(notice?.title).not.toContain(UUID);
    expect(notice?.body).not.toContain(UUID);
    expect(notice?.link ?? "").not.toContain(UUID);
    expect(notice?.referenceId.length ?? 0).toBeLessThanOrEqual(128);
  });

  it("每条规则都能在只有 id / action / 时刻的最小行上出一条通告", () => {
    for (const code of AUDIT_WHITELIST_CODES) {
      const notice = composeAuditNotice(row({ action: code }), NOW);
      expect(notice, code).not.toBeNull();
      expect(notice?.title.length ?? 0, code).toBeGreaterThan(0);
      expect(notice?.title.length ?? 0, code).toBeLessThanOrEqual(256);
      expect(notice?.body ?? "", code).toContain("执行");
    }
  });
});
