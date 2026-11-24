"use client";

/**
 * Familiar application workspace with customer branding and local filtering.
 * @package @vxture/customer-portal
 * @layer Presentation
 * @category module
 * @author AI-Generated
 * @date 2026-11-15
 */
import { startSessionSync } from "@vxture/core-identity-sdk";
import { useEffect, useState, type CSSProperties } from "react";
import { Button, Icon, Input } from "@vxture/design-system";
import type { PortalBrand, WorkspaceData } from "../lib/contracts";
import { BrandIdentity } from "./BrandIdentity";
import { ResearchArtwork } from "./ResearchArtwork";

/** Render application links supplied only by the authenticated server projection. */
export function WorkspacePage({
  brand,
  data: initialData,
  designPreview = false,
}: {
  brand: PortalBrand;
  data: WorkspaceData;
  designPreview?: boolean;
}) {
  const [data, setData] = useState(initialData);
  useEffect(() => {
    if (designPreview) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("vx_sso_checked");
    window.history.replaceState(null, "", url.href);
    const sync = startSessionSync(async (signal) => {
      const response = await fetch("/api/portal/workspace", {
        credentials: "same-origin",
        cache: "no-store",
        signal,
      });
      if (signal.aborted) return "unavailable";
      if (
        response.status === 401 ||
        response.status === 403 ||
        response.status === 404
      ) {
        window.location.replace(
          response.status === 403 ? "/?access=denied" : "/",
        );
        return "anonymous";
      }
      if (!response.ok) return "unavailable";
      const current = (await response.json()) as WorkspaceData;
      if (
        signal.aborted ||
        !Array.isArray(current.apps) ||
        typeof current.name !== "string"
      )
        return "unavailable";
      setData(current);
      return "active";
    });
    return sync.stop;
  }, [designPreview]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("全部应用");
  const categories = [
    "全部应用",
    ...new Set(data.apps.map((app) => app.category)),
  ];
  const apps = data.apps.filter(
    (app) =>
      (category === "全部应用" || category === app.category) &&
      `${app.name} ${app.description}`
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase().trim()),
  );
  return (
    <div
      className="research-workspace"
      data-density={brand.density}
      style={{ "--portal-brand": brand.brandColor } as CSSProperties}
    >
      <a className="research-skip" href="#workspace-main">
        跳到主要内容
      </a>
      <header className="research-work-header">
        <BrandIdentity brand={brand} />
        <nav className="research-work-nav" aria-label="主导航">
          <a href="/workspace" aria-current="page">
            工作台
          </a>
          <a href="#applications">应用中心</a>
        </nav>
        <div className="research-work-account">
          <a href={designPreview ? "/" : "/auth/logout"}>
            {designPreview ? "返回首页" : "退出登录"}
          </a>
          <span>
            <Icon name="user" size="sm" />
          </span>
        </div>
      </header>
      <main className="research-work-main" id="workspace-main">
        <section className="research-work-welcome">
          <div>
            <p>欢迎回来，{data.name}</p>
            <h1>专注探索，让想法向前一步。</h1>
          </div>
          <span className="research-work-scope">
            <Icon name="buildings" size="sm" />
            {brand.name}
            <span aria-hidden="true">/</span>
            {data.workspaceName}
          </span>
        </section>
        <section className="research-work-banner">
          <span>CONNECTED INTELLIGENCE</span>
          <h2>专业所长，皆为所用。</h2>
          <p>让知识流动，让数据连接，让智能成为日常工作的力量。</p>
          <ResearchArtwork />
        </section>

        {/* Search and categories operate on the authorized projection, never a global catalog. */}
        <section
          className="research-work-section"
          id="applications"
          aria-labelledby="applications-title"
        >
          <div className="research-work-section-heading">
            <div>
              <h2 id="applications-title">我的应用</h2>
              <p>连接专业能力，从这里开始工作</p>
            </div>
            <label className="research-search">
              <Icon name="search" size="sm" />
              <Input
                type="search"
                aria-label="搜索应用"
                placeholder="搜索应用"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
          </div>
          <div className="research-app-filters" aria-label="应用分类">
            {categories.map((item) => (
              <Button
                variant="ghost"
                size="sm"
                key={item}
                type="button"
                aria-pressed={category === item}
                onClick={() => setCategory(item)}
              >
                {item}
              </Button>
            ))}
          </div>
          <div className="research-app-grid">
            {apps.map((app, index) => (
              <article className="research-app-card" key={app.code}>
                <div className="research-app-heading">
                  <span className="research-app-icon">
                    <Icon
                      name={
                        index % 3 === 0
                          ? "book-open"
                          : index % 3 === 1
                            ? "database"
                            : "sparkles"
                      }
                      size="lg"
                    />
                  </span>
                  <div>
                    <h3>{app.name}</h3>
                    <p>{app.code.toUpperCase()}</p>
                  </div>
                </div>
                <p className="research-app-description">{app.description}</p>
                <div className="research-app-bottom">
                  <span className="research-app-category">{app.category}</span>
                  {app.href ? (
                    <a
                      className="research-app-launch"
                      href={app.href}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      进入应用
                      <Icon name="external-link" size="sm" />
                    </a>
                  ) : (
                    <span className="research-app-launch">
                      应用入口
                      <Icon name="external-link" size="sm" />
                    </span>
                  )}
                </div>
              </article>
            ))}
            {apps.length === 0 && (
              <div className="research-work-empty" role="status">
                {query || category !== "全部应用"
                  ? "没有找到匹配的应用"
                  : "当前工作空间暂无可用应用"}
              </div>
            )}
          </div>
        </section>
        <p className="research-work-hint">
          <Icon name="shield" size="sm" />
          应用访问权限由组织统一管理。如需开通更多应用，请联系组织管理员。
        </p>
        <footer className="research-work-footer">
          <span>{brand.name} · 智能应用门户</span>
          <span>由 VXTURE 提供平台服务</span>
        </footer>
      </main>
    </div>
  );
}
