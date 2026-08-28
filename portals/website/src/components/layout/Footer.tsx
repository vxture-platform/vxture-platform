/**
 * Footer.tsx - 网站全局底部信息栏
 *
 * Presentation Layer - Component
 *
 * 职责：
 * - 展示网站全局底部栏 UI
 * - 使用 src/data/footer.data.ts 获取结构数据
 * - 使用 next-intl 进行翻译
 *
 * @layer Presentation
 * @category Components - Layout
 * @author AI-Generated
 * @date 2026-03-18
 */
"use client";

import { useState, useRef } from "react";
import { useTranslations } from "next-intl";
import { Button, useTheme, Icon } from "@vxture/design-system";
import { debugLog } from "@vxture-platform/shared";
import Image from "next/image";
import { FOOTER_DATA } from "@/data/layout/footer.data";
import { Link } from "@/lib/i18n/navigation";

export default function Footer() {
  const { theme } = useTheme();
  const isDarkMode = theme === "dark";
  const t = useTranslations("layout.footer");

  // 调试日志
  debugLog("Footer data:", FOOTER_DATA);

  // 微信二维码显示状态
  const [qrCodeVisible, setQrCodeVisible] = useState(false);
  // 微信图标 ref
  const wechatIconRef = useRef<HTMLElement>(null);

  // 设置微信图标 ref
  const setWechatIconRef = (el: HTMLElement | null) => {
    wechatIconRef.current = el;
  };

  // 如果 Footer 被禁用，不渲染
  if (!FOOTER_DATA.enabled) return null;

  // 渲染 Footer UI
  return (
    <footer
      className={`vx-website-footer flex w-full flex-col ${
        isDarkMode
          ? "text-vx-gray-200 bg-vx-gray-900"
          : "text-vx-gray-800 bg-vx-gray-100"
      }`}
    >
      <div className="flex flex-1 flex-col w-full max-w-7xl xl:max-w-screen-2xl mx-auto pt-8 px-4 sm:px-6 lg:px-8">
        {/* 主要内容区域：品牌 + 联系 + 社交 / 链接区 */}
        <div className="flex flex-1 flex-col md:flex-row gap-8 items-start">
          {/* 左侧：品牌信息 + 联系方式 */}
          <div className="vx-website-footer-brand flex min-w-50 flex-col">
            {/* 品牌标识 */}
            <span
              className={`text-lg font-semibold mb-4 ${isDarkMode ? "text-vx-white" : "text-vx-gray-700"}`}
            >
              {t(FOOTER_DATA.brand.nameKey)}
            </span>

            <ul className="space-y-2 text-sm text-vx-gray-600 leading-6">
              {/* 地址信息 */}
              {FOOTER_DATA.brand.addressKey && (
                <li className="flex items-center space-x-1">
                  <Icon name="map-pin" className="w-4 h-4 shrink-0" />
                  <span>{t(FOOTER_DATA.brand.addressKey)}</span>
                </li>
              )}

              {/* Contact Phone */}
              {FOOTER_DATA.contact.contact_phone && (
                <li className="flex items-center space-x-1">
                  <Icon name="phone" className="w-4 h-4 shrink-0" />
                  <span>{FOOTER_DATA.contact.contact_phone}</span>
                </li>
              )}

              {/* Service Email */}
              {FOOTER_DATA.contact.service_email && (
                <li className="flex items-center space-x-1">
                  <Icon name="mail" className="w-4 h-4 shrink-0" />
                  <a
                    href={`mailto:${FOOTER_DATA.contact.service_email}`}
                    className="hover:text-vx-primary transition-colors"
                  >
                    {FOOTER_DATA.contact.service_email}
                  </a>
                </li>
              )}

              {/* Partner Email */}
              {FOOTER_DATA.contact.partner_email && (
                <li className="flex items-center space-x-1">
                  <Icon name="mail" className="w-4 h-4 shrink-0" />
                  <a
                    href={`mailto:${FOOTER_DATA.contact.partner_email}`}
                    className="hover:text-vx-primary transition-colors"
                  >
                    {FOOTER_DATA.contact.partner_email}
                  </a>
                </li>
              )}
            </ul>
          </div>

          {/* 右侧：链接区（分区块展示） */}
          <div className="vx-website-footer-links flex flex-1 flex-col justify-between gap-8 md:flex-row">
            {FOOTER_DATA.sections.map((section) => (
              <div key={section.id} className="flex-1">
                <h3
                  className={`text-lg font-semibold mb-4 ${
                    isDarkMode ? "text-vx-white" : "text-vx-gray-700"
                  }`}
                >
                  {t(section.titleKey)}
                </h3>
                <ul className="space-y-2">
                  {section.links.map((link) => (
                    <li key={link.href}>
                      <a
                        href={link.href}
                        className={`text-sm hover:text-vx-primary transition-colors duration-300 ${
                          isDarkMode ? "text-vx-gray-400" : "text-vx-gray-600"
                        }`}
                      >
                        {t(link.labelKey)}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        {/* 社交链接 */}
        <div className="flex items-center py-4">
          {FOOTER_DATA.socialEnabled && FOOTER_DATA.social?.length > 0 && (
            <div className="flex space-x-4">
              {FOOTER_DATA.social.map((social) => (
                <div key={social.name} className="relative group">
                  {social.icon === "wechat" ? (
                    <Button
                      variant="ghost"
                      size="icon-md"
                      aria-label={t(social.ariaLabelKey)}
                      className="text-vx-gray-600 hover:text-vx-primary transition-colors"
                      onMouseEnter={() => setQrCodeVisible(true)}
                      onMouseLeave={() => setQrCodeVisible(false)}
                      ref={setWechatIconRef}
                    >
                      <Icon name="wechat" className="w-5 h-5" />
                    </Button>
                  ) : (
                    <a
                      href={social.href}
                      aria-label={t(social.ariaLabelKey)}
                      className="text-vx-gray-600 hover:text-vx-primary transition-colors"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {social.icon === "github" && (
                        <Icon name="github" className="w-5 h-5" />
                      )}
                      {social.icon === "linkedin" && (
                        <Icon name="linkedin" className="w-5 h-5" />
                      )}
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 微信二维码 */}
        {qrCodeVisible &&
          wechatIconRef.current &&
          (() => {
            const rect = wechatIconRef.current.getBoundingClientRect();
            const wechatData = FOOTER_DATA.social.find(
              (social) => social.icon === "wechat",
            );

            if (!wechatData) return null;

            return (
              <div
                className={`fixed p-2 rounded-lg shadow-lg z-50 ${
                  isDarkMode
                    ? "bg-vx-gray-800 border border-vx-gray-700"
                    : "bg-vx-surface border border-vx-gray-200"
                }`}
                style={{
                  left: rect.right,
                  top: rect.top,
                  transform: "translateY(-100%)",
                }}
              >
                <Image
                  src={wechatData.href}
                  alt={t(wechatData.ariaLabelKey)}
                  width={200}
                  height={200}
                  className="w-auto max-w-none h-48 object-contain"
                />
                <div className="mt-1 text-center text-xs text-vx-gray-600">
                  {t(wechatData.ariaLabelKey)}
                </div>
              </div>
            );
          })()}

        {/* 分割线 */}
        <div className="mt-auto flex items-center justify-between py-0 border-t border-vx-gray-300">
          {/* 底部信息：版权 + 法律 + 备案 */}
          <div className="flex w-full justify-between items-center py-4 text-sm text-vx-gray-600 flex-wrap gap-2">
            {/* 左侧：版权 */}
            <p className="whitespace-nowrap">
              {t(FOOTER_DATA.copyright.textKey)}
            </p>

            {/* 右侧：法律链接 + 备案信息 */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 justify-end">
              {FOOTER_DATA.legal?.length > 0 &&
                FOOTER_DATA.legal.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="hover:text-vx-primary transition-colors whitespace-nowrap"
                  >
                    {t(link.labelKey)}
                  </Link>
                ))}
              {t(FOOTER_DATA.icp.textKey) && (
                <a
                  href={FOOTER_DATA.icp.link}
                  className="hover:text-vx-primary transition-colors whitespace-nowrap"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t(FOOTER_DATA.icp.textKey)}
                </a>
              )}
              {t(FOOTER_DATA.publicSecurity.textKey) && (
                <a
                  href={FOOTER_DATA.publicSecurity.link}
                  className="hover:text-vx-primary transition-colors whitespace-nowrap"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t(FOOTER_DATA.publicSecurity.textKey)}
                </a>
              )}
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
