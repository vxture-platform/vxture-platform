/**
 * Labeled knowledge capability examples.
 * @package @vxture/website
 * @layer Presentation
 * @category Components - Marketing
 * @author AI-Generated
 * @date 2026-11-02
 */
import { useTranslations } from "next-intl";
import { IntakeScene, OrganizationScene } from "./KardaLibraryScenes";
import { RetrievalScene, SharingScene } from "./KardaRetrievalScenes";

const SCENES = {
  ingest: IntakeScene,
  organize: OrganizationScene,
  retrieve: RetrievalScene,
  share: SharingScene,
};

/** @param props Selected capability. @returns An explicitly illustrative scene. */
export function KardaCapabilityScene({ kind }: { kind: keyof typeof SCENES }) {
  const t = useTranslations("products.karda");
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
