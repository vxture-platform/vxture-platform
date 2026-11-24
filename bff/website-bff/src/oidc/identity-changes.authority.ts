/**
 * Website maps its customer key to the shared protocol subject.
 * @package @vxture/bff-website
 * @layer Application
 * @category identity
 * @author AI-Generated
 * @date 2026-11-24
 */
// ⚠️ 跨层引用: Account mapping stays in the BFF.
import { IdentityChangesAuthority as ProtocolAuthority } from "@vxture/core-oidc-rp";
export { IdentityChangeConflict } from "@vxture/core-oidc-rp";
export class IdentityChangesAuthority extends ProtocolAuthority {
  override authorizationVersion(userId: string): Promise<string> {
    return super.authorizationVersion(`usr_${userId}`);
  }
}
