/**
 * Short-lived verification tickets kept only in the current interaction.
 * @package @vxture/accounts
 * @layer Presentation
 * @category api
 * @author AI-Generated
 * @date 2026-11-10
 */
import { apiMessage } from "@/lib/api-message";
import { accountsRequest } from "./customer-self";
import {
  startAuthentication,
  type PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";

export type SecurityRealm = "customer" | "workforce";
export interface SecurityScope {
  realm: SecurityRealm;
  operation: string;
  target: string;
}
function base(realm: SecurityRealm) {
  return `/oidc/${realm === "customer" ? "customer" : "operator"}/self/reauthentication`;
}
export function securityVerificationOptions(scope: SecurityScope) {
  return accountsRequest<{ methods: string[] }>(
    `${base(scope.realm)}/options`,
    {
      method: "POST",
      body: JSON.stringify(scope),
    },
  );
}
export async function startSecurityVerification(
  scope: SecurityScope,
  method: string,
) {
  return accountsRequest<{
    verificationId: string;
    options?: PublicKeyCredentialRequestOptionsJSON;
  }>(base(scope.realm), {
    method: "POST",
    body: JSON.stringify({ ...scope, method }),
  });
}
export async function verifySecurityTicket(
  scope: SecurityScope,
  id: string,
  input: { password?: string; code?: string; response?: unknown },
) {
  return accountsRequest<{ proofToken: string; expiresAt: number }>(
    `${base(scope.realm)}/${encodeURIComponent(id)}/verify`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
}
/** Verify the existing passkey; registering a new key never proves ownership. */
export async function verifySecurityPasskey(scope: SecurityScope) {
  const ticket = await startSecurityVerification(scope, "webauthn");
  if (!ticket.options) throw new Error(apiMessage("passkey_auth_start_failed"));
  const response = await startAuthentication({ optionsJSON: ticket.options });
  return verifySecurityTicket(scope, ticket.verificationId, { response });
}
