/**
 * operator-alerts.wiring.spec.ts —— **外来的字**进运营告警之前要过哪两道
 * （2026-09-28 第二批修补 + 批 3 复审补）。
 *
 * 为什么单独钉这一条：这几条告警的正文里有一段不是我们自己写的字——心跳里的
 * last_error、自愈记下的最后一次失败原因、**运营自己填的维护窗口标题**。
 * 前两样是作业抛什么就存什么，最常见的形状恰恰是「订阅 {uuid} 不存在」或 pg 把整行
 * 冲突键值打出来。于是「通告里不出现 UUID」这条铁律在自己的代码里守得住、在别人的
 * 文本上一路漏——而且**不报错**：页面照渲染，只是运营看到一串谁也查不了的十六进制。
 *
 * 第二道是长度与唯一性：外来的字还会被当去重键用。窗口标题是 varchar(256) 且没有唯一
 * 约束，而 `notification_logs.reference_id` 是 varchar(128) 且 dispatcher 不截它——
 * 详见下面 `todoAlertInput` 那一组。
 *
 * 通告与邮件两半都要过一遍（邮件同样是人在读）。静默 / 失败的裁定本身在 job-health.spec，
 * 去重键与平面在 job-health-alert.job.spec，这里不重复。
 */
import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import type {
  OperatorAlertInput,
  OperatorAlertResult,
} from "@vxture/service-notification";
import type { OpsTodo } from "@vxture/service-ops-todos";
import type { CreateSystemNoticeInput } from "@vxture/service-notice";
import {
  OperatorAlertsWiring,
  composeEscalatedTodoNotice,
  composeJobHealthNotice,
  composeSelfHealGaveUpNotice,
  todoAlertInput,
} from "./operator-alerts.wiring";
import { OPS_NOTICE_REFERENCE_ID_MAX } from "./ops-notice";

/** pg 的唯一键冲突原文——uuid 在里面，而且不止一个。 */
const PG_ERROR =
  'error: duplicate key value violates unique constraint "uidx_orders_live"\n' +
  "DETAIL: Key (subscription_id, plan_version_id)=" +
  "(11111111-1111-4111-8111-111111111111, 22222222-2222-4222-8222-222222222222) already exists.";

const UUID_SHAPE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

describe("composeJobHealthNotice —— 心跳里的错误原文", () => {
  const facts = {
    verdict: "failed" as const,
    jobName: "subscription-renewal",
    idleMs: 0,
    thresholdMs: 5 * 60_000,
    intervalMs: 60_000,
    lastError: PG_ERROR,
    failureCount: 2,
    lastStartedAt: new Date("2026-09-28T11:59:00.000Z"),
    now: new Date("2026-09-28T12:00:00.000Z"),
  };

  it("正文里一个 uuid 都不剩，但错误本身仍然读得出来", () => {
    const notice = composeJobHealthNotice(facts);
    expect(notice.body).not.toMatch(UUID_SHAPE);
    expect(notice.body).toContain("已隐去内部 id");
    // 抹的只是 uuid：约束名与 SQLSTATE 一类定位线索必须留着。
    expect(notice.body).toContain("uidx_orders_live");
    expect(notice.body).toContain("duplicate key");
  });

  it("uuid 被切在截断边界上也不会留半截", () => {
    const notice = composeJobHealthNotice({
      ...facts,
      lastError: "x".repeat(790) + " 11111111-1111-4111-8111-111111111111 tail",
    });
    expect(notice.body).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i);
  });
});

describe("composeSelfHealGaveUpNotice —— 最后一次失败原因", () => {
  it("正文里不出现 uuid（这条是 critical，最会被人转出去的一条）", () => {
    const notice = composeSelfHealGaveUpNotice({
      orderNo: "SO202600100",
      attempts: 3,
      lastError:
        "provisioning timeout for subscription " +
        "33333333-3333-4333-8333-333333333333",
    });
    expect(notice.body).not.toMatch(UUID_SHAPE);
    expect(notice.body).toContain("已隐去内部 id");
    expect(notice.body).toContain("provisioning timeout");
    // 可视码照旧上屏（标题、链接都靠它）。
    expect(notice.title).toContain("SO202600100");
  });
});

/* ── 升档待办的那一条 critical 通告（2026-09-28 第三批）──────────────────────── */

const escalatedTodo = (over: Partial<OpsTodo> = {}): OpsTodo => ({
  id: "confirm_payment:ORD-1",
  kind: "confirm_payment",
  severity: "rose",
  priority: 2,
  subject: { type: "order", no: "ORD-1" },
  tenant: {
    no: "200000010",
    name: "示例租户",
    type: "company",
    status: "active",
    riskLevel: null,
    region: null,
    industry: null,
    scale: null,
  },
  applicant: null,
  amount: { value: "99.00", currency: "CNY", paid: null },
  product: null,
  progress: "pendingVerify",
  waitingSince: new Date(Date.now() - 5 * 3_600_000).toISOString(),
  href: "/orders/ORD-1",
  escalated: true,
  escalationStep: 1,
  ...over,
});

