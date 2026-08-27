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
  Pagination,
  StatusBadge,
  Textarea,
  useToast,
} from "@vxture/design-system";
import {
  assignComplianceEvent,
  createComplianceEvent,
  deleteComplianceEvent,
  dismissComplianceEvent,
  fetchComplianceEvents,
  fetchPlatformAdmins,
  resolveComplianceEvent,
  updateComplianceEvent,
  type ComplianceEventWriteInput,
} from "@/api/admin-bff";
import type { DataTableColumn, StatusBadgeTone } from "@vxture/design-system";
import type { ComplianceEventItem } from "@/entities/console";
import { PageHeader } from "@/modules/shared/PageHeader";
import { formatDate } from "@/modules/tenants/tenant-utils";
import { useConfirmLabels } from "@/modules/shared/destructive";

// TD-021 合规事件页。设计权威 = governance-write-paths.md §3.2/§5。
// 状态机 open→(指派)in_review→resolved / open|in_review→dismissed；终态只读；
// 软删仅限终态（后端强制）。

type StatusFilter = ComplianceEventItem["status"] | "all";
type DialogMode = "create" | "edit" | null;

interface EventForm {
  tenantId: string;
  eventType: string;
  regulationCode: string;
  evidenceUrl: string;
  tags: string;
}

const PAGE_SIZE = 20;

const STATUS_LABELS: Record<ComplianceEventItem["status"], string> = {
  open: "待处理",
  in_review: "处理中",
  resolved: "已办结",
  dismissed: "已驳回",
};

/** 合规事件状态 -> DS 语气。业务状态到语气的映射留产品侧。 */
function statusTone(status: ComplianceEventItem["status"]): StatusBadgeTone {
  if (status === "open") return "warning";
  if (status === "in_review") return "info";
  if (status === "resolved") return "success";
  return "neutral";
}

const TERMINAL: ReadonlySet<ComplianceEventItem["status"]> = new Set([
  "resolved",
  "dismissed",
]);

function createDefaultForm(): EventForm {
  return {
    tenantId: "",
    eventType: "",
    regulationCode: "",
    evidenceUrl: "",
    tags: "",
  };
}

function formFromRecord(item: ComplianceEventItem): EventForm {
  return {
    tenantId: item.tenantId ?? "",
    eventType: item.eventType,
    regulationCode: item.regulationCode ?? "",
    evidenceUrl: item.evidenceUrl ?? "",
    tags: item.tags.join(", "),
  };
}

function buildPayload(form: EventForm): ComplianceEventWriteInput {
  return {
    tenantId: form.tenantId.trim() || null,
    eventType: form.eventType.trim(),
    regulationCode: form.regulationCode.trim() || null,
    evidenceUrl: form.evidenceUrl.trim() || null,
    tags: form.tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean),
  };
}

function describeError(error: unknown): { description?: string } {
  return error instanceof Error && error.message
    ? { description: error.message }
    : {};
}

interface HandlerOption {
  id: string;
  name: string;
}

/* 从模块级常量改成收 `locale` 的工厂：常量在模块加载时就求值了，那一刻
   没有任何运行时上下文，而列里的日期要按界面语言排。 */
function columnsOf(
  locale: string,
): readonly DataTableColumn<ComplianceEventItem>[] {
  return [
    {
      id: "eventType",
      header: "事件类型",
      cell: (item) => (
        <span className="flex min-w-0 items-center gap-xs">
          <span className="truncate">{item.eventType}</span>
          {item.evidenceUrl ? (
            <a
              href={item.evidenceUrl}
              target="_blank"
              rel="noreferrer"
              title="查看证据材料"
              onClick={(event) => event.stopPropagation()}
            >
              <Icon name="arrow-long-right" size="xs" fallback="placeholder" />
            </a>
          ) : null}
        </span>
      ),
    },
    {
      id: "tenant",
      header: "租户",
      cell: (item) =>
        item.tenantName ?? (item.tenantId ? item.tenantId : "平台级"),
    },
    {
      id: "status",
      header: "状态",
      align: "center",
      cell: (item) => (
        <StatusBadge tone={statusTone(item.status)}>
          {STATUS_LABELS[item.status]}
        </StatusBadge>
      ),
    },
    {
      id: "regulation",
      header: "法规条款",
      cell: (item) => item.regulationCode ?? "-",
    },
    {
      id: "handler",
      header: "处理人",
      cell: (item) => item.handlerName ?? "-",
    },
    {
      id: "updatedAt",
      header: "更新时间",
      cell: (item) => formatDate(item.updatedAt, locale),
    },
  ];
}

