"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  ActionMenu,
  Button,
  DataTable,
  DialogForm,
  EmptyState,
  FilterBar,
  Icon,
  Input,
  Label,
  ListPageTemplate,
  MetricGrid,
  NativeSelect,
  StatusBadge,
  TableTitleCell,
  Textarea,
  useToast,
} from "@vxture/design-system";
import {
  archiveFeatureFlag,
  createFeatureFlag,
  fetchFeatureFlags,
  toggleFeatureFlag,
  updateFeatureFlag,
  type FeatureFlagWriteInput,
} from "@/api/arche-bff";
import type { DataTableColumn } from "@vxture/design-system";
import type { FeatureFlagRecord } from "@/entities/console";
import { PageHeader } from "@/modules/shared/PageHeader";
import { ListPagination } from "@/modules/shared/ListPagination";
import { type PageSize } from "@/modules/shared/PageSizePicker";
import { formatDate } from "@/lib/format";

// P2 占位板块建设：功能开关（admin.feature_flags）。全局开关 + 灰度百分比 +
// 逐租户覆盖（tenant_overrides，本页只读携带、不在 UI 编辑）+ 归档。
// 能力守卫：读 release:feature_flag.read|.manage，写 .manage（seed §4.3）。

type ArchivedFilter = "active" | "archived" | "all";
type DialogMode = "create" | "edit" | null;

interface FlagForm {
  flagKey: string;
  category: string;
  environment: string;
  description: string;
  rolloutPercentage: string;
  expiresAt: string;
  // Carried verbatim so an edit does not wipe per-tenant overrides set elsewhere.
  tenantOverrides: Record<string, boolean>;
}

function toLocalInputValue(date: Date) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function isoToLocalInput(value: string | null) {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : toLocalInputValue(d);
}

function createDefaultForm(): FlagForm {
  return {
    flagKey: "",
    category: "release",
    environment: "all",
    description: "",
    rolloutPercentage: "0",
    expiresAt: "",
    tenantOverrides: {},
  };
}

function formFromRecord(item: FeatureFlagRecord): FlagForm {
  return {
    flagKey: item.flagKey,
    category: item.category,
    environment: item.environment,
    description: item.description ?? "",
    rolloutPercentage: String(item.rolloutPercentage),
    expiresAt: isoToLocalInput(item.expiresAt),
    tenantOverrides: item.tenantOverrides,
  };
}

function buildPayload(
  form: FlagForm,
  includeKey: boolean,
): FeatureFlagWriteInput {
  const rollout = Number(form.rolloutPercentage);
  return {
    ...(includeKey ? { flagKey: form.flagKey.trim() } : {}),
    category: form.category.trim() || "release",
    environment: form.environment.trim() || "all",
    description: form.description.trim() || null,
    rolloutPercentage: Number.isFinite(rollout) ? rollout : 0,
    tenantOverrides: form.tenantOverrides,
    expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
  };
}

function describeError(error: unknown): { description?: string } {
  return error instanceof Error && error.message
    ? { description: error.message }
    : {};
}

function formIsValid(form: FlagForm, mode: DialogMode) {
  const rollout = Number(form.rolloutPercentage);
  const rolloutOk = Number.isInteger(rollout) && rollout >= 0 && rollout <= 100;
  const keyOk =
    mode !== "create" ||
    (/^[a-z0-9][a-z0-9._-]*$/i.test(form.flagKey.trim()) &&
      form.flagKey.trim().length > 0);
  return keyOk && rolloutOk;
}

function overrideSummary(overrides: Record<string, boolean>): string {
  const n = Object.keys(overrides).length;
  return n === 0 ? "无" : `${n} 个租户`;
}

/* 从模块级常量改成收 `locale` 的工厂：常量在模块加载时就求值了，那一刻
   没有任何运行时上下文，而列里的日期要按界面语言排。 */
function columnsOf(
  locale: string,
): readonly DataTableColumn<FeatureFlagRecord>[] {
  return [
    {
      id: "key",
      header: "开关键 / 分类",
      cell: (item) => (
        <TableTitleCell
          title={item.flagKey}
          description={`${item.category}${item.isArchived ? " · 已归档" : ""}`}
        />
      ),
    },
    { id: "environment", header: "环境", cell: (item) => item.environment },
    {
      id: "status",
      header: "状态",
      align: "center",
      cell: (item) => (
        <StatusBadge tone={item.isGloballyEnabled ? "success" : "neutral"}>
          {item.isGloballyEnabled ? "已启用" : "已停用"}
        </StatusBadge>
      ),
    },
    {
      id: "rollout",
      header: "灰度",
      align: "right",
      cell: (item) => `${item.rolloutPercentage}%`,
    },
    {
      id: "updatedAt",
      header: "更新时间",
      cell: (item) => formatDate(item.updatedAt, locale),
    },
  ];
}

