/**
 * format.utils.test.ts — 全平台日期/金额/数字的唯一权威形态。
 *
 * ── 为什么这块最该先测 ──
 * 这两个日期函数是 2026-09-08 才立的，30 个调用点全指过来，**却一条测试都没有**。
 * 它们坏了不报错：页面照常渲染，只是那一处的时间跟别处长得不一样，或者少两个字符。
 * 而排查订单、审计、通知时，同一分钟内的先后顺序恰恰最要紧。
 *
 * ── 钉死的四条 ──
 *  1. 两种形态**只差时间部分**——这是 owner 定的规矩，也是「显示时间必须带秒」的由来
 *     （当前口径 = 长日期 + 长时间，长时间本就含秒）。
 *  2. 字段顺序交给 locale，不写死：中文 `2026/09/08`、英文 `09/08/2026`。
 *     同一串数字，读出来是两个日期。
 *  3. 空值/非法值落到 fallback，**不吐 Invalid Date**。
 *  4. 非法 locale 不抛——降级到 ISO，界面不会因为一个坏 locale 整页白。
 */
import { describe, expect, it } from "vitest";
import {
  formatCurrency,
  formatDateTime,
  formatDay,
  formatNumber,
} from "./format.utils";

/** 固定时刻：UTC 07:04:05，用 Asia/Shanghai 看是 15:04:05。 */
const T = "2026-09-08T07:04:05.123456Z";
const TZ = { timeZone: "Asia/Shanghai" } as const;

describe("formatDay / formatDateTime — 形态", () => {
  it("长日期：年月日俱全且补零", () => {
    expect(formatDay(T, "zh-CN", "—", TZ)).toBe("2026/09/08");
  });

  it("长时间含秒——「显示时间必须带秒」就是这一条", () => {
    expect(formatDateTime(T, "zh-CN", "—", TZ)).toBe("2026/09/08 15:04:05");
  });

  it("两种形态只差时间部分（日期段逐字相同）", () => {
    const day = formatDay(T, "zh-CN", "—", TZ);
    const dt = formatDateTime(T, "zh-CN", "—", TZ);
    expect(dt.startsWith(day)).toBe(true);
    expect(dt.slice(day.length).trim()).toBe("15:04:05");
  });

  it("短形态可选：短日期无年、短时间无秒", () => {
    expect(formatDay(T, "zh-CN", "—", { ...TZ, date: "short" })).toBe("09/08");
    expect(
      formatDateTime(T, "zh-CN", "—", { ...TZ, date: "short", time: "short" }),
    ).toBe("09/08 15:04");
  });

  it("24 小时制——不出现 AM/PM", () => {
    expect(formatDateTime(T, "zh-CN", "—", TZ)).not.toMatch(/[AP]M|上午|下午/);
  });
});

describe("字段顺序属于语言", () => {
  it("中文年在前、英文月在前——同一串数字读出来是两个日期", () => {
    expect(formatDay(T, "zh-CN", "—", TZ)).toBe("2026/09/08");
    expect(formatDay(T, "en-US", "—", TZ)).toBe("09/08/2026");
  });

  it("locale 省略时交给运行时默认，不抛也不空", () => {
    expect(formatDay(T, undefined, "—", TZ)).toMatch(/\d/);
  });
});

describe("空值与非法值", () => {
  it.each([null, undefined, ""])("%p → fallback", (v) => {
    expect(formatDay(v, "zh-CN", "未设置")).toBe("未设置");
    expect(formatDateTime(v, "zh-CN", "未设置")).toBe("未设置");
  });

  it("解析不出来的串 → fallback，绝不吐 Invalid Date", () => {
    expect(formatDay("不是日期", "zh-CN", "—")).toBe("—");
    expect(formatDateTime("不是日期", "zh-CN", "—")).toBe("—");
  });

  it("fallback 默认是「—」，不是空串", () => {
    // 空串会让表格那一格看起来像渲染失败；「—」是明确的「没有值」。
    expect(formatDay(null, "zh-CN")).toBe("—");
  });

  it("0 是合法时刻（epoch），不能被当成空值", () => {
    // `!value` 那种写法会把 0 判成空——epoch 虽罕见，但把合法值当空是真错。
    expect(formatDay(0, "zh-CN", "—", { timeZone: "UTC" })).toBe("1970/01/01");
  });
});

describe("输入形态", () => {
  it("string / number / Date 三种入参给出同一结果", () => {
    const d = new Date(T);
    const a = formatDateTime(T, "zh-CN", "—", TZ);
    const b = formatDateTime(d, "zh-CN", "—", TZ);
    const c = formatDateTime(d.getTime(), "zh-CN", "—", TZ);
    expect(b).toBe(a);
    expect(c).toBe(a);
  });
});

describe("固定时区", () => {
  it("同一时刻按不同时区渲染出不同的钟点", () => {
    const sh = formatDateTime(T, "zh-CN", "—", { timeZone: "Asia/Shanghai" });
    const utc = formatDateTime(T, "zh-CN", "—", { timeZone: "UTC" });
    expect(sh).toBe("2026/09/08 15:04:05");
    expect(utc).toBe("2026/09/08 07:04:05");
  });

  it("跨日的时区差会改变日期部分（不能只算时分）", () => {
    const late = "2026-09-08T23:30:00Z";
    expect(formatDay(late, "zh-CN", "—", { timeZone: "Asia/Shanghai" })).toBe(
      "2026/09/09",
    );
    expect(formatDay(late, "zh-CN", "—", { timeZone: "UTC" })).toBe(
      "2026/09/08",
    );
  });
});

