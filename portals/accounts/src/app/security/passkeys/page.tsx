/**
 * page.tsx - /security/passkeys (operator passkey management, P3.4)
 * @package @vxture/accounts
 *
 * Authenticated operator credential-management surface. The manager component
 * loads the operator's passkeys via the operator central session cookie; an
 * unauthenticated visitor sees the "please log in" error from the API.
 */
import { OperatorPasskeyManager } from "@/components/OperatorPasskeyManager";

export const dynamic = "force-dynamic";

export default function OperatorPasskeysPage() {
  return (
    <main className="mx-auto w-full max-w-panel-lg px-md py-3xl">
      <OperatorPasskeyManager />
    </main>
  );
}
