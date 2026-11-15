/**
 * Public presentation contracts; no server credentials or domain-package imports.
 * @package @vxture/customer-portal
 * @layer Presentation
 * @category types
 * @author AI-Generated
 * @date 2026-11-15
 */
export interface PortalBrand {
  name: string;
  title: string;
  subtitle: string;
  brandColor: string;
  appearance: "light" | "dark";
  density: "comfortable" | "compact";
  logo: string | null;
  favicon: string | null;
  background: string | null;
}
export interface WorkspaceData {
  name: string;
  workspaceName: string;
  apps: {
    code: string;
    name: string;
    description: string;
    category: string;
    href: string | null;
  }[];
}
