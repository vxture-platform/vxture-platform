"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  Icon,
  Input,
  ListPageTemplate,
  NativeSelect,
  StatusBadge,
  ViewModeSwitch,
} from "@vxture/design-system";
import type { IconName, StatusBadgeTone } from "@vxture/design-system";
import { fetchDevServices } from "@/api/admin-bff";
import type { DevServiceSnapshot } from "@/entities/console";
import { PageHeader } from "@/modules/shared/PageHeader";

type ServiceStatus = "healthy" | "degraded" | "offline" | "stopping";
type ServiceLayer =
  | "tooling"
  | "ai"
  | "agent"
  | "gateway"
  | "bff"
  | "portal"
  | "other";
type ViewMode = "cards" | "list";
type StatusFilter = "all" | ServiceStatus;
type LayerFilter = "all" | ServiceLayer;
type PriorityFilter = "all" | "p0" | "p1" | "p2" | "p3";
type ProbeFilter = "all" | "http" | "tcp" | "mixed";
type SourceFilter = "all" | "dev-tools" | "dev-panel";

const REFRESH_INTERVAL_MS = 15_000;

const defaultFilters = {
  status: "all" as StatusFilter,
  layer: "all" as LayerFilter,
  priority: "all" as PriorityFilter,
  probe: "all" as ProbeFilter,
  source: "all" as SourceFilter,
};

function serviceStatus(service: DevServiceSnapshot): ServiceStatus {
  if (service.stopping) return "stopping";
  if (service.listening && service.healthy) return "healthy";
  if (service.listening) return "degraded";
  return "offline";
}

function serviceLayer(service: DevServiceSnapshot): ServiceLayer {
  if (service.id === "dev-tools") return "tooling";
  if (service.id === "auth-bff") return "bff";
  if (service.id.includes("varda") || service.id.includes("ruyin"))
    return "agent";
  if (service.id.includes("ai")) return "ai";
  if (service.id === "gateway") return "gateway";
  if (service.id.endsWith("-bff")) return "bff";
  if (["website", "console", "admin"].includes(service.id)) return "portal";
  return "other";
}

function serviceProbe(service: DevServiceSnapshot): ProbeFilter {
  const hasTcp = service.health.some(
    (check) => check.url.startsWith("tcp://") || check.okStatuses === null,
  );
  const hasHttp = service.health.some(
    (check) =>
      check.url.startsWith("http://") || check.url.startsWith("https://"),
  );
  if (hasTcp && hasHttp) return "mixed";
  if (hasTcp) return "tcp";
  if (hasHttp) return "http";
  return "all";
}

function statusLabel(status: ServiceStatus) {
  if (status === "healthy") return "健康";
  if (status === "degraded") return "未就绪";
  if (status === "stopping") return "停止中";
  return "离线";
}

/** 服务态 → 语气。卡片视图与列表状态列共用这一张表，两处天生同源。 */
const SERVICE_STATUS_TONE: Record<ServiceStatus, StatusBadgeTone> = {
  healthy: "success",
  degraded: "warning",
  stopping: "warning",
  offline: "danger",
};

function layerLabel(layer: ServiceLayer) {
  if (layer === "tooling") return "开发工具";
  if (layer === "ai") return "AI 服务";
  if (layer === "agent") return "智能体";
  if (layer === "gateway") return "网关";
  if (layer === "bff") return "BFF";
  if (layer === "portal") return "门户";
  return "其他";
}

function sourceLabel(source: SourceFilter) {
  if (source === "dev-tools") return "Dev Tools";
  if (source === "dev-panel") return "Dev Panel";
  return "全部来源";
}

function layerIcon(layer: ServiceLayer): IconName {
  if (layer === "tooling") return "settings";
  if (layer === "ai") return "cloud";
  if (layer === "agent") return "sparkles";
  if (layer === "gateway") return "api";
  if (layer === "bff") return "server";
  if (layer === "portal") return "home";
  return "cube";
}

function statusIcon(status: ServiceStatus): IconName {
  if (status === "healthy") return "success";
  if (status === "degraded") return "warning";
  if (status === "stopping") return "clock";
  return "error";
}

function statusOrder(status: ServiceStatus) {
  if (status === "offline") return 0;
  if (status === "degraded") return 1;
  if (status === "stopping") return 2;
  return 3;
}

