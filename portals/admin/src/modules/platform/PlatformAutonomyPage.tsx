"use client";

import Link from "next/link";
import { isServing, type ModelState } from "@vxture-platform/shared";
import { useEffect, useMemo, useState } from "react";
import {
  DashboardTemplate,
  DataTable,
  EmptyState,
  Icon,
  MetricGrid,
  PanelCard,
  PanelItem,
  PanelList,
  StatusBadge,
  TableTitleCell,
} from "@vxture/design-system";
import type {
  DataTableColumn,
  IconName,
  StatusBadgeTone,
} from "@vxture/design-system";
import {
  fetchAiModelGrants,
  fetchAiModels,
  fetchPlatformOverview,
} from "@/api/admin-bff";
import type { PlatformOverview } from "@/api/admin-bff";
import type { AiModelGrantRecord, AiModelRecord } from "@/entities/console";
import { PageHeader } from "@/modules/shared/PageHeader";

type AutonomyMetric = {
  label: string;
  value: string;
  detail: string;
  icon: IconName;
  tone: StatusBadgeTone;
};
type ResourceRow = {
  subject: string;
  key: string;
  model: string;
  quota: string;
  usage: string;
  status: string;
};

const autonomyDomains = [
  {
    title: "身份权限",
    description: "内部用户、平台角色和权限边界，与租户成员体系完全分离。",
    icon: "shield-check",
    links: [
      { label: "平台用户", href: "/platform-admins", meta: "账号、岗位、状态" },
      { label: "平台角色", href: "/admin-roles", meta: "角色、权限、授权" },
      {
        label: "权限策略",
        href: "/admin-permissions",
        meta: "权限点、层级、绑定",
      },
    ],
  },
  {
    title: "平台资源",
    description:
      "平台自身作为资源消费主体，承载 Varda、内部任务和治理分析的模型用量。",
    icon: "cloud",
    links: [
      {
        label: "模型平台",
        href: "/atlas",
        meta: "Provider、端点、链路",
      },
      {
        label: "密钥管理",
        href: "/platform-secrets",
        meta: "凭据、轮换、可见性",
      },
    ],
  },
  // 「运行保障」域已整体撤走（2026-08-11）：维护窗口/服务监控/任务调度三项全部
  // 迁往 opera，admin 侧不再托管任何运行保障入口——见
  // portals/admin/src/config/navigation.ts 同批次注释。
  {
    title: "安全审计",
    description:
      "控制面操作必须可追溯，高风险动作进入审批、二次确认和审计闭环。",
    icon: "info",
    links: [
      { label: "审计日志", href: "/audit-logs", meta: "操作、对象、结果" },
      { label: "审批中心", href: "/approval-center", meta: "确认、审批、凭证" },
    ],
  },
] satisfies Array<{
  title: string;
  description: string;
  icon: IconName;
  links: Array<{ label: string; href: string; meta: string }>;
}>;

function buildOperationRows(overview: PlatformOverview | null): Array<{
  label: string;
  value: string;
  meta: string;
  tone: StatusBadgeTone;
  href: string;
}> {
  const o = overview;
  const pendingVerifications = o?.pendingVerifications ?? 0;
  const openRisk = o?.openRiskCount ?? 0;
  const openTickets = o?.openTickets ?? 0;
  return [
    {
      label: "待审核认证",
      value: formatNumber(pendingVerifications),
      meta: "租户实名待复核",
      tone: pendingVerifications > 0 ? "warning" : "success",
      href: "/verifications",
    },
    {
      // 双过滤与 openRiskCount 口径对齐（governance-write-paths.md §5）。
      label: "待处理风险",
      value: formatNumber(openRisk),
      meta: "风险记录待处置",
      tone: openRisk > 0 ? "danger" : "success",
      href: "/risk-records?reviewed=false&riskLevel=follow_up,high",
    },
    {
      label: "未结工单",
      value: formatNumber(openTickets),
      meta: "支持工单待跟进",
      tone: openTickets > 0 ? "warning" : "success",
      href: "/tickets",
    },
    {
      label: "在营订阅",
      value: formatNumber(o?.activeSubscriptions ?? 0),
      meta: "生效中的订阅",
      tone: "brand",
      href: "/subscriptions",
    },
  ];
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("zh-CN").format(value);
}

