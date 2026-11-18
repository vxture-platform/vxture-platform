"use client";

/**
 * GrantPickerDrawer.tsx - Shared catalog picker for model and capability grants.
 * @package @vxture/opera
 * @layer Presentation
 * @category component
 * @author AI-Generated
 * @date 2026-11-18
 */

import { useEffect, useRef, useState } from "react";
import {
  Badge,
  Banner,
  Button,
  Checkbox,
  Drawer,
  Field,
  FieldLabel,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  Icon,
  NativeSelect,
} from "@vxture/design-system";
import {
  executeGrantBatch,
  filterResources,
  selectMatches,
  type BatchResult,
  type GrantResource,
  type ResourceFilter,
} from "./selection";

// ============================================================================
// Types and defaults
// ============================================================================

interface GrantPickerDrawerProps {
  readonly kind: "model" | "capability";
  readonly productCode: string;
  readonly resources: readonly GrantResource[];
  readonly onClose: () => void;
  readonly onGrant: (id: string, riskScope: string) => Promise<void>;
  readonly onComplete: () => Promise<void>;
}

const PAGE_SIZE = 50;
const INITIAL_FILTER: ResourceFilter = {
  keyword: "",
  category: "",
  availability: "available",
  selectedOnly: false,
};

// ============================================================================
// Component
// ============================================================================

/**
 * Render a bounded picker with cross-page selection and explicit batch review.
 * @param props Catalog, product context and existing grant operations.
 * @returns A shared model or capability authorization drawer.
 */
