/**
 * workspace-switch.itest.spec.ts — 工作空间切换的**解析那一段**在真 Postgres 上的验证。
 *
 * Run: WORKSPACE_ITEST=1 DATABASE_URL=postgresql://... pnpm test
 *
 * ── 这一段在整条链路的哪儿 ──
 *
 *     浏览器 ─/auth/switch-workspace?workspaceId─▶ console-bff 预检
 *       ─302 IdP /oidc/authorize?workspace_hint─▶ 记进 Redis
 *         ─铸令牌时读回 ─▶ **resolveWorkspaceForSession** ─▶ active_workspace 进 token
 *                            ↑ 这里
 *
 * 链路的其余几段各有各的验收：参数名那个字面量钉在 oidc-rp 的 spec（写错名字照样
 * 编译，症状是切换静默无效）；「提示有没有被递下去」钉在 active-context 的 spec。
 * 剩下这一段是**判据本身**，全写在 SQL 的 where 里，只有真库跑得出来。
 *
 * ── 判据为什么是四条而不是一条 ──
 * 提示来自地址栏与 Redis 里的旧值，**不可信也会过期**。少任何一条，症状都不是报错：
 *
 *   · 不查租户   → 拿到别的租户的工作空间 id 就能横着进去（越权，最严重的一条）
 *   · 不查成员   → 我不在里面也能进
 *   · 不查启用中 → 停用的空间成了落点
 *   · 不退回默认 → 提示过期时登录直接失败，而不是落回默认
 *
 * 收尾按租户删干净（workspaces 对 tenants 是 ON DELETE CASCADE）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { PgOrganizationRepository } from "./pg-organization.repository";

const RUN = process.env.WORKSPACE_ITEST === "1";
const CONN = process.env.DATABASE_URL ?? "";

describe.runIf(RUN)("工作空间切换的解析（live DB）", () => {
  let pool: Pool;
  let repo: PgOrganizationRepository;
  let tenantId: string;
  let otherTenantId: string;
  let userId: string;
  let strangerId: string;
  /** 默认、我能进的第二个、我进不去的、已停用的、别的租户的。 */
  const ws: Record<string, string> = {};

  /** 建一个工作空间；`member` 为真时把 userId 挂进去。 */
  async function makeWorkspace(
    tenant: string,
    name: string,
    opts: { isDefault?: boolean; status?: string; member?: string | null } = {},
  ): Promise<string> {
    const r = await pool.query<{ id: string }>(
      `insert into tenancy.workspaces (tenant_id, name, is_default, status)
       values ($1, $2, $3, $4) returning id`,
      [tenant, name, opts.isDefault ?? false, opts.status ?? "active"],
    );
    const id = r.rows[0]!.id;
    if (opts.member) {
      await pool.query(
        `insert into tenancy.workspace_memberships
           (workspace_id, tenant_id, user_id, role_id, role_scope, status, created_at, updated_at)
         select $1, $2, $3, r.id, 'workspace', 'active', now(), now()
           from access.roles r
          where r.scope = 'workspace' and r.role_code = 'member'`,
        [id, tenant, opts.member],
      );
    }
    return id;
  }

  /** 把用户挂成租户成员——工作空间成员的前提（fk_workspace_memberships_tenant_member）。 */
  async function joinTenant(tenant: string, user: string) {
    await pool.query(
      `insert into tenancy.tenant_memberships
         (tenant_id, user_id, role_id, role_scope, status, created_at, updated_at)
       select $1, $2, r.id, 'tenant', 'active', now(), now()
         from access.roles r
        where r.scope = 'tenant' and r.role_code = 'member'
       on conflict (tenant_id, user_id) do nothing`,
      [tenant, user],
    );
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: CONN });
    repo = new PgOrganizationRepository(pool);

    const users = await pool.query<{ id: string }>(
      `select id from account.users limit 2`,
    );
    userId = users.rows[0]!.id;
    strangerId = users.rows[1]?.id ?? users.rows[0]!.id;

    for (const key of ["a", "b"] as const) {
      const t = await pool.query<{ id: string }>(
        `insert into tenancy.tenants (name, display_name, type, owner_user_id, status)
         values ($1, 'ITEST', 'organization', $2, 'active') returning id`,
        [`ITEST 切换租户 ${key}`, userId],
      );
      if (key === "a") tenantId = t.rows[0]!.id;
      else otherTenantId = t.rows[0]!.id;
    }
    await joinTenant(tenantId, userId);
    await joinTenant(otherTenantId, userId);

    ws["default"] = await makeWorkspace(tenantId, "ITEST 默认", {
      isDefault: true,
      member: userId,
    });
    ws["mine"] = await makeWorkspace(tenantId, "ITEST 我能进的第二个", {
      member: userId,
    });
    ws["notMine"] = await makeWorkspace(tenantId, "ITEST 我进不去的", {
      member: null,
    });
    ws["archived"] = await makeWorkspace(tenantId, "ITEST 已停用", {
      status: "archived",
      member: userId,
    });
    ws["otherTenant"] = await makeWorkspace(otherTenantId, "ITEST 别的租户的", {
      member: userId,
    });
  });

  afterAll(async () => {
    for (const t of [tenantId, otherTenantId]) {
      if (!t) continue;
      await pool.query(
        `delete from tenancy.workspace_memberships where tenant_id = $1`,
        [t],
      );
      await pool.query(
        `delete from tenancy.tenant_memberships where tenant_id = $1`,
        [t],
      );
      await pool.query(`delete from tenancy.tenants where id = $1`, [t]);
    }
    await pool?.end();
  });

  it("不给提示 → 落在默认", async () => {
    const r = await repo.resolveWorkspaceForSession(tenantId, userId);
    expect(r.workspace?.id).toBe(ws["default"]);
    expect(r.membershipRole).toBe("member");
  });

  it("提示站得住 → 落在提示指的那个（这条是切换真的生效）", async () => {
    const r = await repo.resolveWorkspaceForSession(
      tenantId,
      userId,
      ws["mine"],
    );
    expect(r.workspace?.id).toBe(ws["mine"]);
    expect(r.membershipRole).toBe("member");
  });

  /* 下面四条是同一个形状的四种坏提示：每一条都必须**静默退回默认**，
     既不越权、也不失败。 */

  it("别的租户的工作空间 → 退回默认（越权，最严重的一条）", async () => {
    const r = await repo.resolveWorkspaceForSession(
      tenantId,
      userId,
      ws["otherTenant"],
    );
    expect(r.workspace?.id).toBe(ws["default"]);
  });

  it("我不是成员的 → 退回默认", async () => {
    const r = await repo.resolveWorkspaceForSession(
      tenantId,
      userId,
      ws["notMine"],
    );
    expect(r.workspace?.id).toBe(ws["default"]);
  });

  it("已停用的 → 退回默认", async () => {
    const r = await repo.resolveWorkspaceForSession(
      tenantId,
      userId,
      ws["archived"],
    );
    expect(r.workspace?.id).toBe(ws["default"]);
  });

  it("形状不对的提示 → 退回默认，不撞出 22P02", async () => {
    /* `workspaces.id` 是 uuid 列。非 uuid 文本会让 PG 抛
       "invalid input syntax for type uuid"——那是 500，不是「退回默认」。 */
    const r = await repo.resolveWorkspaceForSession(
      tenantId,
      userId,
      "not-a-uuid",
    );
    expect(r.workspace?.id).toBe(ws["default"]);
  });

  it("切换器清单：只列我能进、且启用中的", async () => {
    const list = await repo.listWorkspacesForSwitch(tenantId, userId);
    const ids = list.map((w) => w.id).sort();
    expect(ids).toEqual([ws["default"], ws["mine"]].sort());
    // 默认排在最前：切换器里它是最常回去的那一个。
    expect(list[0]!.id).toBe(ws["default"]);
  });

  /**
   * 改租户角色**不该**动我在各个工作空间里的角色（2026-09-09 回归）。
   *
   * 工作空间还只有一个的时候，`updateOrgMemberRole` 把两级一起改是对的：
   * 代码原注写着「只改租户级会留下谁也解释不了的中间态」。但工作空间变成复数之后，
   * 那条 UPDATE 的 where 只有 `(tenant_id, user_id)`、**没有工作空间**，于是它会
   * 把这个人在**每一个**工作空间里的角色一起改掉。
   *
   * 够得着的路径：我建了个工作空间（建者拿 workspace-owner）→ 别人把我的租户角色
   * 改成 member → 我在自己建的那个空间里也变成 member，管不了它了。
   * 不报错、没有提示，只是权限少了。
   */
  it("改租户角色不该覆盖我在其它工作空间里的角色", async () => {
    // 我在 mine 这个空间里是 owner（模拟「自己建的空间」）。
    await pool.query(
      `update tenancy.workspace_memberships m
          set role_id = r.id
         from access.roles r
        where m.workspace_id = $1 and m.user_id = $2
          and r.scope = 'workspace' and r.role_code = 'owner'`,
      [ws["mine"], userId],
    );

    await repo.updateOrgMemberRole(tenantId, userId, "member");

    const after = await pool.query<{ role_code: string }>(
      `select rr.role_code
         from tenancy.workspace_memberships m
         join access.roles rr on rr.id = m.role_id
        where m.workspace_id = $1 and m.user_id = $2`,
      [ws["mine"], userId],
    );
    // 默认空间跟着租户角色走是既有行为；**别的**空间不该被牵连。
    expect(after.rows[0]?.role_code).toBe("owner");
  });

  /**
   * 正向对照：默认空间**仍然**要跟着租户角色走。
   *
   * 上一条只证明「别的空间没被动」，一个「工作空间那半整个不写」的实现同样能过它——
   * 那就切过头了，会留下代码原注说的「租户里是 manager、工作空间里还是 member」
   * 那种谁也解释不了的中间态。两条合起来才把范围钉死：**恰好默认那一个**。
   */
  it("改租户角色仍然带动默认工作空间（切过头的反向对照）", async () => {
    await repo.updateOrgMemberRole(tenantId, userId, "manager");
    const def = await pool.query<{ role_code: string }>(
      `select rr.role_code
         from tenancy.workspace_memberships m
         join access.roles rr on rr.id = m.role_id
        where m.workspace_id = $1 and m.user_id = $2`,
      [ws["default"], userId],
    );
    expect(def.rows[0]?.role_code).toBe("manager");
  });

  it("切换器清单：换个人看，只剩他自己能进的（这里是一个都没有）", async () => {
    if (strangerId === userId) return; // 库里只有一个账号时跳过
    await joinTenant(tenantId, strangerId);
    const list = await repo.listWorkspacesForSwitch(tenantId, strangerId);
    /* 他是租户成员但没被挂进任何工作空间——「组织成员可以不在任何工作空间」
       就是这个形状（owner 2026-09-09 的第 3 件裁定）。 */
    expect(list).toEqual([]);
  });
});
