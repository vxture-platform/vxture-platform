/**
 * Realm-specific interactive login entry.
 * @package @vxture/accounts
 * @layer Presentation
 * @category page
 * @author AI-Generated
 * @date 2026-11-06
 */
import { LoginEntry } from "@/components/LoginEntry";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const challenge =
    typeof params.login_challenge === "string" ? params.login_challenge : "";
  return <LoginEntry loginChallenge={challenge} entryRealm="workforce" />;
}
