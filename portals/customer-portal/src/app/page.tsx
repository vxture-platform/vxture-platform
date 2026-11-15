/**
 * Registered-host public entry page.
 * @package @vxture/customer-portal
 * @layer Presentation
 * @category page
 * @author AI-Generated
 * @date 2026-11-15
 */
import { isDesignPreview, loadBrand } from "../lib/runtime";
import { LoginPage } from "../modules/LoginPage";

/** Render only public branding before authentication. */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ access?: string }>;
}) {
  return (
    <LoginPage
      brand={await loadBrand()}
      designPreview={await isDesignPreview()}
      accessDenied={(await searchParams).access === "denied"}
    />
  );
}