function isPrivateProvider(provider: string) {
  return ["private", "custom", "self-hosted"].includes(provider);
}

/** 模型三态的中文标签。三值压成布尔会让「已弃用」读成「已停用」，而前者仍在服务。 */
const MODEL_STATE_LABEL: Record<ModelState, string> = {
  active: "启用",
  inactive: "停用",
  deprecated: "已弃用",
};

function buildAutonomyMetrics(
  models: AiModelRecord[],
  overview: PlatformOverview | null,
): AutonomyMetric[] {
  /* 数**还能服务的**：`deprecated` 仍可解析，把它排除掉会低报平台的模型面。 */
  const activeModels = models.filter((model) => isServing(model.state)).length;
  const o = overview;

  return [
    {
      label: "模型平台",
      value: formatNumber(models.length),
      detail: `自治域已接入 ${formatNumber(activeModels)} 个启用模型，停用模型 ${formatNumber(models.length - activeModels)} 个。`,
      icon: "cloud",
      tone: "brand",
    },
    {
      label: "平台用户",
      value: formatNumber(o?.operatorCount ?? 0),
      detail: "内部运营账号接入平台角色、MFA 和审计边界。",
      icon: "user",
      tone: "success",
    },
    {
      label: "租户",
      value: formatNumber(o?.tenantCount ?? 0),
      detail: "已入驻租户纳入平台治理、计费与审计边界。",
      icon: "server",
      tone: "brand",
    },
    {
      label: "待审批",
      value: formatNumber(o?.pendingVerifications ?? 0),
      detail: "待复核的实名认证进入审批中心与确认链路。",
      icon: "check",
      tone: (o?.pendingVerifications ?? 0) > 0 ? "warning" : "success",
    },
  ];
}

/** 面板头右端的入口。与总览页同一个写法。 */
function DetailLink({ href, label }: { href: string; label: string }) {
  return (
    <Link className="admin-overview-panel-detail" href={href}>
      {label}
    </Link>
  );
}

const RESOURCE_COLUMNS: readonly DataTableColumn<ResourceRow>[] = [
  {
    id: "subject",
    header: "主体",
    cell: (row) => <strong>{row.subject}</strong>,
  },
  { id: "key", header: "标识", cell: (row) => row.key },
  { id: "model", header: "模型", cell: (row) => row.model },
  { id: "quota", header: "配额", cell: (row) => row.quota, align: "right" },
  { id: "usage", header: "用量", cell: (row) => row.usage, align: "right" },
  {
    id: "status",
    header: "状态",
    align: "center",
    cell: (row) => (
      <StatusBadge tone={row.status === "启用" ? "success" : "neutral"}>
        {row.status}
      </StatusBadge>
    ),
  },
];

function buildResourceRows(
  models: AiModelRecord[],
  grants: AiModelGrantRecord[],
): ResourceRow[] {
  const grantCountByModelId = grants.reduce((counts, grant) => {
    counts.set(grant.modelId, (counts.get(grant.modelId) ?? 0) + 1);
    return counts;
  }, new Map<string, number>());

  return models.map((model) => ({
    subject: isPrivateProvider(model.provider) ? "自建模型" : "三方模型",
    key: `${model.provider} / ${model.protocol}`,
    model: model.modelName,
    quota: `${formatNumber(model.capabilities.length)} 项能力`,
    usage: `${formatNumber(grantCountByModelId.get(model.id) ?? 0)} 条授权`,
    /* 三值，别压成布尔——「已弃用」不是「已停用」，前者仍在服务。 */
    status: MODEL_STATE_LABEL[model.state],
  }));
}

