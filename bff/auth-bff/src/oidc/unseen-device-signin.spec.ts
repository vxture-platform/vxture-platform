/**
 * unseen-device-signin.spec.ts —— 「没见过的设备登录」这条通知的**顺序**（2026-09-29）。
 *
 * ── 为什么顺序值一条用例，而且是这一批里最该有的一条 ──
 * 判据是 `session.login_attempts` 里本人此前成功登录过的设备。本次这一行一落库，它自己就
 * 成了「这台设备我见过」的证据——所以**问必须在写之前**。写反了的症状不是报错，是这条通知
 * 「看起来装好了却永远不响」：编译过、类型过、守卫全绿、日志里一行异常都没有。本仓最常见的
 * 缺陷就是这个形状（做了没接），而它在一个靠它发现账号被接管的功能上代价最大。
 *
 * 另外两件一起钉：
 *   · **发在写之后**：通知是对已发生事实的回执，不是预告。
 *   · **两步都不许让登录失败**：取判据抛、投递抛、流水写失败，登录照样完成。
 *
 * 做法：直接拿 `OidcService.prototype` 上那个私有方法配一个只有三样东西的 `this`
 * （它只碰 `this.account` / `this.loginAttempts` / `this.logger`）。整条服务要十几个协作者，
 * 为这一条顺序去装它反而会把判据埋在装配噪音里。
 */
import { describe, expect, it, vi } from "vitest";
import { OidcService } from "./oidc.service";

type Recorder = (input: {
  userId?: string | null;
  identifier: string;
  authMethod: string;
  result: string;
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
}) => Promise<void>;

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/141.0";
const USER_ID = "11111111-2222-3333-4444-555555555555";

function build(overrides?: {
  detect?: ReturnType<typeof vi.fn>;
  notify?: ReturnType<typeof vi.fn>;
  record?: ReturnType<typeof vi.fn>;
}) {
  /** 调用先后写进同一条时间线——两个 mock 各自的 order 对不出「谁先」。 */
  const calls: string[] = [];
  const detect =
    overrides?.detect ??
    vi.fn(async () => {
      calls.push("detect");
      return { userId: USER_ID };
    });
  const notify =
    overrides?.notify ??
    vi.fn(async () => {
      calls.push("notify");
    });
  const record =
    overrides?.record ??
    vi.fn(async () => {
      calls.push("record");
    });
  const ctx = {
    account: { detectUnseenDevice: detect, notifyUnseenDevice: notify },
    loginAttempts: { record },
    logger: { warn: vi.fn(), log: vi.fn() },
  };
  const recordTenantAttempt = (
    OidcService.prototype as unknown as { recordTenantAttempt: Recorder }
  ).recordTenantAttempt.bind(ctx) as Recorder;
  return { recordTenantAttempt, calls, detect, notify, record, ctx };
}

const SUCCESS = {
  userId: USER_ID,
  identifier: "13800138000",
  authMethod: "password",
  result: "success",
  ipAddress: "203.0.113.9",
  userAgent: UA,
};

describe("未见过的设备：问 → 写 → 发", () => {
  it("判据在流水写入**之前**取（反了这条通知就永远不响）", async () => {
    const { recordTenantAttempt, calls } = build();
    await recordTenantAttempt(SUCCESS);
    expect(calls).toEqual(["detect", "record", "notify"]);
  });

  it("判据拿到的是本次登录的用户与设备串", async () => {
    const { recordTenantAttempt, detect } = build();
    await recordTenantAttempt(SUCCESS);
    expect(detect).toHaveBeenCalledWith(USER_ID, UA);
  });

  it("失败的登录**判据都不取**（失败尝试的 UA 是攻击者的）", async () => {
    const { recordTenantAttempt, detect, notify, record } = build();
    await recordTenantAttempt({ ...SUCCESS, result: "bad_credentials" });
    expect(detect).not.toHaveBeenCalled();
    /* 投递照旧被调用一次，拿到的是 null —— 「要不要发」由它自己短路，不在调用点复写一遍
       那个判断（两处各写一份，改了一处就会出现「这条路不发」）。 */
    expect(notify).toHaveBeenCalledWith(null);
    /* 流水照旧要写——风控证据不因为不发通知就少一行。 */
    expect(record).toHaveBeenCalledTimes(1);
  });

  it("查不到用户（登录标识不存在）判据都不取", async () => {
    const { recordTenantAttempt, detect, notify } = build();
    await recordTenantAttempt({ ...SUCCESS, userId: null });
    expect(detect).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(null);
  });

  it("判据取失败：登录照样完成，流水照写，这一条不发（宁可不发，不发一条假警报）", async () => {
    const detect = vi.fn(async () => {
      throw new Error("db down");
    });
    const { recordTenantAttempt, record, notify, ctx } = build({ detect });
    /*
     * 这一层的每个调用点都是 `await this.recordTenantAttempt(...)`，所以「抛出去」的后果
     * 就是**一次本来成功的登录变成 500**——为了一条提醒把登录弄坏，方向完全反了。
     *
     * 这条用例此前钉的是 `rejects.toThrow("db down")`，也就是把那个后果当成了期望行为，
     * 理由写的是「被调用方自己吞异常，真实路径到不了这里」。那个理由站不住：被调用方吞不吞
     * 是另一个包里的实现细节，合同写在本方法的文档里（「两步都不许让登录失败」），门就得长
     * 在本方法里。现在门在了，期望也跟着改成 resolves。
     */
    await expect(recordTenantAttempt(SUCCESS)).resolves.toBeUndefined();
    expect(ctx.logger.warn).toHaveBeenCalledTimes(1);
    expect(String(ctx.logger.warn.mock.calls[0]?.[0])).toContain(
      "unseen-device criterion read failed",
    );
    /* 流水照写：风控证据不因为判据读不到就少一行。 */
    expect(record).toHaveBeenCalledTimes(1);
    /* 判据读不到 ⇒ pending 仍是 null ⇒ 投递照旧被调用一次、由它自己短路。 */
    expect(notify).toHaveBeenCalledWith(null);
  });

  it("投递抛了也不影响登录（通知是回执，不是登录的前置条件）", async () => {
    const notify = vi.fn(async () => {
      throw new Error("smtp down");
    });
    const { recordTenantAttempt, record, ctx } = build({ notify });
    await expect(recordTenantAttempt(SUCCESS)).resolves.toBeUndefined();
    /* 流水在投递之前就写完了，通知炸掉不回滚它。 */
    expect(record).toHaveBeenCalledTimes(1);
    expect(ctx.logger.warn).toHaveBeenCalledTimes(1);
    expect(String(ctx.logger.warn.mock.calls[0]?.[0])).toContain(
      "unseen-device notice failed",
    );
  });

  it("流水写失败：只记一行日志，通知照发，登录不受影响", async () => {
    const record = vi.fn(async () => {
      throw new Error("insert failed");
    });
    const { recordTenantAttempt, notify, ctx } = build({ record });
    await expect(recordTenantAttempt(SUCCESS)).resolves.toBeUndefined();
    expect(ctx.logger.warn).toHaveBeenCalledTimes(1);
    expect(String(ctx.logger.warn.mock.calls[0]?.[0])).toContain(
      "login_attempt write failed",
    );
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("不必发时（首次登录 / 见过的设备）投递也照旧被调用一次，由它自己短路", async () => {
    const detect = vi.fn(async () => null);
    const { recordTenantAttempt, notify } = build({ detect });
    await recordTenantAttempt(SUCCESS);
    expect(notify).toHaveBeenCalledWith(null);
  });
});
