/**
 * Capability illustrations, using sample data rather than production claims.
 * @package @vxture/website
 * @layer Presentation
 * @category Components - Marketing
 * @author AI-Generated
 * @date 2026-11-02
 */
import { useTranslations } from "next-intl";

import { CatalogScene, QualityScene } from "./ArdaCatalogScenes";
import { LineageScene, ServiceScene } from "./ArdaServiceScenes";

type SceneKind = "catalog" | "quality" | "lineage" | "service";

const SCENES = {
  catalog: CatalogScene,
  quality: QualityScene,
  lineage: LineageScene,
  service: ServiceScene,
};

/** @param props Selected capability. @returns A labeled, noninteractive example. */
export function ArdaCapabilityScene({ kind }: { kind: SceneKind }) {
  const t = useTranslations("products.arda");
  const Scene = SCENES[kind];
  return (
    <figure className="rounded-xl border border-border bg-muted/30 p-5 sm:p-6">
      <figcaption className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <span className="text-body-sm font-semibold">
          {t(`capabilities.${kind}.sceneTitle`)}
        </span>
        <span className="text-label-sm text-muted-foreground">
          {t("sample.disclaimer")}
        </span>
      </figcaption>
      <Scene />
    </figure>
  );
}