export function PlatformAutonomyPage() {
  const [models, setModels] = useState<AiModelRecord[]>([]);
  const [grants, setGrants] = useState<AiModelGrantRecord[]>([]);
  const [loadingResources, setLoadingResources] = useState(true);
  const [resourceError, setResourceError] = useState<string | null>(null);
  const [overview, setOverview] = useState<PlatformOverview | null>(null);

  // 平台总览真实聚合（B15）：独立读取，模型资源读取失败不影响总览指标。
  useEffect(() => {
    let active = true;
    fetchPlatformOverview().then((next) => {
      if (active) setOverview(next);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    setLoadingResources(true);
    setResourceError(null);

    Promise.all([fetchAiModels(true), fetchAiModelGrants()])
      .then(([modelRecords, grantRecords]) => {
        if (!active) return;
        setModels(modelRecords);
        setGrants(grantRecords);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setModels([]);
        setGrants([]);
        setResourceError(
          error instanceof Error
            ? error.message
            : "Model Platform 数据读取失败",
        );
      })
      .finally(() => {
        if (active) setLoadingResources(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const autonomyMetrics = useMemo(
    () => buildAutonomyMetrics(models, overview),
    [models, overview],
  );
  const operationRows = useMemo(() => buildOperationRows(overview), [overview]);
  const resourceRows = useMemo(
    () => buildResourceRows(models, grants),
    [models, grants],
  );

  return (
    <DashboardTemplate
      className="platform-autonomy-page"
      header={
        <PageHeader
          icon="shield-check"
          title="平台总览"
          description="平台自治域只管理平台自身的身份、资源、运行、安全和审计；租户运营、订阅交易和客户服务保持在运营业务域。"
        />
      }
      metrics={
        <MetricGrid
          aria-label="平台自治态势"
          items={autonomyMetrics.map((metric) => ({
            id: metric.label,
            label: metric.label,
            value: metric.value,
            icon: metric.icon,
            tone: metric.tone,
            // 口径是整句，落在标签行的 `?` 里；常驻会把一排卡撑成一排段落。
            help: metric.detail,
          }))}
        />
      }
      entries={
        <div className="grid gap-md sm:grid-cols-2 lg:grid-cols-4">
          {autonomyDomains.map((domain) => (
            <PanelCard
              key={domain.title}
              icon={domain.icon}
              title={domain.title}
              description={domain.description}
            >
              <PanelList>
                {domain.links.map((link) => (
                  <PanelItem
                    key={link.href}
                    main={
                      <Link href={link.href} className="block">
                        <TableTitleCell
                          title={link.label}
                          description={link.meta}
                        />
                      </Link>
                    }
                    trail={
                      <Icon
                        name="chevron-right"
                        size="sm"
                        fallback="chevron-right"
                        aria-hidden="true"
                      />
                    }
                  />
                ))}
              </PanelList>
            </PanelCard>
          ))}
        </div>
      }
    >
      <div className="grid gap-md lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <PanelCard
          title="平台资源"
          description="一期只支持 tenant 与 platform 两类主体，平台不进入租户表，但拥有独立模型配额和统计归属。"
          action={<DetailLink href="/model-grants" label="模型授权" />}
        >
          <DataTable
            columns={RESOURCE_COLUMNS}
            rows={resourceRows}
            rowKey={(row) => `${row.key}-${row.model}`}
            loading={loadingResources}
            loadingRows={3}
            empty={
              <EmptyState
                title={resourceError ? "模型资源读取失败" : "暂无模型"}
                description={resourceError ?? "尚未接入模型资源。"}
              />
            }
          />
        </PanelCard>

        <PanelCard
          title="待处理风险"
          description="面向平台控制面，不展示租户运营事项。"
        >
          <PanelList>
            {operationRows.map((row) => (
              <PanelItem
                key={row.label}
                main={
                  <Link href={row.href} className="block">
                    <TableTitleCell title={row.label} description={row.meta} />
                  </Link>
                }
                trail={<StatusBadge tone={row.tone}>{row.value}</StatusBadge>}
              />
            ))}
          </PanelList>
        </PanelCard>
      </div>
    </DashboardTemplate>
  );
}
