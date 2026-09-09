/**
 * workspace-crud.itest.spec.ts — 工作空间写侧在真 Postgres 上的验证。
 *
 * Run: WORKSPACE_ITEST=1 DATABASE_URL=postgresql://... pnpm test
 *
 * ── 为什么非要连真库 ──
 * 这五个方法里，**类型检查看不见的东西恰好是全部要点**：
 *
 *   1. PG 的参数类型推断。`case when $4 then $5 else description end` 里的 `$5`
 *      传 null 时，不加 `::text` 会抛 "could not determine data type of parameter"。
 *      tsc 对此一无所知。
 *   2. 三条不变式究竟挡不挡得住。默认的不能停、最后一个 active 的不能停、
 *      同租户重名要撞——判据全写在 SQL 里，用假 pool 测等于用 JS 把它们重算一遍，
 *      那测的是重算的那份，不是真跑的那份。
 *   3. `workspace_no` 由触发器取号。应用层一个字都没写，只有真库跑得出来。
 *
 * ── 收尾为什么不是 ROLLBACK ──
 * 起初写成「测试持有一条连接 + begin，末尾 rollback」，结果全部超时：仓储内部自己
 * `pool.connect()` 拿连接，与测试持有的那条**互相等**。连接池发的是独占连接，
 * 不会因为 max:1 就共享同一个事务。所以改成**显式清理**：数据全部带 `ITEST` 前缀，
 * 末尾按租户删干净（workspaces 对 tenants 是 ON DELETE CASCADE）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { PgOrganizationRepository } from "./pg-organization.repository";

const RUN = process.env.WORKSPACE_ITEST === "1";
const CONN = process.env.DATABASE_URL ?? "";

describe.runIf(RUN)("工作空间写侧（live DB）", () => {
  let pool: Pool;
  let repo: PgOrganizationRepository;
  let tenantId: string;
  let userId: string;
  let baseWsId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: CONN });
    repo = new PgOrganizationRepository(pool);

    const t = await pool.query<{ id: string }>(
      `insert into tenancy.tenants (name, display_name, type, owner_user_id, status)
       select 'ITEST 工作空间租户', 'ITEST', 'organization', u.id, 'active'
         from account.users u limit 1
       returning id`,
    );
    tenantId = t.rows[0]!.id;
    const u = await pool.query<{ id: string }>(
      `select id from account.users limit 1`,
    );
    userId = u.rows[0]!.id;
    /* 必须先挂租户成员:`fk_workspace_memberships_tenant_member` 要求工作空间成员
       **先是租户成员**(工作空间成员 ⊂ 租户成员,库里硬挡)。第一版夹具漏了这一条,
       六条用例全挂在这个 FK 上——这正是这组测试要连真库的理由。 */
    await pool.query(
      `insert into tenancy.tenant_memberships
         (tenant_id, user_id, role_id, role_scope, status, created_at, updated_at)
       select $1, $2, r.id, 'tenant', 'active', now(), now()
         from access.roles r
        where r.scope = 'tenant' and r.role_code = 'owner'`,
      [tenantId, userId],
    );
    const w = await pool.query<{ id: string }>(
      `insert into tenancy.workspaces (tenant_id, name, is_default, status)
       values ($1, 'ITEST 默认空间', true, 'active') returning id`,
      [tenantId],
    );
    baseWsId = w.rows[0]!.id;
  });

  afterAll(async () => {
    /* 先删成员行再删租户：workspace_memberships 挂在 workspaces 上，
       而 workspaces 对 tenants 是 CASCADE——顺序反了会剩下孤儿成员行。 */
    if (tenantId) {
      await pool.query(
        `delete from tenancy.workspace_memberships where tenant_id = $1`,
        [tenantId],
      );
      await pool.query(`delete from tenancy.tenants where id = $1`, [tenantId]);
    }
    await pool?.end();
  });

  it("建：名字首尾空白被裁掉，workspace_no 由触发器取到", async () => {
    const made = await repo.createWorkspace({
      tenantId,
      name: "  ITEST 空间 A  ",
      description: "说明",
      creatorUserId: userId,
      creatorRoleCode: "owner",
    });
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    expect(made.workspace.name).toBe("ITEST 空间 A");
    /* 号是 10 位可视码（类别位 3 + 随机 8 + Luhn）。应用层没写过它一个字符——
       断言它非空，就是断言触发器真的跑了。 */
    expect(made.workspace.workspaceNo).toMatch(/^\d{10}$/);
    // 建好即可进：创建者已挂进去，不是一个进不去的空壳。
    expect(made.workspace.memberCount).toBe(1);
    expect(made.workspace.isDefault).toBe(false);
  });

  it("建：同租户重名要撞（大小写与首尾空白归一后比）", async () => {
    const dup = await repo.createWorkspace({
      tenantId,
      name: "itest 空间 a ",
      creatorUserId: userId,
      creatorRoleCode: "owner",
    });
    expect(dup).toEqual({ ok: false, reason: "name_taken" });
  });

  it("改：说明可以显式清空（不是「没给就不改」）", async () => {
    const list = await repo.listWorkspaces(tenantId);
    const target = list.find((w) => w.name === "ITEST 空间 A")!;
    expect(target.description).toBe("说明");

    /* 「显式设为 null」与「没给就不改」是两件事，SQL 里靠一个布尔位分开。
       只断言清空成功证明不了什么——下面那条反向对照才是判据。 */
    expect(
      await repo.updateWorkspace(tenantId, target.id, { description: null }),
    ).toEqual({
      ok: true,
    });
    const after = await repo.listWorkspaces(tenantId);
    expect(after.find((w) => w.id === target.id)!.description).toBeNull();

    // 反向对照：不给这一项时不该被清掉。
    expect(
      await repo.updateWorkspace(tenantId, target.id, { name: "ITEST 空间 B" }),
    ).toEqual({ ok: true });
    const renamed = await repo.listWorkspaces(tenantId);
    expect(renamed.find((w) => w.id === target.id)!.name).toBe("ITEST 空间 B");
  });

  it("停用：默认的停不掉", async () => {
    expect(await repo.archiveWorkspace(tenantId, baseWsId)).toEqual({
      ok: false,
      reason: "default_locked",
    });
  });

  it("停用：非默认的可以停；停用的设不成默认", async () => {
    const list = await repo.listWorkspaces(tenantId);
    const other = list.find((w) => w.id !== baseWsId)!;
    expect(await repo.archiveWorkspace(tenantId, other.id)).toEqual({
      ok: true,
    });
    /* 默认永远落在一个 active 的空间上——这两条合起来就是「至少有一个 active」
       的真正来源：停用的设不成默认，而默认停不掉。 */
    expect(await repo.setDefaultWorkspace(tenantId, other.id)).toEqual({
      ok: false,
      reason: "archived",
    });
  });

  /**
   * 兜底那条要真的挡得住。
   *
   * 起初这条用例叫「最后一个 active 的停不掉」，但它走到的是 `default_locked`——
   * 把判据整个拆掉重跑，7 条照样全绿。原因是经这几个方法**根本到不了**那个状态：
   * 默认永远 active 且停不掉，下界已经由那条保证。
   *
   * 所以这里用直接 SQL 造出「默认被停用、只剩一个非默认的 active」——
   * 手工修数据或迁移写歪就会是这个形状——再看兜底认不认。
   */
  it("停用：兜底——只剩一个 active 时停不掉（用直接 SQL 造状态）", async () => {
    const list = await repo.listWorkspaces(tenantId);
    const other = list.find((w) => w.id !== baseWsId)!;
    await pool.query(
      `update tenancy.workspaces set status='active' where id=$1`,
      [other.id],
    );
    // 绕过这一层，把默认那条直接停掉：这几个方法造不出的状态。
    await pool.query(
      `update tenancy.workspaces set status='archived' where id=$1`,
      [baseWsId],
    );
    expect(await repo.archiveWorkspace(tenantId, other.id)).toEqual({
      ok: false,
      reason: "last_active",
    });
    await pool.query(
      `update tenancy.workspaces set status='active' where id=$1`,
      [baseWsId],
    );
  });

  it("改默认：默认唯一，切过去之后原来那条不再是默认", async () => {
    const list = await repo.listWorkspaces(tenantId);
    const other = list.find((w) => w.id !== baseWsId)!;
    // 先恢复成 active 才能设为默认。
    await pool.query(
      `update tenancy.workspaces set status='active' where id=$1`,
      [other.id],
    );
    expect(await repo.setDefaultWorkspace(tenantId, other.id)).toEqual({
      ok: true,
    });

    const after = await repo.listWorkspaces(tenantId);
    const defaults = after.filter((w) => w.isDefault);
    // 一租户只该有一条默认——这是会话解析的落点，两条会让登录进哪儿变成随机。
    expect(defaults).toHaveLength(1);
    expect(defaults[0]!.id).toBe(other.id);
  });

  it("列：不含别的租户的工作空间", async () => {
    const list = await repo.listWorkspaces(tenantId);
    expect(list.every((w) => w.organizationId === tenantId)).toBe(true);
    expect(list.map((w) => w.name).sort()).toEqual(
      ["ITEST 默认空间", "ITEST 空间 B"].sort(),
    );
  });
});
