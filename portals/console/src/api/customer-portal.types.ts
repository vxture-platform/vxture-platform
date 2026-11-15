/**
 * Customer portal HTTP projections; presentation does not import domain code.
 * @package @vxture/console
 * @layer Presentation
 * @category contracts
 * @author AI-Generated
 * @date 2026-11-15
 */
export interface PortalConfiguration {
  name: string;
  title: string;
  subtitle: string;
  brandColor: string;
  appearance: "light" | "dark";
  density: "comfortable" | "compact";
  logo: string | null;
  favicon: string | null;
  background: string | null;
  applications: { code: string; group: string; hidden: boolean }[];
}
export interface PortalVersion {
  id: string;
  version: number;
  configuration: PortalConfiguration;
  status: "pending" | "rejected" | "approved" | "withdrawn";
  note: string;
  reviewNote: string | null;
  submittedAt: string;
  reviewedAt: string | null;
}
export interface PortalRecord {
  id: string;
  tenantId: string;
  hostname: string;
  workspaceId: string;
  selfService: boolean;
  enabled: boolean;
  revision: number;
  draft: PortalConfiguration;
  publishedVersionId: string | null;
  updatedAt: string;
  updatedBy: string;
  updatedSurface: string;
  versions: PortalVersion[];
}
