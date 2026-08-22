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
import { FooterPlaceholderPage } from "@/components/marketing/FooterPlaceholderPage";
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
  return <FooterPlaceholderPage title="Blog" />;
}

// =============================================================================
// 渲染分区：Stub
// =============================================================================

// 区段标识 → 显示标题映射（占位阶段，未来迁移至 i18n）
const STUB_TITLES: Record<string, string> = {
  faq: "FAQ",
  support: "支持中心",
  insights: "行业洞察",
  careers: "加入我们",
  certifications: "认证与合规",
  changelog: "更新日志",
};

function renderStub({ section }: StubEntry) {
  const title = STUB_TITLES[section] ?? section;
  return <FooterPlaceholderPage title={title} />;
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
