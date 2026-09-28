/**
 * operator-notices.spec.ts —— 发布面四项筛选的规整与两条语句的形状（第四批）。
 *
 * 为什么钉这些：筛选这种东西**错了不报错**，只是少看几行或多看几行，而「多看了几行」
 * 在屏幕上和「筛选生效了」长得一模一样。所以这里逐条钉住：
 *   · 不给的那一项落成 null / false / 空数组，绑定值的**位次**不许动；
 *   · 关键词里的 % 与 _ 是运营者要找的字符，不是通配符；
 *   · 三档计数算在 narrowed 上（严重度晚一步生效），否则勾了一档另两档恒为 0；
 *   · 汇总那条比页行**正好少绑一个值**——加一项筛选只改一处的话，pg 直接拒。
 *
 * ── 值的词汇不在这里钉 ──
 * 四个参数（`severity` / `source` / `unread` / `q`）**认哪些值**由
 * `@vxture/service-notice` 的 `filters/notice-filters.ts` 一处定，两个平面共用；那份
 * 约定自己的测试在 `services/notification/notice/src/filters/notice-filters.spec.ts`
 * （admin-bff 的 spec 也引着它）。下面这几组仍然跑一遍，但钉的是**本 BFF 这一侧**：
 * 解析器真的接上了，且抛出来的 `NoticeFilterError` 被翻成了带 `field` 的 400 封套——
 * 控制台靠那个 `field` 高亮出错的那一格。
 */
