/**
 * Tenant business settings and lifecycle requests.
 * @package @vxture/bff-console
 * @layer Application
 * @category dto
 * @author AI-Generated
 * @date 2026-11-11
 */
export class UpdateOrganizationDto {
  /**
   * Renaming an organization invalidates its previous verification.
   * The response exposes verificationSuperseded for the renewal prompt.
   */
  name?: string | null;
  /** Display name changes do not invalidate verification. */
  displayName?: string | null;
  description?: string | null;
  industry?: string | null;
  scale?: string | null;
  website?: string | null;
  contactName?: string | null;
  contactRole?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  /** Derive contact details from this member; null removes the association. */
  contactUserId?: string | null;
  /** Ignored when contact details are derived from an associated member. */
  contactGender?: "male" | "female" | null;
  countryCode?: string | null;
  address?: string | null;
  address2?: string | null;
  postalCode?: string | null;
  isBillingRecipient?: boolean;
  timezone?: string | null;
  language?: string | null;
  currency?: string | null;
}

/** Personal-to-organization conversion requires explicit acknowledgement. */
export class ConvertTenantDto {
  name = "";
  acknowledged = false;
}

/** Organization closure requires acknowledgement and matching tenant name. */
export class RequestTenantClosureDto {
  acknowledged = false;
  confirmName = "";
}
