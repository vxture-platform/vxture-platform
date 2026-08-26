"use client";

/* 维护窗口 — 计划内停机的声明、执行与对账。
 *
 * 2026-08-07 自 admin 迁入（批 A）。**按 opera 的方式重写**，不是搬文件：admin 那份
 * 挂在 5 个产品 CSS 类上（vx-maintenance-page / vx-tenant-search / vx-tenant-select /
 * vx-model-dialog__grid / vx-admin-action-btn），而 opera 的 globals.css 只引 DS，
 * 骨架一律 ListPageTemplate 三槽 + 纯 T2 工具类。行为与能力门不变，数据仍是
 * admin.maintenance_windows，只是改由 opera-bff 供给。
 *
 * 状态机由 BFF 守：scheduled →(start) in_progress →(complete) completed，
 * scheduled|in_progress →(cancel) cancelled，终态只读。前端只按当前状态决定
 * 哪些动作可见，不自己判合法性——真正的裁决在条件 UPDATE 那一层。 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import {
  ActionMenu,
  Button,
  DataTable,
  DialogForm,
  EmptyState,
  FilterBar,
  Icon,
  Input,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldTier,
  ListPageTemplate,
  NativeSelect,
  Pagination,
  StatusBadge,
  Textarea,
  ViewHeader,
  useListPagination,
  useToast,
  type DataTableSort,
  type StatusBadgeTone,
} from "@vxture/design-system";
import { useOperatorSession } from "@/features/session/SessionProvider";
import { useTranslations } from "next-intl";
import { api, OperaApiError } from "@/lib/api";
import { useConfirmLabels } from "@/lib/destructive";

/** 写操作的能力码，与 BFF 的能力门同名（release:maintenance.manage）。 */
const MANAGE = "release:maintenance.manage";

interface MaintenanceWindowItem {
  id: string;
  severity: "minor" | "major" | "critical";
  /** product_251 B-3：一个产品内不得混用多个字段名，统一 `state`。 */
  state: "scheduled" | "in_progress" | "completed" | "cancelled";
  title: string;
  description: string | null;
  impactDescription: string | null;
  affectedServices: string[];
  startAt: string;
  endAt: string;
  actualEndAt: string | null;
  createdBy: string;
  createdByName: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

const STATE_LABELS: Record<MaintenanceWindowItem["state"], string> = {
  scheduled: "已计划",
  in_progress: "进行中",
  completed: "已完成",
  cancelled: "已取消",
};

const SEVERITY_LABELS: Record<MaintenanceWindowItem["severity"], string> = {
  minor: "一般",
  major: "重要",
  critical: "严重",
};

/** 窗口状态 → DS 语气。业务状态到语气的映射留产品侧，DS 不收业务语义。 */
function stateTone(state: MaintenanceWindowItem["state"]): StatusBadgeTone {
  if (state === "in_progress") return "warning";
  if (state === "scheduled") return "info";
  if (state === "completed") return "success";
  return "neutral";
}

/**
 * 严重度阶梯：灰 / 琥珀 / 红。
 *
 * `minor` 走中性而不是绿（owner 2026-08-06 判，随页面一起迁过来）：六档里
 * `success` 的语义是**达成了一件事**，而低严重度不是一项达成，是"不用担心"。
 * 同一页的状态列已经用绿表示「已完成」，严重度再用绿，一屏里的绿就有两种含义。
 */
function severityTone(
  severity: MaintenanceWindowItem["severity"],
): StatusBadgeTone {
  if (severity === "critical") return "danger";
  if (severity === "major") return "warning";
  return "neutral";
}

const DATE_TIME = new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "short",
  timeStyle: "short",
});

function formatMoment(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : DATE_TIME.format(d);
}

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready" };

type DialogMode = "create" | "edit" | null;

interface WindowForm {
  severity: MaintenanceWindowItem["severity"];
  title: string;
  description: string;
  impactDescription: string;
  affectedServices: string;
  startAt: string;
  endAt: string;
}

