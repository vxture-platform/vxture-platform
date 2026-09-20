"use client";

/* 运营通告 — 三个平面之间同步信息的发布面。
 *
 * owner 2026-09-20：「面向客户的由 admin 发布，面向内部运营的由 opera 发布」。
 * 所以**写侧只在这一页**；admin / arche 各自在自己的首页读，读不到写。
 *
 * 与 admin 的「平台公告」不是一回事：那张面向**客户**（按套餐 / 租户类型投放，
 * 客户在 console 看见），能力码 content:announcement.*。这一页面向**运营者**，
 * 能力码 ops:notice.*，两条线互不相干。
 *
 * 撤回走软删：通告已经被人看过、已读关系也落了表，硬删会连带抹掉「谁读过」这个
 * 事实。撤回只是让它退出各平面的列表。 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import {
  ActionButton,
  ActionMenu,
  Button,
  Checkbox,
  DataTable,
  DialogForm,
  EmptyState,
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldTier,
  FilterBar,
  Icon,
  Input,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  ListPageTemplate,
  NativeSelect,
  StatusBadge,
  TableTitleCell,
  Textarea,
  ViewHeader,
  useListPagination,
  useToast,
  type StatusBadgeTone,
} from "@vxture/design-system";
import { useTranslations } from "next-intl";
import { FIELD_LABEL_A11Y, FIELD_TIER_TITLE } from "@/lib/form-labels";
import { ListPagination } from "@/modules/shared/ListPagination";
import { useOperatorSession } from "@/features/session/SessionProvider";
import { useTableLabels } from "@/lib/table";
import { api, OperaApiError } from "@/lib/api";
import { useConfirmLabels } from "@/lib/destructive";
import { formatDateTime } from "@vxture-platform/shared";
import { useTableSort, type SortAccessor } from "@/lib/table-sort";

/** 写操作的能力码，与 BFF 的能力门同名。 */
const MANAGE = "ops:notice.manage";

const PLANES = ["admin", "opera", "arche"] as const;
type Plane = (typeof PLANES)[number];

/** 平面的中文名。与三个门户对外的叫法一致，不用代号。 */
const PLANE_LABELS: Record<Plane, string> = {
  admin: "运营台",
  opera: "运维台",
  arche: "治理台",
};

type Severity = "info" | "warning" | "critical";

const SEVERITY_LABELS: Record<Severity, string> = {
  info: "一般",
  warning: "重要",
  critical: "紧急",
};

/**
 * 严重度阶梯：灰 / 琥珀 / 红。
 *
 * `info` 走中性而不是绿——六档里 `success` 的语义是**达成了一件事**，而「一般」
 * 不是一项达成。这与维护窗口页的取舍同源。
 */
function severityTone(severity: Severity): StatusBadgeTone {
  if (severity === "critical") return "danger";
  if (severity === "warning") return "warning";
  return "neutral";
}

