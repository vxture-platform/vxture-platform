/**
 * Customer audit views never expose internal UUIDs as display text.
 * @package @vxture/console
 * @layer Presentation
 * @category test
 * @author AI-Generated
 * @date 2026-11-19
 */
import { describe, expect, it } from "vitest";
import { auditBusinessNo, auditDisplayText } from "./audit-display";
describe("audit public identifiers", () => {
  it.each([
    "00000000-0000-4000-a000-000000000100",
    "usr_00000000-0000-4000-a000-000000000100",
    "removed 00000000-0000-4000-a000-000000000100",
    "",
  ])("hides raw identifiers and decorated UUIDs", (value) => {
    expect(auditDisplayText(value)).toBeNull();
    expect(auditBusinessNo(value)).toBeNull();
  });
  it("preserves names and recognized public business numbers", () => {
    expect(auditDisplayText("如影智能研究院")).toBe("如影智能研究院");
    expect(auditBusinessNo("U-1649201736")).toBe("U-1649201736");
    expect(auditBusinessNo("ORD-202609-31DDD533C6")).toBe(
      "ORD-202609-31DDD533C6",
    );
    expect(auditBusinessNo("internal-resource-key")).toBeNull();
  });
});
