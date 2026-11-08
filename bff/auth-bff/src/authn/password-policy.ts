/**
 * Password policy for newly established credentials; existing sign-in is unchanged.
 * @package @vxture/bff-auth
 * @layer Application
 * @category validation
 * @author AI-Generated
 * @date 2026-11-09
 */
/**
 * Validate length and at least three character categories.
 * @param value - Candidate new credential.
 * @param realm - Isolated identity domain selecting the minimum length.
 * @returns Whether the candidate satisfies the credential policy.
 */
export function validNewPassword(
  value: unknown,
  realm: "customer" | "workforce",
): value is string {
  if (
    typeof value !== "string" ||
    value.length < (realm === "workforce" ? 12 : 8) ||
    value.length > 128
  )
    return false;
  const categories = [/[A-Z]/, /[a-z]/, /[0-9]/, /[^A-Za-z0-9\s]/];
  return categories.filter((category) => category.test(value)).length >= 3;
}