function formatUpdatedAt(value: Date | null) {
  if (!value) return "等待同步";
  return value.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function formatCheckStatus(status: number | string | null) {
  if (status === null) return "down";
  return String(status);
}

function serviceSearchText(service: DevServiceSnapshot) {
  return [
    service.id,
    service.name,
    service.port,
    service.priority,
    service.url,
    service.command,
    service.source,
    serviceStatus(service),
    serviceLayer(service),
    ...service.health.flatMap((check) => [
      check.label,
      check.url,
      check.status,
    ]),
  ]
    .filter((value) => value !== null && value !== undefined)
    .join(" ")
    .toLowerCase();
}

function maxDuration(service: DevServiceSnapshot) {
  return Math.max(0, ...service.health.map((check) => check.durationMs));
}

function ServiceHealthSummary({
  label,
  value,
  tag,
  icon,
  status,
}: {
  label: string;
  value: string;
  tag: string;
  icon: IconName;
  status: ServiceStatus;
}) {
  return (
    <article
      className={`vx-service-health-summary__item vx-service-health-status--${status}`}
    >
      <span className="vx-service-health-summary__icon" aria-hidden="true">
        <Icon name={icon} size="lg" fallback="placeholder" />
      </span>
      <div>
        <span>{label}</span>
        <div className="vx-service-health-summary__value-line">
          <strong>{value}</strong>
          {tag ? <em>{tag}</em> : null}
        </div>
      </div>
    </article>
  );
}

function ServiceHealthCard({ service }: { service: DevServiceSnapshot }) {
  const status = serviceStatus(service);
  const layer = serviceLayer(service);
  const failedChecks = service.health.filter((check) => !check.ok).length;

  return (
    <article
      className={`vx-service-health-card vx-service-health-status--${status}`}
    >
      <header className="vx-service-health-card__header">
        <span className="vx-service-health-card__icon" aria-hidden="true">
          <Icon name={layerIcon(layer)} size="lg" fallback="placeholder" />
        </span>
        <div>
          <p>{layerLabel(layer)}</p>
          <h2>{service.name}</h2>
        </div>
        <StatusBadge
          className="vx-service-health-status-badge"
          tone={SERVICE_STATUS_TONE[status]}
          icon={statusIcon(status)}
        >
          {statusLabel(status)}
        </StatusBadge>
      </header>

      <div className="vx-service-health-card__meta">
        <span>端口 {service.port}</span>
        <span>P{service.priority}</span>
        <span>{sourceLabel(service.source ?? "dev-panel")}</span>
        <span>{service.uptime || "—"}</span>
      </div>

      <div
        className="vx-service-health-card__checks"
        aria-label={`${service.name} 探针`}
      >
        {service.health.map((check) => (
          <span
            key={`${service.id}-${check.label}`}
            className={
              check.ok
                ? "vx-service-health-check vx-service-health-check--ok"
                : "vx-service-health-check vx-service-health-check--bad"
            }
          >
            {check.label}
            <b>{formatCheckStatus(check.status)}</b>
            <small>{check.durationMs}ms</small>
          </span>
        ))}
      </div>

      <footer className="vx-service-health-card__footer">
        <span>{service.url}</span>
        <strong>
          {failedChecks
            ? `${failedChecks} 个异常探针`
            : `${service.health.length} 个探针通过`}
        </strong>
      </footer>
    </article>
  );
}

function ServiceHealthList({ services }: { services: DevServiceSnapshot[] }) {
  const columns = [
    {
      id: "service",
      header: "服务",
      cell: (service: DevServiceSnapshot) => {
        const layer = serviceLayer(service);
        return (
          <div className="vx-service-health-list__service">
            <Icon name={layerIcon(layer)} size="sm" fallback="placeholder" />
            <div>
              <strong>{service.name}</strong>
              <span>{service.id}</span>
            </div>
          </div>
        );
      },
    },
    {
      /* 状态列居中，且用 StatusBadge 出语气——行不再染色，业务语气全靠这一列
       * （DataTable 的对齐约定与"需要语气就必须有状态列"的约定，见其文件头）。 */
      id: "status",
      header: "状态",
      align: "center" as const,
      cell: (service: DevServiceSnapshot) => {
        const status = serviceStatus(service);
        /* icon 显式给：stopping 是 warning 语气，但时钟比感叹号准。 */
        return (
          <StatusBadge
            tone={SERVICE_STATUS_TONE[status]}
            icon={statusIcon(status)}
          >
            {statusLabel(status)}
          </StatusBadge>
        );
      },
    },
    {
      id: "layer",
      header: "分层",
      cell: (service: DevServiceSnapshot) => layerLabel(serviceLayer(service)),
    },
    {
      id: "port",
      header: "端口",
      align: "right" as const,
      cell: (service: DevServiceSnapshot) => service.port,
    },
    {
      id: "checks",
      header: "探针",
      cell: (service: DevServiceSnapshot) => (
        <div className="vx-service-health-list__checks">
          {service.health.map((check) => (
            <span
              key={`${service.id}-${check.label}`}
              className={
                check.ok
                  ? "vx-service-health-check vx-service-health-check--ok"
                  : "vx-service-health-check vx-service-health-check--bad"
              }
            >
              {check.label}
            </span>
          ))}
        </div>
      ),
    },
    {
      id: "duration",
      header: "响应",
      align: "right" as const,
      cell: (service: DevServiceSnapshot) => `${maxDuration(service)}ms`,
    },
    {
      id: "uptime",
      header: "运行",
      cell: (service: DevServiceSnapshot) => service.uptime || "—",
    },
  ];

  return (
    /* 行不染色：健康度由"状态"列的 StatusBadge 说，且只说一遍。
     * aria-label 随 DataTable 收窄取消（本件不再透传任意属性）。 */
    <DataTable
      className="vx-service-health-list"
      columns={columns}
      rows={services}
      rowKey={(service: DevServiceSnapshot) => service.id}
    />
  );
}

export function ServiceHealthPage({
  eyebrow = "运营总览",
  title = "服务健康",
  description = "集中查看 dev-tools、核心服务、BFF、网关和门户的只读健康状态。",
}: {
  eyebrow?: string;
  title?: string;
  description?: string;
}) {
  const [services, setServices] = useState<DevServiceSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState(defaultFilters);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let controller: AbortController | null = null;

    function clearTimer() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    }

    async function pullServices() {
      clearTimer();
      if (!active) return;
      if (
        typeof document !== "undefined" &&
        document.visibilityState === "hidden"
      )
        return;

      controller?.abort();
      controller = new AbortController();

      try {
        const records = await fetchDevServices(controller.signal);
        if (!active) return;
        setServices(records);
        setLastUpdatedAt(new Date());
        setFeedback(null);
      } catch (error) {
        if (
          active &&
          !(error instanceof DOMException && error.name === "AbortError")
        ) {
          setFeedback("服务健康数据暂时不可用。");
        }
      } finally {
        if (active) {
          setLoading(false);
          if (
            typeof document === "undefined" ||
            document.visibilityState === "visible"
          ) {
            timer = setTimeout(pullServices, REFRESH_INTERVAL_MS);
          }
        }
      }
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        void pullServices();
      } else {
        clearTimer();
        controller?.abort();
      }
    }

    void pullServices();
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      active = false;
      clearTimer();
      controller?.abort();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  const visibleServices = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return services
      .filter((service) => {
        const status = serviceStatus(service);
        const layer = serviceLayer(service);
        const probe = serviceProbe(service);
        const source = service.source ?? "dev-panel";
        const priority = `p${service.priority}` as PriorityFilter;
        const matchesQuery =
          !normalizedQuery ||
          serviceSearchText(service).includes(normalizedQuery);

        return (
          matchesQuery &&
          (filters.status === "all" || filters.status === status) &&
          (filters.layer === "all" || filters.layer === layer) &&
          (filters.priority === "all" || filters.priority === priority) &&
          (filters.probe === "all" || filters.probe === probe) &&
          (filters.source === "all" || filters.source === source)
        );
      })
      .sort((left, right) => {
        const statusDiff =
          statusOrder(serviceStatus(left)) - statusOrder(serviceStatus(right));
        if (statusDiff !== 0) return statusDiff;
        return (
          left.priority - right.priority ||
          left.name.localeCompare(right.name, "zh-CN")
        );
      });
  }, [filters, query, services]);

  const stats = useMemo(() => {
    const healthy = services.filter(
      (service) => serviceStatus(service) === "healthy",
    ).length;
    const degraded = services.filter(
      (service) => serviceStatus(service) === "degraded",
    ).length;
    const offline = services.filter(
      (service) => serviceStatus(service) === "offline",
    ).length;
    const failedChecks = services.reduce(
      (total, service) =>
        total + service.health.filter((check) => !check.ok).length,
      0,
    );

    return {
      healthy,
      degraded,
      offline,
      failedChecks,
      total: services.length,
    };
  }, [services]);

  function updateFilter<Key extends keyof typeof filters>(
    key: Key,
    value: (typeof filters)[Key],
  ) {
    setFilters((old) => ({ ...old, [key]: value }));
  }

  function resetFilters() {
    setQuery("");
    setFilters(defaultFilters);
  }

  return (
    <ListPageTemplate
      className="vx-service-health-page"
      header={
        <PageHeader
          icon="server"
          eyebrow={eyebrow}
          title={title}
          description={description}
          secondary={<Badge>{formatUpdatedAt(lastUpdatedAt)}</Badge>}
        />
      }
      summary={
        <>
          {feedback ? <p className="vx-profile-message">{feedback}</p> : null}

          <section
            className="vx-service-health-summary"
            aria-label="服务健康概览"
          >
            <ServiceHealthSummary
              label="服务总数"
              value={String(stats.total)}
              tag=""
              icon="server"
              status="healthy"
            />
            <ServiceHealthSummary
              label="服务正常"
              value={String(stats.healthy)}
              tag=""
              icon="success"
              status="healthy"
            />
            <ServiceHealthSummary
              label="服务启动，探针异常"
              value={String(stats.degraded)}
              tag=""
              icon="warning"
              status="degraded"
            />
            <ServiceHealthSummary
              label="服务未启动"
              value={String(stats.offline)}
              tag=""
              icon="error"
              status="offline"
            />
          </section>
        </>
      }
      filters={
        <section
          className="vx-service-health-toolbar"
          aria-label="服务健康筛选"
        >
          <ViewModeSwitch
            value={viewMode}
            onChange={setViewMode}
            ariaLabel="服务健康展示方式"
          />
          <div
            className="vx-service-health-toolbar__spacer"
            aria-hidden="true"
          />
          <Input
            className="vx-service-health-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索服务、端口、探针、URL"
            aria-label="搜索服务健康"
          />
          <Button variant="outline" size="md" onClick={resetFilters}>
            重置
          </Button>

          <div className="vx-service-health-filters">
            <label aria-label="状态筛选">
              <NativeSelect
                value={filters.status}
                onChange={(event) =>
                  updateFilter("status", event.target.value as StatusFilter)
                }
              >
                <option value="all">全部状态</option>
                <option value="healthy">健康</option>
                <option value="degraded">未就绪</option>
                <option value="offline">离线</option>
                <option value="stopping">停止中</option>
              </NativeSelect>
            </label>
            <label aria-label="分层筛选">
              <NativeSelect
                value={filters.layer}
                onChange={(event) =>
                  updateFilter("layer", event.target.value as LayerFilter)
                }
              >
                <option value="all">全部分层</option>
                <option value="tooling">开发工具</option>
                <option value="ai">AI 服务</option>
                <option value="agent">智能体</option>
                <option value="gateway">网关</option>
                <option value="bff">BFF</option>
                <option value="portal">门户</option>
                <option value="other">其他</option>
              </NativeSelect>
            </label>
            <label aria-label="优先级筛选">
              <NativeSelect
                value={filters.priority}
                onChange={(event) =>
                  updateFilter("priority", event.target.value as PriorityFilter)
                }
              >
                <option value="all">全部优先级</option>
                <option value="p0">P0</option>
                <option value="p1">P1</option>
                <option value="p2">P2</option>
                <option value="p3">P3</option>
              </NativeSelect>
            </label>
            <label aria-label="探针筛选">
              <NativeSelect
                value={filters.probe}
                onChange={(event) =>
                  updateFilter("probe", event.target.value as ProbeFilter)
                }
              >
                <option value="all">全部探针</option>
                <option value="http">HTTP</option>
                <option value="tcp">TCP</option>
                <option value="mixed">混合</option>
              </NativeSelect>
            </label>
            <label aria-label="来源筛选">
              <NativeSelect
                value={filters.source}
                onChange={(event) =>
                  updateFilter("source", event.target.value as SourceFilter)
                }
              >
                <option value="all">全部来源</option>
                <option value="dev-tools">Dev Tools</option>
                <option value="dev-panel">Dev Panel</option>
              </NativeSelect>
            </label>
          </div>
        </section>
      }
      table={
        <>
          {visibleServices.length ? (
            viewMode === "cards" ? (
              <section
                className="vx-service-health-grid"
                aria-label="服务健康卡片"
              >
                {visibleServices.map((service) => (
                  <ServiceHealthCard key={service.id} service={service} />
                ))}
              </section>
            ) : (
              <ServiceHealthList services={visibleServices} />
            )
          ) : (
            <section className="vx-service-health-empty">
              <EmptyState
                title={loading ? "正在同步服务健康" : "没有匹配的服务"}
                description={
                  loading
                    ? "正在读取 dev-tools 只读监测结果。"
                    : "调整筛选条件，或重置后查看全部服务。"
                }
                action={
                  <Button variant="outline" onClick={resetFilters}>
                    重置
                  </Button>
                }
              />
            </section>
          )}
        </>
      }
    />
  );
}
