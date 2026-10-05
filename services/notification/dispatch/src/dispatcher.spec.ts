import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { NotificationDispatcher, type NotifyInput } from "./dispatcher";
import { interpolate, render } from "./templates";

interface MirroredNotice {
  planes: unknown;
  severity: unknown;
  title: unknown;
  body: unknown;
  link: unknown;
  referenceType: unknown;
  referenceId: string;
  expiresAt: unknown;
}

// A tiny in-memory stand-in for the tables the dispatcher touches: the inbox
// unique key and the logs ledger are what the customer behaviour hinges on;
// the operator mirror adds tenants / orders / refunds lookups and its own
// unique-keyed write (admin.operator_notices).
function fakePool(
  opts: {
    owner?: string | null;
    emails?: Record<string, string>;
    languages?: Record<string, string>;
    /** 让运营镜像的写入抛：证明客户消息不受影响。 */
    mirrorFails?: boolean;
  } = {},
) {
  const inbox = new Set<string>();
  const logs: Record<string, unknown>[] = [];
  const notices: MirroredNotice[] = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes("select owner_user_id from tenancy.tenants")) {
      return {
        rows:
          opts.owner === null
            ? []
            : [{ owner_user_id: opts.owner ?? "owner-1" }],
        rowCount: 1,
      };
    }
    if (
      sql.includes("as tenant_name") &&
      sql.includes("from tenancy.tenants")
    ) {
      return {
        rows: [{ tenant_no: "8800000012", tenant_name: "Acme" }],
        rowCount: 1,
      };
    }
    if (
      sql.includes("from billing.refunds") ||
      sql.includes("from billing.orders")
    ) {
      return {
        rows: [{ refund_no: "RFD-DB", order_no: "ORD-DB" }],
        rowCount: 1,
      };
    }
    if (sql.includes("insert into admin.operator_notices")) {
      if (opts.mirrorFails) throw new Error("operator_notices down");
      const referenceId = String(params[6]);
      // uq_operator_notices_system: 一事一条。
      if (notices.some((n) => n.referenceId === referenceId)) {
        return { rows: [], rowCount: 0 };
      }
      notices.push({
        planes: params[0],
        severity: params[1],
        title: params[2],
        body: params[3],
        link: params[4],
        referenceType: params[5],
        referenceId,
        expiresAt: params[7],
      });
      return { rows: [{ id: `n-${notices.length}` }], rowCount: 1 };
    }
    if (sql.includes("insert into support.inbox_messages")) {
      const key = [params[1], params[2], params[6], params[7]].join("|");
      if (inbox.has(key)) return { rows: [], rowCount: 0 };
      inbox.add(key);
      return { rows: [{ id: `msg-${inbox.size}` }], rowCount: 1 };
    }
    if (sql.includes("insert into support.notification_logs")) {
      logs.push({
        channel: params[2],
        status: params[4],
        recipient: params[7],
        providerMessageId: params[10],
        error: params[11],
      });
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("from account.users")) {
      const email = opts.emails?.[String(params[0])] ?? null;
      const language = opts.languages?.[String(params[0])] ?? null;
      return {
        rows: [
          { email, language, phone: `1390000${String(params[0]).length}` },
        ],
        rowCount: 1,
      };
    }
    throw new Error(`unexpected sql: ${sql}`);
  });
  return { pool: { query } as unknown as Pool, query, inbox, logs, notices };
}

const mirrorWrites = (f: ReturnType<typeof fakePool>) =>
  f.query.mock.calls.filter((c) =>
    String(c[0]).includes("insert into admin.operator_notices"),
  );

const input: NotifyInput = {
  tenantId: "t-1",
  templateCode: "subscription.expiring_soon",
  reference: { type: "subscription", id: "sub-1:2026-09-10" },
  params: {
    productName: "Arda",
    planName: "Pro",
    endAt: "2026-09-10",
    days: 3,
  },
  link: "/subscription",
};

describe("templates", () => {
  it("interpolates {{params}} and leaves unknown keys empty", () => {
    expect(interpolate("a {{x}} b {{y}}", { x: 1 })).toBe("a 1 b ");
  });
  it("renders escaped html with an absolute link only when a base is given", () => {
    const r = render(
      "refund.rejected",
      { orderNo: "ORD-1", reason: "<x>" },
      "https://c/x",
    );
    expect(r.html).toContain("&lt;x&gt;");
    expect(r.html).toContain("https://c/x");
    expect(r.subject).toBe("[Vxture] 退款申请未通过：订单 ORD-1");
    expect(
      render("refund.rejected", { orderNo: "ORD-1", reason: "r" }, null).text,
    ).not.toContain("http");
  });
});

