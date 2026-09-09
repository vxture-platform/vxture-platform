import { describe, expect, it } from "vitest";
import {
  formatPrincipalNo,
  normalizePrincipalNoInput,
  principalPrefix,
} from "./principal-no";

/**
 * 粘贴进来的用户号要规整成裸号（owner 2026-09-10）。
 *
 * 界面上一律带前缀展示（`U-1799729056`），于是复制过来的十有八九带着它；后端收的
 * 却是裸数字。不规整的话：粘贴 → 查不到 → 人以为号错了，而号是对的。
 */
describe("normalizePrincipalNoInput", () => {
  const NO = "1799729056";

  it.each([
    ["U-1799729056", "标准展示形"],
    ["u-1799729056", "小写"],
    ["U1799729056", "没有连字符"],
    ["U_1799729056", "下划线"],
    ["1799729056", "本来就是裸号"],
    ["  U-1799729056 ", "前后空格"],
    ["U-1799 729056", "中间空格（复制时被断开）"],
    ["\u3000U-1799729056", "全角空格"],
  ])("%s → 裸号（%s）", (input) => {
    expect(normalizePrincipalNoInput(input, "user")).toBe(NO);
  });

  /**
   * **只剔前缀与空白，不改数字**。
   *
   * 把非数字字符一并滤掉看起来更「干净」，但那会让 `1799 729O56` 这种 O/0 手误
   * 静默变成另一个号——那比查不到糟得多：查不到会让人回去核对，静默改号不会。
   */
  it("不吞掉非数字字符：O/0 手误要留着，让它查不到", () => {
    expect(normalizePrincipalNoInput("U-1799729O56", "user")).toBe(
      "1799729O56",
    );
  });

  /** 前缀按 kind 走，不是写死 U——租户号粘进用户框时不该被剔掉 T。 */
  it("只剔自己那一类的前缀", () => {
    expect(normalizePrincipalNoInput("T-2765432109", "user")).toBe(
      "T-2765432109",
    );
    expect(normalizePrincipalNoInput("T-2765432109", "tenant")).toBe(
      "2765432109",
    );
  });

  /**
   * `principalPrefix` 与展示端同源。
   *
   * 输入框拿它当固定前置。此前那里写的是 `formatPrincipalNo("", "user") ?? "U-"`
   * ——那个函数对空串返回 null，于是永远走兜底，「与展示同源」是句空话：
   * 改了前缀,输入框那一半不会跟着变。
   */
  it("principalPrefix 与展示端同源", () => {
    expect(principalPrefix("user")).toBe("U-");
    expect(formatPrincipalNo(NO, "user")).toBe(
      `${principalPrefix("user")}${NO}`,
    );
    expect(principalPrefix("tenant")).toBe("T-");
    expect(principalPrefix("workspace")).toBe("W-");
  });

  /* 与展示函数互为逆:展示出来的东西粘回去要还原成原来的号。
     只测规整那一半的话,展示端改了前缀(比如将来加成 UID-)这里不会红。 */
  it("与 formatPrincipalNo 互逆", () => {
    const shown = formatPrincipalNo(NO, "user")!;
    expect(normalizePrincipalNoInput(shown, "user")).toBe(NO);
  });
});
