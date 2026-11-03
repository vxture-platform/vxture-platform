/**
 * Catalog-owned product identity with a safe, decorative fallback.
 * @package @vxture/website
 * @layer Presentation
 * @category Components - Marketing
 * @author AI-Generated
 * @date 2026-11-03
 */
import { useState } from "react";
import Image from "next/image";
import { Icon } from "@vxture/design-system";

/** @param props Optional catalog image URL. @returns An icon with load-failure recovery. */
export function AgentProductIcon({ url }: { url?: string | null }) {
  const [failed, setFailed] = useState<string | null>(null);
  const source = url?.trim();
  const showImage =
    source && /^(https?:\/\/|\/(?!\/))/.test(source) && source !== failed;
  return (
    <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl border border-primary-border bg-primary-muted text-primary-text">
      {showImage ? (
        <Image
          src={source}
          width={80}
          height={80}
          unoptimized
          alt=""
          className="h-full w-full rounded-2xl object-contain p-2"
          onError={() => setFailed(source)}
        />
      ) : (
        <Icon name="sparkles" className="h-10 w-10" aria-hidden />
      )}
    </div>
  );
}
