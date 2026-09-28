/**
 * invitation-notifications.spec.ts — 邀请四态客户通知（2026-09-29）。
 *
 * 钉三件事，每一件都是「错了不报错」的那一类：
 *   ① 谁收到。收件人挂错不会有任何报错，只是让一个人读到一句指着别人说的话。
 *   ② 去重键里没有 uuid，且每条邀请 × 每个终态各一个键。键撞了就是**少发**，
 *      而少发在日志里长得和「没有这件事」一样。
 *   ③ 通知发不出去不许让业务写回滚 / 报错：转移已经提交，通知是尾巴。
 *
 * 巡检那一组另钉两条上一批学到的纪律：存量闸门只闸通知（状态照改），饱和要出声。
 */
import { describe, expect, it, vi } from "vitest";
import { OrganizationService } from "./organization.service";
import {
  invitationNotice,
  invitationReferenceId,
  type InvitationNoticeState,
  type InvitationTerminalState,
} from "./invitation-notifications";
import type { CustomerNotifyInput } from "./customer-notifier";
import type {
  InvitationNotifyFacts,
  OrganizationReadRepository,
} from "../types/organization.types";

const UUID_SHAPE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const INVITATION_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const OTHER_INVITATION_ID = "bbbbbbbb-2222-4222-8222-222222222222";
const TENANT_ID = "cccccccc-3333-4333-8333-333333333333";
const INVITER_ID = "dddddddd-4444-4444-8444-444444444444";
const INVITEE_ID = "eeeeeeee-5555-4555-8555-555555555555";
/** support.inbox_messages.reference_id / notification_logs.reference_id 的宽度。 */
const REFERENCE_ID_MAX = 128;

const facts = (
  over: Partial<InvitationNotifyFacts> = {},
): InvitationNotifyFacts => ({
  invitationId: INVITATION_ID,
  tenantId: TENANT_ID,
  tenantNo: "1012345678",
  tenantName: "示例科技",
  roleCode: "member",
  expiresAt: new Date("2026-09-20T02:00:00.000Z"),
  target: "ann@example.com",
  inviterUserId: INVITER_ID,
  inviterName: "张三",
  inviteeUserId: INVITEE_ID,
  inviteeName: "李四",
  ...over,
});

/**
 * 客户读得到的那几项：正文参数、去重键（读路由把它原样投影给浏览器）、落点。
 * 收件人与租户 id 不在其中——那两项是投递用的，既不进正文也不进键。
 */
const customerVisible = (input: CustomerNotifyInput) => ({
  templateCode: input.templateCode,
  reference: input.reference,
  params: input.params,
  link: input.link,
});

const STATES: InvitationTerminalState[] = [
  "accepted",
  "declined",
  "revoked",
  "expired",
];

/** 去重键里出现的全部状态段：四个终态 + `pending`（邀请本身那一封）。 */
const ANCHOR_STATES: InvitationNoticeState[] = [...STATES, "pending"];

