/**
 * iam-invitation-notice.spec.ts — 站内邀请通知的**去重锚不许含 uuid**（2026-09-29）。
 *
 * ── 为什么这条要有用例 ──
 * `tenant.invitation` 那一封原来把**邀请行的 uuid** 当去重引用传给分发器，而 inbox 的读
 * 路由把 `reference_id` 原样投影给浏览器（console 的 API 类型里也有 `referenceId`）。
 * 于是一个 uuid 就这样走到了前端——铁律是可视码之外不出 id，而这一类泄漏**不报错**：
 * 页面照样好，只有去读响应体的人才看得见。所以它只能靠用例守住。
 *
 * ── 样本从发侧的函数取，不手抄 ──
 * 期望值用 `invitationReferenceId` 现算一份来比，而不是把 `"1012345678:xxxx:pending"`
 * 这种串写死：写死的话，发侧改了摘要位宽或改了分隔符，这里照样绿（同一事实两处各写一份，
 * 迟早有一处先漂）。同时另外断言那几条**不随实现变化**的性质：无 uuid 形状、位宽、
 * 以及同一条邀请重发多少次都是同一个锚。
 */
import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import type { Request } from "express";
import { invitationReferenceId } from "@vxture/service-organization";

import { IamRouter } from "./iam.router";
import type { RequestContext } from "../types/console.types";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const INVITATION_ID = "44444444-4444-4444-8444-444444444444";
const INVITEE_ID = "55555555-5555-4555-8555-555555555555";
const TENANT_NO = "1012345678";
/** support.inbox_messages.reference_id / notification_logs.reference_id 的列宽。 */
const REFERENCE_ID_MAX = 128;
const UUID_SHAPE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function req(tenantNo: string | null): Request & RequestContext {
  return {
    user: { id: "caller" },
    tenant: { id: TENANT_ID, tenantNo },
    headers: {},
  } as unknown as Request & RequestContext;
}

/** 审计写钩子是 fire-and-forget，给它一个不会炸的池即可。 */
function auditPool(): Pool {
  return {
    query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
  } as unknown as Pool;
}

interface Sent {
  reference: { type: string; id: string };
  params: Record<string, unknown>;
}

/**
 * 按**用户号**通道邀请一次，回分发器收到的那一条。
 *
 * 走 user_no 而不是 email：这条通道是站内送达（notifyInviteeInApp），不碰 MailService，
 * 于是这份用例不需要给邮件那三个依赖任何东西。
 */
async function inviteOnce(tenantNo: string | null): Promise<Sent[]> {
  const sent: Sent[] = [];
  const none = undefined as never;
  const router = new IamRouter(
    {
      inviteMember: vi.fn(async () => ({
        member: { id: INVITEE_ID },
        invitationId: INVITATION_ID,
        token: "tok",
        email: "",
        targetType: "user_no" as const,
        targetUserId: INVITEE_ID,
        roleCode: "manager",
        expiresAt: new Date("2026-10-06T02:00:00.000Z"),
        tenantName: "示例科技",
        inviterName: "张三",
        inviterLanguage: "zh-CN",
      })),
    } as never,
    auditPool(),
    none,
    none,
    {
      notify: vi.fn(async (input: Sent) => {
        sent.push(input);
      }),
    } as never,
  );
  await router.inviteMember(req(tenantNo), { userNo: "1200000003" });
  return sent;
}

describe("tenant.invitation 的去重锚", () => {
  it("锚里没有 uuid，且与邀请四态共用同一个拼法", async () => {
    const sent = await inviteOnce(TENANT_NO);
    expect(sent).toHaveLength(1);
    const anchor = sent[0]!.reference.id;

    /* 本文件存在的理由：这一项会被读路由原样投影给浏览器。 */
    expect(anchor).not.toMatch(UUID_SHAPE);
    expect(anchor).not.toContain(INVITATION_ID);
    /* 期望值现算，不写死——发侧改了摘要位宽这里要当场红。 */
    expect(anchor).toBe(
      invitationReferenceId(TENANT_NO, INVITATION_ID, "pending"),
    );
    expect(sent[0]!.reference.type).toBe("invitation");
  });

  it("位宽算得出来：10 + 1 + 12 + 1 + 7 = 31，列宽 128", async () => {
    const anchor = (await inviteOnce(TENANT_NO))[0]!.reference.id;
    expect(anchor.length).toBe(31);
    expect(anchor.length).toBeLessThanOrEqual(REFERENCE_ID_MAX);
    expect(anchor.startsWith(`${TENANT_NO}:`)).toBe(true);
    expect(anchor.endsWith(":pending")).toBe(true);
  });

  it("重发两次是同一个锚：一封邀请只在收件箱里落一条", async () => {
    const first = (await inviteOnce(TENANT_NO))[0]!.reference.id;
    const again = (await inviteOnce(TENANT_NO))[0]!.reference.id;
    expect(again).toBe(first);
  });

  it("租户可视码解析不出来也照发（这一封就是邀请本身）", async () => {
    const sent = await inviteOnce(null);
    expect(sent).toHaveLength(1);
    const anchor = sent[0]!.reference.id;
    expect(anchor.startsWith("unknown:")).toBe(true);
    expect(anchor).not.toMatch(UUID_SHAPE);
    /* 唯一性仍由摘要担着：换个租户码，同一条邀请的锚只差头一段。 */
    expect(anchor.endsWith(":pending")).toBe(true);
  });

  it("角色按**码**送、参数名是 roleKey（译成词是模板层的事）", async () => {
    const params = (await inviteOnce(TENANT_NO))[0]!.params;
    expect(params.roleKey).toBe("manager");
    /* 旧名字留在这里的后果不是报错，而是模板层拿不到角色、正文里少一个词。 */
    expect(params).not.toHaveProperty("roleName");
  });
});
