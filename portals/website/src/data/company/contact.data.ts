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
 * 联系板块（售前售后 / 生态合作）
 *
 * The accent is carried as **complete utility class strings**, not as a hue name
 * the component interpolates: Tailwind only emits rules for class names it can
 * see literally in the source, so `text-vx-${hue}-600` would produce nothing —
 * silently, with no build error.
 */
export interface ContactChannel {
  /** i18n key under `company.contact.channels.*`. */
  readonly id: string;
  /** Foreground icon on the badge. */
  readonly icon: IconName;
  /** Oversized watermark tucked behind the card's top-right corner. */
  readonly artIcon: IconName;
  /** Utility class colouring the watermark. */
  readonly artClass: string;
  /** Utility class colouring the check marks. */
  readonly inkClass: string;
  /** Which mailbox this panel routes to. */
  readonly email: "service" | "partner";
  /** Whether to show the shared hotline on this panel. */
  readonly showPhone: boolean;
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

/** 两个板块，顺序即左右顺序。 */
export const CONTACT_CHANNELS: readonly ContactChannel[] = [
  {
    id: "support",
    icon: "headset",
    artIcon: "chat-circle",
    artClass: "text-vx-brand-500/10",
    inkClass: "text-vx-brand-500",
    email: "service",
    showPhone: true,
  },
  {
    id: "ecosystem",
    icon: "puzzle",
    artIcon: "plugs-connected",
    artClass: "text-vx-success-500/10",
    inkClass: "text-vx-success-500",
    email: "partner",
    showPhone: false,
  },
];

/**
 * 底部公司信息条的三项。
 *
 * `artIcon` is deliberately a different glyph from `icon`: the watermark reads
 * as decoration only when it is not the same shape as the chip in front of it.
 */
export const CONTACT_FACTS: ReadonlyArray<{
  id: string;
  icon: IconName;
  artIcon: IconName;
}> = [
  { id: "address", icon: "map-pin", artIcon: "buildings" },
  { id: "hours", icon: "clock", artIcon: "calendar" },
  { id: "response", icon: "timer", artIcon: "lightning" },
];