describe("NotificationDispatcher", () => {
  it("defaults recipients to the tenant owner, writes inbox + inapp log, no email without a sender", async () => {
    const f = fakePool();
    const d = new NotificationDispatcher(f.pool);
    const out = await d.notify(input);
    expect(out).toMatchObject({
      inboxCreated: 1,
      emailsSent: 0,
      emailsFailed: 0,
      skipped: 0,
    });
    expect(f.inbox.size).toBe(1);
    expect(f.logs).toEqual([
      {
        channel: "inapp",
        status: "delivered",
        recipient: "owner-1",
        providerMessageId: null,
        error: null,
      },
    ]);
  });

  it("dedupes on the inbox unique key: a second notify for the same reference does nothing", async () => {
    const f = fakePool({ emails: { "owner-1": "o@x.test" } });
    const mail = { send: vi.fn(async () => undefined) };
    const d = new NotificationDispatcher(f.pool, { mail });
    await d.notify(input);
    const again = await d.notify(input);
    expect(again).toMatchObject({
      inboxCreated: 0,
      emailsSent: 0,
      emailsFailed: 0,
      skipped: 1,
    });
    expect(mail.send).toHaveBeenCalledTimes(1);
  });

  /*
   * 2026-12-01 退款转账线的反例：同一张退款单「失败 → 再次发起」会第二次发「已打出」。
   * 发侧把第几次放进引用 id（`{refund}:transfer_initiated:{attempt}`），于是两条都落收件箱，
   * 运营镜像也各一条；把第几次去掉（同一个引用 id），第二条就被唯一键吞掉、镜像也没有——
   * 这正是去重键要带 attempt 的理由。
   */
  it("同一张退款单两次「已打出」（attempt 1 / 2）两条都落，镜像各一条；去掉 attempt 第二条被吞", async () => {
    const f = fakePool();
    const d = new NotificationDispatcher(f.pool);
    const base = {
      tenantId: "t-1",
      templateCode: "refund.transfer_initiated" as const,
      params: { orderNo: "ORD-1", amount: "¥99.00", date: "2026-12-01" },
    };
    const first = await d.notify({
      ...base,
      reference: { type: "refund", id: "rfd-1:transfer_initiated:1" },
    });
    const second = await d.notify({
      ...base,
      reference: { type: "refund", id: "rfd-1:transfer_initiated:2" },
    });
    expect(first.inboxCreated).toBe(1);
    expect(second.inboxCreated).toBe(1);
    expect(f.inbox.size).toBe(2);
    expect(f.notices).toHaveLength(2);
    expect(f.notices.map((n) => n.referenceId)).toEqual([
      "refund.transfer_initiated:refund:rfd-1:transfer_initiated:1",
      "refund.transfer_initiated:refund:rfd-1:transfer_initiated:2",
    ]);

    // 反面：没有 attempt 的引用 id，第二次就是重放。
    const g = fakePool();
    const e = new NotificationDispatcher(g.pool);
    await e.notify({
      ...base,
      reference: { type: "refund", id: "rfd-1:transfer_initiated" },
    });
    const swallowed = await e.notify({
      ...base,
      reference: { type: "refund", id: "rfd-1:transfer_initiated" },
    });
    expect(swallowed).toMatchObject({ inboxCreated: 0, skipped: 1 });
    expect(g.inbox.size).toBe(1);
    expect(g.notices).toHaveLength(1);
  });

  it("unions explicit recipients with the owner", async () => {
    const f = fakePool({
      emails: { "owner-1": "o@x.test", "u-2": "u2@x.test" },
    });
    const mail = { send: vi.fn(async () => undefined) };
    const d = new NotificationDispatcher(f.pool, { mail });
    const out = await d.notify({
      ...input,
      recipients: ["u-2", "owner-1", ""],
    });
    expect(out.inboxCreated).toBe(2);
    expect(out.emailsSent).toBe(2);
    expect(
      mail.send.mock.calls
        .map((c) => (c as unknown[])[0])
        .map((p) => (p as { to: string }).to)
        .sort(),
    ).toEqual(["o@x.test", "u2@x.test"]);
  });

  it("respects preferences: email off → inbox only; inbox off → nothing", async () => {
    const f = fakePool({ emails: { "owner-1": "o@x.test" } });
    const mail = { send: vi.fn(async () => undefined) };
    const prefs = {
      allows: vi.fn(
        async (_u: string, _t: string, ch: string) => ch === "inbox",
      ),
    };
    const d = new NotificationDispatcher(f.pool, { mail, prefs });
    const out = await d.notify(input);
    expect(out).toMatchObject({
      inboxCreated: 1,
      emailsSent: 0,
      emailsFailed: 0,
      skipped: 0,
    });
    expect(mail.send).not.toHaveBeenCalled();

    const f2 = fakePool();
    const d2 = new NotificationDispatcher(f2.pool, {
      mail,
      prefs: { allows: async () => false },
    });
    const out2 = await d2.notify(input);
    expect(out2).toMatchObject({
      inboxCreated: 0,
      emailsSent: 0,
      emailsFailed: 0,
      skipped: 1,
    });
    expect(f2.inbox.size).toBe(0);
  });

  it("a failing sender is logged as failed and never throws", async () => {
    const f = fakePool({ emails: { "owner-1": "o@x.test" } });
    const mail = {
      send: vi.fn(async () => {
        throw new Error("smtp down");
      }),
    };
    const d = new NotificationDispatcher(f.pool, {
      mail,
      logger: { warn: () => {} },
    });
    const out = await d.notify(input);
    expect(out).toMatchObject({
      inboxCreated: 1,
      emailsSent: 0,
      emailsFailed: 1,
      skipped: 0,
    });
    expect(f.logs.map((l) => `${l.channel}:${l.status}`)).toEqual([
      "inapp:delivered",
      "email:failed",
    ]);
    expect(f.logs[1]!.error).toBe("smtp down");
  });

  it("renders in the recipient's language: en* profile → English, otherwise zh-CN", async () => {
    const f = fakePool({
      emails: { "owner-1": "o@x.test", "u-2": "u2@x.test" },
      languages: { "owner-1": "en-US", "u-2": "zh-CN" },
    });
    const mail = { send: vi.fn(async () => undefined) };
    const d = new NotificationDispatcher(f.pool, { mail });
    await d.notify({ ...input, recipients: ["u-2"] });
    const subjects = mail.send.mock.calls
      .map((c) => (c as unknown[])[0] as { to: string; subject: string })
      .sort((a, b) => a.to.localeCompare(b.to));
    expect(subjects[0]!.subject).toContain("Subscription expiring soon");
    expect(subjects[1]!.subject).toContain("订阅即将到期");
  });

  it("announcement: title/content come from params; absolute CTA link goes into the email as-is", async () => {
    const f = fakePool({ emails: { "owner-1": "o@x.test" } });
    const mail = { send: vi.fn(async () => undefined) };
    const d = new NotificationDispatcher(f.pool, { mail });
    const out = await d.notify({
      tenantId: "t-1",
      templateCode: "announcement.published",
      reference: { type: "announcement", id: "ann-1" },
      params: { title: "维护通知", content: "周六 02:00 升级。" },
      link: "https://vxture.com/status",
    });
    expect(out.inboxCreated).toBe(1);
    const sent = (mail.send.mock.calls as unknown as unknown[][])[0]![0] as {
      subject: string;
      text: string;
    };
    expect(sent.subject).toBe("[Vxture] 维护通知");
    expect(sent.text).toContain("周六 02:00 升级。");
    expect(sent.text).toContain("https://vxture.com/status");
  });

  it("sms: sent only when a template code is configured and the sms preference allows; logged with BizId", async () => {
    const f = fakePool();
    const sms = { sendTemplate: vi.fn(async () => "BIZ-1") };
    const prefs = {
      allows: vi.fn(
        async (_u: string, _t: string, ch: string) => ch !== "email",
      ),
    };
    // no template code for this notification → no sms
    const silent = new NotificationDispatcher(f.pool, { sms, prefs });
    const out0 = await silent.notify(input);
    expect(out0.smsSent).toBe(0);
    expect(sms.sendTemplate).not.toHaveBeenCalled();

    const f2 = fakePool();
    const d = new NotificationDispatcher(f2.pool, {
      sms,
      prefs,
      smsTemplates: { "subscription.expiring_soon": "SMS_123" },
    });
    const out = await d.notify(input);
    expect(out.smsSent).toBe(1);
    const call = (
      sms.sendTemplate.mock.calls as unknown as unknown[][]
    )[0]![0] as {
      phone: string;
      templateCode: string;
      params: Record<string, string>;
      outId?: string;
    };
    expect(call.templateCode).toBe("SMS_123");
    expect(call.params).toEqual({
      product: "Arda",
      plan: "Pro",
      date: "2026-09-10",
      days: "3",
    });
    expect(call.outId).toBe("subscription:sub-1:2026-09-10");
    expect(f2.logs.map((l) => `${l.channel}:${l.status}`)).toEqual([
      "inapp:delivered",
      "sms:sent",
    ]);

    // sms preference off → not sent
    const f3 = fakePool();
    const d3 = new NotificationDispatcher(f3.pool, {
      sms,
      prefs: { allows: async (_u, _t, ch) => ch === "inbox" },
      smsTemplates: { "subscription.expiring_soon": "SMS_123" },
    });
    const out3 = await d3.notify(input);
    expect(out3.smsSent).toBe(0);
  });

  it("no owner and no explicit recipient → skipped, nothing written", async () => {
    const f = fakePool({ owner: null });
    const d = new NotificationDispatcher(f.pool, {
      logger: { warn: () => {} },
    });
    const out = await d.notify(input);
    expect(out.skipped).toBe(1);
    expect(f.inbox.size).toBe(0);
  });
});
/**
 * 定向送达（owner 2026-09-09，按用户号邀请）。
 *
 * 这三个开关各自解决一个「默认规则对这类消息是错的」的地方。三条用例都写成
 * **对照**形式：不带开关时会发生什么、带上之后变成什么。只断言带开关的那一半，
 * 证明不了开关起了作用——默认行为恰好一样的实现同样能过。
 */
