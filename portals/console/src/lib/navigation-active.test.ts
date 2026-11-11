/**
 * Sidebar route boundary regressions.
 * @package @vxture/console
 * @layer Presentation
 * @category test
 * @author AI-Generated
 * @date 2026-11-11
 */
import { describe, expect, it } from "vitest";
import { isNavigationActive } from "./navigation-active";
describe("sidebar route matching", () => {
  it.each([
    ["/memberships", "/members", false],
    ["/memberships", "/memberships", true],
    ["/members/roles", "/members", true],
    ["/tenant-settings", "/tenant", false],
    ["/", "/", true],
    ["/members", "/", false],
  ])("matches %s against %s as %s", (path, href, expected) => {
    expect(isNavigationActive(path, href)).toBe(expected);
  });
});
