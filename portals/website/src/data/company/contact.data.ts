/**
 * contact.data.ts - 公司联系方式与联系页结构（唯一数据源）
 *
 * The phone number and mailboxes used to be duplicated between the footer and
 * the contact copy, and they had already drifted apart (the messages file still
 * carried a Beijing address and an unrelated 400 number). They live here now and
 * both consumers read from this file.
 *
 * Text stays in messages/{locale}/company/contact.json — only values and
 * structure live here.
 *
 * @package @vxture/website
 * @layer Presentation
 * @category Data - Company
 * @author AI-Generated
 * @date 2026-08-22
 */

import type { IconName } from "@vxture/design-system";

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 联系方式取值
 */
export interface CompanyContact {
  readonly contact_phone: string;
  readonly service_email: string;
  readonly partner_email: string;
}

/**
 * 联系板块（售前售后 = 客户用户 / 生态合作 = 合作伙伴）
 *
 * The accent is carried as **complete utility class strings**, not as a hue name
 * the component interpolates: Tailwind only emits rules for class names it can
 * see literally in the source, so `text-vx-${hue}-600` would produce nothing —
 * silently, with no build error.
 */
export interface ContactChannel {
  /** i18n key under `company.contact.channels.*`. */
  readonly id: string;
  /** Foreground icon, rendered large enough to span both header lines. */
  readonly icon: IconName;
  /** Oversized watermark in the card's top-right, inset with clear margin. */
  readonly artIcon: IconName;
  /** Utility class colouring the watermark. */
  readonly artClass: string;
  /** Utility class colouring the icon chip. */
  readonly chipClass: string;
  /** Utility class colouring the contact-line icons. */
  readonly inkClass: string;
  /** Which mailbox this panel routes to. */
  readonly email: "service" | "partner";
}

// ============================================================================
// 数据
// ============================================================================

/** 联系方式唯一取值来源。 */
export const COMPANY_CONTACT: CompanyContact = {
  contact_phone: "400-888-2345",
  service_email: "support@vxture.com",
  partner_email: "partner@vxture.com",
};

/**
 * 两张卡，顺序即左右顺序。
 *
 * 两者是**受众之分**，不是业务之分：左边是已经在用或准备用产品的客户用户，
 * 右边是要一起为行业做事的合作伙伴。两边目前共用同一条热线（未来会分开），
 * 所以电话重复出现是有意的，不是漏改。
 */
export const CONTACT_CHANNELS: readonly ContactChannel[] = [
  {
    id: "support",
    icon: "headset",
    artIcon: "chat-circle",
    artClass: "text-vx-brand-500/10",
    chipClass: "bg-vx-brand-50 text-vx-brand-600 dark:bg-vx-brand-950/50",
    inkClass: "text-vx-brand-500",
    email: "service",
  },
  {
    id: "ecosystem",
    icon: "puzzle",
    artIcon: "plugs-connected",
    artClass: "text-vx-success-500/10",
    chipClass: "bg-vx-success-50 text-vx-success-600 dark:bg-vx-success-900/40",
    inkClass: "text-vx-success-500",
    email: "partner",
  },
];