describe("定向送达的三个开关", () => {
  const invite: NotifyInput = {
    tenantId: "t-1",
    templateCode: "tenant.invitation",
    reference: { type: "invitation", id: "inv-1" },
    params: {
      tenantName: "Acme",
      inviterName: "Ann",
      roleKey: "member",
      expiresAt: "2026-09-12",
    },
    link: "/inbox",
  };

  it("exactRecipients 接管收件人集合：owner 不再被并进来", async () => {
    const withOwner = fakePool({ owner: "owner-1" });
    await new NotificationDispatcher(withOwner.pool).notify({
      ...invite,
      recipients: ["invitee-1"],
    });
    // 对照：默认规则确实会把 owner 也发一份。
    expect(withOwner.inbox.size).toBe(2);

    const exact = fakePool({ owner: "owner-1" });
    const res = await new NotificationDispatcher(exact.pool).notify({
      ...invite,
      exactRecipients: ["invitee-1"],
    });
    expect(res.inboxCreated).toBe(1);
    expect([...exact.inbox].every((k) => k.startsWith("invitee-1|"))).toBe(
      true,
    );
  });

  it("mandatory 绕过偏好开关：关掉也照样送到", async () => {
    const deny = { allows: async () => false };

    const gated = fakePool();
    const a = await new NotificationDispatcher(gated.pool, {
      prefs: deny,
    }).notify({ ...invite, exactRecipients: ["invitee-1"] });
    // 对照：不加 mandatory 时，偏好关掉就真的不发。
    expect(a.inboxCreated).toBe(0);

    const forced = fakePool();
    const b = await new NotificationDispatcher(forced.pool, {
      prefs: deny,
    }).notify({
      ...invite,
      exactRecipients: ["invitee-1"],
      mandatory: true,
    });
    expect(b.inboxCreated).toBe(1);
  });

  it("inboxOnly 只落站内：不发邮件", async () => {
    const mail = { send: vi.fn(async () => ({ messageId: "m-1" })) };
    const emails = { "invitee-1": "invitee@example.com" };

    const open = fakePool({ emails });
    await new NotificationDispatcher(open.pool, { mail }).notify({
      ...invite,
      exactRecipients: ["invitee-1"],
    });
    // 对照：不加 inboxOnly 时邮件确实会发出去。
    expect(mail.send).toHaveBeenCalledTimes(1);

    mail.send.mockClear();
    const closed = fakePool({ emails });
    const res = await new NotificationDispatcher(closed.pool, { mail }).notify({
      ...invite,
      exactRecipients: ["invitee-1"],
      inboxOnly: true,
    });
    expect(mail.send).not.toHaveBeenCalled();
    expect(res.inboxCreated).toBe(1); // 站内那一路照走
  });
});

