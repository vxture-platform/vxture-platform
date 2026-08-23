/**
 * CTA 结构数据 - 不包含翻译文本，只定义结构
 * @package @vxture/website
 * @layer Presentation
 * @category Data - Home
 */

/**
 * CTA 功能特性配置
 */
export interface CtaFeature {
  id: string;
  icon: string;
  theme: string;
}

/**
 * CTA 行动按钮配置
 */
export interface CtaAction {
  href: string;
  variant: string;
  icon: string;
  /**
   * 暂不可用：渲染成灰掉的按钮而不是链接。
   *
   * 在线沟通要接外部 chat，接之前既不能让它 404，也不该假装可点——按钮在
   * 但点不动，比点了跳到一个空路由清楚。
   */
  disabled?: boolean;
}

/**
 * CTA 联系方式配置
 */
export interface CtaContact {
  email: {
    icon: string;
    value: string;
  };
  phone: {
    icon: string;
    value: string;
  };
}

/**
 * CTA 完整数据结构
 */
export interface CtaData {
  enabled: boolean;
  titleKey: string;
  subtitleKey: string;
  features: CtaFeature[];
  actions: CtaAction[];
  contact: CtaContact;
}

/**
 * CTA 结构数据 - 使用 labelKey 映射翻译
 */
export const CTA_DATA: CtaData = {
  enabled: true,
  titleKey: "title",
  subtitleKey: "subtitle",
  features: [
    {
      id: "features-cta-01",
      icon: "layers",
      theme: "primary",
    },
    {
      id: "features-cta-02",
      icon: "users",
      theme: "primary",
    },
    {
      id: "features-cta-03",
      icon: "refresh",
      theme: "primary",
    },
  ],
  actions: [
    {
      href: "/contact",
      variant: "primary",
      icon: "calendar",
    },
    {
      // 原 /ruyin-agent 从来没有对应路由（2026-08-23 断链审计）。这个入口的
      // 真实意图是在线沟通，名字也不该带 agent——改 /livechat，等外接 chat
      // 落地再放开。
      href: "/livechat",
      variant: "secondary",
      icon: "bot",
      disabled: true,
    },
  ],
  contact: {
    email: {
      icon: "mail",
      value: "experts@vxture.com",
    },
    phone: {
      icon: "phone",
      value: "029-12345678",
    },
  },
};
