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
 *  2. 月末与闰日：**夹取到当月最后一天**（1/31 + 1 月 = 2/28），不溢出。
 *     2026-09-26 改的——原来是 JS `setUTCMonth` 的溢出行为（1/31 → 3/03）。
 *     本组上一版把那个行为钉住了，注释写着「哪天有人改成压到月末，必须是有人看着改的」。
 *     **它起作用了**：这次就是被它拦下来、看过之后才改的。
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

describe("addCycle — 月末与闰日：夹取，不溢出", () => {
  /*
   * owner 2026-09-26 问「按月订阅的锚定是不是 09/25 → 10/25、02/25 → 03/25，兼容了月
   * 天数不一样」。正常日期上一直是对的；月末那几天此前不是：
   *
   *   旧（JS setUTCMonth 溢出）   1/31 → 3/03    3/31 → 5/01    2/29 +1年 → 3/01
   *   新（夹取，与 Postgres 同）   1/31 → 2/28    3/31 → 4/30    2/29 +1年 → 2/28
   *
   * 为什么必须改：Postgres 的 `+ interval '1 month'`（admin 续期 SQL、开票窗口）与配额
   * 锚点推进都夹取。不改的话 1/31 订的月付客户，服务期落 3/03、配额刷新日落 2/28，两根
   * 轴差三天，而且每续一次差得更多。这个分叉一直存在，只是在配额改成锚定推进之前没有
   * 第二个口径能照出它来。
   */
  it("1/31 + 1 月 → 2/28（平年）", () => {
    expect(iso(addCycle(at("2026-01-31T00:00:00.000Z"), "month", 1))).toBe(
      "2026-02-28T00:00:00.000Z",
    );
  });

  it("2028 是闰年：1/31 + 1 月 → 2/29", () => {
    expect(iso(addCycle(at("2028-01-31T00:00:00.000Z"), "month", 1))).toBe(
      "2028-02-29T00:00:00.000Z",
    );
  });

  it("闰日 2/29 + 1 年 → 2/28（平年没有 2/29，夹到月末而不是滚到 3/01）", () => {
    expect(iso(addCycle(at("2028-02-29T00:00:00.000Z"), "year", 1))).toBe(
      "2029-02-28T00:00:00.000Z",
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

/**
 * 月末夹取（2026-09-26，owner 问「按月是不是 09/25 → 10/25，兼容月天数不一样」）。
 *
 * 正常日期上一直是对的；**月末那几天此前是错的**：原实现用 JS `setUTCMonth(+1)`，它
 * **溢出不夹取**——1/31 加一个月被滚到 3/03。而 Postgres 的 `+ interval '1 month'`
 * （admin 续期 SQL、开票窗口用的）与配额锚点推进都夹取到当月最后一天。
 *
 * 后果：1/31 订的月付客户，服务期落 3/03、配额刷新日落 2/28，两根轴差三天，且每续一次
 * 差得更多（服务期一路漂成 3/03 → 4/03，配额稳定在月末）。
 *
 * 这个分叉一直存在，只是在配额改成锚定推进之前**没有第二个口径能照出它来**。
 */
describe("按月/按年：月末夹取，不溢出", () => {
  const at = (s: string) => new Date(`${s}T00:00:00.000Z`);
  const day = (d: Date) => d.toISOString().slice(0, 10);

  it("普通日期照常：09/25 → 10/25、02/25 → 03/25", () => {
    expect(day(addCycle(at("2026-09-25"), "month", 1))).toBe("2026-10-25");
    expect(day(addCycle(at("2026-02-25"), "month", 1))).toBe("2026-03-25");
  });

  it("**1/31 + 1 月 = 2/28**（不是 3/03）", () => {
    expect(day(addCycle(at("2026-01-31"), "month", 1))).toBe("2026-02-28");
  });

  it("**3/31 + 1 月 = 4/30**（不是 5/01）", () => {
    expect(day(addCycle(at("2026-03-31"), "month", 1))).toBe("2026-04-30");
  });

  it("1/29 + 1 月 = 2/28（平年）", () => {
    expect(day(addCycle(at("2026-01-29"), "month", 1))).toBe("2026-02-28");
  });

  it("闰年 1/31 + 1 月 = 2/29", () => {
    expect(day(addCycle(at("2028-01-31"), "month", 1))).toBe("2028-02-29");
  });

  it("**不累积漂移**：1/31 加两个月回到 3/31", () => {
    expect(day(addCycle(at("2026-01-31"), "month", 2))).toBe("2026-03-31");
  });

  it("**2/29 + 1 年 = 2/28**（不是 3/01）", () => {
    expect(day(addCycle(at("2028-02-29"), "year", 1))).toBe("2029-02-28");
  });

  it("与 Postgres `+ interval` 同口径 —— 这几个值就是库里算出来的", () => {
    // 2026-09-26 在本机库实测：1/31→2/28、3/31→4/30、1/29→2/28、2/29(+1年)→2/28。
    const cases: [string, string, number, string][] = [
      ["2026-01-31", "month", 1, "2026-02-28"],
      ["2026-03-31", "month", 1, "2026-04-30"],
      ["2026-01-29", "month", 1, "2026-02-28"],
      ["2028-02-29", "year", 1, "2029-02-28"],
    ];
    for (const [from, unit, n, want] of cases) {
      expect(day(addCycle(at(from), unit, n)), `${from} +${n} ${unit}`).toBe(
        want,
      );
    }
  });
});
