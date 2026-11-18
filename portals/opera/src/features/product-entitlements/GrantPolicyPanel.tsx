"use client";

/**
 * GrantPolicyPanel.tsx - Continuous product policies and effective provenance.
 * @package @vxture/opera
 * @layer Presentation
 * @category component
 * @author AI-Generated
 * @date 2026-11-18
 */
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Badge,
  Banner,
  Button,
  Checkbox,
  Drawer,
  Field,
  FieldLabel,
  InputGroup,
  InputGroupInput,
  NativeSelect,
} from "@vxture/design-system";
import { api, OperaApiError } from "@/lib/api";
import type { GrantResource } from "./selection";

// Transport types ------------------------------------------------------------
interface Rule {
  id: string;
  name: string;
  enabled: boolean;
  effect: "allow" | "deny";
  selector: {
    mode: "all" | "categories" | "tags" | "resources";
    values: string[];
    tagMatch: "any" | "all";
    excludedIds: string[];
  };
  riskScope: "read" | "write" | "critical";
  criticalRequiresApproval: boolean;
}
interface Policy {
  revision: number;
  rules: Rule[];
  updatedBy: string | null;
  updatedAt: string | null;
}
interface Evaluation {
  matched: number;
  denied: number;
  resources: { resourceId: string; sources: string[]; deniedBy: string[] }[];
}
interface Props {
  kind: "model" | "capability";
  productCode: string;
  resources: readonly GrantResource[];
  canManage: boolean;
}

const splitValues = (value: string) => [
  ...new Set(
    value
      .split(/[,，\n]/)
      .map((item) => item.trim())
      .filter(Boolean),
  ),
];
const errorMessage = (error: unknown, t: (key: string) => string) =>
  error instanceof OperaApiError && error.status === 409
    ? t("anotherAdministratorUpdatedThisConfigurationKeepYour")
    : error instanceof Error
      ? error.message
      : t("couldNotLoadOrSavePleaseRetry");
const newRule = (): Rule => ({
  id: crypto.randomUUID(),
  name: "",
  enabled: true,
  effect: "allow",
  selector: { mode: "all", values: [], tagMatch: "any", excludedIds: [] },
  riskScope: "read",
  criticalRequiresApproval: true,
});

// Read summary ---------------------------------------------------------------
export function GrantPolicyPanel({
  kind,
  productCode,
  resources,
  canManage,
}: Props) {
  const t = useTranslations("productGrants");
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [effective, setEffective] = useState<Evaluation | null>(null);
  const [error, setError] = useState("");
  const [opened, setOpened] = useState(false);
  const endpoint = `/api/${kind === "model" ? "atlas" : "runos"}/grant-policies/${encodeURIComponent(productCode)}`;
  const load = useCallback(async () => {
    setError("");
    try {
      const [document, report] = await Promise.all([
        api.get<Policy>(endpoint),
        api.get<Evaluation>(`${endpoint}/effective`),
      ]);
      setPolicy(document);
      setEffective(report);
    } catch (failure) {
      setError(errorMessage(failure, t));
    }
  }, [endpoint, t]);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <section
      className="my-md rounded-lg border border-border p-md"
      aria-label={t("continuousGrants")}
    >
      <div className="flex flex-wrap items-center justify-between gap-md">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-sm">
            <strong>{t("continuousGrantRules")}</strong>
            {policy ? (
              <Badge variant="outline">
                {t("revision")}
                {policy.revision}
              </Badge>
            ) : null}
          </div>
          <p className="mt-xs text-body-small text-muted-foreground">
            {policy && effective
              ? t("summary", {
                  count: policy.rules.filter((rule) => rule.enabled).length,
                  matched: effective.matched,
                  denied: effective.denied,
                })
              : t("loadingSavedRulesAndEffectivePermissions")}
          </p>
          <p className="mt-xs text-body-small text-muted-foreground">
            {t("rulesAlsoMatchFutureResourcesTheTable")}
          </p>
        </div>
        <Button
          variant="secondary"
          disabled={!policy || Boolean(error)}
          onClick={() => setOpened(true)}
        >
          {canManage
            ? t("configureContinuousRules")
            : t("viewRulesAndPermissions")}
        </Button>
      </div>
      {error ? (
        <div className="mt-md">
          <Banner
            tone="warning"
            title={t("couldNotLoadContinuousGrants")}
            description={error}
          />
          <Button
            variant="secondary"
            className="mt-sm"
            onClick={() => void load()}
          >
            {t("reload")}
          </Button>
        </div>
      ) : null}
      {opened && policy ? (
        <PolicyEditor
          key={endpoint}
          kind={kind}
          endpoint={endpoint}
          initial={policy}
          resources={resources}
          canManage={canManage}
          onClose={() => setOpened(false)}
          onSaved={load}
        />
      ) : null}
    </section>
  );
}

