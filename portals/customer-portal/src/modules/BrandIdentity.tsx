/**
 * Customer-owned brand composition and geometric research monogram.
 * @package @vxture/customer-portal
 * @layer Presentation
 * @category module
 * @author AI-Generated
 * @date 2026-11-15
 */
import Image from "next/image";
import type { PortalBrand } from "../lib/contracts";

/** Render the configured identity, with a neutral geometric fallback. */
export function BrandIdentity({
  brand,
  inverse = false,
  caption = "智能应用门户",
}: {
  brand: PortalBrand;
  inverse?: boolean;
  caption?: string;
}) {
  return (
    <div
      className={`research-identity${inverse ? " research-identity-inverse" : ""}`}
    >
      {brand.logo ? (
        <Image
          className="research-logo-image"
          src={`/api/portal/assets/${brand.logo}`}
          alt=""
          width={44}
          height={44}
          unoptimized
        />
      ) : (
        <svg
          className="research-logo"
          viewBox="0 0 44 44"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M8 32V12l14 8 14-8v20l-14-8-14 8Z"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinejoin="round"
          />
          <path
            d="m8 12 14-8 14 8M22 20v20M8 32l14 8 14-8"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinejoin="round"
          />
        </svg>
      )}
      <div>
        <span className="research-brand-name">{brand.name}</span>
        <span className="research-brand-caption">{caption}</span>
      </div>
    </div>
  );
}
