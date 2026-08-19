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
    // 亮色 = 雾山实景(webp);暗色 = 程序化六边形 SVG(约4KB,替代 653KB PNG)。
    // 视频背景 2026-08-19 起未启用,15MB mp4/webm 资产已删——重新启用时补文件并
    // 恢复 type:"video" + videoUrl/posterImage* 字段(组件 video 分支仍在)。
    url: "/images/hero/banner-hero-poster-light-01.webp",
    urlDark: "/images/hero/banner-hero-dark-01.svg",
  },
  scrollIndicator: {
    enabled: true,
  },
};
