import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import {
  DEDUPE_SQL,
  OPS_ALERT_RETRY_BACKOFF_MS,
  OPS_ALERT_SILENCE_MS,
  OperatorAlertDispatcher,
  renderAlert,
  suppressionOf,
  type OperatorAlertInput,
} from "./operator-alerts";

interface LogRow {
  code: string;
  refId: string;
  status: "sent" | "failed";
  at: number;
}

/**
 * 只装两件事：账本（去重的唯一依据）和运营账号表。
 * 未知 SQL 一律抛——判据得跟着实现走，不能因为多了一条查询就静默变成「没到期」。
 */
function fakePool(opts: {
  operators?: { id: string; email: string | null; display_name?: string }[];
  history?: LogRow[];
}) {
  const logs: LogRow[] = [...(opts.history ?? [])];
  const seen = { dedupe: 0, recipients: 0 };
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes("max(created_at) filter")) {
      seen.dedupe += 1;
      const [code, , refId] = params as string[];
      const mine = logs.filter((l) => l.code === code && l.refId === refId);
      const ok = mine.filter((l) => l.status === "sent");
      return {
        rows: [
          {
            last_ok: ok.length
              ? new Date(Math.max(...ok.map((l) => l.at)))
              : null,
            last_any: mine.length
              ? new Date(Math.max(...mine.map((l) => l.at)))
              : null,
          },
        ],
        rowCount: 1,
      };
    }
    if (sql.includes("from admin.operator_account")) {
      seen.recipients += 1;
      return {
        rows: (opts.operators ?? []).map((o) => ({
          id: o.id,
          email: o.email,
          display_name: o.display_name ?? null,
          username: o.id,
        })),
        rowCount: (opts.operators ?? []).length,
      };
    }
    if (sql.includes("insert into support.notification_logs")) {
      logs.push({
        code: params[0] as string,
        refId: params[3] as string,
        status: params[1] as "sent" | "failed",
        at: Date.now(),
      });
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`unexpected sql: ${sql}`);
  });
  return { pool: { query } as unknown as Pool, query, logs, seen };
}

const alertInput: OperatorAlertInput = {
  code: "ops.order.paid_unprovisioned",
  reference: { type: "order", id: "order-1" },
  subject: "ORD-1 已收款但权益未开通",
  lines: ["某租户的账单已结清，但开通没有落地。"],
  link: "https://y.vxture.com/orders/ORD-1",
};

const twoOperators = [
  { id: "op-1", email: "a@example.com", display_name: "运营甲" },
  { id: "op-2", email: "b@example.com" },
];

function dispatcherWith(
  pool: Pool,
  send: ReturnType<typeof vi.fn> = vi.fn(async () => undefined),
) {
  return {
    dispatcher: new OperatorAlertDispatcher(pool, {
      mail: { send },
      logger: { warn: () => {} },
    }),
    send,
  };
}

const ago = (ms: number) => Date.now() - ms;

