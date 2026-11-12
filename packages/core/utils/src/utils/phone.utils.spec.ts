/**
 * Phone presentation regressions across national, international and masked input.
 * @package @vxture/core-utils
 * @layer Infrastructure
 * @category test
 * @author AI-Generated
 * @date 2026-11-12
 */
import { describe, expect, it } from "vitest";
import { formatPhoneForDisplay, toE164 } from "./phone.utils";

describe("formatPhoneForDisplay", () => {
  it.each([
    "+8618888888888",
    "18888888888",
    "+86 188 8888 8888",
    "008618888888888",
  ])("groups mainland mobile %s", (input) => {
    expect(formatPhoneForDisplay(input)).toEqual({
      callingCode: "+86",
      number: "188 8888 8888",
    });
    expect(toE164(input.replace(/^00/, "+"))).toBe("+8618888888888");
  });
  it("preserves international country calling codes", () => {
    expect(formatPhoneForDisplay("+14155552671")).toEqual({
      callingCode: "+1",
      number: "415 555 2671",
    });
    expect(formatPhoneForDisplay("+442079460958")).toEqual({
      callingCode: "+44",
      number: "20 7946 0958",
    });
  });
  it.each(["188****8888", "not a number", "+86"])(
    "does not invent digits for %s",
    (input) => {
      expect(formatPhoneForDisplay(input)).toEqual({ number: input });
    },
  );
  it.each([null, undefined, "", " "])("shows a fallback for %s", (input) => {
    expect(formatPhoneForDisplay(input)).toEqual({ number: "—" });
  });
});
