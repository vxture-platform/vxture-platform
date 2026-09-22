import { describe, expect, it } from "vitest";
import { ConflictException } from "@nestjs/common";
import {
  assertTenantMemberHeadroom,
  assertTenantWorkspaceHeadroom,
} from "./pg-organization.repository";

/**
 * 租户级防滥用闸（owner 2026-09-22：「设定一个比较高的上限，防止恶意爆仓就行」）。
 *
 * 这几条就是闸本身——拦不住的闸和没有闸完全一样，而且更糟：它会让人以为有。
 * 所以每一条都直接钉「该拦的拦住了、不该拦的没拦」。
 *
 * 事务与行锁由 itest 覆盖（同 invitation-accept.spec 的分工）；这里用桩 client
 * 钉判据：取值来源、已存在成员不算新增、默认缺失要抛。
 */

type Row = Record<string, unknown>;

/**
 * 按 SQL 片段派发的桩 client。
 *
 * 刻意**不**写死返回值，而是由每条用例给出「这张表现在有什么」——写死 happy-path
 * 行会把上游过滤从测试视野里删掉（本仓有过先例）。
 */
function stubClient(opts: {
  tenantExists?: boolean;
  memberLimit?: number | null;
  workspaceLimit?: number | null;
  settings?: Record<string, string>;
  alreadyMember?: boolean;
  memberCount?: number;
  workspaceCount?: number;
}) {
  const calls: string[] = [];
  const settings = opts.settings ?? {};
  return {
    calls,
    client: {
      query: async (
        sql: string,
        params?: unknown[],
      ): Promise<{ rowCount: number; rows: Row[] }> => {
        calls.push(sql.replace(/\s+/g, " ").trim());
        if (sql.includes("from tenancy.tenants")) {
          if (opts.tenantExists === false) return { rowCount: 0, rows: [] };
          const cap = sql.includes("member_limit")
            ? (opts.memberLimit ?? null)
            : (opts.workspaceLimit ?? null);
          return { rowCount: 1, rows: [{ cap }] };
        }
        if (sql.includes("from admin.settings")) {
          const key = String(params?.[0] ?? "");
          const value = settings[key];
          return value === undefined
            ? { rowCount: 0, rows: [] }
            : { rowCount: 1, rows: [{ config_value: value }] };
        }
        if (
          sql.includes("from tenancy.tenant_memberships") &&
          sql.includes("select 1")
        ) {
          return opts.alreadyMember
            ? { rowCount: 1, rows: [{}] }
            : { rowCount: 0, rows: [] };
        }
        if (sql.includes("from tenancy.tenant_memberships")) {
          return { rowCount: 1, rows: [{ n: String(opts.memberCount ?? 0) }] };
        }
        if (sql.includes("from tenancy.workspaces")) {
          return {
            rowCount: 1,
            rows: [{ n: String(opts.workspaceCount ?? 0) }],
          };
        }
        throw new Error(`桩没有覆盖这条 SQL：${sql.slice(0, 80)}`);
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
  };
}

const TENANT = "11111111-1111-1111-1111-111111111111";
const USER = "22222222-2222-2222-2222-222222222222";
const DEFAULTS = {
  "tenant.member_limit": "500",
  "tenant.workspace_limit": "200",
};

describe("成员数闸", () => {
  it("未达上限 → 放行", async () => {
    const { client } = stubClient({ settings: DEFAULTS, memberCount: 499 });
    await expect(
      assertTenantMemberHeadroom(client, TENANT, USER),
    ).resolves.toBeUndefined();
  });

  it("已达上限 → 409，且消息带出当前/上限", async () => {
    const { client } = stubClient({ settings: DEFAULTS, memberCount: 500 });
    await expect(
      assertTenantMemberHeadroom(client, TENANT, USER),
    ).rejects.toThrow(ConflictException);
    await expect(
      assertTenantMemberHeadroom(client, TENANT, USER),
    ).rejects.toThrow("500/500");
  });

  /*
   * addOrgMember 与 acceptInvitation 都是 `on conflict do update`——重复添加已有
   * 成员本就不长数。满员时若把这种情况也拦掉，会出现「已经在里面的人改个角色都
   * 改不了」，而那与防滥用无关。
   */
  it("已是成员 → 即使满员也放行（不是新增）", async () => {
    const { client } = stubClient({
      settings: DEFAULTS,
      memberCount: 500,
      alreadyMember: true,
    });
    await expect(
      assertTenantMemberHeadroom(client, TENANT, USER),
    ).resolves.toBeUndefined();
  });

  it("租户行的覆盖值优先于平台默认", async () => {
    const { client } = stubClient({
      settings: DEFAULTS,
      memberLimit: 3,
      memberCount: 3,
    });
    await expect(
      assertTenantMemberHeadroom(client, TENANT, USER),
    ).rejects.toThrow("3/3");
  });

  /* 覆盖列可空正是为了存量零迁移：NULL 必须落到平台默认，不能被当成 0。 */
  it("覆盖值为 NULL → 落到平台默认，不当成 0", async () => {
    const { client } = stubClient({
      settings: DEFAULTS,
      memberLimit: null,
      memberCount: 10,
    });
    await expect(
      assertTenantMemberHeadroom(client, TENANT, USER),
    ).resolves.toBeUndefined();
  });

  /*
   * 判据读不到就抛，不兜一个硬编码数——兜底会让「设置丢了」这件事悄无声息，
   * 而那正是闸失效的形态（本仓的「检查瞎了会报成功」）。
   */
  it("平台默认缺失 → 抛，而不是放行", async () => {
    const { client } = stubClient({ settings: {}, memberCount: 0 });
    await expect(
      assertTenantMemberHeadroom(client, TENANT, USER),
    ).rejects.toThrow("not configured");
  });

  it("租户不存在 → 放行（交给后续外键去报）", async () => {
    const { client } = stubClient({ tenantExists: false });
    await expect(
      assertTenantMemberHeadroom(client, TENANT, USER),
    ).resolves.toBeUndefined();
  });

  it("锁住租户行之后才数（并发加人要被串起来）", async () => {
    const { client, calls } = stubClient({
      settings: DEFAULTS,
      memberCount: 1,
    });
    await assertTenantMemberHeadroom(client, TENANT, USER);
    expect(calls[0]).toContain("for update");
    expect(calls.some((c) => c.includes("count(*)"))).toBe(true);
  });
});

describe("工作区数闸", () => {
  it("未达上限 → 放行；已达 → 409", async () => {
    const ok = stubClient({ settings: DEFAULTS, workspaceCount: 199 });
    await expect(
      assertTenantWorkspaceHeadroom(ok.client, TENANT),
    ).resolves.toBeUndefined();

    const full = stubClient({ settings: DEFAULTS, workspaceCount: 200 });
    await expect(
      assertTenantWorkspaceHeadroom(full.client, TENANT),
    ).rejects.toThrow("200/200");
  });

  /*
   * 不自己加锁：调用点 createWorkspace 为了防重名已经 `for update` 锁住租户行。
   * 这条钉的是「别重复加锁」，不是「不需要锁」。
   */
  it("不重复加锁（调用点已锁）", async () => {
    const { client, calls } = stubClient({
      settings: DEFAULTS,
      workspaceCount: 1,
    });
    await assertTenantWorkspaceHeadroom(client, TENANT);
    expect(calls[0]).not.toContain("for update");
  });

  it("只数未删除的工作区", async () => {
    const { client, calls } = stubClient({
      settings: DEFAULTS,
      workspaceCount: 1,
    });
    await assertTenantWorkspaceHeadroom(client, TENANT);
    const counting = calls.find((c) => c.includes("count(*)"));
    expect(counting).toContain("deleted_at is null");
  });
});