/** `datetime-local` 要的是本地时间字面量，不是 ISO——直接塞 ISO 会差一个时区。 */
function toLocalInputValue(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function isoToLocalInput(value: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : toLocalInputValue(d);
}

function createDefaultForm(): WindowForm {
  const start = new Date(Date.now() + 60 * 60 * 1000);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  return {
    severity: "minor",
    title: "",
    description: "",
    impactDescription: "",
    affectedServices: "",
    startAt: toLocalInputValue(start),
    endAt: toLocalInputValue(end),
  };
}

function formFromRecord(item: MaintenanceWindowItem): WindowForm {
  return {
    severity: item.severity,
    title: item.title,
    description: item.description ?? "",
    impactDescription: item.impactDescription ?? "",
    affectedServices: item.affectedServices.join(", "),
    startAt: isoToLocalInput(item.startAt),
    endAt: isoToLocalInput(item.endAt),
  };
}

function buildPayload(form: WindowForm) {
  return {
    severity: form.severity,
    title: form.title.trim(),
    description: form.description.trim() || null,
    impactDescription: form.impactDescription.trim() || null,
    affectedServices: form.affectedServices
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    startAt: new Date(form.startAt).toISOString(),
    endAt: new Date(form.endAt).toISOString(),
  };
}

function formIsValid(form: WindowForm): boolean {
  return (
    form.title.trim().length > 0 &&
    form.startAt.trim().length > 0 &&
    form.endAt.trim().length > 0 &&
    new Date(form.endAt) > new Date(form.startAt)
  );
}

/** 后端的报错文案本身就是给人看的（"endAt must be after startAt" 一类），照原样带出。 */
function describeError(error: unknown): { description?: string } {
  return error instanceof Error && error.message
    ? { description: error.message }
    : {};
}

export default function MaintenanceWindowsPage() {
  const tShared = useTranslations();
  const withLabels = useConfirmLabels();
  const [rows, setRows] = useState<MaintenanceWindowItem[]>([]);
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const [keyword, setKeyword] = useState("");
  const [state, setState] = useState("all");
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [sort, setSort] = useState<DataTableSort>({
    columnId: "startAt",
    direction: "desc",
  });
  const [dialogMode, setDialogMode] = useState<DialogMode>(null);
  const [editing, setEditing] = useState<MaintenanceWindowItem | null>(null);
  const [form, setForm] = useState<WindowForm>(createDefaultForm);
  const [submitting, setSubmitting] = useState(false);

  const { can } = useOperatorSession();
  const { toast } = useToast();
  const canManage = can(MANAGE);

  const reload = useCallback(async () => {
    setLoad({ kind: "loading" });
    try {
      const data = await api.get<MaintenanceWindowItem[]>(
        "/api/maintenance-windows",
      );
      setRows(data);
      setLoad({ kind: "ready" });
    } catch (error) {
      // 读失败与"本来就没有"是两件事，空态要能分辨（#41 的三分口径）。
      setLoad({
        kind: "error",
        message:
          error instanceof OperaApiError ? error.message : "读取维护窗口失败",
      });
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const visible = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    const matched = rows.filter(
      (r) =>
        (state === "all" || r.state === state) &&
        (kw === "" ||
          r.title.toLowerCase().includes(kw) ||
          r.affectedServices.some((s) => s.toLowerCase().includes(kw))),
    );
    return [...matched].sort((a, b) => {
      const cmp = a.startAt.localeCompare(b.startAt);
      return sort.direction === "asc" ? cmp : -cmp;
    });
  }, [rows, keyword, state, sort]);

  const filtered = keyword.trim() !== "" || state !== "all";
  const pager = useListPagination(visible, 20);

  const editingState = editing?.state;
  /** 进行中的窗口只允许顺延结束时间与追记描述，其余字段锁死（同 BFF 的分支）。 */
  const liveEditOnly = dialogMode === "edit" && editingState === "in_progress";

  function openCreate() {
    setEditing(null);
    setForm(createDefaultForm());
    setDialogMode("create");
  }

  function openEdit(item: MaintenanceWindowItem) {
    setEditing(item);
    setForm(formFromRecord(item));
    setDialogMode("edit");
  }

  function closeDialog() {
    setDialogMode(null);
    setEditing(null);
  }

  /** 写操作统一走这里：成功提示 + 重新拉取，失败把后端文案原样带给用户。 */
  async function runAction(label: string, action: () => Promise<unknown>) {
    setSubmitting(true);
    try {
      await action();
      toast({ tone: "success", title: label });
      await reload();
    } catch (error) {
      toast({ tone: "danger", title: `${label}失败`, ...describeError(error) });
    } finally {
      setSubmitting(false);
    }
  }

  async function submitForm(event: FormEvent) {
    event.preventDefault();
    const payload = buildPayload(form);
    setSubmitting(true);
    try {
      if (dialogMode === "edit" && editing) {
        await api.put(`/api/maintenance-windows/${editing.id}`, payload);
        toast({ tone: "success", title: "维护窗口已更新" });
      } else {
        await api.post("/api/maintenance-windows", payload);
        toast({ tone: "success", title: "维护窗口已创建" });
      }
      closeDialog();
      await reload();
    } catch (error) {
      toast({ tone: "danger", title: "保存失败", ...describeError(error) });
    } finally {
      setSubmitting(false);
    }
  }

  const pagination = (
    <Pagination
      className="w-full"
      page={pager.page}
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
        description="正在取维护窗口清单。"
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
        title="没有匹配的维护窗口"
        description="换个状态或关键词再看。"
      />
    ) : (
      <EmptyState
        title="暂无维护窗口"
        description="计划内停机需要先在这里声明，运维执行与对账都以此为准。"
      />
    );

  return (
    <>
      <ListPageTemplate
        header={
          <ViewHeader
            icon="clock"
            title="维护窗口"
            description="声明与管理平台维护窗口：计划、执行、完成与取消，实际结束时间对账。"
            action={
              // 没有 manage 能力就不渲染写入口。这是界面取舍不是安全边界——
              // 接口那边照样 403（见 BFF 的 assertCanManageMaintenanceWindows）。
              canManage ? (
                <Button onClick={openCreate} disabled={submitting}>
                  <Icon name="plus" size="sm" aria-hidden="true" />
                  新建窗口
                </Button>
              ) : null
            }
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
          >
            <InputGroup className="grow basis-media-3xl max-w-panel-sm">
              <InputGroupAddon>
                <Icon name="search" size="sm" aria-hidden="true" />
              </InputGroupAddon>
              <InputGroupInput
                placeholder="搜索标题 / 影响服务…"
                aria-label="搜索维护窗口"
                value={keyword}
                onChange={(e) => {
                  setKeyword(e.target.value);
                  pager.resetPage();
                }}
              />
            </InputGroup>
            <NativeSelect
              wrapperClassName="w-fit"
              value={state}
              onChange={(e) => {
                setState(e.target.value);
                pager.resetPage();
              }}
              aria-label={tShared("filters.stateLabel")}
            >
              <option value="all">{tShared("filters.allStates")}</option>
              {(
                Object.keys(STATE_LABELS) as MaintenanceWindowItem["state"][]
              ).map((s) => (
                <option key={s} value={s}>
                  {STATE_LABELS[s]}
                </option>
              ))}
            </NativeSelect>
          </FilterBar>
        }
        table={
          <DataTable
            columns={[
              {
                id: "title",
                header: "窗口",
                cell: (r) => (
                  <div className="flex flex-col gap-2xs">
                    <span className="text-label-md text-foreground">
                      {r.title}
                    </span>
                    {r.affectedServices.length > 0 ? (
                      <span className="text-body-sm text-muted-foreground">
                        {r.affectedServices.join(" · ")}
                      </span>
                    ) : null}
                  </div>
                ),
              },
              {
                id: "startAt",
                header: "开始",
                sortable: true,
                width: "sm",
                cell: (r) => formatMoment(r.startAt),
              },
              {
                id: "endAt",
                header: "结束（计划）",
                width: "sm",
                cell: (r) => formatMoment(r.endAt),
              },
              {
                id: "actualEndAt",
                header: "实际结束",
                width: "sm",
                cell: (r) => (
                  <span className="text-body-sm text-muted-foreground">
                    {formatMoment(r.actualEndAt)}
                  </span>
                ),
              },
              {
                id: "createdByName",
                header: "创建人",
                width: "sm",
                cell: (r) => (
                  <span className="text-body-sm text-muted-foreground">
                    {r.createdByName ?? "—"}
                  </span>
                ),
              },
              {
                id: "severity",
                header: "严重度",
                align: "center",
                width: "xs",
                cell: (r) => (
                  <StatusBadge tone={severityTone(r.severity)}>
                    {SEVERITY_LABELS[r.severity]}
                  </StatusBadge>
                ),
              },
              {
                id: "state",
                header: tShared("columns.state"),
                align: "center",
                width: "xs",
                cell: (r) => (
                  <StatusBadge tone={stateTone(r.state)}>
                    {STATE_LABELS[r.state]}
                  </StatusBadge>
                ),
              },
            ]}
            rows={pager.pageRows}
            rowKey={(r) => r.id}
            selectedKeys={selected}
            onSelectionChange={setSelected}
            indexStart={pager.indexStart}
            sort={sort}
            onSortChange={setSort}
            {...(canManage
              ? {
                  rowActions: (item: MaintenanceWindowItem) => (
                    <ActionMenu
                      label="维护窗口操作"
                      disabled={submitting}
                      items={[
                        {
                          id: "start",
                          label: "开始维护",
                          icon: "play",
                          disabled: submitting || item.state !== "scheduled",
                          onSelect: () =>
                            void runAction("维护已开始", () =>
                              api.post(
                                `/api/maintenance-windows/${item.id}/start`,
                              ),
                            ),
                        },
                        {
                          id: "complete",
                          label: "完成维护",
                          icon: "check",
                          disabled: submitting || item.state !== "in_progress",
                          onSelect: () =>
                            void runAction("维护已完成", () =>
                              api.post(
                                `/api/maintenance-windows/${item.id}/complete`,
                                {},
                              ),
                            ),
                        },
                        {
                          id: "edit",
                          label: tShared("common.edit"),
                          icon: "edit",
                          disabled:
                            submitting ||
                            (item.state !== "scheduled" &&
                              item.state !== "in_progress"),
                          onSelect: () => openEdit(item),
                        },
                        {
                          id: "cancel",
                          label: "取消窗口",
                          icon: "stop",
                          danger: true,
                          separatorBefore: true,
                          disabled:
                            submitting ||
                            (item.state !== "scheduled" &&
                              item.state !== "in_progress"),
                          confirm: withLabels({
                            verb: tShared("actions.cancel"),
                            target: `维护窗口「${item.title}」`,
                            consequence:
                              "取消后窗口进入终态，不能再改回计划中或进行中；历史记录保留。要重新安排同一段维护，得新建一个窗口。",
                            onConfirm: () =>
                              runAction("维护窗口已取消", () =>
                                api.post(
                                  `/api/maintenance-windows/${item.id}/cancel`,
                                ),
                              ),
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

      {dialogMode ? (
        <DialogForm
          open
          title={dialogMode === "create" ? "新建维护窗口" : "编辑维护窗口"}
          description={
            liveEditOnly
              ? "进行中的窗口仅允许顺延结束时间与更新描述。"
              : "声明计划维护窗口；到点后手动「开始维护」。"
          }
          submitLabel={dialogMode === "create" ? "创建" : "保存修改"}
          submitting={submitting}
          submitDisabled={!formIsValid(form)}
          onOpenChange={(open) => {
            if (!open) closeDialog();
          }}
          onSubmit={(event) => void submitForm(event)}
        >
          {/* 三档（DS `FieldTier`）：身份 = 一条维护公告最少要说清的「什么事、什么时候」；
              常规 = 分级与波及面；高级 = 两段可选长文。 */}
          <FieldTier
            tier="identity"
            hint="标题与时间窗会直接出现在对外公告上；进行中的窗口只能顺延，不能提前。"
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="mw-title">标题</FieldLabel>
                <Input
                  id="mw-title"
                  value={form.title}
                  maxLength={256}
                  disabled={liveEditOnly}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, title: e.target.value }))
                  }
                  placeholder="如 数据库版本升级"
                  required
                />
              </Field>
              <div className="grid grid-cols-2 gap-md">
                <Field>
                  <FieldLabel htmlFor="mw-start">计划开始</FieldLabel>
                  <Input
                    id="mw-start"
                    type="datetime-local"
                    value={form.startAt}
                    disabled={liveEditOnly}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, startAt: e.target.value }))
                    }
                    required
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="mw-end">计划结束</FieldLabel>
                  <Input
                    id="mw-end"
                    type="datetime-local"
                    value={form.endAt}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, endAt: e.target.value }))
                    }
                    required
                  />
                  {liveEditOnly ? (
                    <FieldDescription>
                      进行中的窗口只能顺延，不能提前
                    </FieldDescription>
                  ) : null}
                </Field>
              </div>
            </FieldGroup>
          </FieldTier>

          <FieldTier
            tier="details"
            hint="严重度决定公告的展示强度，受影响服务可留空。"
          >
            <FieldGroup>
              <div className="grid grid-cols-2 gap-md">
                <Field>
                  <FieldLabel htmlFor="mw-severity">严重度</FieldLabel>
                  <NativeSelect
                    id="mw-severity"
                    value={form.severity}
                    disabled={liveEditOnly}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        severity: e.target
                          .value as MaintenanceWindowItem["severity"],
                      }))
                    }
                  >
                    <option value="minor">一般</option>
                    <option value="major">重要</option>
                    <option value="critical">严重</option>
                  </NativeSelect>
                </Field>
                <Field>
                  <FieldLabel htmlFor="mw-services">受影响服务</FieldLabel>
                  <Input
                    id="mw-services"
                    value={form.affectedServices}
                    disabled={liveEditOnly}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        affectedServices: e.target.value,
                      }))
                    }
                    placeholder="如 auth-bff, admin-bff"
                  />
                  <FieldDescription>逗号分隔，可选</FieldDescription>
                </Field>
              </div>
            </FieldGroup>
          </FieldTier>

          <FieldTier
            tier="advanced"
            title="说明文案"
            hint="两段都可选，不填也能发布——留空时公告只展示标题与时间窗。"
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="mw-desc">描述</FieldLabel>
                <Textarea
                  id="mw-desc"
                  value={form.description}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, description: e.target.value }))
                  }
                  rows={3}
                  placeholder="维护内容说明"
                />
                <FieldDescription>可选</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="mw-impact">影响说明</FieldLabel>
                <Textarea
                  id="mw-impact"
                  value={form.impactDescription}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      impactDescription: e.target.value,
                    }))
                  }
                  rows={3}
                  placeholder="对用户/租户的影响范围与降级预期"
                />
                <FieldDescription>可选</FieldDescription>
              </Field>
            </FieldGroup>
          </FieldTier>
        </DialogForm>
      ) : null}
    </>
  );
}
