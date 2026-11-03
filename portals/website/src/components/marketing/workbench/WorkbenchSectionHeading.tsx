/**
 * Editorial heading group for the desktop product narrative.
 * @package @vxture/website
 * @layer Presentation
 * @category Components - Marketing
 * @author AI-Generated
 * @date 2026-11-03
 */
/** @param props Localized section identity and copy. @returns A connected title and description. */
export function WorkbenchSectionHeading({
  id,
  eyebrow,
  title,
  description,
}: {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="max-w-website-3xl">
      <p className="text-label-sm font-semibold tracking-widest text-primary-text">
        {eyebrow}
      </p>
      <h2
        id={id}
        className="font-display mt-4 text-3xl font-semibold leading-snug tracking-tight text-balance lg:text-4xl"
      >
        {title}
      </h2>
      <p className="mt-5 text-base leading-8 text-pretty text-muted-foreground">
        {description}
      </p>
    </div>
  );
}