describe("composeEscalatedTodoNotice", () => {
  it("有处置页的那一类：critical、只投 admin、不过期，链接就是待办的处置页", () => {
    const notice = composeEscalatedTodoNotice(escalatedTodo());
    expect(notice).toMatchObject({
      targetPlanes: ["admin"],
      severity: "critical",
      link: "/orders/ORD-1",
      referenceType: "ops_signal",
      expiresAt: null,
    });
    expect(notice.title).toContain("订单 ORD-1");
    expect(notice.body).toContain("示例租户");
    expect(notice.body).toContain("¥99.00");
  });

  /**
   * 去重键带级数：每跨过一个阈值倍数写一条。少了这一格，一件事只会播一条，
   * 拖多久都不再出声——那正是 4h 静默窗口已经有的毛病，通告不该重犯。
   */
  it("去重键 = 类别:可视码:级数，级数不同即不同键", () => {
    const first = composeEscalatedTodoNotice(
      escalatedTodo({ escalationStep: 1 }),
    );
    const third = composeEscalatedTodoNotice(
      escalatedTodo({ escalationStep: 3 }),
    );
    expect(first.referenceId).toBe("confirm_payment:ORD-1:1");
    expect(third.referenceId).toBe("confirm_payment:ORD-1:3");
    expect(first.referenceId).not.toBe(third.referenceId);
    // 同一级数同一条单 → 同一个键（一步只播一条）。
    expect(
      composeEscalatedTodoNotice(escalatedTodo({ escalationStep: 1 }))
        .referenceId,
    ).toBe(first.referenceId);
  });

  /**
   * 平面跟着「这活在哪儿干」走（2026-09-28 批 5 修）。维护窗口超时的 href 为 null 正是
   * 因为处置面在运维台；此前这一条写死 admin ⇒ 「窗口跑过了计划结束时间」这件事唯一的
   * 信号投给了一个没人能结束它的平面。两个平面都投：客户还被锁在产品外面，运营台该看见。
   * 链接仍然是 null——通告的 link 是平面内相对路径，给 opera 的路径在 admin 里点开 404。
   */
  it("没有处置页的那一类：投运维台 + 运营台两个平面", () => {
    const notice = composeEscalatedTodoNotice(
      escalatedTodo({
        kind: "maintenance_overdue",
        subject: { type: "maintenance", no: "数据库主从切换" },
        tenant: null,
        amount: null,
        href: null,
      }),
    );
    expect(notice.targetPlanes).toEqual(["opera", "admin"]);
    expect(notice.link).toBeNull();
  });

  it("没有处置页的那一类：不给链接，正文说去运维台", () => {
    const notice = composeEscalatedTodoNotice(
      escalatedTodo({
        id: "maintenance_overdue:aaaaaaaa-1111-4111-8111-111111111111",
        kind: "maintenance_overdue",
        subject: { type: "maintenance", no: "数据库主从切换" },
        tenant: null,
        amount: null,
        href: null,
        escalationStep: 2,
      }),
    );
    expect(notice.link).toBeNull();
    expect(notice.body).toContain("运维台");
    // 上屏的是称呼（窗口标题）。
    expect(notice.title).toContain("维护窗口 数据库主从切换");
    // 去重键跟**身份**走（窗口标题不唯一），且只进库不上屏。
    expect(notice.referenceId).toBe(
      "maintenance_overdue:aaaaaaaa-1111-4111-8111-111111111111:2",
    );
    expect(notice.title).not.toMatch(UUID_SHAPE);
    expect(notice.body).not.toMatch(UUID_SHAPE);
  });

  it("主体码里混进外来文本也不会把 uuid 带上屏（窗口标题是人填的）", () => {
    const notice = composeEscalatedTodoNotice(
      escalatedTodo({
        kind: "maintenance_overdue",
        subject: {
          type: "maintenance",
          no: "回滚 55555555-5555-4555-8555-555555555555",
        },
        tenant: null,
        amount: null,
        href: null,
      }),
    );
    expect(notice.body).not.toMatch(UUID_SHAPE);
    expect(notice.body).toContain("已隐去内部 id");
  });
});

/* ── 邮件素材：维护窗口那一支的两道处理（2026-09-28 批 3 复审补）───────────────── */