import { HttpException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { NOTICE_KEYWORD_MAX, likePattern } from "@vxture/service-notice";
import {
  LIST_SQL,
  LIST_SUMMARY_SQL,
  normalizeListFilters,
  noticeListValues,
  type NoticeListFilters,
} from "./operator-notices.router";

const OPERATOR = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

/** 抛出来的封套里那个 `field` —— 控制台靠它高亮出错的那一格。 */
const fieldOf = (run: () => unknown): string | null => {
  try {
    run();
    return null;
  } catch (error) {
    if (!(error instanceof HttpException)) return String(error);
    const body = error.getResponse() as { field?: string };
    return body.field ?? "(no field)";
  }
};

/** 只看规整后的严重度那一项。 */
const severitiesOf = (raw: string | string[] | undefined) =>
  normalizeListFilters({ severity: raw }).severities;

describe("severity —— 两种写法一个口径（词汇在服务包，这里钉接线）", () => {
  it("逗号分隔与重复参数等价", () => {
    expect(severitiesOf("warning,critical")).toEqual(["warning", "critical"]);
    expect(severitiesOf(["warning", "critical"])).toEqual([
      "warning",
      "critical",
    ]);
  });

  it("没给 / 空串 / all 都是「不筛」", () => {
    expect(severitiesOf(undefined)).toEqual([]);
    expect(severitiesOf("")).toEqual([]);
    expect(severitiesOf("all")).toEqual([]);
  });

  /* 三档全勾与一档不勾在库里必须落成同一种表示：counts 算在 narrowed 上，
     两种表示各走一条路的话，同一屏会算出两排不同的数字。 */
  it("三档全给收敛成「不筛」", () => {
    expect(severitiesOf("info,warning,critical")).toEqual([]);
  });

  it("重复的只算一次", () => {
    expect(severitiesOf("warning,warning")).toEqual(["warning"]);
  });

  /* 静默忽略会让人看着一页没筛过的数据以为筛过了——那比 400 难查得多。
     这一条同时钉住翻译：包里抛的是 NoticeFilterError，封套里必须留下 field。 */
  it("不认识的值抛，并点名 severity", () => {
    expect(fieldOf(() => severitiesOf("urgent"))).toBe("severity");
  });
});

describe("source", () => {
  const sourceOf = (raw: string | undefined) =>
    normalizeListFilters({ source: raw }).source;

  it("没给 / 空串 / all 都是「不筛」", () => {
    expect(sourceOf(undefined)).toBeNull();
    expect(sourceOf("")).toBeNull();
    expect(sourceOf("all")).toBeNull();
  });

  it("两个合法值原样回", () => {
    expect(sourceOf("manual")).toBe("manual");
    expect(sourceOf("system")).toBe("system");
  });

  it("别的词抛，并点名 source", () => {
    expect(fieldOf(() => sourceOf("robot"))).toBe("source");
  });
});

describe("开关类参数", () => {
  it("true 与 1 都认，其余当没开", () => {
    expect(normalizeListFilters({ unread: "true" }).unreadOnly).toBe(true);
    expect(normalizeListFilters({ unread: "1" }).unreadOnly).toBe(true);
    expect(normalizeListFilters({ unread: "yes" }).unreadOnly).toBe(false);
    expect(normalizeListFilters({}).unreadOnly).toBe(false);
  });

  it("includeExpired 同一套判法", () => {
    expect(
      normalizeListFilters({ includeExpired: "true" }).includeExpired,
    ).toBe(true);
    expect(normalizeListFilters({ includeExpired: "1" }).includeExpired).toBe(
      true,
    );
    expect(normalizeListFilters({}).includeExpired).toBe(false);
  });
});

describe("keyword", () => {
  /* 「只有空白」曾经抛 VALIDATION_REQUIRED（optionalText 是给必填字段用的帮手）：
     在搜索框里按一下空格，整页变「读取失败」。筛选框里的空白是「没筛」。 */
  it("两侧空白剪掉；只有空白 = 不筛，不抛", () => {
    expect(normalizeListFilters({ keyword: "  网关  " }).keyword).toBe("网关");
    expect(normalizeListFilters({ keyword: "   " }).keyword).toBe("");
    expect(normalizeListFilters({ keyword: "" }).keyword).toBe("");
  });

  /* 上限**与 admin 同为 200**（此前这一侧是 128，同一个 150 字的搜索在两个平面上
     一个 200 一个 400）。数字取自服务包的 NOTICE_KEYWORD_MAX，不在这里再写一遍。 */
  it("过长才抛，并点名 keyword；上限与 admin 同一个数", () => {
    expect(NOTICE_KEYWORD_MAX).toBe(200);
    expect(
      fieldOf(() =>
        normalizeListFilters({ q: "x".repeat(NOTICE_KEYWORD_MAX + 1) }),
      ),
    ).toBe("keyword");
    expect(
      normalizeListFilters({ q: "x".repeat(NOTICE_KEYWORD_MAX) }).keyword,
    ).toHaveLength(NOTICE_KEYWORD_MAX);
    // 129 字曾经只在这一侧是错的。
    expect(normalizeListFilters({ q: "x".repeat(129) }).keyword).toHaveLength(
      129,
    );
  });

  /* 线上名是 q（与 admin 逐字相同），读模型那侧的字段名是 keyword。两个都认，
     否则其中一半会静默失效，而「搜了但没筛」与「搜到了很多条」长得一样。 */
  it("q 与 keyword 都认，q 优先", () => {
    expect(normalizeListFilters({ q: "退款" }).keyword).toBe("退款");
    expect(normalizeListFilters({ keyword: "退款" }).keyword).toBe("退款");
    expect(normalizeListFilters({ q: "甲", keyword: "乙" }).keyword).toBe("甲");
  });

  /* 绑定参数挡得住注入，挡不住语义：搜「100%」时 % 是要找的字符。 */
  it("通配符与反斜杠都转义", () => {
    expect(likePattern("100%")).toBe("%100\\%%");
    expect(likePattern("a_b")).toBe("%a\\_b%");
    expect(likePattern("c\\d")).toBe("%c\\\\d%");
  });
});

describe("绑定值 —— 位次与「不给就是 null」", () => {
  const filters = (
    over: Partial<NoticeListFilters> = {},
  ): NoticeListFilters => ({
    includeExpired: false,
    severities: [],
    source: null,
    unreadOnly: false,
    keyword: "",
    ...over,
  });

  it("全不给：七个位次逐一落在该落的值上", () => {
    expect(noticeListValues("opera", OPERATOR, filters())).toEqual([
      "opera",
      OPERATOR,
      false,
      null,
      false,
      null,
      [],
    ]);
  });

  it("给了就按位次替换，关键词进的是转义过的模式", () => {
    expect(
      noticeListValues(
        "opera",
        OPERATOR,
        filters({
          includeExpired: true,
          severities: ["critical"],
          source: "system",
          unreadOnly: true,
          keyword: "50%",
        }),
      ),
    ).toEqual([
      "opera",
      OPERATOR,
      true,
      "system",
      true,
      "%50\\%%",
      ["critical"],
    ]);
  });
});

describe("两条语句的形状", () => {
  /** 语句里出现过的最大 $n。 */
  const maxPlaceholder = (sql: string): number =>
    Math.max(
      ...[...sql.matchAll(/\$(\d+)/g)].map((m) => Number.parseInt(m[1]!, 10)),
    );

  /* 汇总那条不带 limit/offset，所以它**正好**少绑一个值。加一项筛选时只改一处的话
     （比如只往页行里加 $9），pg 会当场拒掉另一条——但那要跑起来才知道。 */
  it("汇总比页行少绑正好一个值，且与 noticeListValues 的长度对得上", () => {
    const values = noticeListValues("opera", OPERATOR, {
      includeExpired: false,
      severities: [],
      source: null,
      unreadOnly: false,
      keyword: "",
    });
    expect(maxPlaceholder(LIST_SUMMARY_SQL)).toBe(values.length);
    expect(maxPlaceholder(LIST_SQL)).toBe(values.length + 1);
  });

  /* 三档计数算在 narrowed（除严重度以外都筛过）上。算在 matched 上的话，勾了
     「紧急」之后「重要 0 / 一般 0」，而库里明明还有几十条——那排数字从入口退化成
     当前筛选的回声，也就再没人能靠它跳过去。 */
  it("三档计数算在 narrowed 上，不是 matched", () => {
    for (const severity of ["info", "warning", "critical"]) {
      expect(LIST_SUMMARY_SQL).toContain(
        `(select count(*) from narrowed where severity = '${severity}')`,
      );
    }
    expect(LIST_SUMMARY_SQL).not.toContain("from matched where severity");
  });

  it("total 算在 scoped 上（不随四项筛选变），matched 才是筛过的条数", () => {
    expect(LIST_SUMMARY_SQL).toContain("(select count(*) from scoped)");
    expect(LIST_SUMMARY_SQL).toContain("(select count(*) from matched)");
  });

  /* 「只看未读」必须同时要求「投到本平面」与「没过期」：少任一条，这个筛选就会比
     铃铛角标（收件面算的）多出一批行，而两个数都在同一屏上。 */
  it("只看未读同时要求投放本平面且未过期", () => {
    expect(LIST_SQL).toContain(
      "not $5::bool or (read_at is null and on_this_plane and not expired)",
    );
  });

  it("汇总那条不带 limit", () => {
    expect(LIST_SUMMARY_SQL).not.toContain("limit");
    expect(LIST_SQL).toContain("limit $8");
  });
});
