/**
 * Uncached, passive central-session verification for explicit RP probes.
 * @package @vxture/core-oidc-rp
 * @layer Infrastructure
 * @category auth
 * @author AI-Generated
 * @date 2026-11-16
 */
import type { OidcRpConfig } from "./types";

/** Query central validity without treating transport or protocol failures as logout. */
export async function checkOidcSession(
  config: OidcRpConfig,
  sid: string,
): Promise<boolean> {
  const response = await fetch(
    `${(config.backchannelIssuer ?? config.issuer).replace(/\/$/, "")}/oidc/session/status`,
    {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(5000),
      headers: {
        "content-type": "application/json",
        authorization: `Basic ${Buffer.from(
          `${encodeURIComponent(config.clientId)}:${encodeURIComponent(config.clientSecret)}`,
        ).toString("base64")}`,
      },
      body: JSON.stringify({ sid, active: false }),
    },
  );
  if (!response.ok) throw new Error("Central session verification unavailable");
  const body: unknown = await response.json();
  if (
    !body ||
    typeof body !== "object" ||
    !("valid" in body) ||
    typeof body.valid !== "boolean" ||
    (body.valid &&
      (!("next_check_at" in body) ||
        !Number.isInteger(body.next_check_at) ||
        Number(body.next_check_at) <= Math.floor(Date.now() / 1000)))
  )
    throw new Error("Invalid central session verification response");
  return body.valid;
}
