"use client";

/* Credential — 第三方系统凭证托管与代理注入（连接器调用外部系统时用）。
 *
 * 2026-08-13 从「只能录入的表单」升为真管理页。此前 runos 只交付了写入口，
 * 页面挂着一条横幅说"没有清单、不能轮换、不能吊销"——那条横幅**促成了**
 * `vxture-runos#65`，runos 随后在 `280-management-apis.md` §5b.1/§5b.2 把这
 * 三样确认为缺口（TD-010）并补齐：`GET /governance/credentials`（元数据）、
 * `POST .../rotate`、`DELETE`（吊销）、`PATCH .../applies-to`（重定范围）。
 *
 * **列表永远只有元数据。** runos 侧 `listMetadata()` 连 `secret_ciphertext`
 * 都不 select——不是"查出来再过滤"，是根本不查。所以这页回答得了"这个连接器
 * 的凭证配了没有、上次什么时候轮换的"，回答不了"密钥是什么"，后者永远无解，
 * 这是对的。
 *
 * **吊销会清空密文**（不是打标记），不可逆——所以走独立确认框，且和轮换一样
 * 挂 step-up 闸门（`product_250` v0.4：判据归 platform 目录、执行归 console）。
 *
 * mode 仍只接受 "account-scoped"：per-caller 依赖平台侧 RFC 8693 token
 * exchange（`vxture-platform#226`，未落地），runos 会直接拒。 */

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  Suspense,
} from "react";
import {
  ActionMenu,
  Banner,
  Button,
  DataTable,
  DetailList,
  DetailRow,
  DialogForm,
  Drawer,
  EmptyState,
  Field,
  FieldGroup,
  FieldTier,
  FieldLabel,
  FilterBar,
  FilterPopover,
  countFilterValue,
  type FilterValue,
  Icon,
  Input,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  ListPageTemplate,
  NativeSelect,
  Section,
  StatusBadge,
  TableTitleCell,
  ViewHeader,
  useListPagination,
  useToast,
  type StatusBadgeTone,
  ActionButton,
} from "@vxture/design-system";
import { ListPagination } from "@/modules/shared/ListPagination";
import { useOperatorSession } from "@/features/session/SessionProvider";
import { useLocale, useTranslations } from "next-intl";
import { useTableLabels } from "@/lib/table";
import { isStepUpCancelled, useStepUp } from "@/features/stepup/StepUpProvider";
import { api, OperaApiError } from "@/lib/api";
import { useConfirmLabels } from "@/lib/destructive";
import { formatDateTime } from "@vxture-platform/shared";
import { useTableSort, type SortAccessor } from "@/lib/table-sort";
import { FIELD_LABEL_A11Y } from "@/lib/form-labels";

const MANAGE = "capability:runos.manage";

/** 元数据视图——runos 侧不 select 密文，这里自然也没有对应字段。 */
interface CredentialBindingRecord {
  bindingId: string;
  credentialClass: string;
  providerId: string;
  mode: string;
  appliesTo: string[];
  subjectScope: string | null;
  state: string;
  createdAt: string;
  rotatedAt: string | null;
}

const STATE_TONE: Record<string, StatusBadgeTone> = {
  active: "success",
  revoked: "danger",
};

type DialogState =
  | { kind: "create" }
  | { kind: "rotate"; row: CredentialBindingRecord }
  /* 没有 `revoke` 档：吊销的确认由 DS 的 `ConfirmDestructive` 接管。 */
  | { kind: "scope"; row: CredentialBindingRecord }
  | null;

interface CredentialDraft {
  credentialClass: string;
  providerId: string;
  appliesTo: string;
  secretMaterial: string;
}

const EMPTY_DRAFT: CredentialDraft = {
  credentialClass: "",
  providerId: "",
  appliesTo: "",
  secretMaterial: "",
};

function describeError(error: unknown): { description?: string } {
  return error instanceof OperaApiError && error.message
    ? { description: error.message }
    : {};
}

