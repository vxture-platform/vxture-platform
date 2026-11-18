"use client";

/**
 * GrantPolicyPanel.tsx - Continuous product policies and effective provenance.
 * @package @vxture/opera
 * @layer Presentation
 * @category component
 * @author AI-Generated
 * @date 2026-11-18
 */
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
const errorMessage = (error: unknown) =>
  error instanceof OperaApiError && error.status === 409
    ? "配置已被其他管理员更新。请保留当前修改，关闭后重新读取并核对；本次未覆盖他人配置。"
    : error instanceof Error
      ? error.message
      : "读取或保存失败，请重试。";
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
      setError(errorMessage(failure));
    }
  }, [endpoint]);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <section
      className="my-md rounded-lg border border-border p-md"
      aria-label="持续授权"
    >
      <div className="flex flex-wrap items-center justify-between gap-md">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-sm">
            <strong>持续授权规则</strong>
            {policy ? (
              <Badge variant="outline">版本 {policy.revision}</Badge>
            ) : null}
          </div>
          <p className="mt-xs text-body-small text-muted-foreground">
            {policy && effective
              ? `${policy.rules.filter((rule) => rule.enabled).length} 条启用规则 · 产品范围有效 ${effective.matched} 项 · 明确拒绝 ${effective.denied} 项`
              : "读取服务端规则与实际权限…"}
          </p>
          <p className="mt-xs text-body-small text-muted-foreground">
            持续匹配后续新增资源；下方表格保留手工授权。明确拒绝会覆盖手工授权。
          </p>
        </div>
        <Button
          variant="secondary"
          disabled={!policy || Boolean(error)}
          onClick={() => setOpened(true)}
        >
          {canManage ? "配置持续规则" : "查看规则与权限"}
        </Button>
      </div>
      {error ? (
        <div className="mt-md">
          <Banner tone="warning" title="持续授权未能读取" description={error} />
          <Button
            variant="secondary"
            className="mt-sm"
            onClick={() => void load()}
          >
            重新读取
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
  const noun = kind === "model" ? "模型路由" : "能力";
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
      setError(errorMessage(failure));
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
          ? "配置已保存，授权快照暂未刷新；正在按周期重试，请稍后查看生效权限。"
          : saved.propagationSeconds > 0
            ? `配置已保存，通常在 ${saved.propagationSeconds} 秒内同步至所有实例。`
            : "配置已保存，后续请求按新规则判定。服务器在请求时再次检查权限。",
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
      setError("请填写规则名称并选择匹配范围。");
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
      ? `规则：${savedRuleNames.get(source.slice(5)) ?? source.slice(5)}`
      : source.startsWith("manual:")
        ? `手工授权 ${source.slice(7)}`
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
      title={`${noun}持续授权`}
      description="规则按当前分类和标签持续匹配，后续新增资源无需逐条授权。"
      width="min(960px, 100vw)"
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
            关闭
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
              {busy ? "处理中…" : review ? "确认保存规则" : "预览变更并确认"}
            </Button>
          ) : null}
        </div>
      }
    >
      <div className="flex flex-col gap-md">
        {error ? (
          <Banner tone="danger" title="操作未完成" description={error} />
        ) : null}
        {notice ? (
          <Banner tone="success" title="保存结果" description={notice} />
        ) : null}
        {discarding ? (
          <Banner
            tone="warning"
            title="存在尚未保存的修改"
            description={
              <div className="flex flex-wrap gap-sm">
                <Button
                  variant="secondary"
                  onClick={() => setDiscarding(false)}
                >
                  继续编辑
                </Button>
                <Button variant="secondary" onClick={onClose}>
                  放弃修改并关闭
                </Button>
              </div>
            }
          />
        ) : null}
        <div
          className="flex flex-wrap gap-sm"
          role="group"
          aria-label="规则视图"
        >
          <Button
            variant={mode === "rules" ? "default" : "secondary"}
            disabled={busy}
            onClick={() => setMode("rules")}
          >
            规则配置
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
            当前生效权限
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
            修改记录
          </Button>
        </div>
        {review && report ? (
          <Banner
            tone="warning"
            title="请核对后保存"
            description={`按当前目录计算，保存后产品范围有效 ${report.matched} 项，明确拒绝 ${report.denied} 项。新增资源也会持续匹配；手工授权保留，但明确拒绝优先。`}
          />
        ) : null}
        {mode === "rules" ? (
          <>
            <Banner
              tone="info"
              title="持续匹配与本次全选不同"
              description="本次全选仅授权当前资源；持续规则会跟随新增资源及其分类、标签变更。排除项只退出这一条规则，彻底禁止请添加明确拒绝规则。"
            />
            {rules.length === 0 ? (
              <p className="text-muted-foreground">
                尚未配置持续规则，现有手工授权继续生效。
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
                      {rule.enabled ? "启用" : "停用"} ·{" "}
                      {rule.effect === "deny" ? "明确拒绝" : "允许"} ·{" "}
                      {rule.selector.mode === "all"
                        ? "全部及未来新增"
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
                        编辑
                      </Button>
                      <Button
                        variant="secondary"
                        disabled={busy}
                        onClick={() =>
                          change(rules.filter((item) => item.id !== rule.id))
                        }
                      >
                        移除
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
                新增规则
              </Button>
            ) : null}
            {editing ? (
              <div className="flex flex-col gap-md rounded-lg border border-border p-md">
                <Field>
                  <FieldLabel>规则名称</FieldLabel>
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
                    <FieldLabel>处理方式</FieldLabel>
                    <NativeSelect
                      value={editing.effect}
                      onChange={(event) =>
                        setEditing({
                          ...editing,
                          effect: event.target.value as Rule["effect"],
                        })
                      }
                    >
                      <option value="allow">允许授权</option>
                      <option value="deny">明确拒绝（优先）</option>
                    </NativeSelect>
                  </Field>
                  <Field>
                    <FieldLabel>匹配范围</FieldLabel>
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
                      <option value="all">全部，包含未来新增</option>
                      <option value="categories">指定分类，包含未来新增</option>
                      <option value="tags">指定标签，包含未来新增</option>
                      <option value="resources">指定资源编号</option>
                    </NativeSelect>
                  </Field>
                </div>
                {editing.selector.mode !== "all" ? (
                  <Field>
                    <FieldLabel>
                      {editing.selector.mode === "categories"
                        ? "分类"
                        : editing.selector.mode === "tags"
                          ? "标签"
                          : "资源编号"}
                      （多个用逗号分隔）
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
                    <FieldLabel>标签匹配</FieldLabel>
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
                      <option value="any">满足任一标签</option>
                      <option value="all">满足全部标签</option>
                    </NativeSelect>
                  </Field>
                ) : null}
                <Field>
                  <FieldLabel>
                    排除的资源编号（可选，多个用逗号分隔）
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
                      <FieldLabel>风险上限</FieldLabel>
                      <NativeSelect
                        value={editing.riskScope}
                        onChange={(event) =>
                          setEditing({
                            ...editing,
                            riskScope: event.target.value as Rule["riskScope"],
                          })
                        }
                      >
                        <option value="read">只读</option>
                        <option value="write">写入</option>
                        <option value="critical">高风险</option>
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
                      高风险操作需要审批
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
                  启用此规则
                </label>
                <div className="flex gap-sm">
                  <Button onClick={addEdited}>应用到待保存配置</Button>
                  <Button variant="secondary" onClick={() => setEditing(null)}>
                    取消本条编辑
                  </Button>
                </div>
              </div>
            ) : null}
          </>
        ) : null}
        {mode === "effective" && report ? (
          <>
            <p>
              服务端产品范围有效 {report.matched} 项，明确拒绝 {report.denied}{" "}
              项。应用级手工授权请查看主表。
            </p>
            {dirty ? (
              <Banner
                tone="info"
                title="此处展示已保存规则"
                description="当前编辑内容尚未保存，不影响此列表。"
              />
            ) : null}
            <InputGroup>
              <InputGroupInput
                aria-label="筛选生效资源"
                placeholder="搜索资源编号"
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
                      ? `拒绝规则：${entry.deniedBy.map((id) => savedRuleNames.get(id) ?? id).join("、")}`
                      : `授权来源：${entry.sources.map(sourceLabel).join("、")}`}
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
                上一页
              </Button>
              <span>
                {page + 1} / {Math.max(1, Math.ceil(matches.length / 50))}
              </span>
              <Button
                variant="secondary"
                disabled={(page + 1) * 50 >= matches.length}
                onClick={() => setPage(page + 1)}
              >
                下一页
              </Button>
            </div>
          </>
        ) : null}
        {mode === "history" ? (
          <div className="divide-y divide-border">
            {history?.length ? (
              history.map((item) => (
                <div key={item.revision} className="py-md">
                  <strong>版本 {item.revision}</strong>
                  <p className="mt-xs break-all text-body-small text-muted-foreground">
                    {item.updatedAt} · {item.updatedBy}
                  </p>
                  <p className="mt-xs text-body-small">
                    {item.rules.length} 条规则 ·{" "}
                    {item.rules.map((rule) => rule.name).join("、")}
                  </p>
                </div>
              ))
            ) : (
              <p>暂无修改记录。</p>
            )}
          </div>
        ) : null}
      </div>
    </Drawer>
  );
}
