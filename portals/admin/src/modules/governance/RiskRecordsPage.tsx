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
  TableTitleCell,
  Textarea,
  useToast,
} from "@vxture/design-system";
import {
  createRiskRecord,
  deleteRiskRecord,
  fetchRiskRecords,
  reviewRiskRecord,
  updateRiskRecord,
  type RiskRecordWriteInput,
} from "@/api/admin-bff";
import type { DataTableColumn, StatusBadgeTone } from "@vxture/design-system";
import type { RiskRecordItem } from "@/entities/console";
import { PageHeader } from "@/modules/shared/PageHeader";
import { TENANT_RISK_TONE, formatDate } from "@/modules/tenants/tenant-utils";
import { useConfirmLabels } from "@/modules/shared/destructive";

// TD-021 风险记录页。设计权威 = governance-write-paths.md §3.1/§5。
// 「审阅」= 后端写 reviewer_id；risk_level 变更后端自动清空 reviewer_id。

type LevelFilter = RiskRecordItem["riskLevel"] | "all";
type ReviewFilter = "all" | "reviewed" | "pending";
type DialogMode = "create" | "edit" | null;

interface RiskForm {
  tenantId: string;
  riskLevel: RiskRecordItem["riskLevel"];
  riskScore: string;
  scope: string;
  reason: string;
  tags: string;
}

const PAGE_SIZE = 20;

const LEVEL_LABELS: Record<RiskRecordItem["riskLevel"], string> = {
  normal: "常规",
  follow_up: "需跟进",
  high: "高风险",
};

/** 风险等级 -> DS 语气。业务状态到语气的映射留产品侧。 */
/**
 * 风险档：灰 / 琥珀 / 红。
 *
 * `normal` 走中性不走绿——判据同维护窗口的严重度（owner 2026-08-07）：六档里
 * `success` 是"达成了一件事"，而"无风险"不是一项达成。`tenant-utils.ts` 的
 * `TENANT_RISK_TONE` 早就是这么定的，本页当初另起了一份、给了绿，两处对同一个
 * 值域说了两种话。**同一值域只该有一张表**。
 */
function levelTone(level: RiskRecordItem["riskLevel"]): StatusBadgeTone {
  return TENANT_RISK_TONE[level];
}

function createDefaultForm(): RiskForm {
  return {
    tenantId: "",
    riskLevel: "normal",
    riskScore: "",
    scope: "",
    reason: "",
    tags: "",
  };
}

function formFromRecord(item: RiskRecordItem): RiskForm {
  return {
    tenantId: item.tenantId,
    riskLevel: item.riskLevel,
    riskScore: item.riskScore === null ? "" : String(item.riskScore),
    scope: item.scope ?? "",
    reason: item.reason,
    tags: item.tags.join(", "),
  };
}

function buildPayload(
  form: RiskForm,
  mode: "create" | "edit",
): RiskRecordWriteInput {
  const tags = form.tags
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  return {
    ...(mode === "create" ? { tenantId: form.tenantId.trim() } : {}),
    riskLevel: form.riskLevel,
    riskScore: form.riskScore === "" ? null : Number(form.riskScore),
    scope: form.scope.trim() || null,
    reason: form.reason.trim(),
    tags,
  };
}

function describeError(error: unknown): { description?: string } {
  return error instanceof Error && error.message
    ? { description: error.message }
    : {};
}

function formIsValid(form: RiskForm, mode: "create" | "edit") {
  if (form.reason.trim().length === 0) return false;
  if (mode === "create" && form.tenantId.trim().length === 0) return false;
  if (form.riskScore !== "") {
    const n = Number(form.riskScore);
    if (!Number.isInteger(n) || n < 0 || n > 100) return false;
  }
  return true;
}

/* 从模块级常量改成收 `locale` 的工厂：常量在模块加载时就求值了，那一刻
   没有任何运行时上下文，而列里的日期要按界面语言排。 */
function columnsOf(locale: string): readonly DataTableColumn<RiskRecordItem>[] {
  return [
    {
      id: "tenant",
      header: "租户",
      cell: (item) => (
        <TableTitleCell
          title={item.tenantName ?? item.tenantId}
          {...(item.tenantNo ? { description: `#${item.tenantNo}` } : {})}
        />
      ),
    },
    {
      id: "level",
      header: "等级",
      align: "center",
      cell: (item) => (
        <StatusBadge tone={levelTone(item.riskLevel)}>
          {LEVEL_LABELS[item.riskLevel]}
        </StatusBadge>
      ),
    },
    {
      id: "score",
      header: "评分",
      align: "right",
      cell: (item) => item.riskScore ?? "-",
    },
    { id: "scope", header: "范围", cell: (item) => item.scope ?? "-" },
    {
      id: "tags",
      header: "标签",
      cell: (item) => (item.tags.length > 0 ? item.tags.join(", ") : "-"),
    },
    {
      id: "reviewer",
      header: "审阅人",
      cell: (item) => item.reviewerName ?? "待审阅",
    },
    {
      id: "updatedAt",
      header: "更新时间",
      cell: (item) => formatDate(item.updatedAt, locale),
    },
  ];
}