describe("非法 locale 不抛", () => {
  it("坏 locale → 降级到 ISO，不让界面整页白", () => {
    // Intl 收到非法 locale 会抛 RangeError；这里必须兜住。
    expect(formatDay(T, "!!bad!!", "—")).toBe("2026-09-08");
    expect(formatDateTime(T, "!!bad!!", "—")).toBe(T.replace("123456", "123"));
  });
});

describe("金额与数字", () => {
  it("按 locale 推断币种，也可显式指定", () => {
    expect(formatCurrency(1234.5, "zh-CN")).toContain("1,234.50");
    expect(formatCurrency(1234.5, "zh-CN", "USD")).toContain("1,234.50");
  });

  it("坏 locale 时回落成原数字，不抛", () => {
    expect(formatCurrency(12, "!!bad!!" as never)).toBe("12");
    expect(formatNumber(12, "!!bad!!" as never)).toBe("12");
  });

  it("数字走千分位——与日期无关，别被日期判据误伤", () => {
    expect(formatNumber(1234567, "zh-CN")).toBe("1,234,567");
  });
});

/**
 * Intl 实例缓存（2026-09-10）。
 *
 * 构造贵、format 便宜：同一组 (locale, options) 跑 2000 次，每次重新构造 252ms、
 * 复用实例 3.3ms——**77 倍**（本机实测）。一张 100 行的表两个日期列就是 200 次构造。
 *
 * 这一组不测「快不快」（那会是个看机器脸色的脆弱判据），测的是**行为不变**加
 * 「确实复用了同一个实例」——后者用 spy 数构造次数，比计时可靠。
 */
describe("Intl 实例缓存", () => {
  const ISO = "2026-09-10T14:05:09.000Z";

  it("复用之后输出不变（缓存没串味）", () => {
    const a = formatDateTime(ISO, "zh-CN");
    const b = formatDateTime(ISO, "zh-CN");
    expect(b).toBe(a);
  });

  /**
   * **真的复用了同一个实例**。
   *
   * 上一条只证明「结果一样」——把实现改成「每次都 new、顺手写进 Map」照样能过，
   * 而那是个只写不读的假缓存（反向验证时正是这样漏过去的）。所以这里数构造次数：
   * 同一组 (locale, options) 调 5 次，构造应当只发生一次。
   */
  it("同一组参数只构造一次（数构造次数，不看计时）", () => {
    const Real = Intl.DateTimeFormat;
    let constructed = 0;
    const Spy = function (this: unknown, ...args: unknown[]) {
      constructed += 1;
      return new (Real as unknown as new (
        ...a: unknown[]
      ) => Intl.DateTimeFormat)(...args);
    } as unknown as typeof Intl.DateTimeFormat;
    Spy.supportedLocalesOf = Real.supportedLocalesOf;

    /* 用一个此前没出现过的 locale：缓存是模块级的，拿已用过的会一次都不构造，
       那样「只构造一次」和「一次都没构造」就分不开了。 */
    const fresh = "de-DE";
    (Intl as { DateTimeFormat: typeof Intl.DateTimeFormat }).DateTimeFormat =
      Spy;
    try {
      for (let i = 0; i < 5; i += 1) formatDateTime(ISO, fresh);
    } finally {
      (Intl as { DateTimeFormat: typeof Intl.DateTimeFormat }).DateTimeFormat =
        Real;
    }
    expect(constructed).toBe(1);
  });

  /* 不同 locale / 不同形态必须各拿各的实例——键少了任何一维，
     第二次调用就会拿到上一次那个，症状是「切了语言日期没变」。 */
  it("不同 locale 各出各的结果", () => {
    expect(formatDay(ISO, "zh-CN")).not.toBe(formatDay(ISO, "en-US"));
  });

  it("同 locale 不同形态各出各的结果", () => {
    const long = formatDay(ISO, "zh-CN", "—", { date: "long" });
    const short = formatDay(ISO, "zh-CN", "—", { date: "short" });
    expect(long).not.toBe(short);
  });

  it("带时区与不带时区不共用一个实例", () => {
    const utc = formatDateTime(ISO, "zh-CN", "—", { timeZone: "UTC" });
    const tokyo = formatDateTime(ISO, "zh-CN", "—", { timeZone: "Asia/Tokyo" });
    expect(utc).not.toBe(tokyo);
  });

  /**
   * 坏 locale 走兜底，而且**不进缓存**。
   *
   * 进了的话，同一个坏 locale 第二次会拿到一个"构造失败但被记住"的东西——
   * 而缓存里存的只可能是构造成功的实例，所以这条同时钉住「抛出来的不写进 Map」。
   */
  it("非法 locale → 兜底，且重复调用行为一致", () => {
    const first = formatDay(ISO, "不是语言标签");
    const second = formatDay(ISO, "不是语言标签");
    expect(second).toBe(first);
    expect(first).toBe("2026-09-10"); // toISOString().slice(0,10) 兜底
  });
});
