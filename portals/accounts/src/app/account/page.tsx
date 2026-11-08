/**
 * Customer account-center entry.
 * @package @vxture/accounts
 * @layer Presentation
 * @category page
 * @author AI-Generated
 * @date 2026-11-06
 */
import { AccountCenterShell } from "@/components/AccountCenterShell";
import { CustomerAccountCenter } from "@/components/CustomerAccountCenter";
import { safeAccountReturn } from "@/lib/account-return";

export const dynamic = "force-dynamic";
export default async function CustomerAccountPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const returnTo = safeAccountReturn(params.returnTo);
  return (
    <AccountCenterShell realm="customer" {...(returnTo ? { returnTo } : {})}>
      <CustomerAccountCenter />
    </AccountCenterShell>
  );
}