/**
 * 这一支的主体码是**运营在运维台自己填的一段自由文本**（窗口标题，varchar(256)），
 * 别的类别都是我们自己发的号。于是它有两个别处没有的坏法，两个都不报错：
 *
 *   ① 标题当去重键：`support.notification_logs.reference_id` 是 varchar(128)，
 *      dispatcher 写账本时**不截**这一列。超长是 22001，账本写不进去——而账本正是下一轮
 *      去重的唯一依据，于是同一条告警每个 tick 重发一次。就算不超长，两个前缀相同的
 *      长标题截断后还会撞成一条：后一个窗口的告警被前一个的 4h 静默窗口吞掉。
 *   ② 标题原样进主题 / 正文：运营把一个内部 id 粘进窗口标题是常事，而邮件也是人在读。
 */
describe("todoAlertInput —— 维护窗口的标题是运营自由文本", () => {
  const maintenanceTodo = (over: Partial<OpsTodo> = {}): OpsTodo =>
    escalatedTodo({
      id: "maintenance_overdue:aaaaaaaa-1111-4111-8111-111111111111",
      kind: "maintenance_overdue",
      subject: { type: "maintenance", no: "数据库主从切换" },
      tenant: null,
      amount: null,
      href: null,
      escalated: false,
      escalationStep: 0,
      ...over,
    });

  it("去重键收口在 reference_id 的列宽（varchar(128)）之内", () => {
    const input = todoAlertInput(
      maintenanceTodo({
        subject: { type: "maintenance", no: "例".repeat(256) },
      }),
      { link: undefined },
    );
    expect(input.reference.type).toBe("maintenance_window");
    expect(input.reference.id.length).toBeLessThanOrEqual(
      OPS_NOTICE_REFERENCE_ID_MAX,
    );
  });

  /**
   * opera-bff 收的标题可到 256 字。两个窗口取同一个超长标题（运营复制粘贴同一个名字，
   * 或只在结尾差一个字）时，键**必须**仍是两个——撞成一条就是后一个窗口的告警被
   * 前一个的静默窗口吞掉，而且台面上什么都看不出来。
   */
  it("两个超长且同前缀的标题：去重键仍然是两个", () => {
    const longTitle = "数据库主从切换".repeat(40); // 280 字，远超 128
    const first = todoAlertInput(
      maintenanceTodo({
        id: "maintenance_overdue:aaaaaaaa-1111-4111-8111-111111111111",
        subject: { type: "maintenance", no: longTitle },
      }),
      { link: undefined },
    );
    const second = todoAlertInput(
      maintenanceTodo({
        id: "maintenance_overdue:bbbbbbbb-2222-4222-8222-222222222222",
        subject: { type: "maintenance", no: `${longTitle}（第二轮）` },
      }),
      { link: undefined },
    );
    expect(first.reference.id).not.toBe(second.reference.id);
    for (const id of [first.reference.id, second.reference.id]) {
      expect(id.length).toBeLessThanOrEqual(OPS_NOTICE_REFERENCE_ID_MAX);
    }
  });

  /**
   * 连同名都不行：`admin.maintenance_windows.title` 上没有唯一约束，运营反复用
   * 「例行维护」是常态。两个同名窗口同时超时，键按标题算就只剩一个。
   */
  it("两个同名窗口：去重键仍然是两个（标题上没有唯一约束）", () => {
    const same = { type: "maintenance" as const, no: "例行维护" };
    const first = todoAlertInput(
      maintenanceTodo({
        id: "maintenance_overdue:aaaaaaaa-1111-4111-8111-111111111111",
        subject: same,
      }),
      { link: undefined },
    );
    const second = todoAlertInput(
      maintenanceTodo({
        id: "maintenance_overdue:bbbbbbbb-2222-4222-8222-222222222222",
        subject: same,
      }),
      { link: undefined },
    );
    expect(first.reference.id).not.toBe(second.reference.id);
    // 主题仍然是那个名字——两封邮件长得一样是对的，它们说的是两件同名的事。
    expect(first.subject).toContain("例行维护");
    expect(second.subject).toContain("例行维护");
  });

  it("标题里粘了内部 id：主题与正文都抹过，通告那半同一口径", () => {
    const input = todoAlertInput(
      maintenanceTodo({
        subject: {
          type: "maintenance",
          no: "回滚 55555555-5555-4555-8555-555555555555",
        },
      }),
      { link: undefined },
    );
    expect(input.subject).not.toMatch(UUID_SHAPE);
    expect(input.lines.join("\n")).not.toMatch(UUID_SHAPE);
    expect(input.subject).toContain("已隐去内部 id");
    // 抹的只是 uuid，运营写的那几个字要留着。
    expect(input.lines.join("\n")).toContain("回滚");
    // 身份进了去重键，但一个字都没上屏。
    expect(input.reference.id).toMatch(UUID_SHAPE);
  });
});

