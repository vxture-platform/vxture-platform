"use client";

/**
 * ModelDetailPage.tsx — 一条模型的注册与配置，都在这一张二级页。
 * @package @vxture/opera
 * @layer Presentation
 * @category Features - Atlas
 *
 * owner 2026-10-05:「查看、添加、编辑 为二级页面，汇集自检检查页面（业务需要完整错误
 * 反馈，现在太简单了）」。
 *
 * 此前「注册模型」是列表页首的弹窗，自检是行操作里一个弹窗、结果再弹一个框（随手关掉就
 * 没了），线协议生效值是第三个抽屉。三件本就属于「这一条模型」的事，散在三个一闪而过的
 * 浮层里。现在都收在它自己的页上：
 *  - 上半是注册/配置表单（编码与类型创建后不可改，其余随时调）。
 *  - 「自检」板块把一次真实调用的**完整回执**常驻在页面上——每条检查的码与文案、usage
 *    与内容是否交付、以及请求本身失败时的 HTTP 状态/错误码/冷却倒计时，见 `ProbeInspection`。
 *  - 「线协议（生效值）」板块把三层合并后的实际 wire 直接摊开，不必再跑一次自检去看。
 *
 * 载入靠列表端点按 `modelCode` 命中（atlas 无单取接口；modelCode 全局唯一、锁死不可改，
 * 是消费方 pin 的那个标识，拿它做路由键稳定可分享）。
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Badge,
  Button,
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldTier,
  Icon,
  Input,
  NativeSelect,
  Section,
  Separator,
  StatusBadge,
  Textarea,
  ViewHeader,
  ViewLayout,
  EmptyState,
  useToast,
} from "@vxture/design-system";
import { FIELD_LABEL_A11Y, FIELD_TIER_TITLE } from "@/lib/form-labels";
import { useOperatorSession } from "@/features/session/SessionProvider";
import { isEnabled } from "@/features/atlas/state";
import { api, OperaApiError } from "@/lib/api";
import { WireReport } from "./WireReport";
import {
  ProbeInspection,
  ProbeWarning,
  type ProbeState,
} from "./ProbeInspection";
import {
  buildModelConfig,
  CAPABILITY_OPTIONS,
  describeError,
  emptyModelDraft,
  MODEL_MANAGE,
  MODEL_TYPES,
  modelDraftFrom,
  modelStateMeta,
  parseExtraBody,
  parseOptionalInt,
  type AiModelRecord,
  type LoadState,
  type ModelDraft,
  type ModelProbeResult,
  type ModelProviderRecord,
  type ProtocolCatalogEntry,
  type ProviderKeyRecord,
} from "./model-service";

const CATALOG = "/model/services";

export function ModelDetailPage({
  modelCode,
}: {
  readonly modelCode: string | null;
}) {
  const router = useRouter();
  const tShared = useTranslations();
  const { toast } = useToast();
  const { can } = useOperatorSession();
  const canManage = can(MODEL_MANAGE);
  const isCreate = modelCode === null;

  /* 新建从某个 provider 行发起时带的预填目标。 */
  const initialProviderId = useSearchParams().get("providerId") ?? "";

  const [load, setLoad] = useState<LoadState | { kind: "missing" }>({
    kind: "loading",
  });
  const [row, setRow] = useState<AiModelRecord | null>(null);
  const [providers, setProviders] = useState<ModelProviderRecord[]>([]);
  const [protocols, setProtocols] = useState<ProtocolCatalogEntry[]>([]);
  const [wireSchemaVersion, setWireSchemaVersion] = useState<number | null>(
    null,
  );
  const [draft, setDraft] = useState<ModelDraft>(
    emptyModelDraft("", "openai-compatible"),
  );
  const [saving, setSaving] = useState(false);
  const [probe, setProbe] = useState<ProbeState>({ kind: "idle" });

  /** 所选 Provider 的 vault 别名候选；`"unavailable"` = 读失败，降级为手填。 */
  const [aliasOptions, setAliasOptions] = useState<
    ProviderKeyRecord[] | "unavailable" | null
  >(null);

  const providerById = useMemo(
    () => new Map(providers.map((p) => [p.id, p])),
    [providers],
  );

  const reload = useCallback(async () => {
    setLoad({ kind: "loading" });
    try {
      const [providerRows, modelRows, protoRes] = await Promise.all([
        api.get<ModelProviderRecord[]>(
          "/api/atlas/providers?includeInactive=true",
        ),
        isCreate
          ? Promise.resolve<AiModelRecord[]>([])
          : api.get<AiModelRecord[]>("/api/atlas/models?includeInactive=true"),
        api
          .get<{
            wireSchemaVersion: number;
            protocols: ProtocolCatalogEntry[];
          }>("/api/atlas/protocols")
          .catch(() => ({ wireSchemaVersion: null, protocols: [] })),
      ]);
      setProviders(providerRows);
      setProtocols(protoRes.protocols);
      setWireSchemaVersion(protoRes.wireSchemaVersion);

      if (isCreate) {
        const fallbackProvider =
          initialProviderId ||
          providerRows.find((p) => isEnabled(p.state))?.id ||
          "";
        setDraft(
          emptyModelDraft(
            fallbackProvider,
            protoRes.protocols[0]?.protocol ?? "openai-compatible",
          ),
        );
        setRow(null);
        setLoad({ kind: "ready" });
        return;
      }

      const found = modelRows.find((m) => m.modelCode === modelCode) ?? null;
      if (!found) {
        setLoad({ kind: "missing" });
        return;
      }
      setRow(found);
      setDraft(modelDraftFrom(found));
      setLoad({ kind: "ready" });
    } catch (error) {
      setLoad({
        kind: "error",
        message:
          error instanceof OperaApiError ? error.message : "读取模型失败",
      });
    }
  }, [isCreate, modelCode, initialProviderId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /* 跟着所选 Provider 拉它的 vault 别名清单喂密钥下拉。 */
  const draftProviderCode =
    providerById.get(draft.providerId)?.providerCode ?? "";
  useEffect(() => {
    if (draftProviderCode === "") {
      setAliasOptions(null);
      return;
    }
    let cancelled = false;
    setAliasOptions(null);
    void api
      .get<ProviderKeyRecord[]>(
        `/api/atlas/provider-keys?providerCode=${encodeURIComponent(draftProviderCode)}`,
      )
      .then((rows) => {
        if (!cancelled) setAliasOptions(rows);
      })
      .catch(() => {
        if (!cancelled) setAliasOptions("unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, [draftProviderCode]);

  const activeProviders = useMemo(
    () =>
      providers.filter((p) => isEnabled(p.state) || p.id === draft.providerId),
    [providers, draft.providerId],
  );

  const protocolOptions = useMemo(() => {
    const codes = protocols.map((p) => p.protocol);
    return draft.protocol && !codes.includes(draft.protocol)
      ? [draft.protocol, ...codes]
      : codes;
  }, [protocols, draft.protocol]);

  function toggleCapability(cap: string) {
    setDraft((d) => ({
      ...d,
      capabilities: d.capabilities.includes(cap)
        ? d.capabilities.filter((c) => c !== cap)
        : [...d.capabilities, cap],
    }));
  }

  async function runProbe() {
    if (!row) return;
    setProbe({ kind: "running" });
    try {
      const result = await api.post<ModelProbeResult>(
        `/api/atlas/models/${row.id}/probe`,
      );
      setProbe({
        kind: "result",
        ok: result.ok,
        lead: result.keyResolved
          ? "密钥已解析。"
          : "密钥未解析——这个模型当前无法真实调用。",
        body: result,
      });
    } catch (error) {
      setProbe({ kind: "error", error, context: "model" });
    }
  }

  const draftValid =
    draft.modelCode.trim() !== "" &&
    draft.modelName.trim() !== "" &&
    draft.endpointUrl.trim() !== "" &&
    draft.capabilities.length > 0;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const provider = providerById.get(draft.providerId);

    const contextWindow = parseOptionalInt(draft.contextWindow);
    const maxOutputTokens = parseOptionalInt(draft.maxOutputTokens);
    const sort = parseOptionalInt(draft.sort);
    const badField = [
      [contextWindow, "上下文窗口"],
      [maxOutputTokens, "最大输出"],
      [sort, "排序权重"],
    ].find(([v]) => v === null);
    if (badField) {
      toast({
        tone: "danger",
        title: `${badField[1]}要填非负整数`,
        description: "留空表示不设；填了就必须是一个 atlas 收得下的整数。",
      });
      return;
    }

    const extraBody = parseExtraBody(draft.extraBody);
    if (!extraBody.ok) {
      toast({
        tone: "danger",
        title: "厂商开关没通过",
        description: extraBody.reason,
      });
      return;
    }

    const mutable = {
      modelName: draft.modelName.trim(),
      providerId: draft.providerId || null,
      endpointUrl: draft.endpointUrl.trim(),
      protocol: draft.protocol,
      description: draft.description.trim() || null,
      capabilities: draft.capabilities,
      supportsStreaming: draft.supportsStreaming,
      ...(contextWindow !== undefined ? { contextWindow } : {}),
      ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
      ...(sort !== undefined ? { sort } : {}),
      /* 只送 managed（vault 别名）。env 形态 atlas 已「出现即 400」（ADR-003）。 */
      keyReference: draft.keyAlias.trim()
        ? { source: "managed" as const, name: draft.keyAlias.trim() }
        : null,
      /* keyReference 在场时 atlas 整体替换 config，必须 round-trip 存量回去。 */
      config: buildModelConfig(
        row?.config ?? null,
        draft.upstreamModel,
        extraBody.value,
        wireSchemaVersion,
      ),
    };

    setSaving(true);
    try {
      if (isCreate) {
        await api.post("/api/atlas/models", {
          modelCode: draft.modelCode.trim(),
          provider: provider?.providerCode ?? draft.providerId,
          /* modelType 只在创建时送——与 modelCode 一样是身份列，PATCH 带上会 400。 */
          modelType: draft.modelType,
          ...mutable,
        });
        toast({ tone: "success", title: `${draft.modelCode} 已注册` });
        router.push(
          `${CATALOG}/model/${encodeURIComponent(draft.modelCode.trim())}`,
        );
      } else {
        await api.patch(`/api/atlas/models/${row?.id}`, mutable);
        toast({ tone: "success", title: `${draft.modelCode} 已保存` });
        await reload();
      }
    } catch (error) {
      toast({ tone: "danger", title: "保存失败", ...describeError(error) });
    } finally {
      setSaving(false);
    }
  }

  const header = (
    <ViewHeader
      icon="brain"
      title={isCreate ? "注册模型" : (row?.modelName ?? modelCode ?? "")}
      description={
        isCreate
          ? "一条模型＝从某家 Provider 接入的某个模型。编码与类型创建后不可改，其余随时可调。"
          : (row?.modelCode ?? undefined)
      }
      secondary={
        row ? (
          <span
            title={
              row.state === "deprecated" && row.deprecatedAt
                ? `弃用于 ${row.deprecatedAt}`
                : undefined
            }
          >
            <StatusBadge tone={modelStateMeta(row.state).tone} dot>
              {modelStateMeta(row.state).label}
            </StatusBadge>
          </span>
        ) : undefined
      }
      action={
        <Button asChild variant="outline">
          <Link href={CATALOG}>
            <Icon name="arrow-left" size="xs" aria-hidden="true" />
            返回模型服务
          </Link>
        </Button>
      }
    />
  );

  if (load.kind === "loading") {
    return (
      <ViewLayout>
        {header}
        <EmptyState
          title={tShared("common.loading")}
          description="正在读取。"
        />
      </ViewLayout>
    );
  }
  if (load.kind === "missing" || load.kind === "error") {
    return (
      <ViewLayout>
        {header}
        <EmptyState
          title={load.kind === "missing" ? "模型不存在" : "读取失败"}
          description={
            load.kind === "missing"
              ? `模型服务里没有编码「${modelCode ?? ""}」。`
              : load.message
          }
          action={
            <Button variant="secondary" onClick={() => void reload()}>
              {tShared("common.retry")}
            </Button>
          }
        />
      </ViewLayout>
    );
  }

  return (
    <ViewLayout>
      {header}
      <form onSubmit={save} className="flex min-w-0 flex-col gap-2xl">
        <div className="density-compact flex flex-col gap-md">
          <FieldTier
            tier="identity"
            title={FIELD_TIER_TITLE.identity}
            hint="决定这是哪个模型、由谁供应。"
          >
            <FieldGroup>
              <div className="grid grid-cols-2 gap-md">
                <Field>
                  <FieldLabel
                    required
                    hint="全局唯一。同一上游模型由多家供应时各注册一条，编码加「供应方/」前缀区分，上游真实名填「上游模型名」。"
                    {...FIELD_LABEL_A11Y}
                    htmlFor="model-code"
                  >
                    编码
                  </FieldLabel>
                  <Input
                    id="model-code"
                    value={draft.modelCode}
                    onChange={(e) =>
                      setDraft({ ...draft, modelCode: e.target.value })
                    }
                    placeholder="deepseek/deepseek-v4-flash"
                    disabled={!isCreate}
                  />
                </Field>
                <Field>
                  <FieldLabel
                    {...FIELD_LABEL_A11Y}
                    required
                    htmlFor="model-name"
                  >
                    名称
                  </FieldLabel>
                  <Input
                    id="model-name"
                    value={draft.modelName}
                    onChange={(e) =>
                      setDraft({ ...draft, modelName: e.target.value })
                    }
                    placeholder="DeepSeek V4 Flash（火山）"
                  />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-md">
                <Field>
                  <FieldLabel
                    hint="只列启用中的（当前已挂的除外）。模型与 Provider 都启用才可服务；换它即换供应方与密钥来源。"
                    {...FIELD_LABEL_A11Y}
                    htmlFor="model-provider"
                  >
                    Provider
                  </FieldLabel>
                  <NativeSelect
                    id="model-provider"
                    value={draft.providerId}
                    onChange={(e) =>
                      setDraft({ ...draft, providerId: e.target.value })
                    }
                  >
                    {draft.providerId === "" ? (
                      <option value="">— 选择 Provider —</option>
                    ) : null}
                    {activeProviders.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.providerName}
                        {isEnabled(p.state) ? "" : "（已停用）"}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field>
                  <FieldLabel htmlFor="model-type">
                    {tShared("columns.kind")}
                  </FieldLabel>
                  <NativeSelect
                    id="model-type"
                    value={draft.modelType}
                    onChange={(e) =>
                      setDraft({ ...draft, modelType: e.target.value })
                    }
                    disabled={!isCreate}
                  >
                    {MODEL_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </NativeSelect>
                  <FieldDescription>
                    {MODEL_TYPES.find((t) => t.value === draft.modelType)
                      ?.hint ?? ""}
                    {isCreate
                      ? "。创建后不可改。"
                      : "。创建后不可改，要换类型只能重新注册。"}
                  </FieldDescription>
                </Field>
              </div>
            </FieldGroup>
          </FieldTier>

          <FieldTier
            tier="details"
            title={FIELD_TIER_TITLE.details}
            hint="接入参数：填错要到第一次真实调用才暴露。"
          >
            <FieldGroup>
              <div className="grid grid-cols-2 gap-md">
                <Field>
                  <FieldLabel
                    required
                    hint="上游 API 的基地址。"
                    {...FIELD_LABEL_A11Y}
                    htmlFor="model-endpoint"
                  >
                    Endpoint URL
                  </FieldLabel>
                  <Input
                    id="model-endpoint"
                    value={draft.endpointUrl}
                    onChange={(e) =>
                      setDraft({ ...draft, endpointUrl: e.target.value })
                    }
                    placeholder="https://api.openai.com/v1"
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="model-protocol">协议</FieldLabel>
                  <NativeSelect
                    id="model-protocol"
                    value={draft.protocol}
                    onChange={(e) =>
                      setDraft({ ...draft, protocol: e.target.value })
                    }
                  >
                    {protocolOptions.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </NativeSelect>
                  <FieldDescription>
                    {protocols.length > 0
                      ? (protocols.find((p) => p.protocol === draft.protocol)
                          ?.description ?? "来自 Atlas 的协议词表。")
                      : "协议词表读取失败，只能保留当前值。"}
                  </FieldDescription>
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-md">
                <Field>
                  <FieldLabel
                    hint="调用上游时送的 model 参数，留空＝直接用编码。编码带了供应方前缀、或上游用接入点 ID（火山引擎 ep-…）时必填。"
                    {...FIELD_LABEL_A11Y}
                    htmlFor="model-upstream"
                  >
                    上游模型名
                  </FieldLabel>
                  <Input
                    id="model-upstream"
                    value={draft.upstreamModel}
                    onChange={(e) =>
                      setDraft({ ...draft, upstreamModel: e.target.value })
                    }
                    placeholder="deepseek-v4-flash / ep-2026…"
                    className="font-mono"
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="model-key">
                    密钥（vault 别名）
                  </FieldLabel>
                  {aliasOptions === "unavailable" ? (
                    <>
                      <Input
                        id="model-key"
                        value={draft.keyAlias}
                        onChange={(e) =>
                          setDraft({ ...draft, keyAlias: e.target.value })
                        }
                        placeholder="default"
                        className="font-mono"
                      />
                      <FieldDescription>
                        密钥清单读取失败；直接填这家 Provider
                        密钥库里的别名也可。
                      </FieldDescription>
                    </>
                  ) : (
                    <>
                      <NativeSelect
                        id="model-key"
                        value={draft.keyAlias}
                        onChange={(e) =>
                          setDraft({ ...draft, keyAlias: e.target.value })
                        }
                      >
                        <option value="">
                          不引用（仅私有/自定义上游可免）
                        </option>
                        {draft.keyAlias !== "" &&
                        !(aliasOptions ?? []).some(
                          (k) => k.keyAlias === draft.keyAlias,
                        ) ? (
                          <option value={draft.keyAlias}>
                            {draft.keyAlias}（不在清单中）
                          </option>
                        ) : null}
                        {(aliasOptions ?? []).map((k) => (
                          <option key={k.id} value={k.keyAlias}>
                            {k.keyAlias}
                            {isEnabled(k.state) ? "" : "（已停用）"}
                          </option>
                        ))}
                      </NativeSelect>
                      <FieldDescription>
                        {aliasOptions !== null && aliasOptions.length === 0
                          ? "这家还没有密钥——先到 Provider 详情页「密钥管理」里录入。"
                          : "从这家 Provider 的密钥库里选。"}
                        {!isCreate && row?.keyReference?.source === "env"
                          ? ` 原引用的 env 变量 ${row.keyReference.name} 已退役（ADR-003），运行时不再读取——请改选 vault 别名。`
                          : ""}
                      </FieldDescription>
                    </>
                  )}
                </Field>
              </div>
              <Field>
                <FieldLabel required hint="至少选一项。" {...FIELD_LABEL_A11Y}>
                  能力标签
                </FieldLabel>
                <div className="flex flex-wrap gap-sm">
                  {CAPABILITY_OPTIONS.map((c) => {
                    const active = draft.capabilities.includes(c);
                    return (
                      <Button
                        key={c}
                        type="button"
                        variant="ghost"
                        onClick={() => toggleCapability(c)}
                        className="inline-flex h-auto w-auto p-0 hover:bg-transparent"
                      >
                        <Badge variant={active ? "default" : "outline"}>
                          {c}
                        </Badge>
                      </Button>
                    );
                  })}
                </div>
              </Field>
            </FieldGroup>
          </FieldTier>

          <FieldTier
            tier="advanced"
            title={FIELD_TIER_TITLE.advanced}
            defaultOpen={draft.extraBody.trim() !== ""}
            hint="都可留空，留空＝用 Atlas 默认。"
          >
            <FieldGroup>
              <div className="grid grid-cols-2 gap-md">
                <Field>
                  <FieldLabel htmlFor="model-description">说明</FieldLabel>
                  <Textarea
                    id="model-description"
                    rows={2}
                    value={draft.description}
                    onChange={(e) =>
                      setDraft({ ...draft, description: e.target.value })
                    }
                    placeholder="这个模型适合做什么、有什么已知限制"
                  />
                </Field>
                <Field>
                  <FieldLabel
                    hint="原样并进请求体的 JSON 对象，留空＝不声明。改名已有参数用 paramMap，这里管的是新字段。"
                    {...FIELD_LABEL_A11Y}
                    htmlFor="model-extra-body"
                  >
                    厂商开关
                  </FieldLabel>
                  <Textarea
                    id="model-extra-body"
                    rows={2}
                    value={draft.extraBody}
                    onChange={(e) =>
                      setDraft({ ...draft, extraBody: e.target.value })
                    }
                    placeholder={'{"thinking":{"type":"disabled"}}'}
                    className="font-mono"
                  />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-md">
                <Field>
                  <FieldLabel
                    hint="token 数，留空＝不声明。"
                    {...FIELD_LABEL_A11Y}
                    htmlFor="model-context"
                  >
                    上下文窗口
                  </FieldLabel>
                  <Input
                    id="model-context"
                    inputMode="numeric"
                    value={draft.contextWindow}
                    onChange={(e) =>
                      setDraft({ ...draft, contextWindow: e.target.value })
                    }
                    placeholder="128000"
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="model-max-output">最大输出</FieldLabel>
                  <Input
                    id="model-max-output"
                    inputMode="numeric"
                    value={draft.maxOutputTokens}
                    onChange={(e) =>
                      setDraft({ ...draft, maxOutputTokens: e.target.value })
                    }
                    placeholder="16384"
                  />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-md">
                <Field>
                  <FieldLabel
                    hint="越小越靠前，默认 999。"
                    {...FIELD_LABEL_A11Y}
                    htmlFor="model-sort"
                  >
                    排序权重
                  </FieldLabel>
                  <Input
                    id="model-sort"
                    inputMode="numeric"
                    value={draft.sort}
                    onChange={(e) =>
                      setDraft({ ...draft, sort: e.target.value })
                    }
                    placeholder="999"
                  />
                </Field>
                <Field>
                  <FieldLabel
                    hint="声明不支持，调用方就不会走 stream 路径。"
                    {...FIELD_LABEL_A11Y}
                    htmlFor="model-streaming"
                  >
                    流式
                  </FieldLabel>
                  <NativeSelect
                    id="model-streaming"
                    value={draft.supportsStreaming ? "yes" : "no"}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        supportsStreaming: e.target.value === "yes",
                      })
                    }
                  >
                    <option value="yes">支持</option>
                    <option value="no">不支持</option>
                  </NativeSelect>
                </Field>
              </div>
            </FieldGroup>
          </FieldTier>
        </div>

        {/* ── 自检 ─────────────────────────────────────────────────────── */}
        {!isCreate ? (
          <Section icon="target" title="自检" level={2}>
            <div className="flex flex-col gap-md">
              <ProbeWarning scope="model" />
              <div>
                <Button
                  type="button"
                  variant="outline"
                  disabled={probe.kind === "running"}
                  onClick={() => void runProbe()}
                >
                  <Icon name="target" size="xs" aria-hidden="true" />
                  {probe.kind === "running" ? "自检中…" : "自检（真实调用）"}
                </Button>
              </div>
              <ProbeInspection state={probe} />
            </div>
          </Section>
        ) : null}

        {/* ── 线协议（生效值）─────────────────────────────────────────── */}
        {row ? (
          <Section icon="code" title="线协议（生效值）" level={2}>
            <WireReport
              model={row}
              provider={providers.find((p) => p.providerCode === row.provider)}
            />
          </Section>
        ) : null}

        <div className="flex flex-col gap-lg">
          <Separator />
          <div className="flex items-center justify-end gap-sm">
            {canManage ? (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={saving}
                  onClick={() =>
                    isCreate ? router.push(CATALOG) : void reload()
                  }
                >
                  {isCreate ? tShared("actions.cancel") : "放弃"}
                </Button>
                <Button type="submit" disabled={saving || !draftValid}>
                  {saving ? "保存中…" : isCreate ? "注册" : "保存"}
                </Button>
              </>
            ) : null}
          </div>
        </div>
      </form>
    </ViewLayout>
  );
}
