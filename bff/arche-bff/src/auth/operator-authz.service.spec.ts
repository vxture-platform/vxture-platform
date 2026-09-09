/**
 * operator-authz.service.spec.ts — 从活库解析操作者主体与能力码。
 *
 * ── 这一格为什么值得测 ──
 * 这是治理平面上**每个请求**都要过的一次授权解析。它给出的 `capabilities` 决定了
 * 后面所有能力门放不放行，所以它多给一个码等于开了一扇门。
 *
 * ── 这份 spec 能证明什么、不能证明什么 ──
 * 假 pool 只能验**映射**（行 → 主体/能力码），验不了 SQL 的**语义**：把
 * `r.status = 'active'` 删掉，假 pool 照样返回我喂给它的那一行，测试全绿。
 * 所以下面分两段：
 *
 *   · 映射行为 —— 假 pool，真断言。
 *   · SQL 里那三个过滤条件在不在 —— **文本断言**。它只能抓「被删掉」，
 *     抓不到「语义漂了」（比如 join 换了张表）。写清楚它管到哪，
 *     比让人以为它管住了全部要好。
 *
 * SQL 自身跑不跑得通，是**在本机活库上真跑过**验的（见提交信息）：三条过滤引用的
 * 列都存在、不存在的 id 返回 0 行、真实 operator 返回 1 行。被测件的注释里记着
 * 一次教训——「我第一版按 status 写，实测列不存在」——静态读代码看不出这种。
 */

import { describe, expect, it, vi } from "vitest";
import { OperatorAuthzService } from "./operator-authz.service";

type Row = {
  id: string;
  display_name: string | null;
  role_rank: number | null;
  permissions: string[] | null;
};

function svc(rows: Row[]) {
  const query = vi.fn().mockResolvedValue({ rows });
  const service = new OperatorAuthzService({ query } as never);
  return { service, query };
}

const ROW: Row = {
  id: "op-1",
  display_name: "运维甲",
  role_rank: 30,
  permissions: ["governance.risk.read", "governance.risk.manage"],
};

describe("解析结果的映射", () => {
  it("有行 → 主体 + 能力码", async () => {
    const { service } = svc([ROW]);
    await expect(service.resolve("op-1")).resolves.toEqual({
      operator: { id: "op-1", displayName: "运维甲", roleRank: 30 },
      capabilities: ["governance.risk.read", "governance.risk.manage"],
    });
  });

  it("无行 → null（调用方据此转 401）", async () => {
    // 账号不存在 / 已软删 / 已停用 / 角色已停用，SQL 都返回 0 行——
    // 这里不区分原因是刻意的：给调用方一个「没有主体」，不泄露账号是否存在。
    const { service } = svc([]);
    await expect(service.resolve("op-1")).resolves.toBeNull();
  });

  it("有角色但零权限 → 空数组，不是 null", async () => {
    // 「有主体、没有任何能力」和「没有主体」是两件事：前者能登录、什么也做不了，
    // 后者直接 401。能力码退化成 null 会让下游的 includes 抛 TypeError。
    const { service } = svc([{ ...ROW, permissions: [] }]);
    const got = await service.resolve("op-1");
    expect(got?.capabilities).toEqual([]);
  });

  it("permissions 为 null 也落成空数组", async () => {
    const { service } = svc([{ ...ROW, permissions: null }]);
    const got = await service.resolve("op-1");
    expect(got?.capabilities).toEqual([]);
  });

  it("display_name / role_rank 可空，原样透传不编造默认值", async () => {
    const { service } = svc([{ ...ROW, display_name: null, role_rank: null }]);
    const got = await service.resolve("op-1");
    expect(got?.operator).toEqual({
      id: "op-1",
      displayName: null,
      roleRank: null,
    });
  });

  it("只取第一行 —— SQL 有 limit 1，多行是异常，不该合并", async () => {
    const { service } = svc([ROW, { ...ROW, id: "op-2" }]);
    const got = await service.resolve("op-1");
    expect(got?.operator.id).toBe("op-1");
  });

  it("operatorId 走参数化占位符，不拼进 SQL", async () => {
    // 拼字符串就是注入。这条断言看的是「id 出现在参数数组里」，
    // 而不是「SQL 文本里没有这个 id」——后者对 UUID 形状的 id 恒真，不区分。
    const { service, query } = svc([ROW]);
    await service.resolve("op-1");
    const call = query.mock.calls[0];
    expect(call).toBeDefined();
    const [sql, params] = call as [string, unknown[]];
    expect(params).toEqual(["op-1"]);
    expect(sql).not.toContain("op-1");
  });
});

describe("SQL 里的三个过滤条件（文本断言，只抓被删掉）", () => {
  /** 取被测件真正发出的那条 SQL，不另抄一份——抄一份就成了同义反复。 */
  async function sqlOf(): Promise<string> {
    const { service, query } = svc([ROW]);
    await service.resolve("op-1");
    return String(query.mock.calls[0]?.[0]);
  }

  it("软删与停用的账号不给主体", async () => {
    const sql = await sqlOf();
    expect(sql).toContain("a.deleted_at is null");
    expect(sql).toContain("a.status = 'active'");
  });

  it("角色停用即失去全部能力", async () => {
    // 少了这条，一个被停用的角色仍然带着它原有的能力码。
    expect(await sqlOf()).toContain("r.status = 'active'");
  });

  it("停用的能力码不计入 —— 这一列是布尔 is_active 不是 status", async () => {
    // operator_role 用 status、operator_permission 用 is_active，两张表不同构。
    // 被测件注释记着第一版按 status 写、实测列不存在。
    const sql = await sqlOf();
    expect(sql).toContain("p.is_active = true");
    expect(sql).not.toContain("p.status");
  });

  it("零权限落成空数组而不是 [null]", async () => {
    // left join 没配上时 array_agg 会产出 [null]；array_remove 把它抹平。
    expect(await sqlOf()).toContain("array_remove");
  });
});
