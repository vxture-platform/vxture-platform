import { describe, expect, it } from "vitest";
import { createFormatter } from "next-intl";
import { DATETIME_FORMATS } from "./formats";

/**
 * 日期时间形态的**输出**验收。
 *
 * ── 为什么必须钉输出串,而不是钉配置对象 ──
 * `useFormatter().dateTime(d, "long")` 里的 `"long"` 是个**字符串**。名字配不上时
 * next-intl 不抛,只在控制台记一句、然后退回默认形态照样渲染——tsc 绿、eslint 绿、
 * 构建绿,页面上是另一个格式。所以这一组不看「配置里有没有这一项」,
 * 看的是「拿这个名字格式化出来的串长什么样」。
 *
 * 这里用的 `createFormatter` 与 `useFormatter()` 是同一个实现,后者只是从 React
 * context 里取 locale 和 formats 再调它。走这条能在 node 环境下跑,不必装 jsdom。
 *
 * ── 形态照 owner 2026-09-08 的规范 ──
 *     长日期 `2026/09/08`   短日期 `09/08`
 *     长时间 `15:04:05`     短时间 `15:04`
 * 平台统一「长日期 + 长时间」,且「显示时间就必须带秒」。
 */

/** 固定一个带时区的时刻;下面按 Asia/Shanghai 判读,不受跑测机器时区影响。 */
const AT = new Date("2026-09-10T14:05:09+08:00");

function fmt(locale: string) {
  return createFormatter({
    locale,
    formats: DATETIME_FORMATS,
    timeZone: "Asia/Shanghai",
  });
}

describe("日期时间形态:中文", () => {
  const f = fmt("zh-CN");

  it("long = 长日期 + 长时间,带秒", () => {
    expect(f.dateTime(AT, "long")).toBe("2026/09/10 14:05:09");
  });

  it("day = 长日期", () => {
    expect(f.dateTime(AT, "day")).toBe("2026/09/10");
  });

  it("time = 长时间,**带秒**", () => {
    expect(f.dateTime(AT, "time")).toBe("14:05:09");
  });

  it("dayShort = 短日期", () => {
    expect(f.dateTime(AT, "dayShort")).toBe("09/10");
  });
});

describe("日期时间形态:英文", () => {
  const f = fmt("en-US");

  /**
   * 字段顺序属于语言,不写死——这一条正是「不能自己拼」的理由。
   * 中文 `2026/09/10`、英文 `09/10/2026`:同一串数字,读出来是两个日期。
   */
  it("英文下年份不在最前", () => {
    expect(f.dateTime(AT, "day")).toBe("09/10/2026");
  });

  it("英文下 long 同样带秒", () => {
    expect(f.dateTime(AT, "long")).toMatch(/:09$/);
  });

  /**
   * 这一条钉的是 `fmtDateShort` 存在的理由。
   *
   * 此前统计卡拿 `fmtDate(x).slice(5)` 砍年份——那是在**格式化之后的串**上做字符串
   * 手术,只在「年份排最前、恰好 4 位 + 1 个分隔符」时凑巧对。英文下
   * `"09/10/2026".slice(5)` 切出的是 `/2026`——一个带着斜杠的**年份**,
   * 被摆在「最近到期」那一格上。
   */
  it("英文下 slice(5) 那套会切出年份,dayShort 不会", () => {
    expect(f.dateTime(AT, "day").slice(5)).toBe("/2026"); // 旧写法的实际产物
    expect(f.dateTime(AT, "dayShort")).toBe("09/10");
  });
});

describe("形态名配错时会被这组测出来", () => {
  /**
   * 反向验证:名字配不上时 next-intl 不抛,退回去照样给一个串——
   * 但那个串**不等于**规范形态。上面每一条比的都是精确串,所以配错必红。
   */
  it("不存在的形态名 → 输出与 long 不同", () => {
    const f = fmt("zh-CN");
    const bogus = f.dateTime(AT, "notAFormat" as never);
    expect(bogus).not.toBe(f.dateTime(AT, "long"));
  });
});
