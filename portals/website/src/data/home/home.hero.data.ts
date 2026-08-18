/**
 * Hero 结构数据 - 不包含翻译文本，只定义结构
 * @package @vxture/website
 * @layer Presentation
 * @category Data - Home
 */

/**
 * Hero CTA 配置
 */
export interface HeroCta {
  href: string;
}

/**
 * Hero 媒体配置
 */
export interface HeroMedia {
  type: string;
  videoUrl?: string;
  /** 亮色模式封面图 */
  posterImage?: string;
  /** 暗色模式封面图（可选，未配置时回退到 posterImage） */
  posterImageDark?: string;
  url?: string;
  urlDark?: string;
}

/**
 * Hero 滚动指示器配置
 */
export interface HeroScrollIndicator {
  enabled: boolean;
}

/**
 * Hero 完整数据结构
 */
export interface HeroData {
  enabled: boolean;
  theme: string;
  intent: string;
  variant: string;
  titleKey: string;
  titleHighlightKey: string;
  descriptionKey: string;
  cta: HeroCta;
  media: HeroMedia;
  scrollIndicator: HeroScrollIndicator;
}

/**
 * Hero 结构数据 - 使用 labelKey 映射翻译
 */
export const HERO_DATA: HeroData = {
  enabled: true,
  theme: "brand",
  intent: "cta",
  variant: "highlight",
  titleKey: "title",
  titleHighlightKey: "titleHighlight",
  descriptionKey: "description",
  cta: {
    href: "/products",
  },
  media: {
    type: "image",
    videoUrl: "/videos/hero/banner-hero-01.mp4",
    url: "/images/hero/banner-hero-poster-light-01.png",
    urlDark: "/images/hero/banner-hero-poster-dark-01.png",
    posterImage: "/images/hero/banner-hero-poster-light-01.png",
    posterImageDark: "/images/hero/banner-hero-poster-dark-01.png",
  },
  scrollIndicator: {
    enabled: true,
  },
};
