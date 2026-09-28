/**
 * invitation-revoke-boundary.spec.ts — 撤销邀请的 **best-effort 边界**（2026-09-29）。
 *
 * ── 钉的是哪一件事 ──
 * `revokeInvitation` 那条 `with revoked as (update … returning …) select …` 走的是
 * `pool.query`，**没有外层事务**：它一返回，撤销就已经提交。紧接着那一次「受邀人是谁」
 * 的回查在提交之后，而它原来**没有任何守卫**——不在这里，不在服务层的
 * `revokeInvitation`（那里只包了发通知那一段），也不在 BFF 的聚合器里。于是回查一旦
 * 失败（扫表超时 / 连接池耗尽），调用方看到的是**撤销失败**，而库里那一行早已 revoked：
 * 页面上仍显示 pending，客户再点一次拿到 404（CAS 已经不成立），于是「撤销坏了」。
 *
 * 这一类缺陷的特征是**测不到就永远看不到**：happy path 上它不存在，只在故障时现形，
 * 而那一刻它长得像另一个 bug。所以这里直接**让回查抛**，断言撤销仍然报成功。
 *
 * ── 为什么用假 pool 而不是真库 ──
 * 真库那一份（invitation-notify.itest.spec.ts）验的是 SQL 形状，而且要
 * `INVITATION_ITEST=1` 才跑，日常与 CI 都不跑。要验的这件事跟 SQL 形状无关，是
 * 「第二条语句抛了以后这个方法回什么」——那只跟控制流有关，假 pool 是**更准**的探针：
 * 真库里很难可靠地让一次 select 抛。两条 SQL 靠各自的特征串分流，不靠调用顺序：
 * 顺序一改，按次数分流的桩会静默测错那一条。
 */
import { Logger } from "@nestjs/common";
import type { Pool } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PgOrganizationRepository } from "./pg-organization.repository";

const INVITATION_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const TENANT_ID = "cccccccc-3333-4333-8333-333333333333";
const INVITER_ID = "dddddddd-4444-4444-8444-444444444444";
const INVITEE_ID = "eeeeeeee-5555-4555-8555-555555555555";

/** `with revoked as (…) select …` 回的那一行（INVITATION_FACTS_SELECT 的列名）。 */
const REVOKED_ROW = {
  invitation_id: INVITATION_ID,
  tenant_id: TENANT_ID,
  tenant_no: "1012345678",
  tenant_name: "示例科技",
  role_code: "member",
  expires_at: new Date("2026-09-20T02:00:00.000Z"),
  target: "ann@example.com",
  target_type: "email",
  inviter_user_id: INVITER_ID,
  inviter_name: "张三",
};

/** 受邀人回查（resolveInvitee）命中时回的那一行。 */
const INVITEE_ROW = { id: INVITEE_ID, name: "李四" };

interface Stub {
  repo: PgOrganizationRepository;
  sql: string[];
}

/**
 * 假 pool。两条语句按**它们做的事**分流（撤销那条含 `with revoked as`，回查那条
 * 从 `account.users` 取数），不按第几次被调用——按次数分流的桩会在语句顺序变了以后
 * 静默测错那一条。冒出第三条语句就抛，免得将来加了一次查询而这里毫无反应。
 */
function stub(opts: {
  revokedRows?: unknown[];
  lookup?: () => Promise<{ rows: unknown[] }>;
}): Stub {
  const sql: string[] = [];
  const query = vi.fn(async (text: string) => {
    sql.push(text);
    if (text.includes("with revoked as")) {
      return { rows: opts.revokedRows ?? [REVOKED_ROW] };
    }
    if (text.includes("from account.users u")) {
      return opts.lookup ? await opts.lookup() : { rows: [INVITEE_ROW] };
    }
    throw new Error(`unexpected query: ${text.slice(0, 60)}`);
  });
  return {
    repo: new PgOrganizationRepository({ query } as unknown as Pool),
    sql,
  };
}

const isRevoke = (text: string) => text.includes("with revoked as");
const isLookup = (text: string) => text.includes("from account.users u");

describe("revokeInvitation —— 提交之后的失败不许冒出去", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("受邀人回查抛了 → 撤销仍然报成功，只是没有收件人", async () => {
    const warn = vi
      .spyOn(Logger.prototype, "warn")
      .mockImplementation(() => {});
    const { repo, sql } = stub({
      lookup: async () => {
        throw new Error("canceling statement due to statement timeout");
      },
    });

    const outcome = await repo.revokeInvitation(INVITATION_ID, TENANT_ID);

    /* 这一条就是本文件存在的理由：撤销已经提交，所以它必须报成功。 */
    expect(outcome.ok).toBe(true);
    /* 事实照旧带回来——邀请人 / 租户那几列是撤销那条语句给的，回查失败不影响它们。 */
    expect(outcome.notify?.tenantNo).toBe("1012345678");
    /* 只是收件人空着：服务层据此落到 no_recipient_account，记一行日志、不发。 */
    expect(outcome.notify?.inviteeUserId).toBeNull();
    expect(outcome.notify?.inviteeName).toBeNull();
    /* 两条语句都跑过了（不是「回查没被调用」那种假通过）。 */
    expect(sql.filter(isRevoke)).toHaveLength(1);
    expect(sql.filter(isLookup)).toHaveLength(1);
    /* 吞掉不等于不出声：故障与「这个人还没注册」在服务层那一行日志里长得一样。 */
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0]?.[0] ?? "");
    expect(line).toContain("invitee lookup failed after commit");
    /* 日志也是人在读：可视码之外不出 id。 */
    expect(line).toContain("1012345678");
    expect(line).not.toContain(INVITATION_ID);
  });

  it("回查正常 → 收件人带上，一行 warn 都不记", async () => {
    const warn = vi
      .spyOn(Logger.prototype, "warn")
      .mockImplementation(() => {});
    const { repo } = stub({});

    const outcome = await repo.revokeInvitation(INVITATION_ID, TENANT_ID);

    expect(outcome.ok).toBe(true);
    expect(outcome.notify?.inviteeUserId).toBe(INVITEE_ID);
    expect(outcome.notify?.inviteeName).toBe("李四");
    expect(warn).not.toHaveBeenCalled();
  });

  it("CAS 输了（没改到行）→ ok:false，且根本不去回查", async () => {
    const { repo, sql } = stub({ revokedRows: [] });

    const outcome = await repo.revokeInvitation(INVITATION_ID, TENANT_ID);

    expect(outcome).toEqual({ ok: false });
    /* 没有转移就没有收件人要算——多跑一次扫表是白花的，也会让日志里多一条噪声。 */
    expect(sql.filter(isLookup)).toHaveLength(0);
  });
});
