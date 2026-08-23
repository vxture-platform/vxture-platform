/**
 * page.tsx - 首页主内容区
 *
 * 功能：渲染首页核心区块，包括 Hero、Features、Solutions、Cases、CTA
 *
 * @author Stone Smoker
 * @created 2024-06-01
 * @lastModified 2026-03-03
 * @version 2.0.0
 * @copyright Copyright (c) 2024-2026 Vxture Team
 *
 * @layer Presentation
 * @category Pages
 */
"use client";

// ============================================================================
// 导入
// ============================================================================

import {
  HeroSection,
  FeaturesSection,
  ProductTiersSection,
  CaseSection,
  CTASection,
} from "@/components/marketing";
import ScrollToButton from "@/components/marketing/ScrollToButton";
import { SnapChoicePanel, SnapDebugPanel } from "@/components/marketing/debug";
import { useWindowScrollSnap } from "@/hooks";

// ============================================================================
// 常量定义
// ============================================================================

/** 区块信息列表 */
const SECTIONS = [
  { id: "section-01", name: "Hero" },
  { id: "section-02", name: "Features" },
  { id: "section-03", name: "ProductTiers" },
  { id: "section-04", name: "Cases" },
  { id: "section-05", name: "CTA" },
] as const;

/** 调试面板位置 */
const DEBUG_PANEL_POSITION = {
  top: "80px",
  right: "20px",
  zIndex: 50,
} as const;

/** 选择面板位置 */
const CHOICE_PANEL_POSITION = {
  top: "80px",
  left: "20px",
  zIndex: 50,
} as const;

/** 是否开发环境 */
const IS_DEVELOPMENT = process.env.NODE_ENV === "development";

// ============================================================================
// 组件实现
// ============================================================================

export default function HomePage() {
  // ==========================================================================
  // Hook 调用
  // ==========================================================================

  const { activeTarget, snapToTarget, snapdebugInfo } = useWindowScrollSnap({
    debugFlag: IS_DEVELOPMENT,
    targetSelector: ".snap-section",
    targetAlignTo: "top",
    snapThreshold: 280,
    enabledDirections: ["up", "down"],
  });

  // ==========================================================================
  // 渲染
  // ==========================================================================

  return (
    <div className="relative">
      {/* 调试面板信息组件 */}
      <SnapDebugPanel
        position={DEBUG_PANEL_POSITION}
        visible={IS_DEVELOPMENT}
        {...(snapdebugInfo ? { snapdebugInfo } : {})}
      />

      {/* 吸附选择调试组件 */}
      <SnapChoicePanel
        sections={SECTIONS}
        activeTarget={activeTarget}
        snapToTarget={snapToTarget}
        position={CHOICE_PANEL_POSITION}
        visible={IS_DEVELOPMENT}
      />

      {/* Hero 区块 */}
      <HeroSection id={SECTIONS[0].id} name={SECTIONS[0].name} />

      {/* Features 区块 */}
      <FeaturesSection id={SECTIONS[1].id} name={SECTIONS[1].name} />

      {/* 产品体系区块 */}
      <ProductTiersSection id={SECTIONS[2].id} name={SECTIONS[2].name} />

      {/* Cases 区块 */}
      <CaseSection id={SECTIONS[3].id} name={SECTIONS[3].name} />

      {/* CTA 区块 */}
      <CTASection id={SECTIONS[4].id} name={SECTIONS[4].name} />

      {/* 滚动到顶部按钮 */}
      <ScrollToButton snapToTarget={snapToTarget} />
    </div>
  );
}