describe("invitationNotice —— 收件人与形状", () => {
  it("接受 / 拒绝 / 过期发给邀请人，撤销发给受邀人", () => {
    const of = (state: InvitationTerminalState) => {
      const outcome = invitationNotice(state, facts());
      if (!outcome.ok) throw new Error(`unexpected gap ${outcome.gap}`);
      return outcome.input;
    };
    expect(of("accepted").exactRecipients).toEqual([INVITER_ID]);
    expect(of("declined").exactRecipients).toEqual([INVITER_ID]);
    expect(of("expired").exactRecipients).toEqual([INVITER_ID]);
    expect(of("revoked").exactRecipients).toEqual([INVITEE_ID]);
    /* 落点与模板正文点名的页面必须是同一个：那三条正文里写的是「成员管理」
       （也是「邀请成员」按钮所在的页），受邀人那条去收件箱（成员管理对他是 403）。 */
    expect(of("accepted").link).toBe("/members");
    expect(of("declined").link).toBe("/members");
    expect(of("expired").link).toBe("/members");
    expect(of("revoked").link).toBe("/inbox");
  });

  it("四个模板码逐字对上（另一半实现按这四个字符串编码）", () => {
    const codes = STATES.map((s) => {
      const outcome = invitationNotice(s, facts());
      return outcome.ok ? outcome.input.templateCode : "gap";
    });
    expect(codes).toEqual([
      "tenant.invitation_accepted",
      "tenant.invitation_declined",
      "tenant.invitation_revoked",
      "tenant.invitation_expired",
    ]);
  });

  it("去重键：无 uuid、每态一个、每邀请一个、宽度算得出来", () => {
    const at = new Date("2026-09-20T02:00:00.000Z");
    /* `pending` 一并入列：`tenant.invitation`（邀请本身那一封，写入方在 console-bff）
       用的是同一个函数。五个状态五个键——少一个就是**少发一条**，而少发不报错。 */
    const ids = ANCHOR_STATES.map((s) =>
      invitationReferenceId("1012345678", INVITATION_ID, s, at),
    );
    expect(new Set(ids).size).toBe(5);
    for (const id of ids) {
      expect(id).not.toMatch(UUID_SHAPE);
      // 10（租户码）+ 1 + 12（摘要）+ 1 + ≤8（终态）[+ 1 + 10（到期日）] = ≤42
      expect(id.length).toBeLessThanOrEqual(42);
      expect(id.length).toBeLessThanOrEqual(REFERENCE_ID_MAX);
    }
    expect(
      invitationReferenceId("1012345678", OTHER_INVITATION_ID, "revoked"),
    ).not.toBe(invitationReferenceId("1012345678", INVITATION_ID, "revoked"));
    /* 邀请本身那一封的位宽逐字钉住：10 + 1 + 12 + 1 + 7（pending）= 31。
       它是唯一一个在 BFF 那侧拼参数的调用方，写歪了要在这里看得见。 */
    const pending = invitationReferenceId(
      "1012345678",
      INVITATION_ID,
      "pending",
    );
    expect(pending.length).toBe(31);
    expect(pending.endsWith(":pending")).toBe(true);
    expect(pending).not.toMatch(UUID_SHAPE);
    /* 同一条邀请重发多少次都是这一个键——去重键恒定，收件箱里只会有一条。 */
    expect(
      invitationReferenceId("1012345678", INVITATION_ID, "pending", at),
    ).toBe(pending);
    // 同一条邀请每次算出同一个键——否则去重不成立，每趟巡检都会再发一条。
    expect(
      invitationReferenceId("1012345678", INVITATION_ID, "expired", at),
    ).toBe(invitationReferenceId("1012345678", INVITATION_ID, "expired", at));
  });

  it("重发再过期要能再通知一次：过期那一档的键带到期日，另三档不带", () => {
    /* 重发把过期的行救回 pending 并顺延有效期，于是同一行会再过期一次——那是一件
       新的事。键里不带日期,第二次就被收件箱唯一键静默吃掉,而少发不报错。 */
    const first = invitationReferenceId(
      "1012345678",
      INVITATION_ID,
      "expired",
      new Date("2026-09-20T02:00:00.000Z"),
    );
    const second = invitationReferenceId(
      "1012345678",
      INVITATION_ID,
      "expired",
      new Date("2026-10-05T02:00:00.000Z"),
    );
    expect(first).not.toBe(second);
    expect(first.endsWith(":2026-09-20")).toBe(true);
    // 终态的另三档一生只发生一次,不带日期(带了反而会因改期而重复)。
    for (const state of ["accepted", "declined", "revoked"] as const) {
      expect(
        invitationReferenceId("1012345678", INVITATION_ID, state, new Date()),
      ).toBe(`${invitationReferenceId("1012345678", INVITATION_ID, state)}`);
    }
  });

  it("整条 payload 里一个 uuid 都没有（收件人 id 除外——那一项不进正文也不进键）", () => {
    for (const state of STATES) {
      const outcome = invitationNotice(state, facts());
      if (!outcome.ok) throw new Error("unexpected gap");
      expect(JSON.stringify(customerVisible(outcome.input))).not.toMatch(
        UUID_SHAPE,
      );
    }
  });

  it("参数给全：租户名 / 邀请人 / 受邀人 / 角色 / 到期日", () => {
    const outcome = invitationNotice("accepted", facts());
    if (!outcome.ok) throw new Error("unexpected gap");
    expect(outcome.input.params).toEqual({
      tenantName: "示例科技",
      inviterName: "张三",
      inviteeName: "李四",
      roleKey: "member",
      expiresAt: "2026-09-20",
    });
  });

  it("受邀人还没有账号 → 显示名回落到邀请人当初填的收件目标", () => {
    const outcome = invitationNotice(
      "accepted",
      facts({ inviteeName: null, target: "ann@example.com" }),
    );
    if (!outcome.ok) throw new Error("unexpected gap");
    expect(outcome.input.params.inviteeName).toBe("ann@example.com");
  });

  it("租户解析不出来 → no_tenant；收件人没有账号 → no_recipient_account", () => {
    expect(invitationNotice("accepted", facts({ tenantId: null }))).toEqual({
      ok: false,
      gap: "no_tenant",
    });
    expect(invitationNotice("accepted", facts({ tenantNo: null }))).toEqual({
      ok: false,
      gap: "no_tenant",
    });
    // 撤销的收件人是受邀人：按邮箱邀请一个还没注册的人就是这一档。
    expect(invitationNotice("revoked", facts({ inviteeUserId: null }))).toEqual(
      {
        ok: false,
        gap: "no_recipient_account",
      },
    );
    // 邀请人的账号已注销（join 过滤掉了）→ 接受这条也无人可收。
    expect(
      invitationNotice("accepted", facts({ inviterUserId: null })),
    ).toEqual({ ok: false, gap: "no_recipient_account" });
  });
});

