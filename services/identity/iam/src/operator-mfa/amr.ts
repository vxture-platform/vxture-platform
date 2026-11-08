/**
 * amr.ts — map an internal authMethod string to RFC 8176 `amr` values.
 * @package @vxture/service-iam
 * @layer Domain
 *
 * The login flow records the factors cleared as a `+`-joined authMethod
 * (e.g. "password+totp"). The access token / session carry the standard `amr`
 * array so step-up and audit can reason about how the principal authenticated
 * (identity-platform-operator.md §2.3/§4). RFC 8176 values: pwd, otp, hwk; "mfa"
 * is appended when two or more factors were used. Recovery codes have no RFC
 * value, so "rc" is used.
 */
const FACTOR_TO_AMR: Record<string, string> = {
  password: "pwd",
  email_otp: "otp",
  phone_otp: "otp",
  phone: "sms",
  email: "otp",
  totp: "otp",
  webauthn: "hwk",
  recovery: "rc",
};

/** Convert a `+`-joined authMethod into a deduped, ordered amr array. */
export function authMethodToAmr(authMethod: string): string[] {
  const factors = (authMethod ?? "")
    .split("+")
    .map((f) => f.trim())
    .filter(Boolean);
  const amr: string[] = [];
  for (const factor of factors) {
    const value = FACTOR_TO_AMR[factor] ?? factor;
    if (!amr.includes(value)) amr.push(value);
  }
  if (factors.length >= 2 && !amr.includes("mfa")) amr.push("mfa");
  return amr;
}