/**
 * 邮件那一半。dispatcher 换成假的：真 dispatcher 要查静默窗口与运营账号表，
 * 而这里要断言的是**送给它的素材**，不是它怎么发。
 * 通告写侧也换成假的，好断言「升档才写、写几条、写的是什么键」。
 */
function wiringWithCapture(): {
  wiring: OperatorAlertsWiring;
  sent: () => OperatorAlertInput[];
  notices: () => CreateSystemNoticeInput[];
} {
  const captured: OperatorAlertInput[] = [];
  const written: CreateSystemNoticeInput[] = [];
  const pool = {
    query: vi.fn(async () => ({ rows: [{ id: "notice-1" }], rowCount: 1 })),
  } as unknown as Pool;
  const wiring = new OperatorAlertsWiring(pool, {} as never);
  const alert = vi.fn(async (input: OperatorAlertInput) => {
    captured.push(input);
    const result: OperatorAlertResult = {
      sent: 1,
      failed: 0,
      suppressed: false,
      noRecipient: false,
    };
    return result;
  });
  (wiring as unknown as { dispatcher: { alert: typeof alert } }).dispatcher = {
    alert,
  };
  (
    wiring as unknown as {
      noticeWriter: {
        createSystemNotice: (i: CreateSystemNoticeInput) => Promise<unknown>;
      };
    }
  ).noticeWriter = {
    createSystemNotice: async (input: CreateSystemNoticeInput) => {
      written.push(input);
      return { inserted: true, id: "notice-1" };
    },
  };
  return { wiring, sent: () => captured, notices: () => written };
}

describe("OperatorAlertsWiring —— 邮件正文同样不许带 uuid", () => {
  it("作业失败：邮件的错误行抹过 uuid", async () => {
    const { wiring, sent } = wiringWithCapture();
    await wiring.alertJobHealth({
      verdict: "failed",
      jobName: "subscription-renewal",
      idleMs: 0,
      thresholdMs: 5 * 60_000,
      intervalMs: 60_000,
      lastError: PG_ERROR,
      failureCount: 2,
      lastStartedAt: new Date("2026-09-28T11:59:00.000Z"),
    });
    const lines = sent()[0]!.lines.join("\n");
    expect(lines).not.toMatch(UUID_SHAPE);
    expect(lines).toContain("已隐去内部 id");
    expect(lines).toContain("uidx_orders_live");
  });

  it("升档的待办：邮件照发，另外写一条 critical 通告", async () => {
    const { wiring, sent, notices } = wiringWithCapture();
    await wiring.alertTodo(escalatedTodo({ escalationStep: 2 }));
    // 邮件那一封照旧（4h 静默窗口在 dispatcher 里，这里只看素材送到了）。
    expect(sent()).toHaveLength(1);
    expect(sent()[0]!.code).toBe("ops.order.pending_verify");
    // 通告那一条：critical、带级数的去重键。
    expect(notices()).toHaveLength(1);
    expect(notices()[0]).toMatchObject({
      severity: "critical",
      targetPlanes: ["admin"],
      referenceId: "confirm_payment:ORD-1:2",
    });
  });

  it("没升档的待办：只发邮件，一条通告都不写", async () => {
    const { wiring, sent, notices } = wiringWithCapture();
    await wiring.alertTodo(
      escalatedTodo({ escalated: false, escalationStep: 0 }),
    );
    expect(sent()).toHaveLength(1);
    expect(notices()).toEqual([]);
  });

  it("href 为 null 的类别：邮件不带链接（admin 里没有那一页）", async () => {
    const { wiring, sent } = wiringWithCapture();
    await wiring.alertTodo(
      escalatedTodo({
        kind: "maintenance_overdue",
        subject: { type: "maintenance", no: "数据库主从切换" },
        tenant: null,
        amount: null,
        href: null,
        escalated: false,
        escalationStep: 0,
      }),
    );
    expect(sent()[0]!.link).toBeUndefined();
  });

  it("自愈放弃：邮件的原因行抹过 uuid（订单 id 本来也不该上屏）", async () => {
    const { wiring, sent } = wiringWithCapture();
    await wiring.orderSelfHealGaveUp({
      orderId: "44444444-4444-4444-8444-444444444444",
      orderNo: "SO202600100",
      attempts: 3,
      lastError: "subscription 33333333-3333-4333-8333-333333333333 not found",
    });
    const lines = sent()[0]!.lines.join("\n");
    expect(lines).not.toMatch(UUID_SHAPE);
    expect(lines).toContain("已隐去内部 id");
    expect(lines).toContain("not found");
  });
});