// ── 服务层：转移 → 通知 ───────────────────────────────────────────────────────

interface Harness {
  service: OrganizationService;
  sent: CustomerNotifyInput[];
  repo: {
    acceptInvitation: ReturnType<typeof vi.fn>;
    declineInvitation: ReturnType<typeof vi.fn>;
    revokeInvitation: ReturnType<typeof vi.fn>;
    revokeInvitationsCreatedBy: ReturnType<typeof vi.fn>;
    closeTenant: ReturnType<typeof vi.fn>;
    findExpiredInvitationCandidates: ReturnType<typeof vi.fn>;
    markInvitationExpired: ReturnType<typeof vi.fn>;
  };
}

function harness(opts: { notifier?: "none" | "throws" } = {}): Harness {
  const sent: CustomerNotifyInput[] = [];
  const repo = {
    acceptInvitation: vi.fn(async () => ({
      ok: true as const,
      membership: {
        organizationId: TENANT_ID,
        userId: INVITEE_ID,
        role: "member",
        status: "active",
      },
      tenantName: "示例科技",
      notify: facts(),
    })),
    declineInvitation: vi.fn(async () => ({
      ok: true as const,
      notify: facts(),
    })),
    revokeInvitation: vi.fn(async () => ({
      ok: true as const,
      notify: facts(),
    })),
    revokeInvitationsCreatedBy: vi.fn(async () => 3),
    closeTenant: vi.fn(async () => ({ ok: true as const })),
    findExpiredInvitationCandidates: vi.fn(async () => []),
    markInvitationExpired: vi.fn(async () => true),
  };
  const service = new OrganizationService(
    repo as unknown as OrganizationReadRepository,
  );
  if (opts.notifier !== "none") {
    service.setCustomerNotifier({
      notify: async (input) => {
        sent.push(input);
        if (opts.notifier === "throws") throw new Error("dispatcher down");
        return undefined;
      },
    });
  }
  return { service, sent, repo };
}

const ANY_IDENTITY = { email: "ann@example.com", userNo: null };

