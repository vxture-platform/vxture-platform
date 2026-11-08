/**
 * Workforce passkey management entry.
 * @package @vxture/accounts
 * @layer Presentation
 * @category page
 * @author AI-Generated
 * @date 2026-11-06
 */
import { OperatorPasskeyManager } from "@/components/OperatorPasskeyManager";
import { AccountCenterShell } from "@/components/AccountCenterShell";
import { safeAccountReturn } from "@/lib/account-return";

export const dynamic = "force-dynamic";

export default async function OperatorPasskeysPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const returnTo = safeAccountReturn(params.returnTo);
  return (
    <AccountCenterShell
      realm="workforce"
      section="passkeys"
      {...(returnTo ? { returnTo } : {})}
    >
      <main>
        <OperatorPasskeyManager />
      </main>
    </AccountCenterShell>
  );
}
