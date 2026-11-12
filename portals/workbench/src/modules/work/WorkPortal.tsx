"use client";

/**
 * Production portal orchestration with explicit login, outage and empty states.
 * @package @vxture/workbench
 * @layer Presentation
 * @category module
 * @author AI-Generated
 * @date 2026-11-05
 */
import { withLocalePreference } from "@vxture/platform-browser";
import { useWorkLocale } from "../../lib/locale";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button, Drawer, Icon, SegmentedControl } from "@vxture/design-system";
import { loadWorkData } from "../../lib/api";
import { authNavigation } from "../../lib/navigation";
import type {
  AppView,
  LoadResult,
  WorkApp,
  WorkData,
  WorkRuntime,
} from "../../lib/contracts";
import type { HomeCopy } from "../../lib/presentation";
import {
  appVersion,
  homeApps,
  sortApps,
  RELEASE_LABELS,
  TIER_LABELS,
} from "../../lib/presentation";
import { buildConsoleEntry } from "../../lib/console-entry";
import { WorkHeader } from "./WorkHeader";
import { TitleRegion } from "./TitleRegion";
import { AppCard, AppCatalog } from "./AppCatalog";
import { LoginPage } from "./LoginPage";
import { useAppActivity } from "./use-app-activity";
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
  const { locale, t } = useWorkLocale();
  const pathname = usePathname();
  const appsPage = pathname === "/apps";
  const knownRoute = pathname === "/" || appsPage;
  const [now, setNow] = useState(() => new Date(initialTime));
  const [result, setResult] = useState<LoadResult<WorkData> | null>(null);
  const [revision, setRevision] = useState(0);
  const syncInFlight = useRef(false);
  const lastSyncAt = useRef(0);
  const allowSilentSso = useRef(true);
  const silentFailure = useRef(false);
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
    syncInFlight.current = true;
    lastSyncAt.current = Date.now();
    const current = new URL(window.location.href);
    const silentFailed = current.searchParams.get("vx_sso_silent") === "0";
    if (silentFailed) {
      silentFailure.current = true;
      current.searchParams.delete("vx_sso_silent");
      window.history.replaceState(null, "", current.href);
    }
    void loadWorkData(controller.signal, runtime.catalogConfigured)
      .then((value) => {
        if (controller.signal.aborted) return;
        // ruyin.work cannot read the IdP cookie on accounts.vxture.com.
        // A bounded top-level prompt=none flow restores this RP independently.
        if (value.status === "error" && value.code === 401) {
          let attemptedAt = 0;
          try {
            attemptedAt = Number(sessionStorage.getItem("vx:work:sso-at")) || 0;
            if (silentFailed) {
              attemptedAt = Date.now();
              sessionStorage.setItem("vx:work:sso-at", String(attemptedAt));
            }
          } catch {
            // The callback marker still prevents a redirect loop without storage.
          }
          if (
            allowSilentSso.current &&
            !silentFailure.current &&
            Date.now() - attemptedAt >= 1500
          ) {
            allowSilentSso.current = false;
            try {
              sessionStorage.setItem("vx:work:sso-at", String(Date.now()));
            } catch {
              // Storage is optional; authorization remains server-bound.
            }
            window.location.replace(
              authNavigation("login", window.location.href, {
                prompt: "none",
                ui_locales: document.documentElement.lang,
              }),
            );
            return;
          }
        }
        allowSilentSso.current = false;
        // Keep the authenticated shell during a transient data outage.
        setResult((previous) =>
          value.status === "error" &&
          value.code !== 401 &&
          previous?.status === "ready"
            ? {
                ...previous,
                data: { ...previous.data, availabilityIssue: value.message },
              }
            : value,
        );
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setResult((previous) =>
            previous?.status === "ready"
              ? {
                  ...previous,
                  data: {
                    ...previous.data,
                    availabilityIssue: "连接失败，请稍后重试",
                  },
                }
              : { status: "error", code: 0, message: "连接失败，请稍后重试" },
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) syncInFlight.current = false;
      });
    return () => {
      controller.abort();
      syncInFlight.current = false;
    };
  }, [
    runtime.authConfigured,
    runtime.catalogConfigured,
    revision,
    knownRoute,
    pathname,
  ]);
  useEffect(() => {
    if (!runtime.authConfigured || !knownRoute) return;
    const sync = (): void => {
      if (
        document.visibilityState !== "visible" ||
        syncInFlight.current ||
        Date.now() - lastSyncAt.current < 1500
      )
        return;
      // Foreground checks must not restart a failed top-level SSO bootstrap.
      setRevision((value) => value + 1);
    };
    const foreground = (): void => sync();
    const interval = window.setInterval(sync, 300_000);
    window.addEventListener("focus", foreground);
    window.addEventListener("pageshow", foreground);
    document.addEventListener("visibilitychange", foreground);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", foreground);
      window.removeEventListener("pageshow", foreground);
      document.removeEventListener("visibilitychange", foreground);
    };
  }, [runtime.authConfigured, knownRoute]);
  useEffect(() => {
    setDetailsOpen(false);
    setNotificationsOpen(false);
  }, [appsPage]);
  const data = result?.status === "ready" ? result.data : null;
  const checking = runtime.authConfigured && result === null;
  const catalog = data?.catalog;
  const activity = useAppActivity(data);
  const common = homeApps(activity.apps, activity.view, copy.appLimit);
  const appActions = {
    onFavorite: activity.favorite,
    onLaunch: activity.launch,
    favoritesEnabled: activity.enabled,
  };
  const signIn = (): void => {
    window.location.assign(
      authNavigation("login", location.href, { ui_locales: locale }),
    );
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
        {t("跳到主要内容")}
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
              <p>{t("正在载入工作空间…")}</p>
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
                    {t("应用可用状态暂无法确认：")}
                    {t(data.availabilityIssue)}
                    <Button size="sm" variant="ghost" onClick={retry}>
                      {t("重试")}
                    </Button>
                  </div>
                )}
                {activity.message && (
                  <p className="work-status" role="status">
                    {t(activity.message)}
                  </p>
                )}
                {appsPage && activity.result?.status === "error" && (
                  <div className="work-status" role="status">
                    {t("收藏和使用记录暂不可用")}
                    <Button variant="ghost" size="sm" onClick={activity.retry}>
                      {t("重试")}
                    </Button>
                  </div>
                )}
                {catalog?.status === "error" ? (
                  <div role="alert" className="work-empty">
                    <p>{t(catalog.message)}</p>
                    <Button size="sm" variant="secondary" onClick={retry}>
                      {t("重新加载")}
                    </Button>
                  </div>
                ) : appsPage ? (
                  <AppCatalog
                    {...appActions}
                    apps={sortApps(activity.apps, activity.view)}
                    onOverview={showOverview}
                  />
                ) : (
                  <>
                    <section
                      aria-labelledby="common-apps"
                      className="work-common-apps"
                    >
                      <div className="work-section-heading work-common-heading">
                        <div>
                          <h2 id="common-apps">{t("常用应用")}</h2>
                          <p>{t("专业能力，随时进入")}</p>
                        </div>
                        <div className="work-home-actions">
                          <fieldset
                            className="work-availability work-home-sort"
                            disabled={!activity.enabled}
                            onKeyDown={(event) => {
                              const views: AppView[] = [
                                "favorites",
                                "recent",
                                "frequent",
                              ];
                              if (
                                ![
                                  "ArrowLeft",
                                  "ArrowRight",
                                  "Home",
                                  "End",
                                ].includes(event.key) ||
                                !activity.enabled
                              )
                                return;
                              event.preventDefault();
                              const current = views.indexOf(activity.view);
                              const index =
                                event.key === "Home"
                                  ? 0
                                  : event.key === "End"
                                    ? 2
                                    : (current +
                                        (event.key === "ArrowRight" ? 1 : 2)) %
                                      3;
                              activity.changeView(views[index]!);
                              event.currentTarget
                                .querySelectorAll<HTMLButtonElement>(
                                  '[role="radio"]',
                                )
                                [index]?.focus();
                            }}
                          >
                            <SegmentedControl<AppView>
                              ariaLabel={t("常用应用排序")}
                              value={activity.view}
                              items={[
                                { value: "favorites", label: t("收藏") },
                                { value: "recent", label: t("最近") },
                                { value: "frequent", label: t("最多") },
                              ]}
                              onChange={activity.changeView}
                            />
                          </fieldset>
                          <Button
                            asChild
                            variant="ghost"
                            size="sm"
                            className="work-all-apps"
                          >
                            <Link href="/apps">
                              {t("全部应用")}
                              <Icon name="arrow-right" size="sm" />
                            </Link>
                          </Button>
                        </div>
                      </div>
                      {activity.result?.status === "error" ? (
                        <div className="work-empty" role="status">
                          <p>{t("收藏和使用记录暂不可用")}</p>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={activity.retry}
                          >
                            {t("重新加载")}
                          </Button>
                        </div>
                      ) : !activity.result ? (
                        <div className="work-empty" role="status">
                          {t("正在载入应用记录…")}
                        </div>
                      ) : common.length ? (
                        <div className="work-app-grid">
                          {common.map((app) => (
                            <AppCard
                              key={app.code}
                              app={app}
                              {...appActions}
                              onOverview={showOverview}
                            />
                          ))}
                        </div>
                      ) : (
                        <div className="work-empty">
                          <p className="text-body-md text-muted-foreground">
                            {activity.apps.length === 0
                              ? t("尚未订阅应用")
                              : activity.view === "recent"
                                ? t("还没有使用记录")
                                : t("近 30 天还没有使用记录")}
                          </p>
                          <Link
                            href="/apps"
                            className="text-body-sm text-primary"
                          >
                            {t("浏览应用中心")}
                          </Link>
                        </div>
                      )}
                    </section>
                    <div className="work-task-grid">
                      {[
                        {
                          title: "继续工作",
                          description: t("从上次停下的地方，接着推进"),
                        },
                        {
                          title: "与我协作",
                          description: t("让协同有序，让进展清晰"),
                        },
                      ].map((section) => (
                        <section key={t(section.title)}>
                          <div className="work-section-heading">
                            <div>
                              <h2>{t(section.title)}</h2>
                              <p>{t(section.description)}</p>
                            </div>
                          </div>
                          <div className="work-task-panel">
                            <div className="work-panel-heading">
                              {section.title === "继续工作"
                                ? t("工作事项")
                                : t("协作事项")}
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
                              <h3 role="status">{t("工作记录正在接通中…")}</h3>
                              <p>{t("工作事项暂不可用，可从应用中继续处理")}</p>
                            </div>
                          </div>
                        </section>
                      ))}
                    </div>
                    <aside
                      className="work-desktop-callout"
                      aria-label={t("桌面工作环境")}
                    >
                      <span className="work-desktop-glyph">
                        <Icon name="desktop" size="lg" />
                      </span>
                      <div>
                        <h2>{t("本地资料，也能接着用")}</h2>
                        <p>{t("通过 RUYIN 桌面端，连接你的本地工作环境")}</p>
                      </div>
                      <a
                        className="work-section-link"
                        href={withLocalePreference(
                          new URL(`/${locale}/workbench`, runtime.websiteUrl)
                            .href,
                          locale,
                        )}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {t("了解桌面端")}
                        <Icon name="external-link" size="sm" />
                      </a>
                    </aside>
                  </>
                )}
                {appsPage && (
                  <aside
                    className="work-desktop-callout"
                    aria-label={t("订阅更多产品")}
                  >
                    <span className="work-desktop-glyph">
                      <Icon name="sparkles" size="lg" />
                    </span>
                    <div>
                      <h2>{t("拓展所长，开启更多可能")}</h2>
                      <p>{t("探索更多专业智能体与产品，为业务增添新的能力")}</p>
                    </div>
                    <a
                      className="work-section-link"
                      href={buildConsoleEntry(
                        data,
                        runtime.consoleUrl,
                        "subscription",
                        locale,
                      )}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {t("订阅更多产品")}
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
                href={withLocalePreference(
                  new URL(`/${locale}`, runtime.websiteUrl).href,
                  locale,
                )}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t("VXTURE 官网")}
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
        title={overview?.name ?? t("使用帮助")}
        description={
          overview
            ? t("{0}应用概要", overview.brand ? `${overview.brand} · ` : "")
            : undefined
        }
        closeLabel={t("关闭详情")}
        className="work-detail-drawer"
        footer={
          overview ? (
            <>
              <Button variant="ghost" asChild>
                <a
                  href={withLocalePreference(
                    new URL(
                      `/${locale}/products/${encodeURIComponent(overview.code)}`,
                      runtime.websiteUrl,
                    ).href,
                    locale,
                  )}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t("产品介绍")}
                  <Icon name="external-link" size="sm" />
                </a>
              </Button>
              {overview.available && overview.href && (
                <Button asChild className="work-action">
                  <a
                    onClick={() => activity.launch(overview)}
                    onAuxClick={(event) => {
                      if (event.button === 1) activity.launch(overview);
                    }}
                    href={overview.href}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {t("进入")}
                  </a>
                </Button>
              )}
            </>
          ) : (
            <Button asChild variant="secondary">
              <a
                href={withLocalePreference(
                  new URL(`/${locale}`, runtime.websiteUrl).href,
                  locale,
                )}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t("访问 VXTURE 官网")}
              </a>
            </Button>
          )
        }
      >
        {overview ? (
          <div className="work-detail-body">
            <p className="text-body-md text-muted-foreground">
              {overview.description || t("产品介绍暂未提供")}
            </p>
            <dl className="work-detail-facts">
              <div>
                <dt>{t("版本")}</dt>
                <dd>{appVersion(overview.version)}</dd>
              </div>
              {RELEASE_LABELS[overview.stage] && (
                <div>
                  <dt>{t("版本类型")}</dt>
                  <dd>{t(RELEASE_LABELS[overview.stage]!)}</dd>
                </div>
              )}
              <div>
                <dt>{t("使用状态")}</dt>
                <dd>{t(overview.availabilityLabel)}</dd>
              </div>
              {overview.tier && (
                <div>
                  <dt>{t("套餐")}</dt>
                  <dd>{t(TIER_LABELS[overview.tier] ?? overview.tier)}</dd>
                </div>
              )}
            </dl>
          </div>
        ) : (
          <div className="flex flex-col gap-lg">
            <p className="text-body-md text-muted-foreground">
              {t("选择应用卡片查看产品概要，点击“进入”直接开始工作。")}
            </p>
            <p className="text-body-md text-muted-foreground">
              {t(
                "在顶部单位面板切换组织或工作空间，账号与账务信息可在管理控制台查看。",
              )}
            </p>
          </div>
        )}
      </Drawer>
    </div>
  );
}
