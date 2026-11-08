/**
 * Workforce account center with validated application return links.
 * @package @vxture/accounts
 * @layer Presentation
 * @category page
 * @author AI-Generated
 * @date 2026-11-06
 */
import { OperatorAccountCenter } from "@/components/OperatorAccountCenter";
import { AccountCenterShell } from "@/components/AccountCenterShell";
import { safeAccountReturn } from "@/lib/account-return";

export const dynamic = "force-dynamic";

export default async function WorkforceAccountPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const returnTo = safeAccountReturn(params.returnTo);
  return (
    <AccountCenterShell realm="workforce" {...(returnTo ? { returnTo } : {})}>
      <OperatorAccountCenter />
    </AccountCenterShell>
  );
}