/* 收 `locale` 而不是写死 `"zh-CN"`：日期的字段顺序属于语言——中文
   `2026/8/18`，英文 `8/18/2026`。 */
function formatTime(iso: string | null, locale: string): string {
  if (!iso) return "从未";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : formatDateTime(d, locale);
}

function parseList(input: string): string[] {
  return input
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready" };

/**
 * 深链(`vxture-platform#17` §4):`?bindingId=<uuid>` 把关键词框预填成那个绑定 id。
 *
 * 命中时同时打开那一条的详情抽屉（2026-09-15 起这一页有详情抽屉了）；关键词框仍预填
 * 那个 id，关掉抽屉后表格停在定位到的那一行上。
 *
 * 未命中时说出那个 id:一张空表读起来是「没有凭证绑定」,而那和「id 拼错了」
 * 「绑定被删了」在界面上一模一样。
 */
export default function RunosCredentialsPage() {
  return (
    <Suspense fallback={null}>
      <RunosCredentialsPageContent />
    </Suspense>
  );
}

function RunosCredentialsPageContent() {
  const locale = useLocale();
  const tShared = useTranslations();
  const tableLabels = useTableLabels();
  const withLabels = useConfirmLabels();
  const { toast } = useToast();
  const { can } = useOperatorSession();
  /* 凭证类操作全部托管密钥材料，走 step-up 闸门。 */
  const { runWithStepUp } = useStepUp();
  const canManage = can(MANAGE);

  const [rows, setRows] = useState<CredentialBindingRecord[]>([]);
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const deepLinkTarget = useSearchParams().get("bindingId");
  const [keyword, setKeyword] = useState(deepLinkTarget ?? "");
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [draft, setDraft] = useState<CredentialDraft>(EMPTY_DRAFT);
  const [secretInput, setSecretInput] = useState("");
  const [scopeInput, setScopeInput] = useState("");
  /* 筛选：状态 / 模式做下拉框，来源 / 凭证类别收进「更多筛选」气泡。清单一次全量取回，都在本地筛。 */
  const [facetValue, setFacetValue] = useState<FilterValue>({});
  /** 详情抽屉里看的那一条。null = 抽屉关着。 */
  const [detailRow, setDetailRow] = useState<CredentialBindingRecord | null>(
    null,
  );
  const [submitting, setSubmitting] = useState(false);

  const reload = useCallback(async () => {
    setLoad({ kind: "loading" });
    try {
      const data = await api.get<CredentialBindingRecord[]>(
        "/api/runos/credentials",
      );
      setRows(data);
      setLoad({ kind: "ready" });
    } catch (error) {
      setLoad({
        kind: "error",
        message:
          error instanceof OperaApiError ? error.message : "读取凭证清单失败",
      });
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  /**
   * 面板的维度与计数。清单是一次全量取回的，所以计数就是全量的——不存在「只看得到
   * 第一页里有哪些 Provider」的问题。
   */
  const facets = useMemo(() => {
    const options = (pick: (r: CredentialBindingRecord) => string) => {
      const counts = new Map<string, number>();
      for (const r of rows) counts.set(pick(r), (counts.get(pick(r)) ?? 0) + 1);
      return [...counts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([value, count]) => ({ value, label: value, count }));
    };
    return [
      {
        id: "providerId",
        label: "来源（Provider）",
        options: options((r) => r.providerId),
      },
      {
        id: "credentialClass",
        label: "凭证类别",
        options: options((r) => r.credentialClass),
      },
      { id: "state", label: "状态", options: options((r) => r.state) },
      { id: "mode", label: "模式", options: options((r) => r.mode) },
    ];
  }, [rows]);
  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    /* 维度内任一、维度间都要——面板的读法。 */
    const pass = (id: string, value: string) => {
      const chosen = facetValue[id] ?? [];
      return chosen.length === 0 || chosen.includes(value);
    };
    return rows.filter(
      (r) =>
        pass("providerId", r.providerId) &&
        pass("credentialClass", r.credentialClass) &&
        pass("state", r.state) &&
        pass("mode", r.mode) &&
        (kw === "" ||
          r.credentialClass.toLowerCase().includes(kw) ||
          r.providerId.toLowerCase().includes(kw) ||
          r.appliesTo.some((c) => c.toLowerCase().includes(kw))),
    );
  }, [rows, keyword, facetValue]);

  /* 等 `load.kind === "ready"` 再判：rows 还空着时任何 id 都会被判成找不到，
     那条 Banner 会每次进页面闪一下再消失——比没有提示更糟，它教人忽略提示。 */
  const [deepLinkMiss, setDeepLinkMiss] = useState<string | null>(null);
  const [deepLinkDone, setDeepLinkDone] = useState(false);
  useEffect(() => {
    if (deepLinkDone || !deepLinkTarget || load.kind !== "ready") return;
    setDeepLinkDone(true);
    const hit = rows.find((r) => r.bindingId === deepLinkTarget);
    if (hit) setDetailRow(hit);
    else setDeepLinkMiss(deepLinkTarget);
  }, [deepLinkDone, deepLinkTarget, load.kind, rows]);

  const bindingSortAccessors = useMemo<
    Readonly<Record<string, SortAccessor<CredentialBindingRecord>>>
  >(
    () => ({
      class: (r) => r.credentialClass,
      appliesTo: (r) => r.appliesTo.length,
      rotated: (r) => r.rotatedAt,
      state: (r) => r.state,
    }),
    [],
  );
  const bindingSort = useTableSort(filtered, bindingSortAccessors);
  const pager = useListPagination(bindingSort.rows, 20);

  function openCreate() {
    setDraft(EMPTY_DRAFT);
    setDialog({ kind: "create" });
  }

  function openRotate(row: CredentialBindingRecord) {
    setSecretInput("");
    setDialog({ kind: "rotate", row });
  }

  function openScope(row: CredentialBindingRecord) {
    setScopeInput(row.appliesTo.join(", "));
    setDialog({ kind: "scope", row });
  }

  /**
   * 吊销一条凭证绑定。落锤，由菜单项的 `confirm.onConfirm` 调用。
   *
   * 两处与共享 `submit` 不同的地方：
   *
   * 1. **失败一律重新抛出**——DS 的确认件按 Promise 是否 rejected 决定关不关框，
   *    吞掉异常会让一次失败的吊销看起来成功了。
   * 2. **取消二次验证不出 Toast，但仍然抛**：用户是从第二道门退回来的，该落回
   *    第一道门（确认框保持打开），而不是被告知"操作失败"。
   */
  async function revokeBinding(row: CredentialBindingRecord) {
    try {
      await runWithStepUp(() =>
        api.delete(`/api/runos/credentials/${row.bindingId}`),
      );
      toast({
        tone: "warning",
        title: `「${row.credentialClass}」已吊销`,
        description:
          "密文已清空，不可恢复；需要重新录入一条新绑定。凭证由网关每次调用直读、不走快照，所以这一步是立刻生效的——撤授权 / 禁端点 / 撤版本都不是。",
      });
      await reload();
    } catch (error) {
      if (!isStepUpCancelled(error)) {
        toast({ tone: "danger", title: "吊销失败", ...describeError(error) });
      }
      throw error;
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dialog) return;
    setSubmitting(true);
    try {
      if (dialog.kind === "create") {
        await runWithStepUp(() =>
          api.post("/api/runos/credentials", {
            credentialClass: draft.credentialClass.trim(),
            providerId: draft.providerId.trim(),
            mode: "account-scoped",
            appliesTo: parseList(draft.appliesTo),
            secretMaterial: draft.secretMaterial,
          }),
        );
        toast({
          tone: "success",
          title: `凭证「${draft.credentialClass.trim()}」已入库`,
          description: "明文已加密落库，此后任何读接口都不会再回显。",
        });
        setDraft(EMPTY_DRAFT);
      } else if (dialog.kind === "rotate") {
        await runWithStepUp(() =>
          api.post(`/api/runos/credentials/${dialog.row.bindingId}/rotate`, {
            secretMaterial: secretInput,
          }),
        );
        toast({
          tone: "success",
          title: `「${dialog.row.credentialClass}」已轮换`,
          description: "旧密文已被替换，不保留、不可找回。",
        });
      } else {
        const appliesTo = parseList(scopeInput);
        await runWithStepUp(() =>
          api.patch(
            `/api/runos/credentials/${dialog.row.bindingId}/applies-to`,
            { appliesTo },
          ),
        );
        toast({
          tone: "success",
          title: `「${dialog.row.credentialClass}」适用范围已更新`,
          description: `现覆盖 ${appliesTo.length} 个能力。`,
        });
      }
      setDialog(null);
      await reload();
    } catch (error) {
      /* 取消验证不是错误，静默——对话框保持打开，内容还在。 */
      if (!isStepUpCancelled(error)) {
        toast({ tone: "danger", title: "操作失败", ...describeError(error) });
      }
    } finally {
      setSubmitting(false);
    }
  }

  const createValid =
    draft.credentialClass.trim() !== "" &&
    draft.providerId.trim() !== "" &&
    parseList(draft.appliesTo).length > 0 &&
    draft.secretMaterial.trim() !== "";

  const emptyState =
    load.kind === "loading" ? (
      <EmptyState
        title={tShared("common.loading")}
        description="正在读取凭证绑定。"
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
    ) : filtered.length !== rows.length || countFilterValue(facetValue) > 0 ? (
      <EmptyState
        title="没有匹配的凭证"
        description={tShared("common.noMatchKeywordHint")}
      />
    ) : (
      <EmptyState title="暂无凭证绑定" description="点击「录入凭证」开始。" />
    );

  return (
    <>
      <ListPageTemplate
        header={
          <ViewHeader
            icon="key"
            title="凭证托管"
            description="第三方系统凭证托管与代理注入；列表只含元数据，密钥材料永不回显。"
          />
        }
        summary={
          deepLinkMiss ? (
            <Banner
              tone="warning"
              title={tShared("deepLink.bindingMissTitle")}
              description={tShared("deepLink.bindingMissBody", {
                id: deepLinkMiss,
              })}
            />
          ) : (
            <Banner
              tone="info"
              title="控制台零持有明文"
              description="密钥只在录入与轮换时经过一次，落库前 AES-256-GCM 加密；此后任何读接口——包括这个页面——都拿不到它。忘了只能轮换，不能查看。注入由网关在出站时完成，调用方全程看不到凭证。"
            />
          )
        }
        filters={
          <FilterBar
            view="list"
            onViewChange={() => {}}
            cardsDisabledReason={tShared("common.cardsRetired")}
            count={
              filtered.length === rows.length
                ? rows.length
                : `${filtered.length} / ${rows.length}`
            }
            search={
              <InputGroup className="min-w-media-2xl grow basis-0 max-w-panel-sm">
                <InputGroupAddon>
                  <Icon name="search" size="sm" aria-hidden="true" />
                </InputGroupAddon>
                <InputGroupInput
                  placeholder="搜索类别 / Provider / 适用能力…"
                  aria-label="搜索凭证"
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
              setFacetValue({});
              pager.resetPage();
            }}
            actions={
              canManage ? (
                <ActionButton
                  icon="plus"
                  onClick={openCreate}
                  disabled={submitting}
                >
                  录入凭证
                </ActionButton>
              ) : null
            }
          >
            {facets
              .filter((f) => f.id === "state" || f.id === "mode")
              .map((facet) => (
                <NativeSelect
                  key={facet.id}
                  wrapperClassName="w-fit"
                  aria-label={`${facet.label}筛选`}
                  value={facetValue[facet.id]?.[0] ?? "all"}
                  onChange={(e) => {
                    const v = e.target.value;
                    setFacetValue({
                      ...facetValue,
                      [facet.id]: v === "all" ? [] : [v],
                    });
                    pager.resetPage();
                  }}
                >
                  <option value="all">全部{facet.label}</option>
                  {facet.options.map(({ value, count }) => (
                    <option key={value} value={value}>
                      {value}（{count}）
                    </option>
                  ))}
                </NativeSelect>
              ))}
            <FilterPopover
              label="更多筛选"
              confirmLabel="确定"
              clearLabel="清空"
              emptyLabel="暂无可选值"
              facets={facets.filter(
                (f) => f.id === "providerId" || f.id === "credentialClass",
              )}
              value={{
                providerId: facetValue.providerId ?? [],
                credentialClass: facetValue.credentialClass ?? [],
              }}
              onChange={(next) => {
                setFacetValue({
                  ...facetValue,
                  providerId: next.providerId ?? [],
                  credentialClass: next.credentialClass ?? [],
                });
                pager.resetPage();
              }}
            />
          </FilterBar>
        }
        table={
          <DataTable
            labels={tableLabels}
            columns={[
              {
                id: "class",
                header: "凭证",
                sortable: true,
                cell: (r: CredentialBindingRecord) => (
                  <TableTitleCell
                    icon="key"
                    title={
                      <span className="font-mono">{r.credentialClass}</span>
                    }
                    description={r.providerId}
                    onTitleClick={() => setDetailRow(r)}
                  />
                ),
              },
              {
                id: "appliesTo",
                header: "适用范围",
                sortable: true,
                width: "sm",
                cell: (r: CredentialBindingRecord) => (
                  <span className="inline-flex flex-col items-center gap-2xs">
                    <span>{r.appliesTo.length} 个能力</span>
                    {r.subjectScope ? (
                      <span className="text-body-sm text-muted-foreground">
                        {r.subjectScope}
                      </span>
                    ) : null}
                  </span>
                ),
              },
              {
                id: "state",
                header: tShared("columns.state"),
                sortable: true,
                width: "sm",
                cell: (r: CredentialBindingRecord) => (
                  <span className="inline-flex flex-col items-center gap-2xs">
                    <StatusBadge tone={STATE_TONE[r.state] ?? "neutral"} dot>
                      {r.state}
                    </StatusBadge>
                    <span className="text-body-sm text-muted-foreground">
                      {r.mode}
                    </span>
                  </span>
                ),
              },
              {
                id: "rotated",
                header: "上次轮换",
                sortable: true,
                width: "sm",
                cell: (r: CredentialBindingRecord) =>
                  formatTime(r.rotatedAt, locale),
              },
            ]}
            rows={pager.pageRows}
            {...(bindingSort.sort ? { sort: bindingSort.sort } : {})}
            onSortChange={(next) => {
              bindingSort.onSortChange(next);
              pager.resetPage();
            }}
            rowKey={(r) => r.bindingId}
            selectedKeys={selected}
            onSelectionChange={setSelected}
            indexStart={pager.indexStart}
            rowActions={(r: CredentialBindingRecord) => (
              <ActionMenu
                label={`${r.credentialClass} 操作`}
                disabled={submitting}
                items={
                  canManage
                    ? [
                        {
                          id: "detail",
                          label: "查看详情",
                          icon: "eye",
                          onSelect: () => setDetailRow(r),
                        },
                        {
                          id: "rotate",
                          label: "轮换",
                          icon: "refresh",
                          disabled: r.state === "revoked",
                          onSelect: () => openRotate(r),
                        },
                        {
                          id: "scope",
                          label: "调整适用范围",
                          icon: "edit",
                          disabled: r.state === "revoked",
                          onSelect: () => openScope(r),
                        },
                        {
                          id: "revoke",
                          label: "吊销",
                          icon: "prohibit",
                          danger: true,
                          separatorBefore: true,
                          disabled: r.state === "revoked",
                          confirm: withLabels({
                            verb: "吊销",
                            target: `「${r.credentialClass}」的凭证绑定`,
                            /* 凭证是这套管理面里**唯一即时生效**的撤销：网关每次
                               调用都直读凭证库，不经快照。撤授权 / 禁端点 / 撤版本
                               三个都受快照约束、会再放行一轮——真要立刻断掉一条外部
                               调用，动的是这里。这一句必须留在后果里。 */
                            consequence:
                              "密文会被直接清空（不是打个标记），不可恢复，需要重新录入一条新绑定。凭证由网关每次调用直读、不走快照，所以这一步立刻生效——依赖它的能力调用会马上开始失败。",
                            onConfirm: () => revokeBinding(r),
                          }),
                        },
                      ]
                    : [
                        {
                          id: "detail",
                          label: "查看详情",
                          icon: "eye",
                          onSelect: () => setDetailRow(r),
                        },
                      ]
                }
              />
            )}
            footer={
              <ListPagination
                className="w-full"
                currentPage={pager.page}
                pageCount={pager.pageCount}
                total={rows.length}
                filteredTotal={filtered.length}
                pageSize={pager.pageSize}
                onPageSizeChange={pager.onPageSizeChange}
                onPageChange={pager.onPageChange}
              />
            }
            empty={emptyState}
          />
        }
      />

      {/* ── 详情（只读）：密文从不回显，所以这里只有绑定本身的事实 ──────────── */}
      <Drawer
        open={detailRow !== null}
        onClose={() => setDetailRow(null)}
        width="lg"
        title={detailRow ? `凭证 · ${detailRow.credentialClass}` : "凭证"}
        description="密文从不回显。换值用「轮换」，改覆盖面用「调整适用范围」。"
        closeLabel="关闭"
      >
        {detailRow ? (
          <div className="flex flex-col gap-xl">
            <DetailList>
              <DetailRow label="凭证类别">
                <span className="font-mono">{detailRow.credentialClass}</span>
              </DetailRow>
              <DetailRow label="来源（Provider）">
                {detailRow.providerId}
              </DetailRow>
              <DetailRow label="状态">
                <StatusBadge
                  tone={STATE_TONE[detailRow.state] ?? "neutral"}
                  dot
                >
                  {detailRow.state}
                </StatusBadge>
              </DetailRow>
              <DetailRow label="模式">{detailRow.mode}</DetailRow>
              {detailRow.subjectScope ? (
                <DetailRow label="主体范围">{detailRow.subjectScope}</DetailRow>
              ) : null}
              <DetailRow label="录入时间">
                {formatTime(detailRow.createdAt, locale)}
              </DetailRow>
              <DetailRow label="上次轮换">
                {formatTime(detailRow.rotatedAt, locale)}
              </DetailRow>
            </DetailList>
            <Section
              title={`适用能力（${detailRow.appliesTo.length}）`}
              icon="stack"
              level={3}
            >
              <ul className="flex flex-col gap-2xs">
                {detailRow.appliesTo.map((capabilityId) => (
                  <li key={capabilityId}>
                    <Link
                      href={`/capability/registry?capabilityId=${encodeURIComponent(capabilityId)}`}
                      className="font-mono text-code-sm text-primary hover:underline"
                    >
                      {capabilityId}
                    </Link>
                  </li>
                ))}
              </ul>
            </Section>
          </div>
        ) : null}
      </Drawer>

      {/* ── 录入 ─────────────────────────────────────────────────────────── */}
      <DialogForm
        open={dialog?.kind === "create"}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        size="lg"
        title="录入凭证"
        description="明文只在这一次经过；提交后立即加密落库，之后只能轮换、不能查看。"
        submitLabel="录入"
        submitting={submitting}
        submitDisabled={!createValid}
        onSubmit={submit}
        cancelLabel={tShared("actions.cancel")}
      >
        {/* 两档（DS FieldTier），每档一行两条（lg 面板）。四项都必填，所以没有高级档。 */}
        <FieldTier
          tier="identity"
          hint="类别须与目标能力的 credentialRequirements[].credentialClass 对上，否则这条凭证永远不会被取用。"
        >
          <FieldGroup columns={2}>
            <Field>
              <FieldLabel
                htmlFor="cred-class"
                required
                hint="须与目标能力 credentialRequirements[].credentialClass 对应。"
                {...FIELD_LABEL_A11Y}
              >
                凭证类别
              </FieldLabel>
              <Input
                id="cred-class"
                value={draft.credentialClass}
                onChange={(e) =>
                  setDraft({ ...draft, credentialClass: e.target.value })
                }
                placeholder="github-oauth"
                className="font-mono"
              />
            </Field>
            <Field>
              <FieldLabel
                htmlFor="cred-provider"
                required
                {...FIELD_LABEL_A11Y}
              >
                Provider
              </FieldLabel>
              <Input
                id="cred-provider"
                value={draft.providerId}
                onChange={(e) =>
                  setDraft({ ...draft, providerId: e.target.value })
                }
                placeholder="github"
              />
            </Field>
          </FieldGroup>
        </FieldTier>

        <FieldTier
          tier="details"
          title="适用范围与明文"
          hint="明文只在这一次提交时经过控制台，之后任何页面都读不回来。"
        >
          <FieldGroup columns={2}>
            <Field>
              <FieldLabel
                htmlFor="cred-applies"
                required
                hint="逗号分隔，至少一个。"
                {...FIELD_LABEL_A11Y}
              >
                适用的 Capability
              </FieldLabel>
              <Input
                id="cred-applies"
                value={draft.appliesTo}
                onChange={(e) =>
                  setDraft({ ...draft, appliesTo: e.target.value })
                }
                placeholder="arda.github-connector, arda.gitlab-connector"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="cred-secret" required {...FIELD_LABEL_A11Y}>
                凭证明文
              </FieldLabel>
              <Input
                id="cred-secret"
                type="password"
                value={draft.secretMaterial}
                onChange={(e) =>
                  setDraft({ ...draft, secretMaterial: e.target.value })
                }
                placeholder="ghp_…"
                autoComplete="off"
                className="font-mono"
              />
            </Field>
          </FieldGroup>
        </FieldTier>
      </DialogForm>

      {/* ── 轮换 ─────────────────────────────────────────────────────────── */}
      <DialogForm
        open={dialog?.kind === "rotate"}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        size="sm"
        title={
          dialog?.kind === "rotate"
            ? `轮换「${dialog.row.credentialClass}」`
            : "轮换凭证"
        }
        description="新值替换旧密文，旧值不保留、不可找回。上游侧请先确认新密钥已生效，再在这里替换。"
        submitLabel="轮换"
        submitting={submitting}
        submitDisabled={secretInput.trim() === ""}
        onSubmit={submit}
        cancelLabel={tShared("actions.cancel")}
      >
        <Field>
          <FieldLabel htmlFor="rotate-secret" required {...FIELD_LABEL_A11Y}>
            新的凭证明文
          </FieldLabel>
          <Input
            id="rotate-secret"
            type="password"
            value={secretInput}
            onChange={(e) => setSecretInput(e.target.value)}
            autoComplete="off"
            className="font-mono"
          />
        </Field>
      </DialogForm>

      {/* ── 调整适用范围 ─────────────────────────────────────────────────── */}
      <DialogForm
        open={dialog?.kind === "scope"}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        size="sm"
        title={
          dialog?.kind === "scope"
            ? `适用范围 · ${dialog.row.credentialClass}`
            : "调整适用范围"
        }
        description="不需要重新提供密钥。清空等于退役——runos 会拒绝空数组，要退役请用「吊销」。"
        submitLabel={tShared("common.save")}
        submitting={submitting}
        submitDisabled={parseList(scopeInput).length === 0}
        onSubmit={submit}
        cancelLabel={tShared("actions.cancel")}
      >
        <Field>
          <FieldLabel
            htmlFor="scope-list"
            required
            hint="这条凭证会被注入到列出的每一个能力的出站调用里，改动即刻生效。逗号分隔。"
            {...FIELD_LABEL_A11Y}
          >
            适用的 Capability
          </FieldLabel>
          <Input
            id="scope-list"
            value={scopeInput}
            onChange={(e) => setScopeInput(e.target.value)}
            className="font-mono"
          />
        </Field>
      </DialogForm>
    </>
  );
}
