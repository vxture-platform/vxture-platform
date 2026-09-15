/**
 * operator-names.spec.ts —— 操作者只显示名字（2026-09-15）。
 *
 * 钉三件事：
 *   1. `opr_<uuid>` 查得到给名字，查不到给「平台无此运营者」——**任何分支都不回 id**。
 *   2. 守卫先挡掉的 `"unknown"` 回 null，由页面显示「未归属」。
 *   3. 自检行的发起人：requestId 精确对上优先；否则时间窗内恰好一条才认，多于一条不猜。
 */

import { describe, expect, it, vi } from "vitest";

import {
  UNKNOWN_OPERATOR,
  lookupOperatorNames,
  operatorDisplayName,
  operatorUuidOf,
} from "./operator-names";
import { matchProbeTrigger, type AtlasChangeRecord } from "../routers/atlas.router";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

describe("operatorDisplayName", () => {
  const names = new Map([[A, "张三"]]);

  it("gives the name for a known operator", () => {
    expect(operatorDisplayName(`opr_${A}`, names)).toBe("张三");
  });

  it("never falls back to the id", () => {
    expect(operatorDisplayName(`opr_${B}`, names)).toBe(UNKNOWN_OPERATOR);
    expect(operatorDisplayName(`svc_${B}`, names)).toBe(UNKNOWN_OPERATOR);
  });

  it("leaves unattributed attempts to the page", () => {
    expect(operatorDisplayName("unknown", names)).toBeNull();
  });

  it("keeps a non-uuid identity as is", () => {
    expect(operatorDisplayName("opera", names)).toBe("opera");
  });

  it("matches the uuid case-insensitively", () => {
    expect(operatorUuidOf(`opr_${A.toUpperCase()}`)).toBe(A);
  });
});

describe("lookupOperatorNames", () => {
  it("queries only operator uuids, once each", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ id: A, name: "张三" }] });
    const names = await lookupOperatorNames({ query } as never, [
      `opr_${A}`,
      `opr_${A}`,
      "unknown",
    ]);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[1]).toEqual([[A]]);
    expect(names.get(A)).toBe("张三");
  });

  it("skips the query when there is nothing to resolve", async () => {
    const query = vi.fn();
    await lookupOperatorNames({ query } as never, ["unknown"]);
    expect(query).not.toHaveBeenCalled();
  });

  it("returns an empty map when the query fails", async () => {
    const query = vi.fn().mockRejectedValue(new Error("down"));
    const names = await lookupOperatorNames({ query } as never, [`opr_${A}`]);
    expect(names.size).toBe(0);
  });
});

function audit(
  over: Partial<AtlasChangeRecord> & Pick<AtlasChangeRecord, "occurredAt">,
): AtlasChangeRecord {
  return {
    eventId: "e",
    objectType: "models",
    objectId: "m",
    action: "probe",
    actorId: `opr_${A}`,
    actorConsole: "opera",
    changedFields: [],
    requestId: null,
    outcome: "success",
    ...over,
  };
}

describe("matchProbeTrigger", () => {
  const names = new Map([
    [A, "张三"],
    [B, "李四"],
  ]);
  const row = { requestId: "probe-1", createdAt: "2026-09-15T03:40:53.064Z" };

  it("prefers the request id", () => {
    const t = matchProbeTrigger(
      row,
      [
        audit({ occurredAt: "2026-09-15T03:40:53.152Z", actorId: `opr_${B}` }),
        audit({
          occurredAt: "2026-09-15T03:49:00.000Z",
          requestId: "probe-1",
        }),
      ],
      names,
    );
    expect(t).toEqual({ operatorName: "张三", match: "request-id" });
  });

  it("falls back to the single record just after the row", () => {
    const t = matchProbeTrigger(
      row,
      [audit({ occurredAt: "2026-09-15T03:40:53.152Z", actorId: `opr_${B}` })],
      names,
    );
    expect(t).toEqual({ operatorName: "李四", match: "time" });
  });

  it("does not guess when two records share the window", () => {
    const t = matchProbeTrigger(
      row,
      [
        audit({ occurredAt: "2026-09-15T03:40:53.100Z" }),
        audit({ occurredAt: "2026-09-15T03:40:53.200Z", actorId: `opr_${B}` }),
      ],
      names,
    );
    expect(t).toEqual({ operatorName: null, match: "none" });
  });

  it("ignores records before the row or outside the window", () => {
    const t = matchProbeTrigger(
      row,
      [
        audit({ occurredAt: "2026-09-15T03:40:52.000Z" }),
        audit({ occurredAt: "2026-09-15T03:41:10.000Z" }),
      ],
      names,
    );
    expect(t).toEqual({ operatorName: null, match: "none" });
  });

  it("does not time-match a record that already carries another request id", () => {
    const t = matchProbeTrigger(
      row,
      [
        audit({
          occurredAt: "2026-09-15T03:40:53.152Z",
          requestId: "probe-other",
        }),
      ],
      names,
    );
    expect(t.match).toBe("none");
  });
});
