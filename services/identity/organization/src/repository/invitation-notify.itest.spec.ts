/**
 * invitation-notify.itest.spec.ts — 邀请四态的通知事实取数在真 Postgres 上的验证。
 *
 * Run: INVITATION_ITEST=1 DATABASE_URL=postgresql://... pnpm test
 *
 * ── 为什么非要连真库 ──
 * 这一批改的全是**只有 PG 才会有意见**的东西，类型检查一个字都看不见：
 *
 *   1. `for update of i`。三条转移里有两条是持锁的 locked SELECT，而这次给它们加了
 *      外连接（租户、角色、邀请人及其 profile）。裸 `for update` 遇到外连接会被 PG
 *      直接拒（不能锁外连接的可空侧），`of i` 才行——tsc 对此一无所知。
 *   2. `with revoked as (update … returning …) select … from revoked i left join …`。
 *      撤销那一条是一条语句里既改又取，形状对不对只有跑过才知道。
 *   3. 受邀人回查的两条通道。`u.user_no::text = $1` 与 `lower(coalesce(u.email,''))`
 *      —— 前者要转型（user_no 是 bigint），后者要大小写不敏感。用假 pool 测等于
 *      用 JS 把判据重算一遍，测的是重算的那份。
 *   4. 重发能不能救回一条已过期的邀请。到期巡检开始真的写 `status='expired'` 之后，
 *      邀请台账上那个「重发」按钮就全靠 `status in ('pending','expired')` 这一句活着。
 *
 * 收尾用显式清理而不是 ROLLBACK：仓储内部自己 `pool.connect()`，与测试持有的那条
 * 独占连接互相等（workspace-crud.itest 踩过，那里有详细说明）。数据一律带 ITEST 前缀。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { PgOrganizationRepository } from "./pg-organization.repository";

const RUN = process.env.INVITATION_ITEST === "1";
const CONN = process.env.DATABASE_URL ?? "";

interface Person {
  id: string;
  userNo: string;
  email: string;
  account: string;
}

describe.runIf(RUN)("邀请通知事实（live DB）", () => {
  let pool: Pool;
  let repo: PgOrganizationRepository;
  let tenantId: string;
  let tenantNo: string;
  let workspaceId: string;
  let inviter: Person;
  let invitee: Person;

  /** 造一个自带邮箱与显示名的账号（用户号由 new_principal_no 取，Luhn 合法）。 */
  async function makePerson(tag: string): Promise<Person> {
    const r = await pool.query<{
      id: string;
      user_no: string;
      email: string;
      account: string;
    }>(
      `with ins as (
         insert into account.users (user_no, account, email, phone, phone_verified_at)
         values (public.new_principal_no(1),
                 'itest-inv-' || $1 || '-' || substr(gen_random_uuid()::text, 1, 8),
                 'itest-inv-' || $1 || '-' || substr(gen_random_uuid()::text, 1, 8) || '@Example.COM',
                 '1' || lpad((floor(random() * 9999999999))::bigint::text, 10, '0'), now())
         returning id, user_no::text as user_no, email, account
       )
       select * from ins`,
      [tag],
    );
    const row = r.rows[0]!;
    await pool.query(
      `insert into account.user_profiles (user_id, display_name)
       values ($1, $2)
       on conflict (user_id) do update set display_name = excluded.display_name`,
      [row.id, `ITEST ${tag}`],
    );
    return {
      id: row.id,
      userNo: row.user_no,
      email: row.email,
      account: row.account,
    };
  }

  async function invite(target: string, targetType: "email" | "user_no") {
    const { invitation } = await repo.createInvitation({
      scope: "org",
      organizationId: tenantId,
      workspaceId,
      targetType,
      target,
      role: "member",
      createdBy: inviter.id,
    });
    return invitation.id;
  }

  async function statusOf(invitationId: string): Promise<string> {
    const r = await pool.query<{ status: string }>(
      `select status from tenancy.invitations where id = $1`,
      [invitationId],
    );
    return r.rows[0]!.status;
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: CONN });
    repo = new PgOrganizationRepository(pool);
    inviter = await makePerson("inviter");
    invitee = await makePerson("invitee");

    const t = await pool.query<{ id: string; tenant_no: string }>(
      `insert into tenancy.tenants (name, display_name, type, owner_user_id, status)
       values ('ITEST 邀请通知租户', 'ITEST', 'organization', $1, 'active')
       returning id, tenant_no::text as tenant_no`,
      [inviter.id],
    );
    tenantId = t.rows[0]!.id;
    tenantNo = t.rows[0]!.tenant_no;
    /* 工作空间成员必须先是租户成员（fk_workspace_memberships_tenant_member）。 */
    await pool.query(
      `insert into tenancy.tenant_memberships
         (tenant_id, user_id, role_id, role_scope, status, created_at, updated_at)
       select $1, $2, r.id, 'tenant', 'active', now(), now()
         from access.roles r
        where r.scope = 'tenant' and r.role_code = 'owner'`,
      [tenantId, inviter.id],
    );
    const w = await pool.query<{ id: string }>(
      `insert into tenancy.workspaces (tenant_id, name, is_default, status)
       values ($1, 'ITEST 默认空间', true, 'active') returning id`,
      [tenantId],
    );
    workspaceId = w.rows[0]!.id;
  });

  afterAll(async () => {
    if (tenantId) {
      await pool.query(`delete from tenancy.invitations where tenant_id = $1`, [
        tenantId,
      ]);
      await pool.query(
        `delete from tenancy.workspace_memberships where tenant_id = $1`,
        [tenantId],
      );
      await pool.query(`delete from tenancy.tenants where id = $1`, [tenantId]);
    }
    for (const p of [inviter, invitee]) {
      if (p?.id) {
        await pool.query(`delete from account.users where id = $1`, [p.id]);
      }
    }
    await pool?.end();
  });

  it("拒绝：加宽后的 locked SELECT 跑得通，且带回租户可视码与邀请人", async () => {
    const id = await invite(invitee.email, "email");
    const result = await repo.declineInvitation(id, {
      email: invitee.email,
      userNo: null,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const facts = result.notify!;
    expect(facts.tenantId).toBe(tenantId);
    expect(facts.tenantNo).toBe(tenantNo);
    expect(facts.tenantName).toBe("ITEST 邀请通知租户");
    expect(facts.roleCode).toBe("member");
    expect(facts.inviterUserId).toBe(inviter.id);
    expect(facts.inviterName).toBe("ITEST inviter");
    expect(facts.target).toBe(invitee.email);
    expect(await statusOf(id)).toBe("declined");
  });

  it("撤销：一条语句既改又取；受邀人按用户号回查得到账号", async () => {
    const id = await invite(invitee.userNo, "user_no");
    const outcome = await repo.revokeInvitation(id, tenantId);
    expect(outcome.ok).toBe(true);
    expect(outcome.notify?.inviteeUserId).toBe(invitee.id);
    expect(outcome.notify?.inviteeName).toBe("ITEST invitee");
    expect(outcome.notify?.tenantNo).toBe(tenantNo);
    expect(await statusOf(id)).toBe("revoked");
    /* 第二次撤销改不到行（CAS）→ 没有事实，一条都不发。 */
    const again = await repo.revokeInvitation(id, tenantId);
    expect(again).toEqual({ ok: false });
  });

  it("撤销：受邀人是个还没注册的邮箱 → 回查为空（不是异常）", async () => {
    const id = await invite("itest-nobody-here@example.com", "email");
    const outcome = await repo.revokeInvitation(id, tenantId);
    expect(outcome.ok).toBe(true);
    expect(outcome.notify?.inviteeUserId).toBeNull();
    expect(outcome.notify?.inviteeName).toBeNull();
  });

  it("撤销：邮箱回查大小写不敏感（库里存的是写入时的原样）", async () => {
    const id = await invite(invitee.email.toLowerCase(), "email");
    const outcome = await repo.revokeInvitation(id, tenantId);
    expect(outcome.notify?.inviteeUserId).toBe(invitee.id);
  });

  it("接受：加宽后的 locked SELECT 跑得通，受邀人显示名按主键连得到", async () => {
    const id = await invite(invitee.userNo, "user_no");
    const result = await repo.acceptInvitation(
      { invitationId: id },
      invitee.id,
      {
        email: null,
        userNo: invitee.userNo,
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.notify?.inviterUserId).toBe(inviter.id);
    expect(result.notify?.inviteeUserId).toBe(invitee.id);
    expect(result.notify?.inviteeName).toBe("ITEST invitee");
    expect(result.notify?.tenantNo).toBe(tenantNo);
    expect(await statusOf(id)).toBe("accepted");
  });

  it("巡检：候选查询取到过期的 pending 行，CAS 只成功一次", async () => {
    const id = await invite("itest-sweep@example.com", "email");
    await pool.query(
      `update tenancy.invitations set expires_at = now() - interval '2 days'
        where id = $1`,
      [id],
    );
    const rows = await repo.findExpiredInvitationCandidates({ limit: 50 });
    const mine = rows.find((r) => r.invitationId === id);
    expect(mine).toBeDefined();
    expect(mine!.tenantNo).toBe(tenantNo);
    expect(mine!.inviterUserId).toBe(inviter.id);
    expect(await repo.markInvitationExpired(id)).toBe(true);
    expect(await statusOf(id)).toBe("expired");
    // 第二趟（或另一个实例）改不到行：一条通知都不该再发。
    expect(await repo.markInvitationExpired(id)).toBe(false);
  });

  it("重发救回已过期的邀请（巡检写下 expired 之后那个按钮还得好用）", async () => {
    const id = await invite("itest-resend@example.com", "email");
    await pool.query(
      `update tenancy.invitations set expires_at = now() - interval '1 day'
        where id = $1`,
      [id],
    );
    expect(await repo.markInvitationExpired(id)).toBe(true);
    const rotated = await repo.rotateInvitationToken(id, tenantId);
    expect(rotated).not.toBeNull();
    expect(await statusOf(id)).toBe("pending");
    expect(rotated!.expiresAt.getTime()).toBeGreaterThan(Date.now());
    /* 撤销过的仍然重发不了——救回的档只有 expired 一个。 */
    const other = await invite("itest-revoked@example.com", "email");
    await repo.revokeInvitation(other, tenantId);
    expect(await repo.rotateInvitationToken(other, tenantId)).toBeNull();
  });

  /**
   * 反方向的那一半：**重发赶在巡检落笔之前**。
   *
   * 上一条测的是「巡检写下 expired 之后重发还得好用」。这一条测的是它的反面，而那一面
   * 原来是坏的：候选集按 `expires_at <= now()` 选，而 CAS 原来只比 `status = 'pending'`。
   * 重发是唯一一个不改 status 的写者，所以它不会被那一句挡住 —— 取数之后被重发的邀请
   * 会被这一趟改成 expired，受邀人还会收到一封「已过期」。
   *
   * 窗口不是理论上的：一趟最多 200 行，循环体里每行都同步 await SMTP。
   */
  it("重发赶在巡检落笔之前：CAS 必须让掉，不许把刚续期的邀请改成 expired", async () => {
    const id = await invite("itest-resend-race@example.com", "email");
    await pool.query(
      `update tenancy.invitations set expires_at = now() - interval '2 days'
        where id = $1`,
      [id],
    );

    // ① 巡检取数：这一刻它确实是「pending 且已过期」。
    const rows = await repo.findExpiredInvitationCandidates({ limit: 50 });
    expect(rows.some((r) => r.invitationId === id)).toBe(true);

    // ② 取数之后、落笔之前，运营点了「重发」：status 仍是 pending，expires_at 顺延。
    const rotated = await repo.rotateInvitationToken(id, tenantId);
    expect(rotated).not.toBeNull();
    expect(rotated!.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(await statusOf(id)).toBe("pending");

    // ③ 巡检这才落笔。必须一行都改不到 —— 否则刚续期的邀请被判死，且会发错通知。
    expect(await repo.markInvitationExpired(id)).toBe(false);
    expect(await statusOf(id)).toBe("pending");

    // ④ 续期那一刻起它就不该再是候选（口径两边一致才有这个性质）。
    const after = await repo.findExpiredInvitationCandidates({ limit: 50 });
    expect(after.some((r) => r.invitationId === id)).toBe(false);
  });
});
