/**
 * page.tsx - accounts root
 * @package @vxture/accounts
 *
 * v1 ships only /login. The account center (profile / security / connected
 * apps / sessions) lands later. See docs/design/identity-platform-idp.md §7.
 * A bare visit here (no app context) auto-returns rather than dead-ending.
 */
import { AutoReturnToApp } from "@/components/AutoReturnToApp";

export default function HomePage() {
  return <AutoReturnToApp />;
}
