"use client";
/**
 * Shared legal footer for both public and authenticated Ruyin pages.
 * @package @vxture/workbench
 * @layer Presentation
 * @category component
 * @author AI-Generated
 * @date 2026-11-12
 */
import { ShellFooter } from "@vxture/design-system";
import { SITE_FILINGS } from "@vxture-platform/shared";
import { useWorkLocale } from "../../lib/locale";
import type { WorkRuntime } from "../../lib/contracts";

/** Keep policy order and filing information consistent across sign-in states. */
export function WorkFooter({ runtime }: { runtime: WorkRuntime }) {
  const { locale, t } = useWorkLocale();
  const policy = (key: string) =>
    new URL(`/${locale}/legal/${key}`, runtime.websiteUrl).href;
  return (
    <ShellFooter
      layout="centered"
      legal={{
        copyright: {
          href: policy("copyright"),
          label: t("版权声明"),
          year: new Date().getFullYear(),
          owner: "Vxture Studio",
        },

        cookies: { href: policy("cookies"), label: t("Cookie 政策") },
        terms: { href: policy("terms"), label: t("服务条款") },
        privacy: { href: policy("privacy"), label: t("隐私政策") },
        navigationLabel: t("法律信息"),
        filingsLabel: t("网站备案"),
        filings: SITE_FILINGS,
      }}
    />
  );
}