describe("OrganizationService —— 一次转移一条通知", () => {
  it("接受 → 一条给邀请人，且返回值里不带 notify（那一层会进响应体）", async () => {
    const { service, sent } = harness();
    const result = await service.acceptInvitation(
      { invitationId: INVITATION_ID },
      INVITEE_ID,
      ANY_IDENTITY,
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]!.templateCode).toBe("tenant.invitation_accepted");
    expect(sent[0]!.exactRecipients).toEqual([INVITER_ID]);
    expect(result).toEqual({
      ok: true,
      membership: {
        organizationId: TENANT_ID,
        userId: INVITEE_ID,
        role: "member",
        status: "active",
      },
      tenantName: "示例科技",
    });
    expect(Object.keys(result)).not.toContain("notify");
  });

  it("拒绝 → 一条给邀请人；撤销 → 一条给受邀人，仍然回布尔", async () => {
    const { service, sent } = harness();
    expect(
      await service.declineInvitation(INVITATION_ID, ANY_IDENTITY),
    ).toEqual({ ok: true });
    expect(await service.revokeInvitation(INVITATION_ID, TENANT_ID)).toBe(true);
    expect(sent.map((s) => s.templateCode)).toEqual([
      "tenant.invitation_declined",
      "tenant.invitation_revoked",
    ]);
    expect(sent[0]!.exactRecipients).toEqual([INVITER_ID]);
    expect(sent[1]!.exactRecipients).toEqual([INVITEE_ID]);
  });

  it("转移没发生（被拒绝 / CAS 输了）→ 一条都不发", async () => {
    const { service, sent, repo } = harness();
    repo.acceptInvitation.mockResolvedValueOnce({
      ok: false,
      reason: "email_mismatch",
    });
    repo.declineInvitation.mockResolvedValueOnce({
      ok: false,
      reason: "revoked",
    });
    repo.revokeInvitation.mockResolvedValueOnce({ ok: false });
    await service.acceptInvitation(
      { invitationId: INVITATION_ID },
      INVITEE_ID,
      ANY_IDENTITY,
    );
    await service.declineInvitation(INVITATION_ID, ANY_IDENTITY);
    expect(await service.revokeInvitation(INVITATION_ID, TENANT_ID)).toBe(
      false,
    );
    expect(sent).toHaveLength(0);
  });

  it("未注入 notifier → 行为与加这段之前逐字相同（写照做，零通知）", async () => {
    const { service, sent, repo } = harness({ notifier: "none" });
    const result = await service.acceptInvitation(
      { invitationId: INVITATION_ID },
      INVITEE_ID,
      ANY_IDENTITY,
    );
    expect(result.ok).toBe(true);
    expect(repo.acceptInvitation).toHaveBeenCalledTimes(1);
    expect(sent).toHaveLength(0);
  });

  it("notifier 抛了 → 转移照旧成功（通知不回滚业务写）", async () => {
    const { service, sent } = harness({ notifier: "throws" });
    const accepted = await service.acceptInvitation(
      { invitationId: INVITATION_ID },
      INVITEE_ID,
      ANY_IDENTITY,
    );
    expect(accepted.ok).toBe(true);
    expect(await service.revokeInvitation(INVITATION_ID, TENANT_ID)).toBe(true);
    // 试过了，只是没成——两次都进了 notify，异常被 emit 吞掉。
    expect(sent).toHaveLength(2);
  });

  it("受邀人没有平台账号 → 撤销照样成功，一条都不发（不往虚空里发）", async () => {
    const { service, sent, repo } = harness();
    repo.revokeInvitation.mockResolvedValueOnce({
      ok: true,
      notify: facts({ inviteeUserId: null, inviteeName: null }),
    });
    expect(await service.revokeInvitation(INVITATION_ID, TENANT_ID)).toBe(true);
    expect(sent).toHaveLength(0);
  });

  it("批量撤销两条路都不通知（注销账号 / 注销租户），这是决定不是漏", async () => {
    const { service, sent, repo } = harness();
    expect(await service.revokeInvitationsCreatedBy(INVITER_ID)).toBe(3);
    await service.closeTenant(TENANT_ID, INVITER_ID);
    expect(repo.revokeInvitationsCreatedBy).toHaveBeenCalledTimes(1);
    expect(repo.closeTenant).toHaveBeenCalledTimes(1);
    expect(sent).toHaveLength(0);
  });

  it("发出去的每一条 payload 里都没有 uuid（收件人与租户 id 除外）", async () => {
    const { service, sent } = harness();
    await service.acceptInvitation(
      { invitationId: INVITATION_ID },
      INVITEE_ID,
      ANY_IDENTITY,
    );
    await service.declineInvitation(INVITATION_ID, ANY_IDENTITY);
    await service.revokeInvitation(INVITATION_ID, TENANT_ID);
    expect(sent).toHaveLength(3);
    for (const input of sent) {
      expect(JSON.stringify(customerVisible(input))).not.toMatch(UUID_SHAPE);
    }
  });
});

