/**
 * Legacy links resolve to their supported account-center sections.
 * @package @vxture/console
 * @layer Presentation
 * @category test
 * @author AI-Generated
 * @date 2026-11-11
 */
import { describe, expect, it } from "vitest";
import { accountCenterUrl, legacyAccountSection } from "./account-center";

describe("account-center navigation", () => {
  it.each([
    [undefined, undefined],
    ["sessions", "devices"],
    ["history", "devices"],
    ["security", "security"],
    ["deletion", "deletion"],
    ["https://example.com", undefined],
  ] as const)("maps legacy panel %s to %s", (panel, expected) => {
    expect(legacyAccountSection(panel)).toBe(expected);
    const url = new URL(accountCenterUrl("en-US", legacyAccountSection(panel)));
    expect(url.pathname).toBe("/account");
    expect(url.searchParams.get("section")).toBe(expected ?? null);
    expect(url.searchParams.get("vx_locale")).toBe("en-US");
  });
});
