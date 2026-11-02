/**
 * Section introductions keep the description directly beneath the title.
 * @package @vxture/website
 * @layer Presentation
 * @category Components - Marketing
 * @author AI-Generated
 * @date 2026-11-02
 */
interface ArdaSectionIntroProps {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
}

/** @param props Localized section copy. @returns A consistent heading group. */
export function ArdaSectionIntro(props: ArdaSectionIntroProps) {
  return (
    <div className="mb-10 max-w-website-3xl">
      <p className="text-label-sm font-semibold text-primary-text">
        {props.eyebrow}
      </p>
      <h2
        id={props.id}
        className="font-display mt-3 text-3xl font-semibold leading-snug text-balance lg:text-4xl"
      >
        {props.title}
      </h2>
      <p className="mt-4 text-base leading-7 text-pretty text-muted-foreground">
        {props.description}
      </p>
    </div>
  );
}
