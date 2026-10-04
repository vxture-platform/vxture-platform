/**
 * shared-secret.spec.ts - behavioural matrix of `sharedSecretMatches`.
 * @package @vxture/core-auth
 *
 * 这份矩阵**不量时间**：常量时间这件事由 `node:crypto` 的 `timingSafeEqual` 保证，
 * 这里只证两件事——① 哪些输入在到达它之前就被挡住（fail-closed 的那几条），
 * ② 等长输入真的交给了它，而不是某条 `===` 在替它回答。
 * 第 ② 条靠 mock 住 `node:crypto` 看调用次数：若有人把实现改回 `a === b`，
 * 「相等 → 调了一次」那条会红。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const timingSafeEqualSpy = vi.hoisted(() => vi.fn());

vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  timingSafeEqualSpy.mockImplementation(actual.timingSafeEqual);
  return { ...actual, timingSafeEqual: timingSafeEqualSpy };
});

import { sharedSecretMatches } from "./shared-secret";

const SECRET = "shared-secret-value-32-bytes-min";

afterEach(() => {
  timingSafeEqualSpy.mockClear();
});

describe("sharedSecretMatches · fail-closed before any comparison", () => {
  it.each([
    ["empty expected", ""],
    ["undefined expected", undefined],
    ["null expected", null],
  ])(
    "%s → false even when presented equals it, and crypto is never consulted",
    (_label, expected) => {
      expect(sharedSecretMatches(expected ?? "", expected)).toBe(false);
      expect(sharedSecretMatches(SECRET, expected)).toBe(false);
      expect(timingSafeEqualSpy).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["undefined presented", undefined],
    ["array presented (duplicate header)", [SECRET, SECRET]],
    ["number presented", 42],
    ["object presented", { toString: () => SECRET }],
  ])("%s → false, crypto never consulted", (_label, presented) => {
    expect(sharedSecretMatches(presented, SECRET)).toBe(false);
    expect(timingSafeEqualSpy).not.toHaveBeenCalled();
  });

  it("byte-length mismatch → false, crypto never consulted (it would throw on unequal lengths)", () => {
    expect(sharedSecretMatches(SECRET.slice(0, -1), SECRET)).toBe(false);
    expect(sharedSecretMatches(`${SECRET}x`, SECRET)).toBe(false);
    expect(sharedSecretMatches("", SECRET)).toBe(false);
    expect(timingSafeEqualSpy).not.toHaveBeenCalled();
  });

  it("same character count but different byte length is a length mismatch (bytes, not chars)", () => {
    // "é" is two bytes in UTF-8; "e" is one. Same .length, different Buffer length.
    expect(sharedSecretMatches("aé", "ae")).toBe(false);
    expect(timingSafeEqualSpy).not.toHaveBeenCalled();
  });
});

describe("sharedSecretMatches · equal-length inputs go through timingSafeEqual", () => {
  it("equal → true, via exactly one timingSafeEqual call", () => {
    expect(sharedSecretMatches(SECRET, SECRET)).toBe(true);
    expect(timingSafeEqualSpy).toHaveBeenCalledTimes(1);
  });

  it("one byte different, same length → false, still via timingSafeEqual", () => {
    const flipped = `${SECRET.slice(0, 10)}X${SECRET.slice(11)}`;
    expect(flipped).toHaveLength(SECRET.length);
    expect(sharedSecretMatches(flipped, SECRET)).toBe(false);
    expect(timingSafeEqualSpy).toHaveBeenCalledTimes(1);
  });

  it("multibyte equal → true", () => {
    expect(sharedSecretMatches("口令-é", "口令-é")).toBe(true);
    expect(timingSafeEqualSpy).toHaveBeenCalledTimes(1);
  });

  it("the other key of the same length is not accepted (no key is 'close enough')", () => {
    const other = SECRET.split("").reverse().join("");
    expect(other).toHaveLength(SECRET.length);
    expect(other).not.toBe(SECRET);
    expect(sharedSecretMatches(other, SECRET)).toBe(false);
  });
});