// Editor and review ----------------------------------------------------------
function PolicyEditor({
  kind,
  endpoint,
  initial,
  resources,
  canManage,
  onClose,
  onSaved,
}: {
  kind: Props["kind"];
  endpoint: string;
  initial: Policy;
  resources: Props["resources"];
  canManage: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const t = useTranslations("productGrants");
  const [document, setDocument] = useState(initial);
  const [rules, setRules] = useState(initial.rules);
  const [editing, setEditing] = useState<Rule | null>(null);
  const [values, setValues] = useState("");
  const [exclusions, setExclusions] = useState("");
  const [report, setReport] = useState<Evaluation | null>(null);
  const [history, setHistory] = useState<Policy[] | null>(null);
  const [mode, setMode] = useState<"rules" | "effective" | "history">("rules");
  const [review, setReview] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const inFlight = useRef(false);
  const dirty =
    JSON.stringify(rules) !== JSON.stringify(document.rules) ||
    editing !== null;
  const noun = kind === "model" ? t("modelRoute") : t("capability");
  const categories = [
    ...new Set(resources.map((resource) => resource.category)),
  ].sort();
  const knownTags = [
    ...new Set(resources.flatMap((resource) => resource.tags ?? [])),
  ].sort();
  useEffect(() => {
    if (!dirty && !busy) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, busy]);
  function change(next: Rule[]) {
    setRules(next);
    setReview(false);
    setReport(null);
    setNotice("");
  }
  function edit(rule: Rule) {
    setEditing(rule);
    setValues(rule.selector.values.join(", "));
    setExclusions(rule.selector.excludedIds.join(", "));
    setReview(false);
    setError("");
  }
  async function run(operation: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      await operation();
    } catch (failure) {
      setError(errorMessage(failure, t));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  async function preview() {
    await run(async () => {
      setReport(
        await api.post<Evaluation>(`${endpoint}/preview`, {
          expectedRevision: document.revision,
          rules,
        }),
      );
      setReview(true);
    });
  }
  async function save() {
    await run(async () => {
      const saved = await api.post<
        Policy & { propagationSeconds: number; enforcementPending?: boolean }
      >(endpoint, { expectedRevision: document.revision, rules });
      setDocument(saved);
      setRules(saved.rules);
      setReview(false);
      setNotice(
        saved.enforcementPending
          ? t("configurationSavedTheAuthorizationSnapshotHasNot")
          : saved.propagationSeconds > 0
            ? t("propagation", { seconds: saved.propagationSeconds })
            : t("configurationSavedNewRequestsUseTheUpdated"),
      );
      await onSaved();
    });
  }
  function addEdited() {
    if (!editing) return;
    const selected = editing.selector.mode === "all" ? [] : splitValues(values);
    if (
      !editing.name.trim() ||
      (editing.selector.mode !== "all" && selected.length === 0)
    ) {
      setError(t("enterARuleNameAndSelectIts"));
      return;
    }
    const next = {
      ...editing,
      name: editing.name.trim(),
      selector: {
        ...editing.selector,
        values: selected,
        excludedIds: splitValues(exclusions),
      },
    };
    change(
      rules.some((rule) => rule.id === next.id)
        ? rules.map((rule) => (rule.id === next.id ? next : rule))
        : [...rules, next],
    );
    setEditing(null);
    setError("");
  }
  const savedRuleNames = new Map(
    document.rules.map((rule) => [rule.id, rule.name]),
  );
  const sourceLabel = (source: string) =>
    source.startsWith("rule:")
      ? t("ruleSource", {
          name: savedRuleNames.get(source.slice(5)) ?? source.slice(5),
        })
      : source.startsWith("manual:")
        ? t("manualSource", { id: source.slice(7) })
        : source;
  const matches = (report?.resources ?? []).filter(
    (entry) =>
      entry.resourceId.toLowerCase().includes(search.toLowerCase()) &&
      (entry.sources.length > 0 || entry.deniedBy.length > 0),
  );
  return (
    <Drawer
      open
      onClose={() => {
        if (!busy) {
          if (dirty) setDiscarding(true);
          else onClose();
        }
      }}
      title={t("policyTitle", { noun })}
      description={t("rulesContinuouslyMatchCurrentCategoriesAndTags")}
      width="lg"
      className="max-w-full"
      footer={
        <div className="flex w-full flex-wrap items-center justify-end gap-sm">
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => {
              if (dirty) setDiscarding(true);
              else onClose();
            }}
          >
            {t("close")}
          </Button>
          {canManage ? (
            <Button
              disabled={
                busy ||
                editing !== null ||
                JSON.stringify(rules) === JSON.stringify(document.rules)
              }
              onClick={() => void (review ? save() : preview())}
            >
              {busy
                ? t("processing")
                : review
                  ? t("confirmAndSaveRules")
                  : t("previewChangesAndConfirm")}
            </Button>
          ) : null}
        </div>
      }
    >
      <div className="flex flex-col gap-md">
        {error ? (
          <Banner
            tone="danger"
            title={t("operationIncomplete")}
            description={error}
          />
        ) : null}
        {notice ? (
          <Banner tone="success" title={t("saveResult")} description={notice} />
        ) : null}
        {discarding ? (
          <Banner
            tone="warning"
            title={t("unsavedChanges")}
            description={
              <div className="flex flex-wrap gap-sm">
                <Button
                  variant="secondary"
                  onClick={() => setDiscarding(false)}
                >
                  {t("continueEditing")}
                </Button>
                <Button variant="secondary" onClick={onClose}>
                  {t("discardChangesAndClose")}
                </Button>
              </div>
            }
          />
        ) : null}
        <div
          className="flex flex-wrap gap-sm"
          role="group"
          aria-label={t("ruleViews")}
        >
          <Button
            variant={mode === "rules" ? "default" : "secondary"}
            disabled={busy}
            onClick={() => setMode("rules")}
          >
            {t("ruleConfiguration")}
          </Button>
          <Button
            variant={mode === "effective" ? "default" : "secondary"}
            disabled={busy}
            onClick={() =>
              void run(async () => {
                setReport(await api.get<Evaluation>(`${endpoint}/effective`));
                setReview(false);
                setMode("effective");
                setPage(0);
              })
            }
          >
            {t("effectivePermissions")}
          </Button>
          <Button
            variant={mode === "history" ? "default" : "secondary"}
            disabled={busy}
            onClick={() =>
              void run(async () => {
                setHistory(await api.get<Policy[]>(`${endpoint}/history`));
                setMode("history");
              })
            }
          >
            {t("changeHistory")}
          </Button>
        </div>
        {review && report ? (
          <Banner
            tone="warning"
            title={t("reviewBeforeSaving")}
            description={t("previewSummary", {
              matched: report.matched,
              denied: report.denied,
            })}
          />
        ) : null}
        {mode === "rules" ? (
          <>
            <Banner
              tone="info"
              title={t("continuousMatchingDiffersFromSelectingAll")}
              description={t(
                "selectingAllGrantsCurrentResourcesOnlyContinuous",
              )}
            />
            {rules.length === 0 ? (
              <p className="text-muted-foreground">
                {t("noContinuousRulesConfiguredExistingManualGrants")}
              </p>
            ) : (
              rules.map((rule) => (
                <div
                  key={rule.id}
                  className="flex flex-wrap items-center justify-between gap-sm rounded-lg border border-border p-md"
                >
                  <div className="min-w-0 break-words">
                    <strong>{rule.name}</strong>
                    <p className="mt-xs text-body-small text-muted-foreground">
                      {rule.enabled ? t("enabled") : t("disabled")} ·{" "}
                      {rule.effect === "deny" ? t("explicitDeny") : t("allow")}{" "}
                      ·{" "}
                      {rule.selector.mode === "all"
                        ? t("allCurrentAndFutureResources")
                        : rule.selector.values.join("、")}{" "}
                      {kind === "capability" && rule.effect === "allow"
                        ? `· ${rule.riskScope}`
                        : ""}
                    </p>
                  </div>
                  {canManage ? (
                    <div className="flex gap-sm">
                      <Button
                        variant="secondary"
                        disabled={busy}
                        onClick={() => edit(rule)}
                      >
                        {t("edit")}
                      </Button>
                      <Button
                        variant="secondary"
                        disabled={busy}
                        onClick={() =>
                          change(rules.filter((item) => item.id !== rule.id))
                        }
                      >
                        {t("remove")}
                      </Button>
                    </div>
                  ) : null}
                </div>
              ))
            )}
            {canManage && !editing ? (
              <Button
                variant="secondary"
                disabled={busy || rules.length >= 100}
                onClick={() => edit(newRule())}
              >
                {t("addRule")}
              </Button>
            ) : null}
            {editing ? (
              <div className="flex flex-col gap-md rounded-lg border border-border p-md">
                <Field>
                  <FieldLabel>{t("ruleName")}</FieldLabel>
                  <InputGroup>
                    <InputGroupInput
                      value={editing.name}
                      maxLength={100}
                      onChange={(event) =>
                        setEditing({ ...editing, name: event.target.value })
                      }
                    />
                  </InputGroup>
                </Field>
                <div className="grid gap-md sm:grid-cols-2">
                  <Field>
                    <FieldLabel>{t("effect")}</FieldLabel>
                    <NativeSelect
                      value={editing.effect}
                      onChange={(event) =>
                        setEditing({
                          ...editing,
                          effect: event.target.value as Rule["effect"],
                        })
                      }
                    >
                      <option value="allow">{t("allowAccess")}</option>
                      <option value="deny">
                        {t("explicitDenyTakesPriority")}
                      </option>
                    </NativeSelect>
                  </Field>
                  <Field>
                    <FieldLabel>{t("matchingScope")}</FieldLabel>
                    <NativeSelect
                      value={editing.selector.mode}
                      onChange={(event) => {
                        setEditing({
                          ...editing,
                          selector: {
                            ...editing.selector,
                            mode: event.target
                              .value as Rule["selector"]["mode"],
                          },
                        });
                        setValues("");
                      }}
                    >
                      <option value="all">
                        {t("allIncludingFutureResources")}
                      </option>
                      <option value="categories">
                        {t("categoriesIncludingFutureResources")}
                      </option>
                      <option value="tags">
                        {t("tagsIncludingFutureResources")}
                      </option>
                      <option value="resources">
                        {t("specificResourceIds")}
                      </option>
                    </NativeSelect>
                  </Field>
                </div>
                {editing.selector.mode !== "all" ? (
                  <Field>
                    <FieldLabel>
                      {editing.selector.mode === "categories"
                        ? t("category")
                        : editing.selector.mode === "tags"
                          ? t("tags")
                          : t("resourceIds")}
                      {t("separateMultipleValuesWithCommas")}
                    </FieldLabel>
                    <InputGroup>
                      <InputGroupInput
                        value={values}
                        onChange={(event) => setValues(event.target.value)}
                      />
                    </InputGroup>
                    {editing.selector.mode === "categories" ||
                    editing.selector.mode === "tags" ? (
                      <div className="mt-sm flex max-h-32 flex-wrap gap-xs overflow-y-auto">
                        {(editing.selector.mode === "categories"
                          ? categories
                          : knownTags
                        ).map((value) => (
                          <Button
                            key={value}
                            size="sm"
                            variant={
                              splitValues(values).includes(value)
                                ? "default"
                                : "secondary"
                            }
                            onClick={() =>
                              setValues(
                                splitValues(values).includes(value)
                                  ? splitValues(values)
                                      .filter((item) => item !== value)
                                      .join(", ")
                                  : [...splitValues(values), value].join(", "),
                              )
                            }
                          >
                            {value}
                          </Button>
                        ))}
                      </div>
                    ) : null}
                  </Field>
                ) : null}
                {editing.selector.mode === "tags" ? (
                  <Field>
                    <FieldLabel>{t("tagMatching")}</FieldLabel>
                    <NativeSelect
                      value={editing.selector.tagMatch}
                      onChange={(event) =>
                        setEditing({
                          ...editing,
                          selector: {
                            ...editing.selector,
                            tagMatch: event.target.value as "any" | "all",
                          },
                        })
                      }
                    >
                      <option value="any">{t("matchAnyTag")}</option>
                      <option value="all">{t("matchAllTags")}</option>
                    </NativeSelect>
                  </Field>
                ) : null}
                <Field>
                  <FieldLabel>
                    {t("excludedResourceIdsOptionalCommaSeparated")}
                  </FieldLabel>
                  <InputGroup>
                    <InputGroupInput
                      value={exclusions}
                      onChange={(event) => setExclusions(event.target.value)}
                    />
                  </InputGroup>
                </Field>
                {kind === "capability" && editing.effect === "allow" ? (
                  <>
                    <Field>
                      <FieldLabel>{t("riskLimit")}</FieldLabel>
                      <NativeSelect
                        value={editing.riskScope}
                        onChange={(event) =>
                          setEditing({
                            ...editing,
                            riskScope: event.target.value as Rule["riskScope"],
                          })
                        }
                      >
                        <option value="read">{t("readOnly")}</option>
                        <option value="write">{t("write")}</option>
                        <option value="critical">{t("highRisk")}</option>
                      </NativeSelect>
                    </Field>
                    <label className="flex items-center gap-sm">
                      <Checkbox
                        checked={editing.criticalRequiresApproval}
                        onCheckedChange={(checked) =>
                          setEditing({
                            ...editing,
                            criticalRequiresApproval: checked === true,
                          })
                        }
                      />
                      {t("requireApprovalForHighRiskOperations")}
                    </label>
                  </>
                ) : null}
                <label className="flex items-center gap-sm">
                  <Checkbox
                    checked={editing.enabled}
                    onCheckedChange={(checked) =>
                      setEditing({ ...editing, enabled: checked === true })
                    }
                  />
                  {t("enableThisRule")}
                </label>
                <div className="flex gap-sm">
                  <Button onClick={addEdited}>{t("applyToDraft")}</Button>
                  <Button variant="secondary" onClick={() => setEditing(null)}>
                    {t("cancelRuleEditing")}
                  </Button>
                </div>
              </div>
            ) : null}
          </>
        ) : null}
        {mode === "effective" && report ? (
          <>
            <p>
              {t("effectiveProductWidePermissions")}
              {report.matched} {t("itemsExplicitlyDenied")}
              {report.denied} {t("itemsSeeTheMainTableForApplication")}
            </p>
            {dirty ? (
              <Banner
                tone="info"
                title={t("showingSavedRules")}
                description={t("unsavedEditsDoNotAffectThisList")}
              />
            ) : null}
            <InputGroup>
              <InputGroupInput
                aria-label={t("filterEffectiveResources")}
                placeholder={t("searchResourceId")}
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(0);
                }}
              />
            </InputGroup>
            <div className="divide-y divide-border">
              {matches.slice(page * 50, (page + 1) * 50).map((entry) => (
                <div key={entry.resourceId} className="py-sm">
                  <p className="break-all font-mono text-body-small">
                    {entry.resourceId}
                  </p>
                  <p className="mt-xs break-all text-body-small text-muted-foreground">
                    {entry.deniedBy.length
                      ? t("denySources", {
                          names: entry.deniedBy
                            .map((id) => savedRuleNames.get(id) ?? id)
                            .join(", "),
                        })
                      : t("allowSources", {
                          names: entry.sources.map(sourceLabel).join(", "),
                        })}
                  </p>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between gap-sm">
              <Button
                variant="secondary"
                disabled={page === 0}
                onClick={() => setPage(page - 1)}
              >
                {t("previous")}
              </Button>
              <span>
                {page + 1} / {Math.max(1, Math.ceil(matches.length / 50))}
              </span>
              <Button
                variant="secondary"
                disabled={(page + 1) * 50 >= matches.length}
                onClick={() => setPage(page + 1)}
              >
                {t("next")}
              </Button>
            </div>
          </>
        ) : null}
        {mode === "history" ? (
          <div className="divide-y divide-border">
            {history?.length ? (
              history.map((item) => (
                <div key={item.revision} className="py-md">
                  <strong>
                    {t("revision")}
                    {item.revision}
                  </strong>
                  <p className="mt-xs break-all text-body-small text-muted-foreground">
                    {item.updatedAt} · {item.updatedBy}
                  </p>
                  <p className="mt-xs text-body-small">
                    {item.rules.length} {t("rules")}{" "}
                    {item.rules.map((rule) => rule.name).join("、")}
                  </p>
                </div>
              ))
            ) : (
              <p>{t("noChangesRecorded")}</p>
            )}
          </div>
        ) : null}
      </div>
    </Drawer>
  );
}
