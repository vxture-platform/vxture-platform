/**
 * add-cycle.spec.ts — 周期推进（订阅到期日）。
 *
 * ── 为什么这块值得测 ──
 * 到期日算错**不报错**：订阅照常建、账单照常出，只是关断时间提前或推后了。
 * 提前 = 客户付了钱却被断权益；推后 = 白送一段。两种都不会在任何门禁里现形，
 * 只会以「我的订阅怎么没了」或对账差额的形式出现。
 *
 * 这个函数此前**一行都没被测到**（2026-09-08 覆盖率清点：order.service 的
 * `day` / `year` 两个分支是 0 覆盖）。
 *
 * ── 钉住的三类边界 ──
 *  1. 四种周期单位各自推进正确（day / week / month / year）
 *  2. 月末与闰日：JS 的 setUTCMonth 会把 1/31 + 1 个月压成 3/2 或 3/3——
 *     这是平台的既有行为，钉住它是为了「改动时必须是有人看着改的」
 *  3. 未知单位不推进（宁可到期日不动被发现，也不要悄悄按某个默认单位算）
 */
import { describe, expect, it } from "vitest";
import { addCycle } from "./order.service";

const at = (iso: string) => new Date(iso);
const iso = (d: Date) => d.toISOString();

describe("addCycle — 四种周期单位", () => {
  const base = at("2026-01-15T08:30:00.000Z");

  it("day：按天推进", () => {
    expect(iso(addCycle(base, "day", 1))).toBe("2026-01-16T08:30:00.000Z");
    expect(iso(addCycle(base, "day", 30))).toBe("2026-02-14T08:30:00.000Z");
  });

  it("week：一周按 7 天算", () => {
    expect(iso(addCycle(base, "week", 1))).toBe("2026-01-22T08:30:00.000Z");
    expect(iso(addCycle(base, "week", 4))).toBe("2026-02-12T08:30:00.000Z");
  });

  it("month：按自然月推进（不是 30 天）", () => {
    // 按 30 天算会让 1/15 的年付在 2 月就错开一天，逐月累积成对账差额。
    expect(iso(addCycle(base, "month", 1))).toBe("2026-02-15T08:30:00.000Z");
    expect(iso(addCycle(base, "month", 12))).toBe("2027-01-15T08:30:00.000Z");
  });

  it("year：按自然年推进", () => {
    expect(iso(addCycle(base, "year", 1))).toBe("2027-01-15T08:30:00.000Z");
  });

  it("时刻部分原样保留——只推日期，不把时间抹成零点", () => {
    // 抹成零点会让当天早上到期的订阅提前几小时关断。
    for (const unit of ["day", "week", "month", "year"]) {
      expect(iso(addCycle(base, unit, 1))).toContain("T08:30:00.000Z");
    }
  });
});

describe("addCycle — 月末与闰日", () => {
  it("1/31 + 1 月 → 3/3（平年）：JS 的月份进位会溢出到下个月", () => {
    // 这是平台的既有行为，不是缺陷判定。钉住它是为了：哪天有人改成「压到月末」
    // （很多计费系统这么做），必须是**有人看着改的**，而不是顺手改完没人发现。
    expect(iso(addCycle(at("2026-01-31T00:00:00.000Z"), "month", 1))).toBe(
      "2026-03-03T00:00:00.000Z",
    );
  });

  it("2028 是闰年：1/31 + 1 月 → 3/2", () => {
    expect(iso(addCycle(at("2028-01-31T00:00:00.000Z"), "month", 1))).toBe(
      "2028-03-02T00:00:00.000Z",
    );
  });

  it("闰日 2/29 + 1 年 → 3/1（平年没有 2/29）", () => {
    expect(iso(addCycle(at("2028-02-29T00:00:00.000Z"), "year", 1))).toBe(
      "2029-03-01T00:00:00.000Z",
    );
  });

  it("跨年推进正确（12 月 + 1 月）", () => {
    expect(iso(addCycle(at("2026-12-15T00:00:00.000Z"), "month", 1))).toBe(
      "2027-01-15T00:00:00.000Z",
    );
  });
});

describe("addCycle — 边界与异常入参", () => {
  const base = at("2026-06-10T12:00:00.000Z");

  it("未知单位不推进（原样返回，不悄悄按默认单位算）", () => {
    expect(iso(addCycle(base, "fortnight", 1))).toBe(iso(base));
    expect(iso(addCycle(base, "", 3))).toBe(iso(base));
  });

  it("count 为 0 不推进", () => {
    expect(iso(addCycle(base, "month", 0))).toBe(iso(base));
  });

  it("负 count 往回推（升级折抵一类的反向计算要用）", () => {
    expect(iso(addCycle(base, "month", -1))).toBe("2026-05-10T12:00:00.000Z");
  });

  it("不改动传进来的 Date（纯函数，调用方的起算日不能被改写）", () => {
    // 若原地改 base，调用方后面再用它算别的就全错了，且极难查。
    const before = iso(base);
    addCycle(base, "year", 5);
    expect(iso(base)).toBe(before);
  });

  it("全程 UTC——在有夏令时的时区下也不偏移", () => {
    /* 这条断言**必须自己把时区固定住**。
       2026-09-08 变异测试连撞两次：先取 3/29（欧洲切换日）、再取 3/8（美东切换日），
       两次都抓不到 `setDate` 替换 `setUTCDate` 的变异——因为跑测机器实际是
       Asia/Shanghai，**没有夏令时、固定 +8**，本地与 UTC 的日期推进永远一致。
       换句话说：判据的成立与否取决于谁在哪台机器上跑，那就不是判据。
       这里显式切到 America/New_York 跑一遍，再还原。 */
    const saved = process.env.TZ;
    try {
      process.env.TZ = "America/New_York";
      const d = addCycle(at("2026-03-07T23:30:00.000Z"), "day", 1);
      expect(iso(d)).toBe("2026-03-08T23:30:00.000Z");
    } finally {
      if (saved === undefined) delete process.env.TZ;
      else process.env.TZ = saved;
    }
  });
});
