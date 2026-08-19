import Image from "next/image";

type ThemedHeroImageProps = {
  alt: string;
  lightSrc: string;
  darkSrc: string;
  priority?: boolean;
  className?: string;
};

/** SVG 背景不走 next/image(优化器默认拒收 SVG,且矢量图无需再压),直接原生 img。 */
function isSvg(src: string): boolean {
  return src.toLowerCase().endsWith(".svg");
}

export default function ThemedHeroImage({
  alt,
  lightSrc,
  darkSrc,
  priority = true,
  className = "",
}: ThemedHeroImageProps) {
  const imageClassName = `object-cover ${className}`.trim();

  const renderOne = (src: string, themeCls: string) =>
    isSvg(src) ? (
      // eslint-disable-next-line @next/next/no-img-element -- SVG 有意绕过优化器
      <img
        src={src}
        alt={alt}
        className={`absolute inset-0 h-full w-full ${imageClassName} ${themeCls}`}
      />
    ) : (
      <Image
        src={src}
        alt={alt}
        fill
        priority={priority}
        sizes="100vw"
        className={`${imageClassName} ${themeCls}`}
      />
    );

  return (
    <>
      {renderOne(lightSrc, "block dark:hidden")}
      {renderOne(darkSrc, "hidden dark:block")}
    </>
  );
}