describe("OperatorAlertDispatcher", () => {
  it("发给每个在用且已验证邮箱的运营账号，每人记一行账本", async () => {
    const f = fakePool({ operators: twoOperators });
    const { dispatcher, send } = dispatcherWith(f.pool);

    const r = await dispatcher.alert(alertInput);

    expect(r).toMatchObject({ sent: 2, failed: 0, suppressed: false });
    expect(send.mock.calls.map((c) => c[0].to)).toEqual([
      "a@example.com",
      "b@example.com",
    ]);
    expect(f.logs.filter((l) => l.status === "sent")).toHaveLength(2);
  });

  it("4h 静默窗口：窗口内成功过就整条不发，窗口外重新发", async () => {
    const inside = fakePool({
      operators: twoOperators,
      history: [
        {
          code: alertInput.code,
          refId: "order-1",
          status: "sent",
          at: ago(OPS_ALERT_SILENCE_MS - 60_000),
        },
      ],
    });
    const a = dispatcherWith(inside.pool);
    const suppressed = await a.dispatcher.alert(alertInput);
    expect(suppressed).toMatchObject({ suppressed: true, sent: 0 });
    expect(a.send).not.toHaveBeenCalled();
    // 命中静默就该到此为止——连收件人都不该去查。
    expect(inside.seen.recipients).toBe(0);

    const outside = fakePool({
      operators: twoOperators,
      history: [
        {
          code: alertInput.code,
          refId: "order-1",
          status: "sent",
          at: ago(OPS_ALERT_SILENCE_MS + 60_000),
        },
      ],
    });
    const b = dispatcherWith(outside.pool);
    const resent = await b.dispatcher.alert(alertInput);
    expect(resent).toMatchObject({ suppressed: false, sent: 2 });
  });

  it("失败退避 15min：刚失败过就先不重试，退避期满即重试", async () => {
    const fresh = fakePool({
      operators: twoOperators,
      history: [
        {
          code: alertInput.code,
          refId: "order-1",
          status: "failed",
          at: ago(OPS_ALERT_RETRY_BACKOFF_MS - 30_000),
        },
      ],
    });
    expect(
      await dispatcherWith(fresh.pool).dispatcher.alert(alertInput),
    ).toMatchObject({ suppressed: true });

    // 只失败过、且已过退避期 → 必须重试。失败绝不能占用 4h 静默窗口，
    // 否则 SMTP 抖一下就把这条告警压掉 4 小时。
    const stale = fakePool({
      operators: twoOperators,
      history: [
        {
          code: alertInput.code,
          refId: "order-1",
          status: "failed",
          at: ago(OPS_ALERT_RETRY_BACKOFF_MS + 30_000),
        },
      ],
    });
    expect(
      await dispatcherWith(stale.pool).dispatcher.alert(alertInput),
    ).toMatchObject({ suppressed: false, sent: 2 });
  });

  it("成功在 4h 内、随后又有失败行 → 仍按成功静默（有人收到了就够）", async () => {
    const f = fakePool({
      operators: twoOperators,
      history: [
        {
          code: alertInput.code,
          refId: "order-1",
          status: "sent",
          at: ago(3 * 60 * 60 * 1000),
        },
        {
          code: alertInput.code,
          refId: "order-1",
          status: "failed",
          at: ago(60_000),
        },
      ],
    });
    expect(
      await dispatcherWith(f.pool).dispatcher.alert(alertInput),
    ).toMatchObject({ suppressed: true });
  });

  it("去重按业务引用分开：另一张单不受影响", async () => {
    const f = fakePool({
      operators: twoOperators,
      history: [
        {
          code: alertInput.code,
          refId: "order-1",
          status: "sent",
          at: ago(60_000),
        },
      ],
    });
    const { dispatcher } = dispatcherWith(f.pool);
    expect(await dispatcher.alert(alertInput)).toMatchObject({
      suppressed: true,
    });
    expect(
      await dispatcher.alert({
        ...alertInput,
        reference: { type: "order", id: "order-2" },
      }),
    ).toMatchObject({ suppressed: false, sent: 2 });
  });

  it("同一张单的不同告警码互不压制（自愈放弃不该被待办告警盖掉）", async () => {
    const f = fakePool({
      operators: twoOperators,
      history: [
        {
          code: "ops.order.paid_unprovisioned",
          refId: "order-1",
          status: "sent",
          at: ago(60_000),
        },
      ],
    });
    expect(
      await dispatcherWith(f.pool).dispatcher.alert({
        ...alertInput,
        code: "ops.order.selfheal_gave_up",
      }),
    ).toMatchObject({ suppressed: false, sent: 2 });
  });

  it("一个可达运营账号都没有 → noRecipient，且不写账本", async () => {
    const none = fakePool({ operators: [] });
    const r = await dispatcherWith(none.pool).dispatcher.alert(alertInput);
    expect(r).toMatchObject({ noRecipient: true, sent: 0, suppressed: false });
    expect(none.logs).toHaveLength(0);

    // 邮箱为空的账号（查询已滤掉，这里兜底防实现回退）同样不算可达。
    const blank = fakePool({ operators: [{ id: "op-1", email: "   " }] });
    expect(
      await dispatcherWith(blank.pool).dispatcher.alert(alertInput),
    ).toMatchObject({ noRecipient: true });
  });

  it("发送抛错记 failed 而不是 sent——下一轮退避期满还要重试", async () => {
    const f = fakePool({ operators: twoOperators });
    const send = vi.fn(async () => {
      throw new Error("smtp down");
    });
    const r = await dispatcherWith(f.pool, send).dispatcher.alert(alertInput);

    expect(r).toMatchObject({ sent: 0, failed: 2 });
    // 先钉条数：`every` 对空数组恒真，只写 every 的话「一行都没记」也会通过——
    // 而账本正是下一轮退避的唯一依据，写丢了就变成每 tick 重发（2026-09-08 变异测试实测）。
    expect(f.logs).toHaveLength(2);
    expect(f.logs.every((l) => l.status === "failed")).toBe(true);
    // 关键：全失败没有留下 last_ok，所以 4h 静默窗口不成立。
    expect(f.logs.some((l) => l.status === "sent")).toBe(false);
  });

  it("没有邮件发送方（SMTP 未配）记 failed，不能当作发过了", async () => {
    const f = fakePool({ operators: twoOperators });
    const dispatcher = new OperatorAlertDispatcher(f.pool, {
      mail: null,
      logger: { warn: () => {} },
    });
    const r = await dispatcher.alert(alertInput);
    expect(r).toMatchObject({ sent: 0, failed: 2 });
    expect(f.logs).toHaveLength(2);
    expect(f.logs.every((l) => l.status === "failed")).toBe(true);
  });
});