export function FeatureTogglesPage() {
  const locale = useLocale();
  /* 钉在 locale 上：工厂每次调用都新建数组，而这套列此前是模块常量、
     身份稳定。不 memo 等于每次渲染换一套列。 */
  const tableColumns = useMemo(() => columnsOf(locale), [locale]);
  const tShared = useTranslations();
  const { toast } = useToast();
  const [items, setItems] = useState<FeatureFlagRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [environmentFilter, setEnvironmentFilter] = useState<string>("all");
  const [archivedFilter, setArchivedFilter] =
    useState<ArchivedFilter>("active");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(20);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [dialogMode, setDialogMode] = useState<DialogMode>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FlagForm>(createDefaultForm);
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    setItems(await fetchFeatureFlags({ archived: "all" }));
  }

  useEffect(() => {
    load()
      .catch((error) =>
        toast({ tone: "danger", title: "加载失败", ...describeError(error) }),
      )
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const categories = useMemo(
    () => Array.from(new Set(items.map((i) => i.category))).sort(),
    [items],
  );
  const environments = useMemo(
    () => Array.from(new Set(items.map((i) => i.environment))).sort(),
    [items],
  );

  const filtered = useMemo(() => {
    let result = items;
    if (archivedFilter === "active")
      result = result.filter((i) => !i.isArchived);
    else if (archivedFilter === "archived")
      result = result.filter((i) => i.isArchived);
    if (categoryFilter !== "all")
      result = result.filter((i) => i.category === categoryFilter);
    if (environmentFilter !== "all")
      result = result.filter((i) => i.environment === environmentFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter((i) =>
        [i.flagKey, i.description ?? "", i.category, i.environment]
          .join(" ")
          .toLowerCase()
          .includes(q),
      );
    }
    return result;
  }, [items, search, categoryFilter, environmentFilter, archivedFilter]);

  const pageItems = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize]);
  const pageCount = Math.ceil(filtered.length / pageSize);

  function openCreate() {
    setEditingId(null);
    setForm(createDefaultForm());
    setDialogMode("create");
  }

  function openEdit(item: FeatureFlagRecord) {
    setEditingId(item.id);
    setForm(formFromRecord(item));
    setDialogMode("edit");
  }

  function closeDialog() {
    if (submitting) return;
    setDialogMode(null);
    setEditingId(null);
  }

  async function submitForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!formIsValid(form, dialogMode)) return;
    setSubmitting(true);
    try {
      if (dialogMode === "edit" && editingId) {
        await updateFeatureFlag(editingId, buildPayload(form, false));
        toast({ tone: "success", title: "功能开关已更新" });
      } else {
        await createFeatureFlag(buildPayload(form, true));
        toast({ tone: "success", title: "功能开关已创建" });
      }
      await load();
      setDialogMode(null);
      setEditingId(null);
    } catch (error) {
      toast({ tone: "danger", title: "保存失败", ...describeError(error) });
    } finally {
      setSubmitting(false);
    }
  }

  async function runAction(label: string, action: () => Promise<unknown>) {
    setSubmitting(true);
    try {
      await action();
      await load();
      toast({ tone: "success", title: label });
    } catch (error) {
      toast({ tone: "danger", title: `${label}失败`, ...describeError(error) });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <ListPageTemplate
        className="vx-feature-flag-page"
        header={
          <PageHeader
            icon="settings"
            title="功能开关"
            description="管理平台功能开关：全局启停、灰度百分比与逐租户覆盖。灰度按 flag_key 匹配，逐租户覆盖命中优先于灰度百分比。"
          />
        }
        summary={
          <MetricGrid
            loading={loading}
            aria-label="功能开关统计"
            columns={3}
            items={[
              {
                id: "total",
                help: "未归档的开关数。",
                icon: "list",
                label: "开关总数",
                value: String(items.filter((i) => !i.isArchived).length),
              },
              {
                id: "enabled",
                help: "未归档且全局已启用的开关；按租户灰度的不计入。",
                icon: "check",
                label: "已启用",
                value: String(
                  items.filter((i) => !i.isArchived && i.isGloballyEnabled)
                    .length,
                ),
              },
              {
                id: "archived",
                help: "已归档、不再参与发布的开关。",
                icon: "clock-counter-clockwise",
                label: "已归档",
                value: String(items.filter((i) => i.isArchived).length),
              },
            ]}
          />
        }
        filters={
          <FilterBar
            view="list"
            onViewChange={() => {}}
            cardsDisabledReason="卡片视图已下线，改用列表"
            count={`${filtered.length}条`}
            aria-label="功能开关筛选"
            search={
              <Input
                className="grow basis-media-3xl max-w-panel-sm"
                type="search"
                placeholder="搜索开关键、描述、分类…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
              />
            }
            onReset={() => {
              setSearch("");
              setCategoryFilter("all");
              setEnvironmentFilter("all");
              setArchivedFilter("all");
              setPage(1);
            }}
            actions={
              <>
                <Button
                  variant="default"
                  size="md"
                  onClick={openCreate}
                  title="新建功能开关"
                >
                  <Icon name="plus" size="sm" fallback="placeholder" />
                  新建开关
                </Button>
              </>
            }
          >
            <NativeSelect
              wrapperClassName="w-fit basis-media-xl"
              value={categoryFilter}
              onChange={(e) => {
                setCategoryFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="all">全部分类</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect
              wrapperClassName="w-fit basis-media-xl"
              value={environmentFilter}
              onChange={(e) => {
                setEnvironmentFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="all">全部环境</option>
              {environments.map((env) => (
                <option key={env} value={env}>
                  {env}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect
              wrapperClassName="w-fit basis-media-xl"
              value={archivedFilter}
              onChange={(e) => {
                setArchivedFilter(e.target.value as ArchivedFilter);
                setPage(1);
              }}
            >
              <option value="active">未归档</option>
              <option value="archived">已归档</option>
              <option value="all">全部</option>
            </NativeSelect>
          </FilterBar>
        }
        table={
          <DataTable
            columns={tableColumns}
            rows={pageItems}
            rowKey={(item) => item.id}
            loading={loading}
            indexStart={(page - 1) * pageSize + 1}
            selectedKeys={[...selectedIds]}
            onSelectionChange={(keys) => setSelectedIds(new Set(keys))}
            rowActions={(item) => (
              <ActionMenu
                label="功能开关操作"
                disabled={submitting}
                items={[
                  {
                    id: "toggle",
                    label: item.isGloballyEnabled
                      ? tShared("actions.disable")
                      : tShared("actions.enable"),
                    icon: item.isGloballyEnabled ? "x" : "check",
                    disabled: submitting || item.isArchived,
                    onSelect: () =>
                      void runAction(
                        item.isGloballyEnabled ? "已停用" : "已启用",
                        () => toggleFeatureFlag(item.id),
                      ),
                  },
                  {
                    id: "edit",
                    label: tShared("actions.edit"),
                    icon: "edit",
                    disabled: submitting || item.isArchived,
                    onSelect: () => openEdit(item),
                  },
                  {
                    id: "archive",
                    label: item.isArchived
                      ? "恢复"
                      : tShared("actions.archive"),
                    icon: item.isArchived ? "clock-counter-clockwise" : "stop",
                    disabled: submitting,
                    onSelect: () =>
                      void runAction(
                        item.isArchived ? "已恢复" : "已归档",
                        () => archiveFeatureFlag(item.id, !item.isArchived),
                      ),
                  },
                ]}
              />
            )}
            empty={
              <EmptyState
                title="暂无功能开关"
                description={
                  search ||
                  categoryFilter !== "all" ||
                  environmentFilter !== "all" ||
                  archivedFilter !== "all"
                    ? tShared("common.adjustFiltersHint")
                    : "点击「新建开关」创建第一个功能开关"
                }
              />
            }
            footer={
              <ListPagination
                currentPage={page}
                pageCount={pageCount}
                total={filtered.length}
                pageSize={pageSize}
                onPageSizeChange={(size) => {
                  setPageSize(size);
                  setPage(1);
                }}
                onPageChange={setPage}
              />
            }
          />
        }
      />

      {dialogMode ? (
        <DialogForm
          open
          title={dialogMode === "create" ? "新建功能开关" : "编辑功能开关"}
          description="灰度百分比 0-100；逐租户覆盖命中优先于灰度。开关键创建后不可更改。"
          submitLabel={
            dialogMode === "create" ? tShared("actions.create") : "保存"
          }
          submitting={submitting}
          submitDisabled={!formIsValid(form, dialogMode)}
          onOpenChange={(open) => {
            if (!open) closeDialog();
          }}
          onSubmit={(event) => void submitForm(event)}
        >
          <div>
            <Label>
              开关键
              <Input
                value={form.flagKey}
                onChange={(e) => setForm({ ...form, flagKey: e.target.value })}
                placeholder="如 billing.new_invoice_flow"
                disabled={dialogMode === "edit"}
                required
              />
            </Label>
            <Label>
              分类
              <Input
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                placeholder="release"
              />
            </Label>
          </div>
          <div>
            <Label>
              环境
              <Input
                value={form.environment}
                onChange={(e) =>
                  setForm({ ...form, environment: e.target.value })
                }
                placeholder="all"
              />
            </Label>
            <Label>
              灰度百分比
              <Input
                type="number"
                min={0}
                max={100}
                value={form.rolloutPercentage}
                onChange={(e) =>
                  setForm({ ...form, rolloutPercentage: e.target.value })
                }
              />
            </Label>
          </div>
          <Label>
            过期时间（可选）
            <Input
              type="datetime-local"
              value={form.expiresAt}
              onChange={(e) => setForm({ ...form, expiresAt: e.target.value })}
            />
          </Label>
          <Label>
            描述
            <Textarea
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
              placeholder="说明该开关的用途与影响范围"
              rows={3}
              maxLength={512}
            />
          </Label>
          {Object.keys(form.tenantOverrides).length > 0 ? (
            <p className="m-0 text-body-sm text-muted-foreground">
              逐租户覆盖：{overrideSummary(form.tenantOverrides)}
              （本页保留不变，逐租户配置在专用界面维护）
            </p>
          ) : null}
        </DialogForm>
      ) : null}
    </>
  );
}
