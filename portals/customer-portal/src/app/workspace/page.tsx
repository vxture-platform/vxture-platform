/**
 * Local workspace design walkthrough, with no production authentication bypass.
 * @package @vxture/customer-portal
 * @layer Presentation
 * @category page
 * @author AI-Generated
 * @date 2026-11-15
 */
import { redirect } from "next/navigation";
import {
  DESIGN_WORKSPACE,
  isDesignPreview,
  loadBrand,
  portalRequest,
} from "../../lib/runtime";
import type { WorkspaceData } from "../../lib/contracts";
import { WorkspacePage } from "../../modules/WorkspacePage";
import { SessionBootstrap } from "../../modules/SessionBootstrap";

/** Keep fixture data inaccessible unless local design development was explicitly enabled. */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ vx_sso_checked?: string }>;
}) {
  if (!(await isDesignPreview())) {
    if ((await searchParams).vx_sso_checked !== "1")
      return <SessionBootstrap />;
    const response = await portalRequest("/api/portal/workspace");
    if (response.status === 401) redirect("/");
    if (response.status === 403) redirect("/?access=denied");
    if (!response.ok) throw new Error("Workspace is unavailable");
    return (
      <WorkspacePage
        brand={await loadBrand()}
        data={(await response.json()) as WorkspaceData}
      />
    );
  }
  return (
    <WorkspacePage
      brand={await loadBrand()}
      data={DESIGN_WORKSPACE}
      designPreview
    />
  );
}
