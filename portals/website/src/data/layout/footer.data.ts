/**
 * Footer 结构数据 - 不包含翻译文本，只定义结构
 * @package @vxture/website
 * @layer Presentation
 * @category Data - Layout
 */

import { COMPANY_CONTACT } from "@/data/company/contact.data";

/**
 * 品牌信息配置
 */
export interface FooterBrand {
  logo: string;
  shortname: string;
  website: string;
  foundedYear: string;
  timezone: string;
  nameKey: string;
  descriptionKey: string;
  addressKey: string;
}

/**
 * 联系方式配置
 */
export interface FooterContact {
  contact_phone: string;
  service_email: string;
  partner_email: string;
}

/**
 * 社交链接配置
 */
export interface FooterSocial {
  name: string;
  icon: string;
  href: string;
  ariaLabelKey: string;
}

/**
 * 链接区块配置
 */
export interface FooterSection {
  id: string;
  titleKey: string;
  links: Array<{
    href: string;
    labelKey: string;
  }>;
}

/**
 * 法律链接配置
 */
export interface FooterLegal {
  href: string;
  labelKey: string;
}

/**
 * 备案信息配置
 */
export interface FooterIcp {
  textKey: string;
  link: string;
}

/**
 * 版权信息配置
 */
export interface FooterCopyright {
  startYear: number;
  endYear: number;
  companyName: string;
  allRightsReserved: boolean;
  textKey: string;
}

/**
 * Footer 完整数据结构
 */
export interface FooterData {
  enabled: boolean;
  brand: FooterBrand;
  contact: FooterContact;
  social: FooterSocial[];
  /** 社交入口显示开关(owner 2026-08-18 判:显示层删除,数据与组件保留备用)。 */
  socialEnabled: boolean;
  sections: FooterSection[];
  legal: FooterLegal[];
  icp: FooterIcp;
  publicSecurity: FooterIcp;
  copyright: FooterCopyright;
}

/**
 * Footer 结构数据 - 使用 labelKey 映射翻译
 */
export const FOOTER_DATA: FooterData = {
  enabled: true,
  brand: {
    logo: "/favicon.ico",
    shortname: "vxture",
    website: "vxture.ai",
    foundedYear: "2024",
    timezone: "GMT+8",
    nameKey: "brand.name",
    descriptionKey: "brand.description",
    addressKey: "brand.address",
  },
  // 取值来自 data/company/contact.data.ts —— 页脚与联系页共用一份，不各写各的。
  contact: COMPANY_CONTACT,
  socialEnabled: false,
  social: [
    {
      name: "GitHub",
      icon: "github",
      href: "https://github.com/stonesmoker/vxture",
      ariaLabelKey: "social.github",
    },
    {
      name: "LinkedIn",
      icon: "linkedin",
      href: "https://linkedin.com/company/stonesmoker",
      ariaLabelKey: "social.linkedin",
    },
    {
      name: "WeChat",
      icon: "wechat",
      href: "/images/footer/WeChatOfficialAccounts.webp",
      ariaLabelKey: "social.wechat",
    },
  ],
  sections: [
    {
      id: "products-services",
      titleKey: "sections.products.title",
      links: [
        { href: "/appcenter", labelKey: "sections.products.appcenter" },
        { href: "/products", labelKey: "sections.products.products" },
        { href: "/solutions", labelKey: "sections.products.solutions" },
        { href: "/cases", labelKey: "sections.products.cases" },
      ],
    },
    {
      id: "resources-support",
      titleKey: "sections.support.title",
      links: [
        { href: "/docs", labelKey: "sections.support.docs" },
        { href: "/faq", labelKey: "sections.support.faq" },
        { href: "/support", labelKey: "sections.support.technology" },
        { href: "/insights", labelKey: "sections.support.insights" },
      ],
    },
    {
      id: "about-us",
      titleKey: "sections.company.title",
      links: [
        { href: "/about", labelKey: "sections.company.introduction" },
        {
          href: "/certifications",
          labelKey: "sections.company.certifications",
        },
        { href: "/careers", labelKey: "sections.company.careers" },
        { href: "/contact", labelKey: "sections.company.contact" },
      ],
    },
  ],
  legal: [
    { href: "/legal/terms", labelKey: "legal.terms" },
    { href: "/legal/privacy", labelKey: "legal.privacy" },
    { href: "/legal/copyright", labelKey: "legal.copyright" },
    { href: "/legal/brand", labelKey: "legal.brand" },
    { href: "/legal/cookies", labelKey: "legal.cookies" },
  ],
  icp: {
    textKey: "icp.text",
    link: "https://beian.miit.gov.cn",
  },
  publicSecurity: {
    textKey: "publicSecurity.text",
    link: "https://beian.mps.gov.cn",
  },
  copyright: {
    startYear: 2024,
    endYear: 2026,
    companyName: "Vxture Studio",
    allRightsReserved: true,
    textKey: "copyright.text",
  },
};