/**
 * 判定逻辑单独测。上面那组行为测试**测不到 SQL 谓词**——假 pool 用 JS 重算语义，
 * 把 `status in ('sent','delivered')` 改成含 'failed' 也照样全绿（2026-09-08 变异
 * 测试实测）。所以判定搬进纯函数直测，谓词本身用下面那条字面断言钉住。
 */
describe("suppressionOf", () => {
  const W = { silenceMs: 4 * 3600_000, retryBackoffMs: 15 * 60_000 };
  const NOW = 1_757_000_000_000;
  const at = (msAgo: number) => new Date(NOW - msAgo);

  it("什么都没发过 → 发", () => {
    expect(suppressionOf({ lastOk: null, lastAny: null }, W, NOW)).toBe("send");
  });

  it("成功在窗口内 → silenced；窗口外 → send（边界取「不足 4h」）", () => {
    expect(
      suppressionOf({ lastOk: at(W.silenceMs - 1), lastAny: null }, W, NOW),
    ).toBe("silenced");
    expect(
      suppressionOf({ lastOk: at(W.silenceMs), lastAny: null }, W, NOW),
    ).toBe("send");
  });

  it("只失败过：退避期内 backoff，期满 send——失败不占用 4h 静默窗口", () => {
    const justFailed = { lastOk: null, lastAny: at(W.retryBackoffMs - 1) };
    expect(suppressionOf(justFailed, W, NOW)).toBe("backoff");
    const staleFailure = { lastOk: null, lastAny: at(W.retryBackoffMs) };
    expect(suppressionOf(staleFailure, W, NOW)).toBe("send");
    // 关键反例：失败发生在 1 小时前（远超退避、远不足静默）→ 必须重发。
    // 若把失败误算进 last_ok，这里会变成 silenced，告警被压掉 4 小时。
    expect(suppressionOf({ lastOk: null, lastAny: at(3600_000) }, W, NOW)).toBe(
      "send",
    );
  });

  it("成功优先于失败：3h 前成功 + 1min 前失败 → silenced", () => {
    expect(
      suppressionOf({ lastOk: at(3 * 3600_000), lastAny: at(60_000) }, W, NOW),
    ).toBe("silenced");
  });
});

describe("去重谓词", () => {
  // 假 pool 不解析 SQL，所以谓词只能靠字面断言钉住。改这条 SQL 必须同时改这里，
  // 那正是目的：让「谁算成功投递」这件事不能被顺手改掉。
  it("last_ok 只认 sent / delivered，且按邮件通道 + 业务引用聚合", () => {
    expect(DEDUPE_SQL).toContain(
      "max(created_at) filter (where status in ('sent','delivered')) as last_ok",
    );
    expect(DEDUPE_SQL).toContain("channel        = 'email'");
    expect(DEDUPE_SQL).toContain("template_code  = $1");
    expect(DEDUPE_SQL).toContain("reference_id   = $3");
    // 不能退化成「取最近一行」——一成一败时会误判。
    expect(DEDUPE_SQL).not.toContain("order by");
    expect(DEDUPE_SQL).not.toContain("limit");
  });
});

describe("renderAlert", () => {
  it("转义正文并把链接同时放进 text 与 html", () => {
    const out = renderAlert({
      ...alertInput,
      lines: ['租户 <b>"甲" & 乙</b>'],
    });
    expect(out.subject).toBe("[Vxture 运营] ORD-1 已收款但权益未开通");
    expect(out.html).toContain("&lt;b&gt;&quot;甲&quot; &amp; 乙&lt;/b&gt;");
    expect(out.html).not.toContain("<b>");
    expect(out.text).toContain("https://y.vxture.com/orders/ORD-1");
    expect(out.html).toContain('href="https://y.vxture.com/orders/ORD-1"');
  });

  it("没有链接时正文里不出现「处理：」那一行", () => {
    const out = renderAlert({ ...alertInput, link: undefined });
    expect(out.text).not.toContain("处理：");
    expect(out.html).not.toContain("<a ");
  });
});