describe("sweepExpiredInvitations —— 状态 + 通知 + 饱和", () => {
  const dayAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

  it("三元组：改了几行 / 发了几条 / 有没有满", async () => {
    const { service, sent, repo } = harness();
    repo.findExpiredInvitationCandidates.mockResolvedValueOnce([
      facts({ invitationId: INVITATION_ID, expiresAt: dayAgo(1) }),
      facts({ invitationId: OTHER_INVITATION_ID, expiresAt: dayAgo(2) }),
    ]);
    const counts = await service.sweepExpiredInvitations({ backlogDays: 3 });
    expect(counts).toEqual({ expired: 2, notified: 2, saturated: false });
    expect(sent.map((s) => s.templateCode)).toEqual([
      "tenant.invitation_expired",
      "tenant.invitation_expired",
    ]);
    // 两条邀请两个去重键——撞了就是少发一条，而少发不会报错。
    expect(new Set(sent.map((s) => s.reference.id)).size).toBe(2);
    // 过期那一档的键带到期日（重发后再过期要能再通知一次）。
    expect(sent[0]!.reference.id).toMatch(/:expired:\d{4}-\d{2}-\d{2}$/);
  });

  it("存量闸门只闸通知：窗口外的行照样改成 expired，但一句话都不发", async () => {
    const { service, sent, repo } = harness();
    repo.findExpiredInvitationCandidates.mockResolvedValueOnce([
      facts({ invitationId: INVITATION_ID, expiresAt: dayAgo(90) }),
      facts({ invitationId: OTHER_INVITATION_ID, expiresAt: dayAgo(1) }),
    ]);
    const counts = await service.sweepExpiredInvitations({ backlogDays: 3 });
    expect(counts).toEqual({ expired: 2, notified: 1, saturated: false });
    expect(repo.markInvitationExpired).toHaveBeenCalledTimes(2);
    expect(sent).toHaveLength(1);
  });

  it("CAS 输了的行两个计数都不加（那一行已经被接受 / 拒绝 / 撤回）", async () => {
    const { service, sent, repo } = harness();
    repo.findExpiredInvitationCandidates.mockResolvedValueOnce([
      facts({ expiresAt: dayAgo(1) }),
    ]);
    repo.markInvitationExpired.mockResolvedValueOnce(false);
    expect(await service.sweepExpiredInvitations({ backlogDays: 3 })).toEqual({
      expired: 0,
      notified: 0,
      saturated: false,
    });
    expect(sent).toHaveLength(0);
  });

  it("取数到上限 → saturated（一趟满了与一趟繁忙在条数上分不出来）", async () => {
    const { service, repo } = harness();
    repo.findExpiredInvitationCandidates.mockResolvedValueOnce([
      facts({ expiresAt: dayAgo(1) }),
      facts({ invitationId: OTHER_INVITATION_ID, expiresAt: dayAgo(1) }),
    ]);
    const counts = await service.sweepExpiredInvitations({
      backlogDays: 3,
      limit: 2,
    });
    expect(counts.saturated).toBe(true);
    expect(repo.findExpiredInvitationCandidates).toHaveBeenCalledWith({
      limit: 2,
    });
  });

  it("未注入 notifier 也照样改状态（这一趟的活不只是发通知）", async () => {
    const { service, repo } = harness({ notifier: "none" });
    repo.findExpiredInvitationCandidates.mockResolvedValueOnce([
      facts({ expiresAt: dayAgo(1) }),
    ]);
    expect(await service.sweepExpiredInvitations({ backlogDays: 3 })).toEqual({
      expired: 1,
      notified: 0,
      saturated: false,
    });
  });

  it("单行抛异常不中断一趟（下一行照样处理）", async () => {
    const { service, sent, repo } = harness();
    repo.findExpiredInvitationCandidates.mockResolvedValueOnce([
      facts({ invitationId: INVITATION_ID, expiresAt: dayAgo(1) }),
      facts({ invitationId: OTHER_INVITATION_ID, expiresAt: dayAgo(1) }),
    ]);
    repo.markInvitationExpired.mockRejectedValueOnce(new Error("db down"));
    const counts = await service.sweepExpiredInvitations({ backlogDays: 3 });
    expect(counts).toEqual({ expired: 1, notified: 1, saturated: false });
    expect(sent).toHaveLength(1);
  });
});
