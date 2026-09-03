/**
 * page.tsx - Content Registry 路由入口
 * @package @vxture/website
 * @layer Presentation
 * @category Pages - Content
 * @author AI-Generated
 * @date 2026-05-06
 */

import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Link } from "@/lib/i18n/navigation";
import { ComingSoonPage } from "@/components/marketing";
import type { ComingSoonAccent } from "@/components/marketing";
import type { IconName } from "@vxture/design-system";
import {
  CONTENT_REGISTRY,
  isContentSection,
  aggregateContentStaticParams,
} from "@/lib/content";
import type { ContentEntry, LegalDetailEntry, StubEntry } from "@/lib/content";

// =============================================================================
// 静态生成
// =============================================================================

export const dynamicParams = false;

export async function generateStaticParams() {
  return aggregateContentStaticParams();
}

// =============================================================================
// 渲染分区：Legal
// =============================================================================

async function renderLegalIndex() {
  const t = await getTranslations("legal");
  type LegalPolicySummary = {
    label: string;
    title: string;
    summary: string;
    updatedAt: string;
  };
  const POLICY_KEYS = [
    "terms",
    "privacy",
    "copyright",
    "brand",
    "cookies",
    "refund",
  ] as const;

  return (
    <section className="vx-legal-page">
      <div className="vx-legal-container">
        <header className="vx-legal-hero">
          <span>{t("eyebrow")}</span>
          <h1>{t("index.title")}</h1>
          <p>{t("index.description")}</p>
        </header>
        <div className="vx-legal-grid" aria-label={t("index.title")}>
          {POLICY_KEYS.map((key) => {
            const policy = t.raw(`policies.${key}`) as LegalPolicySummary;
            return (
              <Link key={key} href={`/legal/${key}`} className="vx-legal-card">
                <span>{policy.label}</span>
                <strong>{policy.title}</strong>
                <p>{policy.summary}</p>
                <small>{t("updatedAt", { date: policy.updatedAt })}</small>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}

async function renderLegalDetail({ policyKey }: LegalDetailEntry) {
  const t = await getTranslations("legal");
  type LegalPolicy = {
    label: string;
    title: string;
    summary: string;
    updatedAt: string;
    notice: string;
    sections: Array<{ heading: string; body: string[] }>;
  };
  const policy = t.raw(`policies.${policyKey}`) as LegalPolicy;

  return (
    <article className="vx-legal-page">
      <div className="vx-legal-container vx-legal-document">
        <nav className="vx-legal-breadcrumb" aria-label={t("breadcrumbLabel")}>
          <Link href="/legal">{t("index.title")}</Link>
          <span>/</span>
          <span>{policy.label}</span>
        </nav>
        <header className="vx-legal-hero vx-legal-document__hero">
          <span>{policy.label}</span>
          <h1>{policy.title}</h1>
          <p>{policy.summary}</p>
          <small>{t("updatedAt", { date: policy.updatedAt })}</small>
        </header>
        <aside className="vx-legal-notice">{policy.notice}</aside>
        <div className="vx-legal-sections">
          {policy.sections.map((section) => (
            <section key={section.heading} className="vx-legal-section">
              <h2>{section.heading}</h2>
              {section.body.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </section>
          ))}
        </div>
      </div>
    </article>
  );
}

// =============================================================================
// 渲染分区：Blog（占位）
// =============================================================================

async function renderBlogIndex() {
  return renderComingSoon("blog");
}

// =============================================================================
// 渲染分区：Stub
// =============================================================================

/**
 * 区段 → 图标与强调色。文案在 messages 的 common.comingSoon.sections.*。
 *
 * 全站占位页只有一种长相（owner 2026-08-23 定：不容许两套或更多），形状统一
 * 由 ComingSoonPage 给出，这里只给区段之间的辨识度。
 */
const STUB_LOOK: Record<string, { icon: IconName; accent: ComingSoonAccent }> =
  {
    docs: { icon: "book-open", accent: "brand" },
    faq: { icon: "help", accent: "sky" },
    support: { icon: "headset", accent: "sky" },
    insights: { icon: "chart-line-up", accent: "emerald" },
    careers: { icon: "user-plus", accent: "amber" },
    certifications: { icon: "certificate", accent: "brand" },
    changelog: { icon: "list-checks", accent: "sky" },
    blog: { icon: "newspaper", accent: "emerald" },
  };

async function renderComingSoon(section: string) {
  const t = await getTranslations("comingSoon");
  const look = STUB_LOOK[section] ?? { icon: "file-text", accent: "brand" };

  return (
    <ComingSoonPage
      icon={look.icon}
      accent={look.accent}
      eyebrow={t("eyebrow")}
      title={t(`sections.${section}.name`)}
      subtitle={t("subtitle")}
      description={t(`sections.${section}.description`)}
      primaryAction={{ href: "/contact", label: t("action") }}
      backAction={{ href: "/", label: t("back") }}
    />
  );
}

function renderStub({ section }: StubEntry) {
  return renderComingSoon(section);
}

// =============================================================================
// 入口：按 ContentEntry 类型分发渲染
// =============================================================================

async function renderEntry(entry: ContentEntry): Promise<React.ReactElement> {
  switch (entry.type) {
    case "legal-index":
      return renderLegalIndex();
    case "legal-detail":
      return renderLegalDetail(entry);
    case "blog-index":
      return renderBlogIndex();
    case "blog-post":
      notFound();
    case "stub":
      return renderStub(entry);
  }
}

// =============================================================================
// 页面组件
// =============================================================================

interface ContentRouteProps {
  params: { locale: string; slug: string[] };
}

export default async function ContentRoutePage({ params }: ContentRouteProps) {
  const [section, ...rest] = params.slug ?? [];

  if (!section || !isContentSection(section)) notFound();

  const config = CONTENT_REGISTRY[section];
  const entry = await config.loader(rest, params.locale);
  if (!entry) notFound();

  return renderEntry(entry);
}
