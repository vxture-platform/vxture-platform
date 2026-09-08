/**
 * destructive.test.ts — 破坏性确认的文案出口。
 *
 * ── 为什么这块值得测 ──
 * destructive.ts 自己的注释里记着**两个已经发生过的生产缺陷**，两个都不报错：
 *
 *  1. `titleTemplate` 用 `t()` 而不是 `t.raw()`：那一条的值是 `{verb}{target}？`，
 *     `t()` 会当场按 ICU 求值，而 verb/target 此刻还不存在，于是抛 FORMATTING_ERROR
 *     并回落——确认框标题渲染成 `destructive.titleTemplate` 这一串键路径。
 *     原注释写着：「这个缺陷两道门禁一个都抓不到（类型对、词条也对），是把栈跑起来
 *     点开一个删除确认框才看见的」。
 *
 *  2. 合并顺序：`...confirm` 必须在**后**，调用方的 `cancelLabel: t("keepInvitation")`
 *     这类反向措辞才覆盖得掉托底。反过来写会让一个 undefined 悄悄盖掉托底，
 *     确认框上出现英文默认值——而英文默认值出现在生产界面上，本身就是「有人忘了传」
 *     的信号，被盖掉就再也看不出来了。
 *
 * 这里用假的 next-intl 把这两条钉住：假 `t()` 见到 ICU 占位符就抛，与真实行为同形。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const RAW = "{verb}{target}？";

/** 与 next-intl 同形的假译器：`t()` 遇到未提供的占位符就抛，`t.raw()` 原样返回。 */
const t = Object.assign(
  vi.fn((key: string) => {
    const value = DICT[key] ?? key;
    if (/\{[a-zA-Z]+\}/.test(value)) {
      throw new Error(`FORMATTING_ERROR: ${key}`);
    }
    return value;
  }),
  { raw: vi.fn((key: string) => DICT[key] ?? key) },
);

const DICT: Record<string, string> = {
  titleTemplate: RAW,
  cancel: "取消",
  pending: "处理中…",
  blocked: "当前不可执行",
};

vi.mock("next-intl", () => ({ useTranslations: () => t }));

// 必须在 mock 之后再引入被测模块。
const { useConfirmLabels } = await import("./destructive");

describe("useConfirmLabels", () => {
  beforeEach(() => {
    t.mockClear();
    t.raw.mockClear();
  });

  it("titleTemplate 走 t.raw，占位符原样留给 DS 去填", () => {
    const fill = useConfirmLabels();
    const out = fill({} as never);
    expect(out.titleTemplate).toBe(RAW);
    // 关键：这一条走的是 raw；若改成 t()，上面的假译器会抛，
    // 与生产里渲染出 `destructive.titleTemplate` 是同一个根因。
    expect(t.raw).toHaveBeenCalledWith("titleTemplate");
  });

  it("四项托底都补齐——漏传时界面仍可读，是有意的", () => {
    const out = useConfirmLabels()({} as never);
    expect(out.cancelLabel).toBe("取消");
    expect(out.pendingLabel).toBe("处理中…");
    expect(out.blockedHint).toBe("当前不可执行");
  });

  it("调用方的措辞覆盖得掉托底（合并顺序：...confirm 在后）", () => {
    const out = useConfirmLabels()({
      cancelLabel: "保留邀请",
    } as never);
    expect(out.cancelLabel).toBe("保留邀请");
    // 没被覆盖的仍是托底，说明覆盖是逐项的、不是整份替换。
    expect(out.pendingLabel).toBe("处理中…");
  });

  it("调用方传的其它字段原样带出（不被托底吞掉）", () => {
    const out = useConfirmLabels()({
      verb: "删除",
      target: "模型服务",
    } as never);
    expect(out).toMatchObject({ verb: "删除", target: "模型服务" });
  });
});