export function ComplianceEventsPage() {
  const locale = useLocale();
  /* 钉在 locale 上：工厂每次调用都新建数组，而这套列此前是模块常量、
     身份稳定。不 memo 等于每次渲染换一套列。 */
  const tableColumns = useMemo(() => columnsOf(locale), [locale]);
  const tShared = useTranslations();
  const withLabels = useConfirmLabels();
  const { toast } = useToast();
  const [items, setItems] = useState<ComplianceEventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [dialogMode, setDialogMode] = useState<DialogMode>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<EventForm>(createDefaultForm);
  const [submitting, setSubmitting] = useState(false);
  const [assignTarget, setAssignTarget] = useState<ComplianceEventItem | null>(
    null,
  );
  const [handlerOptions, setHandlerOptions] = useState<HandlerOption[]>([]);
  const [handlerId, setHandlerId] = useState("");

  useEffect(() => {
    fetchComplianceEvents()
      .then(setItems)
      .catch((error) => {
        setItems([]);
        setLoadError(
          error instanceof Error ? error.message : "合规事件读取失败",
        );
      })
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    let result = items;
    if (statusFilter !== "all")
      result = result.filter((i) => i.status === statusFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter((i) =>
        [
          i.eventType,
          i.tenantName ?? "",
          i.regulationCode ?? "",
          i.handlerName ?? "",
          ...i.tags,
        ]
          .join(" ")
          .toLowerCase()
          .includes(q),
      );
    }
    return result;
  }, [items, search, statusFilter]);

  const pageItems = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, page]);
  const pageCount = Math.ceil(filtered.length / PAGE_SIZE);

  async function reload() {
    setItems(await fetchComplianceEvents());
  }

  function openCreate() {
    setEditingId(null);
    setForm(createDefaultForm());
    setDialogMode("create");
  }

  function openEdit(item: ComplianceEventItem) {
    setEditingId(item.id);
    setForm(formFromRecord(item));
    setDialogMode("edit");
  }

  function closeDialog() {
    setDialogMode(null);
    setEditingId(null);
  }

  async function openAssign(item: ComplianceEventItem) {
    setAssignTarget(item);
    setHandlerId(item.handlerId ?? "");
    if (handlerOptions.length === 0) {
      try {
        const admins = await fetchPlatformAdmins();
        setHandlerOptions(
          admins
            .filter((a) => a.statusCode === "active")
            .map((a) => ({ id: a.id, name: a.displayName || a.username })),
        );
      } catch {
        // 拉取失败时仍可手填 handler uuid（选项为空 → 显示提示）。
      }
    }
  }

  async function submitForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (form.eventType.trim().length === 0) return;
    setSubmitting(true);
    try {
      if (dialogMode === "edit" && editingId) {
        await updateComplianceEvent(editingId, buildPayload(form));
        toast({ tone: "success", title: "合规事件已更新" });
      } else {
        await createComplianceEvent(buildPayload(form));
        toast({ tone: "success", title: "合规事件已创建" });
      }
      await reload();
      closeDialog();
    } catch (error) {
      toast({ tone: "danger", title: "保存失败", ...describeError(error) });
    } finally {
      setSubmitting(false);
    }
  }

  /**
   * 跑一个写操作并统一出 Toast。
   *
   * **返回成败**（2026-08-26）：此前它吞掉异常且不返回任何东西，于是调用方无从
   * 知道成没成。接上 DS 的破坏性确认件之后这一点成了语义——件按 Promise 是否
   * rejected 决定关不关框，一个永远 resolve 的落锤会让失败的删除看起来成功。
   */
  async function runAction(
    label: string,
    action: () => Promise<unknown>,
  ): Promise<boolean> {
    setSubmitting(true);
    try {
      await action();
      await reload();
      toast({ tone: "success", title: label });
      return true;
    } catch (error) {
      toast({ tone: "danger", title: `${label}失败`, ...describeError(error) });
      return false;
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmAssign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!assignTarget || !handlerId) return;
    const target = assignTarget;
    setAssignTarget(null);
    await runAction("已指派处理人", () =>
      assignComplianceEvent(target.id, handlerId),
    );
  }

  /* 收参数而不是读 `pendingDelete`：确认由菜单项承担，那一项知道自己作用在哪
     一行。失败重新抛出——DS 的确认件按 Promise 是否 rejected 决定关不关框，
     `runAction` 自己吞异常，所以这里把它的成败翻译回一个 rejected。 */
  async function confirmDelete(target: ComplianceEventItem) {
    const ok = await runAction("合规事件已删除", () =>
      deleteComplianceEvent(target.id),
    );
    if (ok === false) throw new Error("合规事件删除失败");
  }

  return (
    <>
      <ListPageTemplate
        className="vx-compliance-page"
        header={
          <PageHeader
            icon="shield-check"
            title="合规事件"
            description="跟踪平台与租户合规事件：指派处理人、办结与驳回、证据留存。"
          />
        }
        summary={
          <MetricGrid
            loading={loading}
            aria-label="合规事件统计"
            columns={3}
            items={[
              {
                id: "open",
                help: "状态为待处理、尚未有人受理的合规事件。",
                icon: "warning",
                label: tShared("status.generic.pending"),
                value: String(items.filter((i) => i.status === "open").length),
              },
              {
                id: "in_review",
                help: "已受理、处理中的合规事件。",
                icon: "clock",
                label: tShared("status.generic.processing"),
                value: String(
                  items.filter((i) => i.status === "in_review").length,
                ),
              },
              {
                id: "resolved",
                help: "已办结的合规事件。",
                icon: "check",
                label: "已办结",
                value: String(
                  items.filter((i) => i.status === "resolved").length,
                ),
              },
            ]}
          />
        }
        filters={
          <FilterBar
            count={`${filtered.length}条`}
            aria-label="合规事件筛选"
            search={
              <Input
                className="grow basis-media-3xl max-w-panel-sm"
                type="search"
                placeholder="搜索事件类型、租户、法规、处理人…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
              />
            }
            onReset={() => {
              setSearch("");
              setStatusFilter("all");
              setPage(1);
            }}
            actions={
              <>
                <Button
                  variant="default"
                  size="md"
                  onClick={openCreate}
                  title="新建合规事件"
                >
                  <Icon name="plus" size="sm" fallback="placeholder" />
                  新建事件
                </Button>
              </>
            }
          >
            <NativeSelect
              wrapperClassName="w-fit basis-media-xl"
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value as StatusFilter);
                setPage(1);
              }}
            >
              <option value="all">{tShared("filters.allStates")}</option>
              <option value="open">{tShared("status.generic.pending")}</option>
              <option value="in_review">
                {tShared("status.generic.processing")}
              </option>
              <option value="resolved">已办结</option>
              <option value="dismissed">
                {tShared("status.generic.rejected")}
              </option>
            </NativeSelect>
          </FilterBar>
        }
        table={
          <DataTable
            columns={tableColumns}
            rows={pageItems}
            rowKey={(item) => item.id}
            loading={loading}
            indexStart={(page - 1) * PAGE_SIZE + 1}
            selectedKeys={[...selectedIds]}
            onSelectionChange={(keys) => setSelectedIds(new Set(keys))}
            rowActions={(item) => (
              <ActionMenu
                label="合规事件操作"
                disabled={submitting}
                items={[
                  {
                    id: "assign",
                    label: item.handlerId ? "改派处理人" : "指派处理人",
                    icon: "user",
                    disabled: submitting || TERMINAL.has(item.status),
                    onSelect: () => void openAssign(item),
                  },
                  {
                    id: "resolve",
                    label: "办结",
                    icon: "check",
                    disabled:
                      submitting ||
                      item.status !== "in_review" ||
                      !item.handlerId,
                    onSelect: () =>
                      void runAction("事件已办结", () =>
                        resolveComplianceEvent(item.id),
                      ),
                  },
                  {
                    id: "dismiss",
                    label: "驳回（误报/不适用）",
                    icon: "stop",
                    disabled: submitting || TERMINAL.has(item.status),
                    onSelect: () =>
                      void runAction("事件已驳回", () =>
                        dismissComplianceEvent(item.id),
                      ),
                  },
                  {
                    id: "edit",
                    label: tShared("actions.edit"),
                    icon: "edit",
                    disabled: submitting || TERMINAL.has(item.status),
                    onSelect: () => openEdit(item),
                  },
                  {
                    id: "delete",
                    label: "删除（仅终态）",
                    icon: "trash",
                    danger: true,
                    disabled: submitting || !TERMINAL.has(item.status),
                    separatorBefore: true,
                    confirm: withLabels({
                      verb: "删除",
                      target: `合规事件「${item.eventType}」`,
                      consequence:
                        "记录被软删并从列表隐藏，不可在界面上恢复。它在审计追加表里的痕迹不受影响——那份是另一套存储，与这一行没有外键关系。",
                      /* 「仅终态」此前只写在标签里（「删除（仅终态）」）和
                         `disabled` 上——点不开，但说不出为什么。接成 `met` 之后
                         框里能看见是哪一条挡的。 */
                      preconditions: [
                        {
                          label: "事件已进入终态",
                          met: TERMINAL.has(item.status),
                        },
                      ],
                      onConfirm: () => confirmDelete(item),
                    }),
                  },
                ]}
              />
            )}
            empty={
              <EmptyState
                title={loadError ? "合规事件读取失败" : "暂无合规事件"}
                description={
                  loadError ??
                  (search || statusFilter !== "all"
                    ? tShared("common.adjustFiltersHint")
                    : "点击「新建事件」录入第一条合规事件")
                }
              />
            }
            footer={
              pageCount > 1 ? (
                <Pagination
                  page={page}
                  pageCount={pageCount}
                  total={filtered.length}
                  pageSize={PAGE_SIZE}
                  onPageChange={setPage}
                />
              ) : null
            }
          />
        }
      />

      {dialogMode ? (
        <DialogForm
          open
          title={dialogMode === "create" ? "新建合规事件" : "编辑合规事件"}
          description="事件登记后经「指派处理人」进入处理，办结/驳回后只读。"
          submitLabel={
            dialogMode === "create" ? tShared("actions.create") : "保存修改"
          }
          submitting={submitting}
          submitDisabled={form.eventType.trim().length === 0}
          onOpenChange={(open) => {
            if (!open) closeDialog();
          }}
          onSubmit={(event) => void submitForm(event)}
        >
          <div>
            <Label>
              事件类型
              <Input
                value={form.eventType}
                maxLength={64}
                onChange={(e) =>
                  setForm((f) => ({ ...f, eventType: e.target.value }))
                }
                placeholder="如 kyc_review / content_takedown"
                required
              />
            </Label>
            <Label>
              法规条款（可选）
              <Input
                value={form.regulationCode}
                maxLength={64}
                onChange={(e) =>
                  setForm((f) => ({ ...f, regulationCode: e.target.value }))
                }
                placeholder="如 GDPR-32"
              />
            </Label>
          </div>
          <Label>
            关联租户 ID（可选，留空 = 平台级事件）
            <Input
              value={form.tenantId}
              onChange={(e) =>
                setForm((f) => ({ ...f, tenantId: e.target.value }))
              }
              placeholder="tenancy.tenants 的 uuid"
            />
          </Label>
          <Label>
            证据材料 URL（可选，仅 http/https）
            <Input
              type="url"
              value={form.evidenceUrl}
              onChange={(e) =>
                setForm((f) => ({ ...f, evidenceUrl: e.target.value }))
              }
              placeholder="https://…"
            />
          </Label>
          <Label>
            标签（逗号分隔，可选）
            <Textarea
              value={form.tags}
              onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))}
              rows={2}
              placeholder="如 kyc, quarterly"
            />
          </Label>
        </DialogForm>
      ) : null}

      {assignTarget ? (
        <DialogForm
          open
          title="指派处理人"
          description={`为「${assignTarget.eventType}」指定处理运营；首次指派后事件进入处理中。`}
          submitLabel="指派"
          submitting={submitting}
          submitDisabled={!handlerId}
          onOpenChange={(open) => {
            if (!open) setAssignTarget(null);
          }}
          onSubmit={(event) => void confirmAssign(event)}
        >
          <Label>
            处理人
            {handlerOptions.length > 0 ? (
              <NativeSelect
                value={handlerId}
                onChange={(e) => setHandlerId(e.target.value)}
              >
                <option value="">请选择</option>
                {handlerOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </NativeSelect>
            ) : (
              <Input
                value={handlerId}
                onChange={(e) => setHandlerId(e.target.value)}
                placeholder="处理人 operator uuid"
              />
            )}
          </Label>
        </DialogForm>
      ) : null}
    </>
  );
}
