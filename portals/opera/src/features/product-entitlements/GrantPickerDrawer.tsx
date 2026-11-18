"use client";

/**
 * GrantPickerDrawer.tsx - Shared catalog picker for model and capability grants.
 * @package @vxture/opera
 * @layer Presentation
 * @category component
 * @author AI-Generated
 * @date 2026-11-18
 */

import { useTranslations } from "next-intl";
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
  const t = useTranslations("productGrants");
  const noun = kind === "model" ? t("modelRoute") : t("capability");
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
      title={t("pickerTitle", { noun, productCode })}
      description={t("selectResourcesFromTheCurrentCatalogThis")}
      closeLabel={t("closeGrantPanel")}
      className="max-w-full [&>div]:min-w-0 [&>div:first-of-type]:shrink-0 [&>div:last-child]:shrink-0 [&>div:last-child]:flex-wrap [&>div:nth-last-child(2)]:flex [&>div:nth-last-child(2)]:min-h-0 [&>div:nth-last-child(2)]:flex-col [&>div:nth-last-child(2)]:overflow-hidden"
      footer={
        <>
          <span
            className="mr-auto text-body-small text-muted-foreground"
            role="status"
            aria-live="polite"
          >
            {progress
              ? t("progress", { done: progress.done, total: progress.total })
              : t("selectedCount", { count: selected.length }) +
                (outside ? t("outsideCount", { count: outside }) : "")}
          </span>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => {
              void close();
            }}
          >
            {t("close")}
          </Button>
          <Button
            disabled={busy || selected.length === 0}
            onClick={() => setReviewing(true)}
          >
            {result?.failed.length
              ? t("retryCount", { count: selected.length })
              : t("grantCount", { count: selected.length })}
          </Button>
        </>
      }
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-md">
        <div className="flex shrink-0 flex-col gap-sm">
          <p className="text-body-small text-muted-foreground">
            {t("catalog")}
            {rows.length} {t("itemsAlreadyGranted")}{" "}
            {rows.filter((row) => row.held).length} {t("itemsMatching")}
            {matches.length} {t("items")}
          </p>
          <div className="grid min-w-0 gap-sm sm:grid-cols-2">
            <InputGroup>
              <InputGroupAddon>
                <Icon name="search" size="sm" aria-hidden="true" />
              </InputGroupAddon>
              <InputGroupInput
                aria-label={t("searchNoun", { noun })}
                placeholder={t("searchNameIdOrCategory")}
                disabled={busy}
                value={filter.keyword}
                onChange={(event) =>
                  updateFilter({ keyword: event.target.value })
                }
              />
            </InputGroup>
            <NativeSelect
              aria-label={t("resourceCategory")}
              disabled={busy}
              value={filter.category}
              onChange={(event) =>
                updateFilter({ category: event.target.value })
              }
            >
              <option value="">{t("allCategories")}</option>
              {categories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect
              aria-label={t("grantStatus")}
              disabled={busy}
              value={filter.availability}
              onChange={(event) =>
                updateFilter({
                  availability: event.target
                    .value as ResourceFilter["availability"],
                })
              }
            >
              <option value="all">{t("allGrantStatuses")}</option>
              <option value="available">{t("notGranted")}</option>
              <option value="held">{t("alreadyGranted")}</option>
            </NativeSelect>
            <label className="flex items-center gap-sm text-body-small">
              <Checkbox
                checked={filter.selectedOnly}
                disabled={busy}
                onCheckedChange={(checked) =>
                  updateFilter({ selectedOnly: checked === true })
                }
              />
              {t("selectedOnly")}
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-sm border-b border-border pb-sm">
            <label className="flex items-center gap-sm text-body-small">
              <Checkbox
                aria-label={t("selectAllMatchingResources")}
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
              {t("selectAllMatchingResources019")}
              {eligible.length}）
            </label>
            <Button
              variant="ghost"
              disabled={busy || selectedMatches === 0}
              onClick={() => {
                setPicked(selectMatches(picked, matches, false));
                setReviewing(false);
              }}
            >
              {t("deselectMatchingResources")}
            </Button>
            <Button
              variant="ghost"
              disabled={busy || picked.size === 0}
              onClick={() => {
                setPicked(new Set());
                setReviewing(false);
              }}
            >
              {t("clearSelection")}
            </Button>
          </div>
          {kind === "capability" ? (
            <Field>
              <FieldLabel htmlFor="grant-risk-scope">
                {t("riskLimitForThisBatch")}
              </FieldLabel>
              <NativeSelect
                id="grant-risk-scope"
                disabled={busy}
                value={riskScope}
                onChange={(event) => {
                  setRiskScope(event.target.value);
                  setReviewing(false);
                }}
              >
                <option value="read">{t("readReadOperations")}</option>
                <option value="write">{t("writeWriteOperations")}</option>
                <option value="critical">
                  {t("criticalHighRiskOperations")}
                </option>
              </NativeSelect>
            </Field>
          ) : null}
          {discarding ? (
            <div className="flex flex-wrap items-center gap-sm rounded-md border border-border p-sm">
              <p className="min-w-0 flex-1 text-body-small">
                {t("remaining")}
                {selected.length}{" "}
                {t("itemsAreUnsubmittedDiscardTheSelectionAnd")}
              </p>
              <Button variant="secondary" onClick={() => setDiscarding(false)}>
                {t("continueEditing")}
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  void close(true);
                }}
              >
                {t("discardSelectionAndClose")}
              </Button>
            </div>
          ) : null}
          {reviewing ? (
            <div className="flex flex-wrap items-center gap-sm rounded-md border border-border p-sm">
              <p className="min-w-0 flex-1 text-body-small break-words">
                {t("grantTo")}
                {productCode} {t("grantSeparator")}
                {selected.length} {t("items")}
                {noun}
                {kind === "capability"
                  ? t("riskSummary", { risk: riskScope })
                  : t("coveringAllApplicationsUnderThisProduct")}
                {t("futureResourcesAreNotIncluded")}
              </p>
              <Button variant="secondary" onClick={() => setReviewing(false)}>
                {t("backToSelection")}
              </Button>
              <Button
                onClick={() => {
                  void submit();
                }}
              >
                {t("confirmGrants")}
              </Button>
            </div>
          ) : null}
          {result ? (
            <Banner
              tone={result.failed.length ? "warning" : "success"}
              title={t("batchSummary", {
                succeeded: result.succeeded.length,
                failed: result.failed.length,
              })}
              description={
                result.failed.length
                  ? t("failedItemsAreRetainedForReviewAnd")
                  : t("grantsSavedCloseThisPanelToRefresh")
              }
            />
          ) : null}
          {refreshError ? (
            <Banner
              tone="warning"
              title={t("grantsSavedButTheListCouldNot")}
              description={t("closeAgainToRetryRefreshingDoNot")}
            />
          ) : null}
        </div>
        <div
          className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain rounded-md border border-border"
          aria-label={t("catalogLabel", { noun })}
          aria-busy={busy}
        >
          {visible.length === 0 ? (
            <p className="p-lg text-body-small text-muted-foreground">
              {t("noMatchingResourcesAdjustYourFilters")}
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
                    aria-label={t("selectResource", { name: row.name })}
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
                        <Badge variant="outline">{t("alreadyGranted")}</Badge>
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
            {t("page")}
            {currentPage + 1} / {pages} {t("perPage")}
            {PAGE_SIZE} {t("itemsSelectAllAppliesAcrossPages")}
          </span>
          <div className="flex gap-sm">
            <Button
              variant="secondary"
              disabled={busy || currentPage === 0}
              onClick={() => setPage(currentPage - 1)}
            >
              {t("previous")}
            </Button>
            <Button
              variant="secondary"
              disabled={busy || currentPage + 1 >= pages}
              onClick={() => setPage(currentPage + 1)}
            >
              {t("next")}
            </Button>
          </div>
        </div>
      </div>
    </Drawer>
  );
}
