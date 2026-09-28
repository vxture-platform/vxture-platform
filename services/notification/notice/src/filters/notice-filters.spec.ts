/**
 * notice-filters.spec.ts —— **两个平面的约定本身**，钉在这里一处。
 *
 * ── 这一份钉的不是「解析对不对」，是「两边同不同」 ──
 * 四个参数名在 admin-bff 与 opera-bff 上逐字相同，值的词汇却分岔过三处：`unread=1`
 * 一边开一边静默忽略、`severity=all` / `source=all` 一边不筛一边 400、关键词上限一边
 * 128 一边 200。三处分岔都不会在类型上报错，也不会让任何一条旧测试红——两侧各自的
 * 测试都在断言自己那一半，而**各自都通过**。
 *
 * 所以约定要有它自己的测试：下面这些用例喂的就是当初分岔的那些输入，断言的是**约定
 * 的那一个结果**。两个路由的 spec 各自引着这一份（见
 * `bff/admin-bff/src/routers/dashboard-notices.router.spec.ts` 与
 * `bff/opera-bff/src/routers/operator-notices.spec.ts` 的文件头），它们那边只管自己的
 * HTTP 翻译（400 的封套、点名哪一格），不再各自复述一遍词汇。
 *
 * 下一次分岔因此会**红在这里**，而不是等到有人同时打开两个文件去比。
 */
import { describe, expect, it } from "vitest";
import {
  NOTICE_KEYWORD_MAX,
  NoticeFilterError,
  likePattern,
  parseNoticeFilters,
  parseNoticeFlag,
  parseNoticeKeyword,
  parseNoticeSeverities,
  parseNoticeSource,
} from "./notice-filters";

/** 抛出来的那一格；没抛就回 null。 */
const fieldOf = (run: () => unknown): string | null => {
  try {
    run();
    return null;
  } catch (error) {
    if (error instanceof NoticeFilterError) return error.field;
    return `不是 NoticeFilterError: ${String(error)}`;
  }
};

describe("曾经分岔的三处 —— 现在两个平面同一个答案", () => {
  /* opera 认 "1"，admin 只认 "true" 于是静默忽略。静默忽略的症状是「筛了但没筛」，
     它和「筛出来很多条」在屏幕上长得一样。取并集：两个都开。 */
  it("unread=1 与 unread=true 都开这一档", () => {
    expect(parseNoticeFlag("true")).toBe(true);
    expect(parseNoticeFlag("1")).toBe(true);
    expect(parseNoticeFilters({ unread: "1" })).toEqual({ unreadOnly: true });
    expect(parseNoticeFilters({ unread: "true" })).toEqual({
      unreadOnly: true,
    });
  });

  /* 开关只有两态：别的值一律当没开，**不抛**——一个筛选开关拼错不该让整页读不出来。 */
  it("开关的其余值当没开，且不抛", () => {
    expect(parseNoticeFlag("false")).toBe(false);
    expect(parseNoticeFlag("yes")).toBe(false);
    expect(parseNoticeFlag("0")).toBe(false);
    expect(parseNoticeFlag(undefined)).toBe(false);
    expect(parseNoticeFilters({ unread: "yes" })).toEqual({});
  });

  /* 下拉框的「全部」送的就是 all。admin 曾为它回 400，而那一格在界面上是默认值。 */
  it("severity=all / source=all / 空串都是「不筛」，不是 400", () => {
    expect(parseNoticeSeverities("all")).toEqual([]);
    expect(parseNoticeSeverities("")).toEqual([]);
    expect(parseNoticeSeverities(undefined)).toEqual([]);
    expect(parseNoticeSource("all")).toBeNull();
    expect(parseNoticeSource("")).toBeNull();
    expect(parseNoticeSource(undefined)).toBeNull();
    expect(parseNoticeFilters({ severity: "all", source: "all" })).toEqual({});
  });

  /* 两个上限取大的那个：收窄会让 admin 上原本成功的一次 150 字搜索开始回 400。 */
  it("关键词上限两侧同为 200 字", () => {
    expect(NOTICE_KEYWORD_MAX).toBe(200);
    expect(parseNoticeKeyword("x".repeat(200))).toHaveLength(200);
    expect(fieldOf(() => parseNoticeKeyword("x".repeat(201)))).toBe("keyword");
    // 129 字曾经只在 opera 上是错的。
    expect(parseNoticeKeyword("x".repeat(129))).toHaveLength(129);
  });
});

