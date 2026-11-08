/**
 * Customer-only public entry; workforce is available only through its own route.
 * @package @vxture/accounts
 * @layer Presentation
 * @category component
 * @author AI-Generated
 * @date 2026-11-07
 */
import { redirect } from "next/navigation";

/** Open the public customer entry without exposing the workforce realm. */
export function AccountCenterHome(): never {
  redirect("/login");
}