interface OperatorNoticeItem {
  id: string;
  /** 空数组 = 三个平面都看得见。 */
  targetPlanes: Plane[];
  severity: Severity;
  title: string;
  body: string;
  link: string | null;
  source: "manual" | "system";
  publishedAt: string;
  expiresAt: string | null;
  createdByName: string | null;
  createdAt: string;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready" };

interface NoticeForm {
  title: string;
  body: string;
  link: string;
  severity: Severity;
  /** 勾选集合。三个都勾 = 全部，提交时收敛成空数组（与 BFF 同一口径）。 */
  planes: Set<Plane>;
  expiresAt: string;
}

function createDefaultForm(): NoticeForm {
  return {
    title: "",
    body: "",
    link: "",
    severity: "info",
    // 默认全选：通告的常态是「三个平面都该知道」，要收窄才动它。
    planes: new Set(PLANES),
    expiresAt: "",
  };
}

function buildPayload(form: NoticeForm) {
  const planes = [...form.planes];
  return {
    title: form.title.trim(),
    body: form.body.trim(),
    link: form.link.trim() || null,
    severity: form.severity,
    // 三个都勾就送空数组——与「没勾任何限制」落成同一种表示，
    // 否则读侧的「空 = 全部」判据会漏掉展开过的那一半。
    targetPlanes: planes.length === PLANES.length ? [] : planes,
    expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
  };
}

function formIsValid(form: NoticeForm): boolean {
  return (
    form.title.trim().length > 0 &&
    form.body.trim().length > 0 &&
    // 一个平面都不勾 = 谁也看不到，那不是一条通告。
    form.planes.size > 0
  );
}

function formatMoment(iso: string | null): string {
  if (!iso) return "—";
  return formatDateTime(new Date(iso), "zh-CN", "—");
}

/** 后端文案本身就是给人看的，照原样带出。 */
function describeError(error: unknown): { description?: string } {
  return error instanceof Error && error.message
    ? { description: error.message }
    : {};
}

/** 投放范围的文字。空数组是「全部平面」，不是「没有平面」。 */
function planesText(planes: Plane[]): string {
  if (planes.length === 0) return "全部平面";
  return planes.map((p) => PLANE_LABELS[p]).join(" · ");
}

export default function OperatorNoticesPage() {
  const tShared = useTranslations();
  const tableLabels = useTableLabels();
  const withLabels = useConfirmLabels();
  const { can } = useOperatorSession();
  const { toast } = useToast();
  const canManage = can(MANAGE);

  const [rows, setRows] = useState<OperatorNoticeItem[]>([]);
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const [keyword, setKeyword] = useState("");
  const [severity, setSeverity] = useState("all");
  const [includeExpired, setIncludeExpired] = useState(false);
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<NoticeForm>(createDefaultForm);
  const [submitting, setSubmitting] = useState(false);

  const reload = useCallback(async () => {
    setLoad({ kind: "loading" });
    try {
      const data = await api.get<OperatorNoticeItem[]>(
        `/api/operator-notices${includeExpired ? "?includeExpired=true" : ""}`,
      );
      setRows(data);
      setLoad({ kind: "ready" });
    } catch (error) {
      // 读失败与「本来就没有」是两件事，空态要能分辨。
      setLoad({
        kind: "error",
        message:
          error instanceof OperaApiError ? error.message : "读取运营通告失败",
      });
    }
  }, [includeExpired]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const visible = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (severity === "all" || r.severity === severity) &&
        (kw === "" ||
          r.title.toLowerCase().includes(kw) ||
          r.body.toLowerCase().includes(kw)),
    );
  }, [rows, keyword, severity]);

  const filtered = keyword.trim() !== "" || severity !== "all";
  const sortAccessors = useMemo<
    Readonly<Record<string, SortAccessor<OperatorNoticeItem>>>
  >(
    () => ({
      title: (r) => r.title,
      severity: (r) => r.severity,
      publishedAt: (r) => r.publishedAt,
      expiresAt: (r) => r.expiresAt,
      createdByName: (r) => r.createdByName,
    }),
    [],
  );
  const sort = useTableSort(visible, sortAccessors, {
    columnId: "publishedAt",
    direction: "desc",
  });
  const pager = useListPagination(sort.rows, 20);

  function openCreate() {
    setForm(createDefaultForm());
    setDialogOpen(true);
  }

  function togglePlane(plane: Plane) {
    setForm((f) => {
      const next = new Set(f.planes);
      if (next.has(plane)) next.delete(plane);
      else next.add(plane);
      return { ...f, planes: next };
    });
  }

  async function submitForm(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    try {
      await api.post("/api/operator-notices", buildPayload(form));
      toast({ tone: "success", title: "通告已发布" });
      setDialogOpen(false);
      await reload();
    } catch (error) {
      toast({ tone: "danger", title: "发布失败", ...describeError(error) });
    } finally {
      setSubmitting(false);
    }
  }

  async function withdraw(item: OperatorNoticeItem) {
    setSubmitting(true);
    try {
      await api.delete(`/api/operator-notices/${item.id}`);
      toast({ tone: "success", title: "通告已撤回" });
      await reload();
    } catch (error) {
      toast({ tone: "danger", title: "撤回失败", ...describeError(error) });
    } finally {
      setSubmitting(false);
    }
  }

  const pagination = (
    <ListPagination
      className="w-full"
      currentPage={pager.page}
      pageCount={pager.pageCount}
      total={rows.length}
      filteredTotal={visible.length}
      pageSize={pager.pageSize}
      onPageSizeChange={pager.onPageSizeChange}
      onPageChange={pager.onPageChange}
    />
  );

  const emptyState =
    load.kind === "loading" ? (
      <EmptyState
        title={tShared("common.loading")}
        description="正在取运营通告清单。"
      />
    ) : load.kind === "error" ? (
      <EmptyState
        title={tShared("common.loadFailed")}
        description={load.message}
        action={
          <Button variant="secondary" onClick={() => void reload()}>
            {tShared("common.retry")}
          </Button>
        }
      />
    ) : filtered ? (
      <EmptyState
        title="没有匹配的通告"
        description="换个严重度或关键词再看。"
      />
    ) : (
      <EmptyState
        icon="bell"
        title="还没有通告"
        description="产品上线、能力新增、变更通告发在这里，三个平面的人都看得到。"
      />
    );

  return (
    <>
      <ListPageTemplate
        header={
          <ViewHeader
            icon="bell"
            title="运营通告"
            description="发给运营者的消息：产品上线、能力新增、变更通告。三个平台由不同人员使用，消息在这里同步。"
          />
        }
        filters={
          <FilterBar
            view="list"
            onViewChange={() => {}}
            cardsDisabledReason={tShared("common.cardsRetired")}
            count={
              visible.length === rows.length
                ? rows.length
                : `${visible.length} / ${rows.length}`
            }
            search={
              <InputGroup className="min-w-media-2xl grow basis-0 max-w-panel-sm">
                <InputGroupAddon>
                  <Icon name="search" size="sm" aria-hidden="true" />
                </InputGroupAddon>
                <InputGroupInput
                  placeholder="搜索标题 / 正文…"
                  aria-label="搜索运营通告"
                  value={keyword}
                  onChange={(e) => {
                    setKeyword(e.target.value);
                    pager.resetPage();
                  }}
                />
              </InputGroup>
            }
            resetLabel={tShared("filters.reset")}
            onReset={() => {
              setKeyword("");
              setSeverity("all");
              setIncludeExpired(false);
              pager.resetPage();
            }}
            actions={
              canManage ? (
                <ActionButton
                  icon="plus"
                  onClick={openCreate}
                  disabled={submitting}
                >
                  发布通告
                </ActionButton>
              ) : null
            }
          >
            <NativeSelect
              wrapperClassName="w-fit"
              value={severity}
              onChange={(e) => {
                setSeverity(e.target.value);
                pager.resetPage();
              }}
              aria-label="严重度"
            >
              <option value="all">全部</option>
              {(Object.keys(SEVERITY_LABELS) as Severity[]).map((s) => (
                <option key={s} value={s}>
                  {SEVERITY_LABELS[s]}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect
              wrapperClassName="w-fit"
              value={includeExpired ? "all" : "live"}
              onChange={(e) => {
                setIncludeExpired(e.target.value === "all");
                pager.resetPage();
              }}
              aria-label="时效"
            >
              <option value="live">仍在生效</option>
              <option value="all">含已过期</option>
            </NativeSelect>
          </FilterBar>
        }
        table={
          <DataTable
            labels={tableLabels}
            columns={[
              {
                id: "title",
                header: "通告",
                sortable: true,
                cell: (r) => (
                  <TableTitleCell
                    icon={r.source === "system" ? "workflow" : "bell"}
                    title={r.title}
                    description={r.body}
                  />
                ),
              },
              {
                id: "planes",
                header: "投放范围",
                width: "sm",
                cell: (r) => (
                  <span className="text-body-sm">
                    {planesText(r.targetPlanes)}
                  </span>
                ),
              },
              {
                id: "severity",
                header: "严重度",
                sortable: true,
                width: "xs",
                cell: (r) => (
                  <StatusBadge tone={severityTone(r.severity)}>
                    {SEVERITY_LABELS[r.severity]}
                  </StatusBadge>
                ),
              },
              {
                id: "publishedAt",
                header: "发布于",
                sortable: true,
                width: "sm",
                cell: (r) => formatMoment(r.publishedAt),
              },
              {
                id: "expiresAt",
                header: "失效于",
                sortable: true,
                width: "sm",
                cell: (r) => (
                  <span className="text-body-sm text-muted-foreground">
                    {/* 不设失效时间就是长期有效,写「—」会被读成"没读到"。 */}
                    {r.expiresAt ? formatMoment(r.expiresAt) : "长期有效"}
                  </span>
                ),
              },
              {
                id: "createdByName",
                header: "发布人",
                sortable: true,
                width: "sm",
                cell: (r) => (
                  <span className="text-body-sm text-muted-foreground">
                    {/* system 来源没有人,写「系统」而不是「—」——后者会被当成读不到。 */}
                    {r.source === "system" ? "系统" : (r.createdByName ?? "—")}
                  </span>
                ),
              },
            ]}
            rows={pager.pageRows}
            {...(sort.sort ? { sort: sort.sort } : {})}
            onSortChange={(next) => {
              sort.onSortChange(next);
              pager.resetPage();
            }}
            rowKey={(r) => r.id}
            selectedKeys={selected}
            onSelectionChange={setSelected}
            indexStart={pager.indexStart}
            {...(canManage
              ? {
                  rowActions: (item: OperatorNoticeItem) => (
                    <ActionMenu
                      label="通告操作"
                      disabled={submitting}
                      items={[
                        {
                          id: "withdraw",
                          label: "撤回通告",
                          icon: "stop",
                          danger: true,
                          disabled: submitting,
                          confirm: withLabels({
                            verb: "撤回",
                            target: `通告「${item.title}」`,
                            consequence:
                              "撤回后它从三个平面的列表里消失，已经读过的人不会再看到。已读记录保留，通告本身也留档，但不能再恢复显示——要再发一次得新建一条。",
                            onConfirm: () => withdraw(item),
                          }),
                        },
                      ]}
                    />
                  ),
                }
              : {})}
            footer={pagination}
            empty={emptyState}
          />
        }
      />

      {dialogOpen ? (
        <DialogForm
          size="lg"
          open
          title="发布运营通告"
          description="发给运营者看，客户端不可见。客户公告请到运营台的「平台公告」发。"
          submitLabel="发布"
          submitting={submitting}
          submitDisabled={!formIsValid(form)}
          onOpenChange={(open) => {
            if (!open) setDialogOpen(false);
          }}
          onSubmit={(event) => void submitForm(event)}
          cancelLabel={tShared("actions.cancel")}
        >
          <FieldTier
            tier="identity"
            title={FIELD_TIER_TITLE.identity}
            hint="标题与正文是三个平面上直接看到的内容。"
          >
            <FieldGroup columns={2}>
              <Field span="full">
                <FieldLabel
                  {...FIELD_LABEL_A11Y}
                  required
                  htmlFor="notice-title"
                >
                  标题
                </FieldLabel>
                <Input
                  id="notice-title"
                  value={form.title}
                  maxLength={256}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, title: e.target.value }))
                  }
                  placeholder="如 karda v1.2 已上线"
                  required
                />
              </Field>
              <Field span="full">
                <FieldLabel
                  {...FIELD_LABEL_A11Y}
                  required
                  htmlFor="notice-body"
                >
                  正文
                </FieldLabel>
                <Textarea
                  id="notice-body"
                  value={form.body}
                  rows={4}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, body: e.target.value }))
                  }
                  placeholder="说清楚发生了什么、对谁有影响、要不要做什么"
                  required
                />
              </Field>
            </FieldGroup>
          </FieldTier>

          <FieldTier
            tier="details"
            title={FIELD_TIER_TITLE.details}
            hint="默认发给三个平面；只与某一边有关时再收窄。"
          >
            <FieldGroup columns={2}>
              <Field span="full">
                <FieldLabel {...FIELD_LABEL_A11Y} required>
                  投放范围
                </FieldLabel>
                <span className="flex flex-wrap gap-sm">
                  {PLANES.map((plane) => (
                    <label
                      key={plane}
                      className="inline-flex items-center gap-2xs text-body-sm"
                    >
                      <Checkbox
                        checked={form.planes.has(plane)}
                        aria-label={PLANE_LABELS[plane]}
                        onCheckedChange={() => togglePlane(plane)}
                      />
                      {PLANE_LABELS[plane]}
                    </label>
                  ))}
                </span>
                {form.planes.size === 0 ? (
                  <FieldDescription>
                    一个都不选的话这条通告谁也看不到，至少选一个
                  </FieldDescription>
                ) : null}
              </Field>
              <Field>
                <FieldLabel htmlFor="notice-severity">严重度</FieldLabel>
                <NativeSelect
                  id="notice-severity"
                  value={form.severity}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      severity: e.target.value as Severity,
                    }))
                  }
                >
                  {(Object.keys(SEVERITY_LABELS) as Severity[]).map((s) => (
                    <option key={s} value={s}>
                      {SEVERITY_LABELS[s]}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel htmlFor="notice-expires">失效时间</FieldLabel>
                <Input
                  id="notice-expires"
                  type="datetime-local"
                  value={form.expiresAt}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, expiresAt: e.target.value }))
                  }
                />
                <FieldDescription>留空 = 长期有效</FieldDescription>
              </Field>
            </FieldGroup>
          </FieldTier>

          <FieldTier
            tier="advanced"
            title="跳转"
            hint="给一个平面内的相对路径，收到的人可以直接点过去。"
          >
            <FieldGroup columns={2}>
              <Field span="full">
                <FieldLabel htmlFor="notice-link">链接</FieldLabel>
                <Input
                  id="notice-link"
                  value={form.link}
                  maxLength={512}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, link: e.target.value }))
                  }
                  placeholder="如 /products/karda"
                />
              </Field>
            </FieldGroup>
          </FieldTier>
        </DialogForm>
      ) : null}
    </>
  );
}