/**
 * `emailTo`（2026-09-29 账号安全线）：邮件那一半改送指定地址，站内那一半不动。
 * 用例按唯一的真实用途写：换邮箱时写给**旧地址**的那一封。两个方向都要有用例——
 * 只测「给了它会去新地址」证不了「不给它今天的行为没变」。
 */
describe("emailTo：邮件改送旧地址", () => {
  const emailChanged: NotifyInput = {
    tenantId: "t-1",
    templateCode: "account.email_changed_old",
    reference: {
      type: "security",
      id: "sec:8800000012:email_changed_old:2026-09-29T12:14:32.000Z",
    },
    params: { occurredAt: "2026-09-29 20:14:32 (UTC+8)" },
    exactRecipients: ["acct-1"],
    link: "/account",
  };
  const toOf = (calls: unknown[], i: number) =>
    ((calls as unknown[][])[i]![0] as { to: string }).to;

  it("给了 emailTo：邮件只去旧地址，站内仍落在该账号名下，账本两行各记各的收件人", async () => {
    const mail = { send: vi.fn(async () => ({ messageId: "m-1" })) };
    // 账号上挂着的已经是**新**地址（事情已经落库）——这正是要区开的两个值。
    const f = fakePool({ emails: { "acct-1": "new@example.com" } });
    const res = await new NotificationDispatcher(f.pool, {
      mail,
      operatorMirror: null,
    }).notify({ ...emailChanged, emailTo: "old@example.com" });

    expect(res).toMatchObject({ inboxCreated: 1, emailsSent: 1 });
    expect(mail.send).toHaveBeenCalledTimes(1);
    expect(toOf(mail.send.mock.calls, 0)).toBe("old@example.com");
    // 站内那一半没动：唯一键的第一段就是 account_id，换完邮箱登录进来照样读得到。
    expect([...f.inbox]).toEqual([
      "acct-1|account.email_changed_old|security|sec:8800000012:email_changed_old:2026-09-29T12:14:32.000Z",
    ]);
    // 账本：站内那行记 account id，邮件那行记**真正寄到的地址**。
    expect(f.logs.map((l) => [l.channel, l.recipient])).toEqual([
      ["inapp", "acct-1"],
      ["email", "old@example.com"],
    ]);
  });

  it("不给 emailTo：一切照旧，邮件送账号上挂着的那个地址", async () => {
    const mail = { send: vi.fn(async () => ({ messageId: "m-1" })) };
    const f = fakePool({ emails: { "acct-1": "new@example.com" } });
    const res = await new NotificationDispatcher(f.pool, {
      mail,
      operatorMirror: null,
    }).notify(emailChanged);

    expect(res).toMatchObject({ inboxCreated: 1, emailsSent: 1 });
    expect(toOf(mail.send.mock.calls, 0)).toBe("new@example.com");
    expect(f.logs.map((l) => [l.channel, l.recipient])).toEqual([
      ["inapp", "acct-1"],
      ["email", "new@example.com"],
    ]);
  });

  it("偏好关掉邮件档的人，给了 emailTo 也不寄：它换的是地址，不是门", async () => {
    const mail = { send: vi.fn(async () => ({ messageId: "m-1" })) };
    const f = fakePool({ emails: { "acct-1": "new@example.com" } });
    const res = await new NotificationDispatcher(f.pool, {
      mail,
      operatorMirror: null,
      // 只关邮件一档，站内照开（真实形态：security_event 的站内档是锁的）。
      prefs: { allows: async (_u, _t, channel) => channel !== "email" },
    }).notify({ ...emailChanged, emailTo: "old@example.com" });

    expect(res).toMatchObject({ inboxCreated: 1, emailsSent: 0 });
    expect(mail.send).not.toHaveBeenCalled();
  });

  it("emailTo 是空串 / 全空白 = 没给：退回账号那个地址，不拿空串去捣 sender", async () => {
    const mail = { send: vi.fn(async () => ({ messageId: "m-1" })) };
    const f = fakePool({ emails: { "acct-1": "new@example.com" } });
    await new NotificationDispatcher(f.pool, {
      mail,
      operatorMirror: null,
    }).notify({ ...emailChanged, emailTo: "   " });
    expect(toOf(mail.send.mock.calls, 0)).toBe("new@example.com");
  });
});

