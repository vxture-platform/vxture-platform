/**
 * Compatibility entry for workforce passkey management.
 * @package @vxture/accounts
 * @layer Presentation
 * @category page
 * @author AI-Generated
 * @date 2026-11-06
 */
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export default function LegacyPasskeysPage() {
  redirect("/workforce/security/passkeys");
}
