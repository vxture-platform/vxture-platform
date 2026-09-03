import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { NotificationDispatcher, type NotifyInput } from "./dispatcher";
import { interpolate, render } from "./templates";

// A tiny in-memory stand-in for the two tables the dispatcher touches: the
// inbox unique key and the logs ledger are what the behaviour hinges on.
function fakePool(
  opts: {
    owner?: string | null;
    emails?: Record<string, string>;
    languages?: Record<string, string>;
  } = {},
) {
  const inbox = new Set<string>();
  const logs: Record<string, unknown>[] = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes("from tenancy.tenants")) {
      return {
        rows:
          opts.owner === null
            ? []
            : [{ owner_user_id: opts.owner ?? "owner-1" }],
        rowCount: 1,
      };
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
  return { pool: { query } as unknown as Pool, query, inbox, logs };
}

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
