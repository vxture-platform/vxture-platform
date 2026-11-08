/**
 * Password policy boundaries and client/server parity.
 * @package @vxture/bff-auth
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-09
 */
import { describe, expect, it } from "vitest";
import { validNewPassword } from "./password-policy";
import { validNewPassword as clientPolicy } from "../../../../portals/accounts/src/lib/password-policy";

describe("new credential policy", () => {
  it.each([
    ["customer", "Abc12345", true],
    ["customer", "abc!2345", true],
    ["customer", "Abc1234", false],
    ["customer", "abcdefgh1234", false],
    ["customer", "ABCDEFGH!!!!", false],
    ["customer", "abcde   ", false],
    ["customer", "Ab1" + "x".repeat(125), true],
    ["customer", "Ab1" + "x".repeat(126), false],
    ["workforce", "Abc12345678!", true],
    ["workforce", "Abc1234567!", false],
    ["workforce", "abcdefghijkl", false],
    ["customer", null, false],
  ] as const)(
    "%s validates credential boundaries",
    (realm, value, expected) => {
      expect(validNewPassword(value, realm)).toBe(expected);
      expect(clientPolicy(value, realm)).toBe(expected);
    },
  );
});
