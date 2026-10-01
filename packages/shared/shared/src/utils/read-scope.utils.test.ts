import { describe, expect, it } from "vitest";
import { describeScope, scopeCondition } from "./read-scope.utils";
import type { ReadScope } from "../types/read-scope.types";

describe("scopeCondition", () => {
  it("tenant 档：带别名", () => {
    const r = scopeCondition("i", { kind: "tenant", tenantId: "T1" }, 1);
    expect(r.condition).toBe("i.tenant_id = $1");
    expect(r.values).toEqual(["T1"]);
    expect(r.nextParamIndex).toBe(2);
  });

  it("tenant 档：无别名", () => {
    const r = scopeCondition(null, { kind: "tenant", tenantId: "T1" }, 3);
    expect(r.condition).toBe("tenant_id = $3");
    expect(r.nextParamIndex).toBe(4);
  });

  it("workspace 档用的是 workspace_id，不是 tenant_id", () => {
    // 这一条锁住「两档不要互相抄错列名」——抄错了 SQL 照样合法，只是过滤错了对象。
    const r = scopeCondition("q", { kind: "workspace", workspaceId: "W1" }, 1);
    expect(r.condition).toBe("q.workspace_id = $1");
    expect(r.values).toEqual(["W1"]);
  });

  it("platform 档不加谓词，也不占参数位", () => {
    const r = scopeCondition("i", { kind: "platform", why: "运营面跨租户" }, 5);
    expect(r.condition).toBeNull();
    expect(r.values).toEqual([]);
    expect(r.nextParamIndex).toBe(5);
  });

  it("platform 档的 why 为空白 → 抛，不是静默放行", () => {
    for (const why of ["", "   ", "\n"]) {
      expect(() =>
        scopeCondition("i", { kind: "platform", why }, 1),
      ).toThrowError(/why/);
    }
  });

  it("序号连续：两段谓词接着拼不会撞 $n", () => {
    const a = scopeCondition("i", { kind: "tenant", tenantId: "T1" }, 1);
    const b = scopeCondition(
      "j",
      { kind: "workspace", workspaceId: "W1" },
      a.nextParamIndex,
    );
    expect([a.condition, b.condition]).toEqual([
      "i.tenant_id = $1",
      "j.workspace_id = $2",
    ]);
  });
});

describe("describeScope", () => {
  it("不把归属 id 写进描述（日志不该带它）", () => {
    const s: ReadScope = { kind: "tenant", tenantId: "SECRET-TENANT" };
    expect(describeScope(s)).toBe("tenant(redacted)");
    expect(describeScope(s)).not.toContain("SECRET");
  });

  it("platform 档把理由带出来——日志里要看得见为什么跨了租户", () => {
    expect(describeScope({ kind: "platform", why: "巡检作业" })).toBe(
      "platform(巡检作业)",
    );
  });
});
