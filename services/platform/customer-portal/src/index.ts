/**
 * Public customer portal domain entry point.
 * @package @vxture/service-customer-portal
 * @layer Domain
 * @category exports
 * @author AI-Generated
 * @date 2026-11-15
 */
export { CustomerPortalService } from "./service";
export { PortalAccessService } from "./access";
export type { PortalIdentity, PortalMember } from "./access";
export {
  DEFAULT_CONFIGURATION,
  parseConfiguration,
  portalHostname,
} from "./configuration";
export type { PortalConfiguration } from "./configuration";
export type {
  PortalRecord,
  PortalVersion,
  PortalActor,
  PublishedPortal,
} from "./service";