/**
 * 运营镜像（owner 2026-09-28「运营端收到的信息和客户侧要完整一致」）。
 * 这里只测「挂在哪、挂几次、抛了怎样」；标题 / 严重度 / 链接逐模板在
 * operator-mirror.spec.ts。
 */
describe("运营镜像", () => {
  it("一个客户事件多个收件人只落一条运营通告，挂在第一个站内成功之后", async () => {
    const f = fakePool({
      emails: { "owner-1": "o@x.test", "u-2": "u2@x.test" },
    });
    const out = await new NotificationDispatcher(f.pool).notify({
      ...input,
      recipients: ["u-2"],
    });
    expect(out.inboxCreated).toBe(2);
    // 写入只发生一次——不是每个收件人各写一次再靠去重挡。
    expect(mirrorWrites(f)).toHaveLength(1);
    expect(f.notices).toHaveLength(1);
    const n = f.notices[0]!;
    expect(n.planes).toEqual(["admin"]);
    expect(n.severity).toBe("info");
    expect(n.title).toBe("客户订阅即将到期 Arda Pro（2026-09-10）");
    expect(n.referenceType).toBe("customer_event");
    expect(n.referenceId).toBe(
      "subscription.expiring_soon:subscription:sub-1:2026-09-10",
    );
    // 完整一致：客户收到的那条原文（标题 + 正文）进运营正文。
    expect(n.body).toBe(
      "租户 Acme · Arda Pro · 客户收到：「订阅即将到期：Arda Pro」将于 2026-09-10 到期（3 天后）。未开启自动续费，到期后权益停止；可在「我的订阅」续费或开启自动续费。",
    );
    expect(n.link).toBeNull();
    expect(n.expiresAt).toBeInstanceOf(Date);
  });

  it("站内已通知过（唯一键冲突）的收件人不触发镜像；全冲突则一次都不试", async () => {
    const f = fakePool({
      emails: { "owner-1": "o@x.test", "u-2": "u2@x.test" },
    });
    const d = new NotificationDispatcher(f.pool);
    await d.notify(input); // owner 首次 → 1 条镜像
    // owner 冲突、u-2 新落 → 在 u-2 上试一次，被去重锚挡下：仍只有 1 条。
    await d.notify({ ...input, recipients: ["u-2"] });
    expect(f.notices).toHaveLength(1);
    expect(mirrorWrites(f)).toHaveLength(2);
    // 全部冲突 → 没有「第一个成功的收件人」，镜像不试。
    const again = await d.notify(input);
    expect(again.inboxCreated).toBe(0);
    expect(mirrorWrites(f)).toHaveLength(2);
  });

  it("警告类：退款申请 → warning、不过期、链接落到订单页", async () => {
    const f = fakePool();
    await new NotificationDispatcher(f.pool).notify({
      tenantId: "t-1",
      templateCode: "refund.requested",
      reference: {
        type: "refund",
        id: "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d:requested",
      },
      params: { orderNo: "ORD-202609-1", amount: "¥99.00" },
      link: "/subscribe/pay/x",
    });
    const n = f.notices[0]!;
    expect(n.severity).toBe("warning");
    expect(n.title).toBe("客户申请退款 ¥99.00 · ORD-202609-1");
    expect(n.link).toBe("/orders/ORD-202609-1");
    expect(n.expiresAt).toBeNull();
  });

  it("镜像写库抛 → 客户消息不受影响：站内照落、邮件照发、不计 skipped，只记日志", async () => {
    const f = fakePool({
      emails: { "owner-1": "o@x.test" },
      mirrorFails: true,
    });
    const mail = { send: vi.fn(async () => undefined) };
    const warn = vi.fn();
    const out = await new NotificationDispatcher(f.pool, {
      mail,
      logger: { warn },
    }).notify(input);
    expect(out).toMatchObject({
      inboxCreated: 1,
      emailsSent: 1,
      emailsFailed: 0,
      skipped: 0,
    });
    expect(f.notices).toHaveLength(0);
    expect(warn.mock.calls.map((c) => String(c[0]))).toEqual([
      expect.stringContaining("operator mirror skipped"),
    ]);
  });

  it("注入的镜像本身抛（不是库抛）同样不影响；显式 null 则不镜像", async () => {
    const f = fakePool({ emails: { "owner-1": "o@x.test" } });
    const mail = { send: vi.fn(async () => undefined) };
    const warn = vi.fn();
    const out = await new NotificationDispatcher(f.pool, {
      mail,
      logger: { warn },
      operatorMirror: {
        mirror: async () => {
          throw new Error("boom");
        },
      },
    }).notify(input);
    expect(out).toMatchObject({ inboxCreated: 1, emailsSent: 1, skipped: 0 });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain("operator mirror threw");

    const off = fakePool();
    await new NotificationDispatcher(off.pool, { operatorMirror: null }).notify(
      input,
    );
    expect(off.notices).toHaveLength(0);
    expect(mirrorWrites(off)).toHaveLength(0);
  });
});
