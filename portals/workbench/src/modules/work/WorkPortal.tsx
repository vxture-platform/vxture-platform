"use client";

/**
 * Production portal orchestration with explicit login, outage and empty states.
 * @package @vxture/workbench
 * @layer Presentation
 * @category module
 * @author AI-Generated
 * @date 2026-11-05
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button, Drawer, Icon } from "@vxture/design-system";
import { loadWorkData } from "../../lib/api";
import { authNavigation } from "../../lib/navigation";
import type {
  LoadResult,
  WorkApp,
  WorkData,
  WorkRuntime,
} from "../../lib/contracts";
import type { HomeCopy } from "../../lib/presentation";
import {
  appVersion,
  homeApps,
  RELEASE_LABELS,
  TIER_LABELS,
} from "../../lib/presentation";
import { buildConsoleEntry } from "../../lib/console-entry";
import { WorkHeader } from "./WorkHeader";
import { TitleRegion } from "./TitleRegion";
import { AppCard, AppCatalog } from "./AppCatalog";
import { LoginPage } from "./LoginPage";
import { NotificationDrawer } from "./NotificationDrawer";

// ============================================================================
// Data lifecycle and public login state
// ============================================================================
/**
 * Keep authenticated data in memory only and reload after real RP transitions.
 * @param props - Server-validated public runtime and configurable daily copy.
 * @returns The Work portal with one shared detail drawer.
 */