export function RiskRecordsPage() {
  const locale = useLocale();
  /* 钉在 locale 上：工厂每次调用都新建数组，而这套列此前是模块常量、
     身份稳定。不 memo 等于每次渲染换一套列。 */
  const tableColumns = useMemo(() => columnsOf(locale), [locale]);
  const tShared = useTranslations();
  const withLabels = useConfirmLabels();
  const { toast } = useToast();
  const [items, setItems] = useState<RiskRecordItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [levelFilter, setLevelFilter] = useState<LevelFilter>("all");
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>("all");
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [dialogMode, setDialogMode] = useState<DialogMode>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<RiskForm>(createDefaultForm);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    // 待处置视图与总览卡口径对齐（reviewed=false&riskLevel=follow_up,high）由
    // URL 直达场景通过筛选器复现；列表本身拉全量（≤500）客户端过滤。
    const params = new URLSearchParams(window.location.search);
    if (params.get("reviewed") === "false") setReviewFilter("pending");
    const level = params.get("riskLevel");
    if (level === "follow_up,high") setLevelFilter("all");
    fetchRiskRecords()
      .then(setItems)
      .catch((error) => {
        setItems([]);
        setLoadError(
          error instanceof Error ? error.message : "风险记录读取失败",
        );
      })
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    let result = items;
    if (levelFilter !== "all")
      result = result.filter((i) => i.riskLevel === levelFilter);
    if (reviewFilter === "reviewed")
      result = result.filter((i) => i.reviewerId !== null);
    if (reviewFilter === "pending")
      result = result.filter((i) => i.reviewerId === null);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter((i) =>
        [i.tenantName ?? "", i.tenantId, i.scope ?? "", i.reason, ...i.tags]
          .join(" ")
          .toLowerCase()
          .includes(q),
      );
    }
    return result;
  }, [items, search, levelFilter, reviewFilter]);

  const pageItems = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, page]);
  const pageCount = Math.ceil(filtered.length / PAGE_SIZE);

  async function reload() {
    setItems(await fetchRiskRecords());
  }

  function openCreate() {
    setEditingId(null);
    setForm(createDefaultForm());
    setDialogMode("create");
  }

  function openEdit(item: RiskRecordItem) {
    setEditingId(item.id);
    setForm(formFromRecord(item));
    setDialogMode("edit");
  }

  function closeDialog() {
    setDialogMode(null);
    setEditingId(null);
  }

  async function submitForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dialogMode || !formIsValid(form, dialogMode)) return;
    setSubmitting(true);
    try {
      if (dialogMode === "edit" && editingId) {
        await updateRiskRecord(editingId, buildPayload(form, "edit"));
        toast({ tone: "success", title: "风险记录已更新" });
      } else {
        await createRiskRecord(buildPayload(form, "create"));
        toast({ tone: "success", title: "风险记录已创建" });
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

  /* 收参数而不是读 `pendingDelete`：确认由菜单项承担，那一项知道自己作用在哪
     一行。失败重新抛出——DS 的确认件按 Promise 是否 rejected 决定关不关框，
     `runAction` 自己吞异常，所以这里把它的成败翻译回一个 rejected。 */
  async function confirmDelete(target: RiskRecordItem) {
    const ok = await runAction("风险记录已删除", () =>
      deleteRiskRecord(target.id),
    );
    if (ok === false) throw new Error("风险记录删除失败");
  }

  const pendingCount = items.filter(
    (i) => i.reviewerId === null && i.riskLevel !== "normal",
  ).length;

  return (
    <>
      <ListPageTemplate
        className="vx-risk-records-page"
        header={
          <PageHeader
            icon="warning"
            title="风险记录"
            description="管理租户风险评估记录：录入、跟进、审阅处置与标签归类。"
          />
        }
        summary={
          <MetricGrid
            loading={loading}
            aria-label="风险记录统计"
            columns={3}
            items={[
              {
                id: "待处置（需跟进/高风险）",
                help: "风险等级非正常且尚无审阅人的记录。",
                icon: "warning",
                label: "待处置（需跟进/高风险）",
                value: String(pendingCount),
              },
              {
                id: "已审阅",
                help: "已指定审阅人的记录，不论结论。",
                icon: "check",
                label: "已审阅",
                value: String(
                  items.filter((i) => i.reviewerId !== null).length,
                ),
              },
              {
                id: "记录总数",
                help: "当前筛选条件下的风险记录条数。",
                icon: "table",
                label: "记录总数",
                value: String(items.length),
              },
            ]}
          />
        }
        filters={
          <FilterBar
            count={`${filtered.length}条`}
            aria-label="风险记录筛选"
            search={
              <Input
                className="grow basis-media-3xl max-w-panel-sm"
                type="search"
                placeholder="搜索租户、范围、原因、标签…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
              />
            }
            onReset={() => {
              setSearch("");
              setLevelFilter("all");
              setReviewFilter("all");
              setPage(1);
            }}
            actions={
              <>
                <Button
                  variant="default"
                  size="md"
                  onClick={openCreate}
                  title="新建风险记录"
                >
                  <Icon name="plus" size="sm" fallback="placeholder" />
                  新建记录
                </Button>
              </>
            }
          >
            <NativeSelect
              wrapperClassName="w-fit"
              className="w-fit basis-media-xl"
              value={levelFilter}
              onChange={(e) => {
                setLevelFilter(e.target.value as LevelFilter);
                setPage(1);
              }}
            >
              <option value="all">全部等级</option>
              <option value="normal">常规</option>
              <option value="follow_up">需跟进</option>
              <option value="high">高风险</option>
            </NativeSelect>
            <NativeSelect
              wrapperClassName="w-fit"
              className="w-fit basis-media-xl"
              value={reviewFilter}
              onChange={(e) => {
                setReviewFilter(e.target.value as ReviewFilter);
                setPage(1);
              }}
            >
              <option value="all">{tShared("filters.allStates")}</option>
              <option value="pending">待审阅</option>
              <option value="reviewed">已审阅</option>
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
                label="风险记录操作"
                disabled={submitting}
                items={[
                  {
                    id: "review",
                    label: item.reviewerId ? "重新审阅" : "标记已审阅",
                    icon: "check",
                    disabled: submitting,
                    onSelect: () =>
                      void runAction("已标记审阅", () =>
                        reviewRiskRecord(item.id),
                      ),
                  },
                  {
                    id: "edit",
                    label: tShared("actions.edit"),
                    icon: "edit",
                    disabled: submitting,
                    onSelect: () => openEdit(item),
                  },
                  {
                    id: "delete",
                    label: "删除",
                    icon: "trash",
                    danger: true,
                    disabled: submitting,
                    separatorBefore: true,
                    confirm: withLabels({
                      verb: "删除",
                      target: `「${item.tenantName ?? item.tenantId}」的风险记录`,
                      consequence:
                        "记录被软删并从列表隐藏，不可在界面上恢复。它在审计追加表里的痕迹不受影响。",
                      onConfirm: () => confirmDelete(item),
                    }),
                  },
                ]}
              />
            )}
            empty={
              <EmptyState
                title={loadError ? "风险记录读取失败" : "暂无风险记录"}
                description={
                  loadError ??
                  (search || levelFilter !== "all" || reviewFilter !== "all"
                    ? tShared("common.adjustFiltersHint")
                    : "点击「新建记录」录入第一条租户风险评估")
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
          title={dialogMode === "create" ? "新建风险记录" : "编辑风险记录"}
          description={
            dialogMode === "create"
              ? "录入租户风险评估。创建后可在列表中审阅处置。"
              : "调整风险等级会自动清除审阅标记（记录重新进入待处置）。"
          }
          submitLabel={
            dialogMode === "create" ? tShared("actions.create") : "保存修改"
          }
          submitting={submitting}
          submitDisabled={!formIsValid(form, dialogMode)}
          onOpenChange={(open) => {
            if (!open) closeDialog();
          }}
          onSubmit={(event) => void submitForm(event)}
        >
          {dialogMode === "create" ? (
            <Label>
              租户 ID
              <Input
                value={form.tenantId}
                onChange={(e) =>
                  setForm((f) => ({ ...f, tenantId: e.target.value }))
                }
                placeholder="tenancy.tenants 的 uuid"
                required
              />
            </Label>
          ) : null}
          <div>
            <Label>
              风险等级
              <NativeSelect
                value={form.riskLevel}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    riskLevel: e.target.value as RiskRecordItem["riskLevel"],
                  }))
                }
              >
                <option value="normal">常规</option>
                <option value="follow_up">需跟进</option>
                <option value="high">高风险</option>
              </NativeSelect>
            </Label>
            <Label>
              风险评分（0–100，可选）
              <Input
                type="number"
                min={0}
                max={100}
                value={form.riskScore}
                onChange={(e) =>
                  setForm((f) => ({ ...f, riskScore: e.target.value }))
                }
              />
            </Label>
          </div>
          <Label>
            风险范围（可选）
            <Input
              value={form.scope}
              maxLength={160}
              onChange={(e) =>
                setForm((f) => ({ ...f, scope: e.target.value }))
              }
              placeholder="如 billing / 内容安全 / API 滥用"
            />
          </Label>
          <Label>
            原因说明
            <Textarea
              value={form.reason}
              onChange={(e) =>
                setForm((f) => ({ ...f, reason: e.target.value }))
              }
              placeholder="风险判定的依据与说明"
              rows={4}
              required
            />
          </Label>
          <Label>
            标签（逗号分隔，可选）
            <Input
              value={form.tags}
              onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))}
              placeholder="如 usage, kyc"
            />
          </Label>
        </DialogForm>
      ) : null}
    </>
  );
}