describe("认不出的值：400 + 点名那一格（两侧都要大声失败）", () => {
  it("写错的 severity 抛，并点名 severity", () => {
    expect(fieldOf(() => parseNoticeSeverities("urgent"))).toBe("severity");
    expect(fieldOf(() => parseNoticeSeverities(["info", "urgent"]))).toBe(
      "severity",
    );
  });

  it("写错的 source 抛，并点名 source", () => {
    expect(fieldOf(() => parseNoticeSource("robot"))).toBe("source");
  });

  it("码只有两个，两侧封套各取所需", () => {
    try {
      parseNoticeSeverities("urgent");
      expect.unreachable("认不出的 severity 必须抛");
    } catch (error) {
      expect(error).toBeInstanceOf(NoticeFilterError);
      expect((error as NoticeFilterError).code).toBe(
        "VALIDATION_INVALID_VALUE",
      );
    }
    try {
      parseNoticeKeyword("x".repeat(NOTICE_KEYWORD_MAX + 1));
      expect.unreachable("超长的 keyword 必须抛");
    } catch (error) {
      expect((error as NoticeFilterError).code).toBe("VALIDATION_TOO_LONG");
    }
  });
});

describe("两种写法一个口径", () => {
  it("逗号分隔与重复参数等价", () => {
    expect(parseNoticeSeverities("warning,critical")).toEqual([
      "warning",
      "critical",
    ]);
    expect(parseNoticeSeverities(["warning", "critical"])).toEqual([
      "warning",
      "critical",
    ]);
    expect(parseNoticeSeverities(" warning , critical ")).toEqual([
      "warning",
      "critical",
    ]);
  });

  it("重复的只算一次", () => {
    expect(parseNoticeSeverities("warning,warning")).toEqual(["warning"]);
  });

  /* 三档全勾与一档不勾在库里必须落成同一种表示：counts 算在「除严重度以外都筛过」
     的集合上，两种表示各走一条路的话，同一屏会算出两排不同的数字。 */
  it("三档全给收敛成「不筛」", () => {
    expect(parseNoticeSeverities("info,warning,critical")).toEqual([]);
    expect(parseNoticeSeverities(["info", "warning", "critical"])).toEqual([]);
  });

  it("两侧空白剪掉；只有空白 = 不筛，不抛", () => {
    expect(parseNoticeKeyword("  网关  ")).toBe("网关");
    expect(parseNoticeKeyword("   ")).toBe("");
    expect(parseNoticeKeyword("")).toBe("");
    expect(parseNoticeKeyword(undefined)).toBe("");
    expect(parseNoticeSource("  manual  ")).toBe("manual");
  });
});

describe("parseNoticeFilters —— 不给的那一项连键都不出现", () => {
  it("一项都不给：空对象", () => {
    expect(parseNoticeFilters({})).toEqual({});
    expect(Object.keys(parseNoticeFilters({}))).toEqual([]);
  });

  it("只有逗号 / 只有空白 / unread=false 一律读作「没筛」", () => {
    expect(
      parseNoticeFilters({
        severity: " , ",
        source: " ",
        unread: "false",
        q: "  ",
      }),
    ).toEqual({});
  });

  it("四项各出现一次，互不牵连", () => {
    expect(
      parseNoticeFilters({
        severity: "critical",
        source: "manual",
        unread: "true",
        q: " ORD-1 ",
      }),
    ).toEqual({
      severities: ["critical"],
      source: "manual",
      unreadOnly: true,
      keyword: "ORD-1",
    });
  });
});

describe("likePattern —— 只有这一份", () => {
  /* 绑定参数挡得住注入，挡不住语义：搜「100%」时 % 是要找的那个字符。 */
  it("通配符与反斜杠都转义", () => {
    expect(likePattern("100%")).toBe("%100\\%%");
    expect(likePattern("a_b")).toBe("%a\\_b%");
    expect(likePattern("c\\d")).toBe("%c\\\\d%");
  });
});
