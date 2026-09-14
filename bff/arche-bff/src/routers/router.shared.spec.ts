/**
 * router.shared.spec.ts —— 列表排序白名单。
 *
 * 排序参与取数（表截在 LIST_LIMIT 条，前端在截断段里排是说假话），所以列 id 会进
 * SQL。这组测试钉住两件事：请求里的字符串永远不进 SQL 文本；方向只认 asc / desc。
 */
import { describe, expect, it } from "vitest";
import { ApiError } from "../errors/api-error";
import { listOrderBy } from "./router.shared";

const COLUMNS = { name: "t.name", time: "t.created_at" } as const;

describe("listOrderBy", () => {
  it("不传 sort 就是默认序", () => {
    expect(
      listOrderBy(undefined, undefined, COLUMNS, "t.created_at desc, t.id"),
    ).toBe("order by t.created_at desc, t.id");
    expect(listOrderBy("", "asc", COLUMNS, "t.id")).toBe("order by t.id");
  });

  it("白名单列 → 写死的表达式；空值沉底；同值按 tiebreak 定序", () => {
    expect(listOrderBy("name", "asc", COLUMNS, "t.id")).toBe(
      "order by t.name asc nulls last, t.id",
    );
    expect(listOrderBy("time", "desc", COLUMNS, "t.id")).toBe(
      "order by t.created_at desc nulls last, t.id",
    );
  });

  it("不给方向按 desc", () => {
    expect(listOrderBy("name", undefined, COLUMNS, "t.id")).toBe(
      "order by t.name desc nulls last, t.id",
    );
  });

  it("白名单外的列 → 400，字符串不进 SQL", () => {
    expect(() =>
      listOrderBy("name; drop table x", "asc", COLUMNS, "t.id"),
    ).toThrow(ApiError);
    expect(() => listOrderBy("password", "asc", COLUMNS, "t.id")).toThrow(
      ApiError,
    );
  });

  it("方向只认 asc / desc", () => {
    expect(() => listOrderBy("name", "sideways", COLUMNS, "t.id")).toThrow(
      ApiError,
    );
  });
});