export function GrantPickerDrawer({
  kind,
  productCode,
  resources,
  onClose,
  onGrant,
  onComplete,
}: GrantPickerDrawerProps) {
  const [filter, setFilter] = useState(INITIAL_FILTER);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [completed, setCompleted] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const [riskScope, setRiskScope] = useState("read");
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [result, setResult] = useState<BatchResult | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [refreshError, setRefreshError] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const running = useRef(false);
  const noun = kind === "model" ? "模型路由" : "能力";
  const rows = resources.map((row) => ({
    ...row,
    held: row.held || completed.has(row.id),
  }));
  const categories = [...new Set(rows.map((row) => row.category))].sort();
  const matches = filterResources(rows, filter, picked);
  const eligible = matches.filter((row) => !row.held);
  const selected = rows.filter((row) => picked.has(row.id) && !row.held);
  const outside = selected.filter(
    (row) => !matches.some((match) => match.id === row.id),
  ).length;
  const selectedMatches = eligible.filter((row) => picked.has(row.id)).length;
  const pages = Math.max(1, Math.ceil(matches.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages - 1);
  const visible = matches.slice(
    currentPage * PAGE_SIZE,
    (currentPage + 1) * PAGE_SIZE,
  );
  const busy = progress !== null;

  useEffect(() => {
    if (!busy && picked.size === 0) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy, picked.size]);

  function updateFilter(update: Partial<ResourceFilter>) {
    setFilter((previous) => ({ ...previous, ...update }));
    setPage(0);
    setReviewing(false);
  }

  async function submit() {
    if (running.current || selected.length === 0) return;
    running.current = true;
    setProgress({ done: 0, total: selected.length });
    setResult(null);
    setReviewing(false);
    try {
      const next = await executeGrantBatch(
        selected.map((row) => row.id),
        (id) => onGrant(id, riskScope),
        (done) => setProgress({ done, total: selected.length }),
      );
      setResult(next);
      setCompleted((previous) => new Set([...previous, ...next.succeeded]));
      setPicked(new Set(next.failed.map((failure) => failure.id)));
      if (next.failed.length > 0) updateFilter({ selectedOnly: true });
      else updateFilter({ availability: "all", selectedOnly: false });
    } finally {
      running.current = false;
      setProgress(null);
    }
  }

  async function close(discard = false) {
    if (running.current) return;
    if (selected.length > 0 && !discard) {
      setDiscarding(true);
      return;
    }
    // Refresh the parent only on close so partial failures keep their selections.
    if (completed.size > 0) {
      running.current = true;
      setProgress({ done: completed.size, total: completed.size });
      try {
        await onComplete();
      } catch {
        setRefreshError(true);
        return;
      } finally {
        running.current = false;
        setProgress(null);
      }
    }
    onClose();
  }

  return (
    <Drawer
      open
      onClose={() => {
        void close();
      }}
      width="lg"
      title={`授权${noun} · ${productCode}`}
      description="选择当前目录中的资源。本次授权不会自动包含未来新增资源。"
      closeLabel="关闭授权面板"
      className="max-w-full [&>div]:min-w-0 [&>div:first-of-type]:shrink-0 [&>div:last-child]:shrink-0 [&>div:last-child]:flex-wrap [&>div:nth-last-child(2)]:flex [&>div:nth-last-child(2)]:min-h-0 [&>div:nth-last-child(2)]:flex-col [&>div:nth-last-child(2)]:overflow-hidden"
      footer={
        <>
          <span
            className="mr-auto text-body-small text-muted-foreground"
            role="status"
            aria-live="polite"
          >
            {progress
              ? `正在处理 ${progress.done} / ${progress.total}，请勿关闭页面`
              : `已选 ${selected.length} 项${outside ? ` · ${outside} 项在当前筛选外` : ""}`}
          </span>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => {
              void close();
            }}
          >
            关闭
          </Button>
          <Button
            disabled={busy || selected.length === 0}
            onClick={() => setReviewing(true)}
          >
            {result?.failed.length
              ? `重试 ${selected.length} 项`
              : `授权 ${selected.length} 项`}
          </Button>
        </>
      }
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-md">
        <div className="flex shrink-0 flex-col gap-sm">
          <p className="text-body-small text-muted-foreground">
            目录 {rows.length} 项 · 已持有{" "}
            {rows.filter((row) => row.held).length} 项 · 匹配 {matches.length}{" "}
            项
          </p>
          <div className="grid min-w-0 gap-sm sm:grid-cols-2">
            <InputGroup>
              <InputGroupAddon>
                <Icon name="search" size="sm" aria-hidden="true" />
              </InputGroupAddon>
              <InputGroupInput
                aria-label={`搜索${noun}`}
                placeholder="搜索名称、ID、分类…"
                disabled={busy}
                value={filter.keyword}
                onChange={(event) =>
                  updateFilter({ keyword: event.target.value })
                }
              />
            </InputGroup>
            <NativeSelect
              aria-label="资源分类"
              disabled={busy}
              value={filter.category}
              onChange={(event) =>
                updateFilter({ category: event.target.value })
              }
            >
              <option value="">全部分类</option>
              {categories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect
              aria-label="授权状态"
              disabled={busy}
              value={filter.availability}
              onChange={(event) =>
                updateFilter({
                  availability: event.target
                    .value as ResourceFilter["availability"],
                })
              }
            >
              <option value="all">全部授权状态</option>
              <option value="available">未授权</option>
              <option value="held">已持有</option>
            </NativeSelect>
            <label className="flex items-center gap-sm text-body-small">
              <Checkbox
                checked={filter.selectedOnly}
                disabled={busy}
                onCheckedChange={(checked) =>
                  updateFilter({ selectedOnly: checked === true })
                }
              />
              只看已选
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-sm border-b border-border pb-sm">
            <label className="flex items-center gap-sm text-body-small">
              <Checkbox
                aria-label="全选筛选结果"
                disabled={busy || eligible.length === 0}
                checked={
                  selectedMatches === 0
                    ? false
                    : selectedMatches === eligible.length
                      ? true
                      : "indeterminate"
                }
                onCheckedChange={(checked) => {
                  setPicked(selectMatches(picked, matches, checked === true));
                  setReviewing(false);
                }}
              />
              全选筛选结果（{eligible.length}）
            </label>
            <Button
              variant="ghost"
              disabled={busy || selectedMatches === 0}
              onClick={() => {
                setPicked(selectMatches(picked, matches, false));
                setReviewing(false);
              }}
            >
              取消选择筛选结果
            </Button>
            <Button
              variant="ghost"
              disabled={busy || picked.size === 0}
              onClick={() => {
                setPicked(new Set());
                setReviewing(false);
              }}
            >
              清空选择
            </Button>
          </div>
          {kind === "capability" ? (
            <Field>
              <FieldLabel htmlFor="grant-risk-scope">本批次风险上限</FieldLabel>
              <NativeSelect
                id="grant-risk-scope"
                disabled={busy}
                value={riskScope}
                onChange={(event) => {
                  setRiskScope(event.target.value);
                  setReviewing(false);
                }}
              >
                <option value="read">read · 读取</option>
                <option value="write">write · 写入</option>
                <option value="critical">critical · 高风险操作</option>
              </NativeSelect>
            </Field>
          ) : null}
          {discarding ? (
            <div className="flex flex-wrap items-center gap-sm rounded-md border border-border p-sm">
              <p className="min-w-0 flex-1 text-body-small">
                尚有 {selected.length}{" "}
                项未提交，是否放弃选择并关闭？已成功的授权不会撤销。
              </p>
              <Button variant="secondary" onClick={() => setDiscarding(false)}>
                继续编辑
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  void close(true);
                }}
              >
                放弃选择并关闭
              </Button>
            </div>
          ) : null}
          {reviewing ? (
            <div className="flex flex-wrap items-center gap-sm rounded-md border border-border p-sm">
              <p className="min-w-0 flex-1 text-body-small break-words">
                将向 {productCode} 授予 {selected.length} 项{noun}
                {kind === "capability"
                  ? `，风险上限 ${riskScope}`
                  : "，适用于该产品下的全部应用"}
                。不包含未来新增资源。
              </p>
              <Button variant="secondary" onClick={() => setReviewing(false)}>
                返回选择
              </Button>
              <Button
                onClick={() => {
                  void submit();
                }}
              >
                确认授权
              </Button>
            </div>
          ) : null}
          {result ? (
            <Banner
              tone={result.failed.length ? "warning" : "success"}
              title={`本批次成功 ${result.succeeded.length} 项，失败 ${result.failed.length} 项`}
              description={
                result.failed.length
                  ? "失败项已保留，可查看原因后重试。已成功的项目不会重复提交。"
                  : "授权已写入；关闭面板后刷新产品授权列表。"
              }
            />
          ) : null}
          {refreshError ? (
            <Banner
              tone="warning"
              title="授权已写入，但列表刷新失败"
              description="请再次关闭以重试刷新，不要重复授权。"
            />
          ) : null}
        </div>
        <div
          className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain rounded-md border border-border"
          aria-label={`${noun}目录`}
          aria-busy={busy}
        >
          {visible.length === 0 ? (
            <p className="p-lg text-body-small text-muted-foreground">
              没有匹配资源，请调整筛选条件。
            </p>
          ) : (
            visible.map((row) => {
              const failure = result?.failed.find((item) => item.id === row.id);
              return (
                <label
                  key={row.id}
                  className="flex min-w-0 items-start gap-sm border-b border-border p-sm last:border-b-0 hover:bg-accent"
                >
                  <Checkbox
                    aria-label={`选择${row.name}`}
                    checked={row.held || picked.has(row.id)}
                    disabled={busy || row.held}
                    onCheckedChange={(checked) => {
                      setPicked(selectMatches(picked, [row], checked === true));
                      setReviewing(false);
                    }}
                  />
                  <span className="flex min-w-0 flex-1 flex-col gap-2xs">
                    <span className="text-body-small break-words text-foreground">
                      {row.name}
                    </span>
                    <span className="font-mono text-code break-all text-muted-foreground">
                      {row.id}
                    </span>
                    {row.description && row.description !== row.name ? (
                      <span className="text-body-small break-words text-muted-foreground">
                        {row.description}
                      </span>
                    ) : null}
                    <span className="flex flex-wrap gap-xs">
                      <Badge variant="secondary">{row.category}</Badge>
                      {row.held ? (
                        <Badge variant="outline">已持有</Badge>
                      ) : row.status ? (
                        <Badge variant="outline">{row.status}</Badge>
                      ) : null}
                    </span>
                    {failure ? (
                      <span className="text-body-small break-words text-destructive">
                        {failure.message}
                      </span>
                    ) : null}
                  </span>
                </label>
              );
            })
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-sm text-body-small text-muted-foreground">
          <span>
            第 {currentPage + 1} / {pages} 页 · 每页 {PAGE_SIZE} 项 ·
            全选跨页生效
          </span>
          <div className="flex gap-sm">
            <Button
              variant="secondary"
              disabled={busy || currentPage === 0}
              onClick={() => setPage(currentPage - 1)}
            >
              上一页
            </Button>
            <Button
              variant="secondary"
              disabled={busy || currentPage + 1 >= pages}
              onClick={() => setPage(currentPage + 1)}
            >
              下一页
            </Button>
          </div>
        </div>
      </div>
    </Drawer>
  );
}
