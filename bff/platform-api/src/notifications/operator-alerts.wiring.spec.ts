/**
 * operator-alerts.wiring.spec.ts —— 作业健康与自愈放弃这两条的**错误原文**不许带 uuid
 * （2026-09-28 第二批修补）。
 *
 * 为什么单独钉这一条：这两条通告的正文里有一段是**外来的字**——心跳里的 last_error、
 * 自愈记下的最后一次失败原因。那些字是作业抛什么就存什么，最常见的形状恰恰是
 * 「订阅 {uuid} 不存在」或 pg 把整行冲突键值打出来。于是「通告里不出现 UUID」这条铁律
 * 在自己的代码里守得住、在别人的异常文本上一路漏——而且**不报错**：页面照渲染，
 * 只是运营看到一串谁也查不了的十六进制。
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
import {
  OperatorAlertsWiring,
  composeJobHealthNotice,
  composeSelfHealGaveUpNotice,
} from "./operator-alerts.wiring";

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

/**
 * 邮件那一半。dispatcher 换成假的：真 dispatcher 要查静默窗口与运营账号表，
 * 而这里要断言的是**送给它的素材**，不是它怎么发。
 */
function wiringWithCapture(): {
  wiring: OperatorAlertsWiring;
  sent: () => OperatorAlertInput[];
} {
  const captured: OperatorAlertInput[] = [];
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
  return { wiring, sent: () => captured };
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
