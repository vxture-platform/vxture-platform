/**
 * persistence.ts - 模式轴的持久化契约键。
 * @package @vxture/design-tokens
 * @layer Presentation
 * @category Tokens
 *
 * 本包已经拥有模式轴的**取值与类名**（`generated/modes.ts`：DENSITIES /
 * FONT_SIZES / densityClass / fontSizeClass）；这里补上同一件事的另一半——
 * 那些取值**存在哪、叫什么键**（localStorage / cookie / DOM 属性 / 广播事件）。
 *
 * 这两组常量原先住在 `@vxture/shared`（2026-08-21 迁入）。搬家的理由不是组织
 * 结构调整而是归属纠正：它们描述的是主题、密度、字号的持久化方式，是纯表现层
 * 契约，与订阅状态、角色值域那类平台业务词汇不是一回事。放在 shared 还带来一个
 * 结构后果——design-system 因此依赖 shared，使设计三包无法作为自足单元发布。
 *
 * 零运行时依赖，服务端与构建脚本可安全引入（主题引导脚本在 <head> 里同步执行，
 * 正是靠这一点）。
 */

/** 主题：持久化键、DOM 契约、可选值。 */
export const THEME_CONSTANTS = {
  /** localStorage key */
  STORAGE_KEY: "theme-storage",

  /** Cookie key */
  COOKIE_KEY: "vx-theme",

  /** HTML data-theme attribute */
  THEME_ATTRIBUTE: "data-theme",

  /** Dark mode class for TailwindCSS */
  DARK_CLASS: "dark",

  /** Default theme */
  DEFAULT_THEME: "system",

  /** Available themes */
  AVAILABLE_THEMES: [
    { name: "system", displayName: "跟随系统", isExplicitDark: false },
    { name: "light", displayName: "浅色", isExplicitDark: false },
    { name: "dark", displayName: "深色", isExplicitDark: true },
  ],
} as const;

/** 跨门户偏好同步：密度 / 字号的持久化键与广播契约。 */
export const PREFERENCE_CONSTANTS = {
  /** localStorage key used to broadcast the latest full preference snapshot */
  SYNC_STORAGE_KEY: "vx-user-preferences",

  /** Custom DOM event used for same-document preference updates */
  SYNC_EVENT: "vx:user-preferences",

  /** Cookie key used for density persistence across portals */
  DENSITY_COOKIE_KEY: "vx-density",

  /** localStorage key used for density persistence across portals */
  DENSITY_STORAGE_KEY: "vx-density",

  /** Cookie key used for font-size persistence across portals */
  FONTSIZE_COOKIE_KEY: "vx-fontsize",

  /** localStorage key used for font-size persistence across portals */
  FONTSIZE_STORAGE_KEY: "vx-fontsize",

  /**
   * Registrable parent domain for cross-subdomain preference cookies. Scoping a
   * cookie to `.vxture.com` lets every *.vxture.com portal (website / console /
   * accounts / admin …) share one preference. Same-domain cross-subdomain only —
   * never cross-domain (e.g. ruyin.ai). Host-only on localhost / IP.
   */
  COOKIE_DOMAIN: "vxture.com",

  /** 1 year cookie max-age */
  COOKIE_MAX_AGE: 60 * 60 * 24 * 365,
} as const;
