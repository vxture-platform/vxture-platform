"use client";

/**
 * Production portal orchestration with explicit login, outage and empty states.
 * @package @vxture/workbench
 * @layer Presentation
 * @category module
 * @author AI-Generated
 * @date 2026-11-05
 */
import { useEffect, useState } from "react";
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
import { WorkHeader } from "./WorkHeader";
import { TitleRegion } from "./TitleRegion";
import { AppCard, AppCatalog } from "./AppCatalog";

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
  const [help, setHelp] = useState(false);
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
    setOverview(null);
    setHelp(false);
  }, [appsPage]);
  const data = result?.status === "ready" ? result.data : null;
  const catalog = data?.catalog;
  const common =
    catalog?.status === "ready"
      ? catalog.data.filter((app) => app.available).slice(0, 3)
      : [];
  const signIn = (): void => {
    window.location.assign(authNavigation("login", location.href));
  };
  const retry = (): void => setRevision((value) => value + 1);

  if (!knownRoute) return null;

  // ========================================================================
  // Shared page frame and authenticated content
  // ========================================================================
  return (
    <div className="work-shell">
      <a className="work-skip" href="#main">
        跳到主要内容
      </a>
      <WorkHeader
        data={data}
        apps={appsPage}
        runtime={runtime}
        onHelp={() => setHelp(true)}
      />
      <main id="main" className={`work-main ${data ? "" : "work-main-public"}`}>
        {!data ? (
          <section className="work-login" aria-labelledby="login-title">
            <div className="work-login-copy">
              <p className="text-label-lg text-primary">RUYIN WORK</p>
              <h1
                id="login-title"
                className="mt-lg text-heading-1 font-semibold"
              >
                专业所长，皆为所用
              </h1>
              <p className="mt-md text-body-lg text-muted-foreground">
                连接专业智能体，开启从容有序的工作
              </p>
              <div className="work-login-art" aria-hidden="true">
                <Icon name="sparkles" size="lg" />
              </div>
            </div>
            <div className="work-login-panel">
              <h2 className="text-title-xl">进入工作空间</h2>
              {runtime.authConfigured && !result ? (
                <p role="status" className="text-body-md text-muted-foreground">
                  正在确认登录状态…
                </p>
              ) : (
                <>
                  <p
                    role="status"
                    className="text-body-md text-muted-foreground"
                  >
                    {!runtime.authConfigured
                      ? "登录服务暂不可用，请稍后再试"
                      : result?.status === "error" && result.code !== 401
                        ? result.message
                        : "使用 VXTURE 账号继续"}
                  </p>
                  {runtime.authConfigured && (
                    <Button
                      className="rounded-full"
                      onClick={
                        result?.status === "error" && result.code !== 401
                          ? retry
                          : signIn
                      }
                    >
                      {result?.status === "error" && result.code !== 401
                        ? "重新连接"
                        : "登录"}
                    </Button>
                  )}
                </>
              )}
              <p className="text-body-sm text-muted-foreground">
                账号、组织和工作空间由统一身份服务管理
              </p>
            </div>
          </section>
        ) : (
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
                onOverview={setOverview}
              />
            ) : (
              <>
                <section aria-labelledby="common-apps">
                  <div className="mb-md flex items-baseline justify-between gap-md">
                    <h2 id="common-apps" className="text-title-xl">
                      常用应用
                    </h2>
                    <Link
                      className="text-body-sm text-muted-foreground hover:text-primary"
                      href="/apps"
                    >
                      全部应用
                    </Link>
                  </div>
                  {common.length ? (
                    <div className="work-app-grid">
                      {common.map((app) => (
                        <AppCard
                          key={app.code}
                          app={app}
                          onOverview={setOverview}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="work-empty">
                      <p className="text-body-md text-muted-foreground">
                        暂无可直接进入的应用
                      </p>
                      <Link href="/apps" className="text-body-sm text-primary">
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
                      message: "工作事项暂不可用，可从应用中继续处理",
                    },
                    {
                      title: "与我协作",
                      description: "让协同有序，让进展清晰",
                      message: "协作事项暂不可用，可进入对应应用查看",
                    },
                  ].map((section) => (
                    <section key={section.title}>
                      <h2 className="text-title-xl">{section.title}</h2>
                      <p className="mt-xs mb-md text-body-sm text-muted-foreground">
                        {section.description}
                      </p>
                      <div className="work-empty">
                        <Icon name="folder" size="lg" />
                        <p className="text-body-sm text-muted-foreground">
                          {section.message}
                        </p>
                      </div>
                    </section>
                  ))}
                </div>
              </>
            )}
          </>
        )}
        <footer className="work-footer">
          <span>{data?.scope.name ?? "Ruyin Work"}</span>
          <a
            href={runtime.websiteUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            VXTURE 官网
          </a>
        </footer>
      </main>

      {/* All details share DS Drawer chrome, close icon, width and footer position. */}
      <Drawer
        open={Boolean(overview) || help}
        onClose={() => {
          setOverview(null);
          setHelp(false);
        }}
        width="lg"
        title={overview?.name ?? "使用帮助"}
        closeLabel="关闭详情"
        footer={
          overview ? (
            <>
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
          <div className="flex flex-col gap-lg">
            <p className="text-body-md text-muted-foreground">
              {overview.description || "产品介绍暂未提供"}
            </p>
            <dl className="work-detail-facts">
              <div>
                <dt>品牌</dt>
                <dd>{overview.brand || overview.name}</dd>
              </div>
              <div>
                <dt>版本</dt>
                <dd>{overview.version ?? "暂未提供"}</dd>
              </div>
              <div>
                <dt>使用状态</dt>
                <dd>{overview.availabilityLabel}</dd>
              </div>
              {overview.tier && (
                <div>
                  <dt>套餐</dt>
                  <dd>{overview.tier}</dd>
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
