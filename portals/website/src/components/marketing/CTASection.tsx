/**
 * CTASection.tsx - 首页行动号召区块（重构版）
 *
 * 功能：展示首页 CTA 区块 UI，使用 data + messages 分离架构
 *
 * @author vxture team
 * @created 2024-06-01
 * @lastModified 2026-03-19
 * @version 2.2.0
 * @copyright Copyright (c) 2024-2026 Vxture Team
 *
 * @layer Presentation
 * @category Components - Home
 */
"use client";

import { Link } from "@/lib/i18n/navigation";
import { useTranslations } from "next-intl";
import { debugLog } from "@vxture-platform/shared";
import { Icon } from "@vxture/design-system";
import { CTA_DATA } from "@/data/home/home.cta.data";

// ============================================================================
// 类型定义
// ============================================================================

interface CTASectionProps {
  readonly id: string;
  readonly name?: string;
}

// ============================================================================
// 主组件实现
// ============================================================================

/**
 * 首页行动号召区块
 *
 * 背景渐变：section 5（CTA）
 *   light: from-vx-brand-50 to-vx-white   （上接 Cases 浅蓝，向下收尾至白）
 *   dark:  from-vx-gray-700 to-vx-gray-800
 */
export default function CTASection({ id, name = "CTA" }: CTASectionProps) {
  const t = useTranslations("home.cta");

  debugLog("CTA data:", CTA_DATA);

  if (!CTA_DATA.enabled) {
    return null;
  }

  return (
    <section
      id={id}
      data-name={name}
      className="vx-section-even vx-website-cta-section relative snap-section flex flex-col justify-center"
    >
      {/* ===== 主内容区 ===== */}
      <div className="flex flex-col justify-center w-full h-full max-w-7xl xl:max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        {/* ===== CTA 标题区 ===== */}
        <div className="w-full text-center">
          {/* 主标题 */}
          <h2 className="font-display text-4xl lg:text-5xl font-bold pt-20 pb-6 text-vx-brand-700 dark:text-vx-brand-200">
            {t(CTA_DATA.titleKey)}
          </h2>
          {/* 副标题 */}
          <p className="text-lg lg:text-xl text-vx-gray-600 dark:text-vx-gray-300 py-6 leading-relaxed">
            {t(CTA_DATA.subtitleKey)}
          </p>
        </div>

        {/* ===== CTA 按钮区 ===== */}
        <div className="w-full flex flex-col sm:flex-row gap-8 justify-center items-center py-6">
          {CTA_DATA.actions.map((action, index) => {
            const isExternal = action.href.startsWith("http");
            const buttonClass = `vx-website-cta-action group px-8 py-4 font-semibold rounded-xl transition-all duration-300 hover:scale-105 ${
              action.variant === "primary"
                ? "bg-gradient-to-r from-vx-brand-600 to-vx-info-500 text-vx-white hover:from-vx-brand-700 hover:to-vx-info-600 hover:shadow-2xl"
                : "border-2 border-vx-brand-200 dark:border-vx-gray-500 text-vx-brand-700 dark:text-vx-gray-200 hover:border-vx-brand-500 hover:text-vx-brand-600 dark:hover:border-vx-brand-400 dark:hover:text-vx-brand-200 hover:shadow-lg"
            }`;
            const buttonContent = (
              <span className="flex items-center justify-center space-x-2">
                {action.variant === "secondary" && (
                  <Icon name="chat-circle" className="w-5 h-5" />
                )}
                <span>{t(`actions.${index}.label`)}</span>
                {action.variant === "primary" && (
                  <Icon
                    name="arrow-right"
                    className="w-5 h-5 group-hover:translate-x-1 transition-transform duration-300"
                  />
                )}
              </span>
            );

            // 暂不可用的入口渲染成灰掉的 span，而不是链接：按钮在但点不动，
            // 比点了跳进一个不存在的路由清楚。
            if (action.disabled) {
              return (
                <span
                  key={action.href}
                  aria-disabled="true"
                  className={`vx-website-cta-action group px-8 py-4 font-semibold rounded-xl border-2 border-vx-gray-200 text-vx-gray-400 cursor-not-allowed dark:border-vx-gray-700 dark:text-vx-gray-500`}
                >
                  {buttonContent}
                </span>
              );
            }

            if (isExternal) {
              return (
                <a
                  key={action.href}
                  href={action.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={buttonClass}
                >
                  {buttonContent}
                </a>
              );
            }
            return (
              <Link
                key={action.href}
                href={action.href}
                className={buttonClass}
              >
                {buttonContent}
              </Link>
            );
          })}
        </div>

        {/* ===== 联系方式区 ===== */}
        {CTA_DATA.contact && (
          <div className="w-full py-6 rounded-2xl border border-vx-brand-100 dark:border-vx-gray-600">
            <p className="text-center text-vx-gray-600 dark:text-vx-gray-300 mb-4">
              {t("contact.description")}
            </p>
            <div className="flex flex-col sm:flex-row gap-6 justify-center items-center text-sm">
              {CTA_DATA.contact.email && (
                <div className="flex items-center space-x-2 text-vx-gray-700 dark:text-vx-gray-200">
                  <Icon
                    name="mail"
                    className="w-4 h-4 text-vx-brand-500 dark:text-vx-brand-300"
                  />
                  <span>{CTA_DATA.contact.email.value}</span>
                </div>
              )}
              {CTA_DATA.contact.phone && (
                <div className="flex items-center space-x-2 text-vx-gray-700 dark:text-vx-gray-200">
                  <Icon
                    name="phone"
                    className="w-4 h-4 text-vx-brand-500 dark:text-vx-brand-300"
                  />
                  <span>{CTA_DATA.contact.phone.value}</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