export function WorkPortal({
  runtime,
  copy,
  initialTime,
}: {
  runtime: WorkRuntime;
  copy: HomeCopy;
  initialTime: string;
}): React.JSX.Element | null {
  const pathname = usePathname();
  const appsPage = pathname === "/apps";
  const knownRoute = pathname === "/" || appsPage;
  const [now, setNow] = useState(() => new Date(initialTime));
  const [result, setResult] = useState<LoadResult<WorkData> | null>(null);
  const [revision, setRevision] = useState(0);
  const [overview, setOverview] = useState<WorkApp | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const detailsOrigin = useRef<HTMLElement | null>(null);
  const rememberDetailsOrigin = (): void => {
    detailsOrigin.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
  };
  const showOverview = (app: WorkApp): void => {
    rememberDetailsOrigin();
    setOverview(app);
    setDetailsOpen(true);
  };
  const closeDetails = (): void => {
    setDetailsOpen(false);
  };
  useEffect(() => {
    if (detailsOpen || !detailsOrigin.current) return;
    let frame = 0;
    // The portal remains mounted through its exit animation; restore focus afterwards.
    const restore = (): void => {
      if (document.querySelector(".work-detail-drawer")) return;
      observer.disconnect();
      frame = requestAnimationFrame(() => {
        if (detailsOrigin.current?.isConnected) detailsOrigin.current.focus();
      });
    };
    const observer = new MutationObserver(restore);
    observer.observe(document.body, { childList: true, subtree: true });
    restore();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [detailsOpen]);
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!runtime.authConfigured || !knownRoute) return;
    const controller = new AbortController();
    setResult(null);
    void loadWorkData(controller.signal, runtime.catalogConfigured)
      .then((value) => {
        if (!controller.signal.aborted) setResult(value);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setResult({
            status: "error",
            code: 0,
            message: "连接失败，请稍后重试",
          });
      });
    return () => controller.abort();
  }, [runtime.authConfigured, runtime.catalogConfigured, revision, knownRoute]);
  useEffect(() => {
    setDetailsOpen(false);
    setNotificationsOpen(false);
  }, [appsPage]);
  const data = result?.status === "ready" ? result.data : null;
  const checking = runtime.authConfigured && result === null;
  const catalog = data?.catalog;
  const common = catalog?.status === "ready" ? homeApps(catalog.data) : [];
  const signIn = (): void => {
    window.location.assign(authNavigation("login", location.href));
  };
  const retry = (): void => setRevision((value) => value + 1);

  if (!knownRoute) return null;

  // ========================================================================
  // Shared page frame and authenticated content
  // ========================================================================
  return (
    <div
      id="workbench-root"
      className={`work-shell ${!data && !checking ? "work-shell-public" : ""}`}
    >
      <a className="work-skip" href="#main">
        跳到主要内容
      </a>
      <WorkHeader
        data={data}
        apps={appsPage}
        runtime={runtime}
        pending={checking}
        onNotifications={() => setNotificationsOpen(true)}
        onHelp={() => {
          rememberDetailsOrigin();
          setOverview(null);
          setDetailsOpen(true);
        }}
      />
      {!data && !checking ? (
        <LoginPage
          runtime={runtime}
          error={result?.status === "error" ? result : null}
          retry={retry}
          signIn={signIn}
        />
      ) : (
        <main id="main" className="work-main" aria-busy={checking || undefined}>
          {checking ? (
            <div className="work-loading" role="status">
              <span className="work-loading-line" />
              <span className="work-loading-title" />
              <p>正在载入工作空间…</p>
              <div className="work-app-grid">
                {[0, 1, 2].map((item) => (
                  <div key={item} className="work-card-skeleton" />
                ))}
              </div>
            </div>
          ) : (
            data && (
              <>
                <TitleRegion
                  name={data.user.name}
                  now={now}
                  copy={copy}
                  apps={appsPage}
                />
                {data.availabilityIssue && (
                  <div role="status" className="work-status">
                    应用可用状态暂无法确认：{data.availabilityIssue}
                    <Button size="sm" variant="ghost" onClick={retry}>
                      重试
                    </Button>
                  </div>
                )}
                {catalog?.status === "error" ? (
                  <div role="alert" className="work-empty">
                    <p>{catalog.message}</p>
                    <Button size="sm" variant="secondary" onClick={retry}>
                      重新加载
                    </Button>
                  </div>
                ) : appsPage ? (
                  <AppCatalog
                    apps={catalog?.status === "ready" ? catalog.data : []}
                    onOverview={showOverview}
                  />
                ) : (
                  <>
                    <section
                      aria-labelledby="common-apps"
                      className="work-common-apps"
                    >
                      <div className="work-section-heading">
                        <div>
                          <h2 id="common-apps">常用应用</h2>
                          <p>专业能力，随时进入</p>
                        </div>
                        <Link className="work-section-link" href="/apps">
                          全部应用
                          <Icon name="arrow-right" size="sm" />
                        </Link>
                      </div>
                      {common.length ? (
                        <div className="work-app-grid">
                          {common.map((app) => (
                            <AppCard
                              key={app.code}
                              app={app}
                              onOverview={showOverview}
                            />
                          ))}
                        </div>
                      ) : (
                        <div className="work-empty">
                          <p className="text-body-md text-muted-foreground">
                            尚未订阅应用
                          </p>
                          <Link
                            href="/apps"
                            className="text-body-sm text-primary"
                          >
                            浏览应用中心
                          </Link>
                        </div>
                      )}
                    </section>
                    <div className="work-task-grid">
                      {[
                        {
                          title: "继续工作",
                          description: "从上次停下的地方，接着推进",
                        },
                        {
                          title: "与我协作",
                          description: "让协同有序，让进展清晰",
                        },
                      ].map((section) => (
                        <section key={section.title}>
                          <div className="work-section-heading">
                            <div>
                              <h2>{section.title}</h2>
                              <p>{section.description}</p>
                            </div>
                          </div>
                          <div className="work-task-panel">
                            <div className="work-panel-heading">
                              {section.title === "继续工作"
                                ? "工作事项"
                                : "协作事项"}
                            </div>
                            <div className="work-task-empty">
                              <span className="work-empty-glyph">
                                <Icon
                                  name={
                                    section.title === "继续工作"
                                      ? "clock-counter-clockwise"
                                      : "list-checks"
                                  }
                                  size="lg"
                                />
                              </span>
                              <h3 role="status">工作记录正在接通中…</h3>
                              <p>工作事项暂不可用，可从应用中继续处理</p>
                            </div>
                          </div>
                        </section>
                      ))}
                    </div>
                    <aside
                      className="work-desktop-callout"
                      aria-label="桌面工作环境"
                    >
                      <span className="work-desktop-glyph">
                        <Icon name="desktop" size="lg" />
                      </span>
                      <div>
                        <h2>本地资料，也能接着用</h2>
                        <p>通过 RUYIN 桌面端，连接你的本地工作环境</p>
                      </div>
                      <a
                        className="work-section-link"
                        href={
                          new URL("/zh-CN/workbench", runtime.websiteUrl).href
                        }
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        了解桌面端
                        <Icon name="external-link" size="sm" />
                      </a>
                    </aside>
                  </>
                )}
                {appsPage && (
                  <aside
                    className="work-desktop-callout"
                    aria-label="订阅更多产品"
                  >
                    <span className="work-desktop-glyph">
                      <Icon name="sparkles" size="lg" />
                    </span>
                    <div>
                      <h2>拓展所长，开启更多可能</h2>
                      <p>探索更多专业智能体与产品，为业务增添新的能力</p>
                    </div>
                    <a
                      className="work-section-link"
                      href={buildConsoleEntry(
                        data,
                        runtime.consoleUrl,
                        "subscription",
                      )}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      订阅更多产品
                      <Icon name="arrow-right" size="sm" />
                    </a>
                  </aside>
                )}
              </>
            )
          )}
          {!checking && (
            <footer className="work-footer">
              <span>
                <Icon name="shield" size="sm" />
                {data?.scope.name ?? "Ruyin Work"}
              </span>
              <a
                href={runtime.websiteUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                VXTURE 官网
                <Icon name="external-link" size="sm" />
              </a>
            </footer>
          )}
        </main>
      )}

      {data && (
        <NotificationDrawer
          key={`${data.user.id}:${data.scope.id}:${data.scope.workspace}`}
          data={data}
          runtime={runtime}
          open={notificationsOpen}
          onClose={() => setNotificationsOpen(false)}
        />
      )}
      {/* All details share DS Drawer chrome, close icon, width and footer position. */}
      <Drawer
        open={detailsOpen}
        onClose={closeDetails}
        width="sm"
        title={overview?.name ?? "使用帮助"}
        description={
          overview
            ? `${overview.brand ? `${overview.brand} · ` : ""}应用概要`
            : undefined
        }
        closeLabel="关闭详情"
        className="work-detail-drawer"
        footer={
          overview ? (
            <>
              <Button variant="ghost" asChild>
                <a
                  href={
                    new URL(
                      `/zh-CN/products/${encodeURIComponent(overview.code)}`,
                      runtime.websiteUrl,
                    ).href
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  产品介绍
                  <Icon name="external-link" size="sm" />
                </a>
              </Button>
              {overview.available && overview.href && (
                <Button asChild className="work-action">
                  <a
                    href={overview.href}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    进入
                  </a>
                </Button>
              )}
            </>
          ) : (
            <Button asChild variant="secondary">
              <a
                href={runtime.websiteUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                访问 VXTURE 官网
              </a>
            </Button>
          )
        }
      >
        {overview ? (
          <div className="work-detail-body">
            <p className="text-body-md text-muted-foreground">
              {overview.description || "产品介绍暂未提供"}
            </p>
            <dl className="work-detail-facts">
              <div>
                <dt>版本</dt>
                <dd>{appVersion(overview.version)}</dd>
              </div>
              {RELEASE_LABELS[overview.stage] && (
                <div>
                  <dt>版本类型</dt>
                  <dd>{RELEASE_LABELS[overview.stage]}</dd>
                </div>
              )}
              <div>
                <dt>使用状态</dt>
                <dd>{overview.availabilityLabel}</dd>
              </div>
              {overview.tier && (
                <div>
                  <dt>套餐</dt>
                  <dd>{TIER_LABELS[overview.tier] ?? overview.tier}</dd>
                </div>
              )}
            </dl>
          </div>
        ) : (
          <div className="flex flex-col gap-lg">
            <p className="text-body-md text-muted-foreground">
              选择应用卡片查看产品概要，点击“进入”直接开始工作。
            </p>
            <p className="text-body-md text-muted-foreground">
              在顶部单位面板切换组织或工作空间，账号与账务信息可在管理控制台查看。
            </p>
          </div>
        )}
      </Drawer>
    </div>
  );
}
