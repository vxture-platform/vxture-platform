"use client";

/**
 * ProviderDetailPage.tsx — 一家 Provider 的接入：新建与配置都在这一张二级页。
 * @package @vxture/opera
 * @layer Presentation
 * @category Features - Atlas
 *
 * owner 2026-10-05:「查看、添加、编辑 模型服务商 为二级页面」。
 *
 * 此前「接入 Provider」是 `/model/services` 页首的一个 xl 弹窗，密钥在行操作的抽屉里、
 * 验证接入在另一个弹窗里——八个字段加线协议加定价策略塞进一个模态框，且这家接得通不通、
 * 密钥在不在，要分别点开两个浮层才看得全。提成独立路由（`/model/services/provider/:code`
 * 与 `/model/services/provider/new`）之后，这些挨在同一张页上：填写在上、密钥与验证在下。
 *
 * 载入靠**列表端点 + 按 code 命中**（atlas 没有单取接口；Provider 是运营量级，几家到
 * 十几家，拉全量再挑一条没有代价）。地址走 `providerCode` 可读码而不是 uuid——能读、能
 * 分享、能粘进工单。
 *
 * 不跳转原则（与产品详情同）：密钥、验证都在本页就地打开，只有「保存并返回」会离开。
 */

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  ActionMenu,
  Badge,
  Banner,
  Button,
  Drawer,
  EmptyState,
  Field,
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
  useToast,
} from "@vxture/design-system";
import { FIELD_LABEL_A11Y, FIELD_TIER_TITLE } from "@/lib/form-labels";
import { useOperatorSession } from "@/features/session/SessionProvider";
import { isStepUpCancelled, useStepUp } from "@/features/stepup/StepUpProvider";
import { isEnabled } from "@/features/atlas/state";
import { api, OperaApiError } from "@/lib/api";
import {
  ProbeInspection,
  ProbeWarning,
  type ProbeState,
} from "./ProbeInspection";
import {
  buildProviderConfig,
  DEEPSEEK_OFF_PEAK_PRESET,
  describeError,
  EMPTY_PROVIDER_DRAFT,
  KEY_SCOPES,
  parseExtraBody,
  parseOffPeakPolicy,
  parseStringMap,
  PROVIDER_MANAGE,
  PROVIDER_TYPES,
  providerDraftFrom,
  type LoadState,
  type ModelProviderRecord,
  type ProviderDraft,
  type ProviderKeyRecord,
  type ProviderProbeResult,
} from "./model-service";

const CATALOG = "/model/services";

export function ProviderDetailPage({
  providerCode,
}: {
  readonly providerCode: string | null;
}) {
  const router = useRouter();
  const tShared = useTranslations();
  const { toast } = useToast();
  const { can } = useOperatorSession();
  const { runWithStepUp } = useStepUp();
  const canManage = can(PROVIDER_MANAGE);
  const isCreate = providerCode === null;
  /* 列表页「密钥管理」行操作深链到这里并直接把抽屉打开（与产品目录 `?productId=` 同一套）。 */
  const deepLinkPanel = useSearchParams().get("panel");

  const [load, setLoad] = useState<LoadState | { kind: "missing" }>({
    kind: "loading",
  });
  const [row, setRow] = useState<ModelProviderRecord | null>(null);
  const [wireSchemaVersion, setWireSchemaVersion] = useState<number | null>(
    null,
  );
  const [draft, setDraft] = useState<ProviderDraft>(EMPTY_PROVIDER_DRAFT);
  const [saving, setSaving] = useState(false);

  /* 密钥抽屉 */
  const [keysOpen, setKeysOpen] = useState(false);
  const [keys, setKeys] = useState<ProviderKeyRecord[]>([]);
  const [keysLoad, setKeysLoad] = useState<LoadState>({ kind: "ready" });
  const [keyDialog, setKeyDialog] = useState<
    { kind: "create" } | { kind: "rotate"; key: ProviderKeyRecord } | null
  >(null);
  const [keyAlias, setKeyAlias] = useState("");
  const [keyScope, setKeyScope] = useState("shared");
  const [plaintextKey, setPlaintextKey] = useState("");

  /* 验证接入 */
  const [verify, setVerify] = useState<ProbeState>({ kind: "idle" });

  const reload = useCallback(async () => {
    if (isCreate) {
      setDraft(EMPTY_PROVIDER_DRAFT);
      setRow(null);
      setLoad({ kind: "ready" });
      return;
    }
    setLoad({ kind: "loading" });
    try {
      const rows = await api.get<ModelProviderRecord[]>(
        "/api/atlas/providers?includeInactive=true",
      );
      const found = rows.find((p) => p.providerCode === providerCode) ?? null;
      if (!found) {
        setLoad({ kind: "missing" });
        return;
      }
      setRow(found);
      setDraft(providerDraftFrom(found));
      setLoad({ kind: "ready" });
    } catch (error) {
      setLoad({
        kind: "error",
        message:
          error instanceof OperaApiError ? error.message : "读取 Provider 失败",
      });
    }
  }, [isCreate, providerCode]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /* 协议词表只为 `wireSchemaVersion`——写 config.wire 时要声明它，见 buildProviderConfig。 */
  useEffect(() => {
    void api
      .get<{ wireSchemaVersion: number }>("/api/atlas/protocols")
      .then((r) => setWireSchemaVersion(r.wireSchemaVersion))
      .catch(() => setWireSchemaVersion(null));
  }, []);

  const loadKeys = useCallback(async (code: string) => {
    setKeysLoad({ kind: "loading" });
    try {
      const data = await api.get<ProviderKeyRecord[]>(
        `/api/atlas/provider-keys?providerCode=${encodeURIComponent(code)}`,
      );
      setKeys(data);
      setKeysLoad({ kind: "ready" });
    } catch (error) {
      setKeysLoad({
        kind: "error",
        message:
          error instanceof OperaApiError ? error.message : "读取密钥失败",
      });
    }
  }, []);

  function openKeys() {
    if (!row) return;
    setKeysOpen(true);
    void loadKeys(row.providerCode);
  }

  /* 深链 `?panel=keys` 到这里就直接把密钥抽屉打开，一次性——用户手动关掉后不再自动弹。 */
  const [panelHandled, setPanelHandled] = useState(false);
  useEffect(() => {
    if (deepLinkPanel === "keys" && row && !panelHandled) {
      setPanelHandled(true);
      setKeysOpen(true);
      void loadKeys(row.providerCode);
    }
  }, [deepLinkPanel, row, panelHandled, loadKeys]);

  async function submitKeyDialog(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!keyDialog || !row) return;
    setSaving(true);
    try {
      await runWithStepUp(async () => {
        if (keyDialog.kind === "create") {
          await api.post("/api/atlas/provider-keys", {
            providerCode: row.providerCode,
            keyAlias: keyAlias.trim(),
            keyScope,
            plaintextKey,
          });
        } else {
          await api.post(
            `/api/atlas/provider-keys/${keyDialog.key.id}/rotate`,
            { plaintextKey },
          );
        }
      });
      toast({
        tone: "success",
        title:
          keyDialog.kind === "create"
            ? `密钥「${keyAlias.trim()}」已入库`
            : `密钥「${keyDialog.key.keyAlias}」已轮换`,
      });
      setKeyDialog(null);
      await loadKeys(row.providerCode);
    } catch (error) {
      if (!isStepUpCancelled(error)) {
        toast({
          tone: "danger",
          title: keyDialog.kind === "create" ? "入库失败" : "轮换失败",
          ...describeError(error),
        });
      }
    } finally {
      setSaving(false);
    }
  }

  async function toggleKeyActive(key: ProviderKeyRecord) {
    if (!row) return;
    setSaving(true);
    try {
      await runWithStepUp(() =>
        api.post(
          `/api/atlas/provider-keys/${key.id}/${isEnabled(key.state) ? "deactivate" : "activate"}`,
          {},
        ),
      );
      toast({
        tone: "success",
        title: `密钥「${key.keyAlias}」已${isEnabled(key.state) ? "停用" : "启用"}`,
      });
      await loadKeys(row.providerCode);
    } catch (error) {
      if (!isStepUpCancelled(error)) {
        toast({ tone: "danger", title: "操作失败", ...describeError(error) });
      }
    } finally {
      setSaving(false);
    }
  }

  async function runVerify() {
    if (!row) return;
    setVerify({ kind: "running" });
    try {
      const result = await api.post<ProviderProbeResult>(
        `/api/atlas/providers/${row.id}/probe`,
      );
      setVerify({
        kind: "result",
        ok: result.ok,
        lead: `借模型 ${result.probedModel.modelCode} 验证；${
          result.probe.keyResolved
            ? "密钥已解析。"
            : "密钥未解析——该 Provider 当前无法真实调用。"
        }`,
        body: result.probe,
      });
    } catch (error) {
      setVerify({ kind: "error", error, context: "provider" });
    }
  }

  const draftValid =
    draft.providerCode.trim() !== "" && draft.providerName.trim() !== "";

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    /* 三个开放映射先各自解析，各类失败的说法各不相同，在填表当下最有用。 */
    const headers = parseStringMap(draft.headers, "附加请求头");
    const paramMap = parseStringMap(draft.paramMap, "参数改名");
    const extraBody = parseExtraBody(draft.extraBody);
    const badWire = [headers, paramMap, extraBody].find((r) => !r.ok);
    if (badWire && !badWire.ok) {
      toast({
        tone: "danger",
        title: "线协议没通过",
        description: badWire.reason,
      });
      return;
    }

    const offPeak = parseOffPeakPolicy(draft.offPeakPricing);
    if (!offPeak.ok) {
      toast({
        tone: "danger",
        title: "低谷定价没通过",
        description: offPeak.reason,
      });
      return;
    }

    /* `config` 出现即整体替换，由 buildProviderConfig 把既有值一并带回去。 */
    const mutable = {
      providerName: draft.providerName.trim(),
      description: draft.description.trim() || null,
      homepageUrl: draft.homepageUrl.trim() || null,
      consoleUrl: draft.consoleUrl.trim() || null,
      billingUrl: draft.billingUrl.trim() || null,
      config: buildProviderConfig(
        row?.config ?? null,
        draft,
        {
          headers: headers.ok ? headers.value : null,
          paramMap: paramMap.ok ? paramMap.value : null,
          extraBody: extraBody.ok ? extraBody.value : null,
          offPeak: offPeak.value,
        },
        wireSchemaVersion,
      ),
    };

    setSaving(true);
    try {
      if (isCreate) {
        await api.post("/api/atlas/providers", {
          providerCode: draft.providerCode.trim(),
          providerType: draft.providerType,
          ...mutable,
        });
        toast({ tone: "success", title: `${draft.providerName} 已接入` });
        /* 新建完就地落到它的配置页——接完往往紧跟着录密钥、验证接入。 */
        router.push(
          `${CATALOG}/provider/${encodeURIComponent(draft.providerCode.trim())}`,
        );
      } else {
        /* 只送可改的：providerCode / providerType 在编辑态 disabled，但 atlas 对
           这两个键「出现即拒」，带上去编辑必然失败。 */
        await api.patch(`/api/atlas/providers/${row?.id}`, mutable);
        toast({ tone: "success", title: `${draft.providerName} 已保存` });
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
      icon="plugs-connected"
      title={
        isCreate ? "接入 Provider" : (row?.providerName ?? providerCode ?? "")
      }
      description={
        isCreate
          ? "Provider＝模型的供应方（收费主体）。密钥、账单都按它归属；同一个模型由多家供应时，每家各接入一次。"
          : (row?.providerCode ?? undefined)
      }
      secondary={
        row ? (
          <StatusBadge tone={isEnabled(row.state) ? "success" : "neutral"} dot>
            {isEnabled(row.state)
              ? tShared("actions.enable")
              : tShared("actions.disable")}
          </StatusBadge>
        ) : undefined
      }
      action={
        <div className="flex items-center gap-sm">
          <Button asChild variant="outline">
            <Link href={CATALOG}>
              <Icon name="arrow-left" size="xs" aria-hidden="true" />
              返回模型服务
            </Link>
          </Button>
          {canManage ? (
            <Button
              type="button"
              variant="outline"
              disabled={!row}
              onClick={openKeys}
            >
              <Icon name="key" size="xs" aria-hidden="true" />
              密钥管理
            </Button>
          ) : null}
        </div>
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
          title={load.kind === "missing" ? "Provider 不存在" : "读取失败"}
          description={
            load.kind === "missing"
              ? `模型服务里没有 Code「${providerCode ?? ""}」。`
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
    <>
      <ViewLayout>
        {header}
        <form onSubmit={save} className="flex min-w-0 flex-col gap-2xl">
          <div className="density-compact flex flex-col gap-md">
            <FieldTier
              tier="identity"
              title={FIELD_TIER_TITLE.identity}
              hint="决定这是哪一家。Code 与类型创建后不可改。"
            >
              <div className="grid grid-cols-3 gap-md">
                <Field>
                  <FieldLabel
                    required
                    hint="全局唯一，模型与密钥都按它归属。"
                    {...FIELD_LABEL_A11Y}
                    htmlFor="provider-code"
                  >
                    Code
                  </FieldLabel>
                  <Input
                    id="provider-code"
                    value={draft.providerCode}
                    onChange={(e) =>
                      setDraft({ ...draft, providerCode: e.target.value })
                    }
                    placeholder="openai"
                    disabled={!isCreate}
                  />
                </Field>
                <Field>
                  <FieldLabel
                    required
                    hint="列表与选择器里显示的名字，可改。"
                    {...FIELD_LABEL_A11Y}
                    htmlFor="provider-name"
                  >
                    名称
                  </FieldLabel>
                  <Input
                    id="provider-name"
                    value={draft.providerName}
                    onChange={(e) =>
                      setDraft({ ...draft, providerName: e.target.value })
                    }
                    placeholder="OpenAI"
                  />
                </Field>
                <Field>
                  <FieldLabel
                    hint="创建后不可改。"
                    {...FIELD_LABEL_A11Y}
                    htmlFor="provider-type"
                  >
                    {tShared("columns.kind")}
                  </FieldLabel>
                  <NativeSelect
                    id="provider-type"
                    value={draft.providerType}
                    onChange={(e) =>
                      setDraft({ ...draft, providerType: e.target.value })
                    }
                    disabled={!isCreate}
                  >
                    {PROVIDER_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
              </div>
            </FieldTier>

            <FieldTier
              tier="details"
              title={FIELD_TIER_TITLE.details}
              hint="填了地址，行操作里就有对方控制台与账单的直达入口。"
            >
              <Field>
                <FieldLabel htmlFor="provider-description">简介</FieldLabel>
                <Textarea
                  id="provider-description"
                  value={draft.description}
                  onChange={(e) =>
                    setDraft({ ...draft, description: e.target.value })
                  }
                  rows={2}
                />
              </Field>
              <div className="grid grid-cols-2 gap-md">
                <Field>
                  <FieldLabel
                    hint="密钥轮换、配额调整在这里做。"
                    {...FIELD_LABEL_A11Y}
                    htmlFor="provider-console"
                  >
                    控制台 URL
                  </FieldLabel>
                  <Input
                    id="provider-console"
                    value={draft.consoleUrl}
                    onChange={(e) =>
                      setDraft({ ...draft, consoleUrl: e.target.value })
                    }
                  />
                </Field>
                <Field>
                  <FieldLabel
                    hint="实际花费以对方账单为准（Atlas 计量不计费）。"
                    {...FIELD_LABEL_A11Y}
                    htmlFor="provider-billing"
                  >
                    账单 URL
                  </FieldLabel>
                  <Input
                    id="provider-billing"
                    value={draft.billingUrl}
                    onChange={(e) =>
                      setDraft({ ...draft, billingUrl: e.target.value })
                    }
                  />
                </Field>
              </div>
            </FieldTier>

            <FieldTier
              tier="advanced"
              title="线协议（config.wire）"
              defaultOpen={
                draft.chatPath.trim() !== "" ||
                draft.authStyle !== "" ||
                draft.streamUsage !== "" ||
                draft.supportsTools !== "" ||
                draft.supportsToolChoice !== "" ||
                draft.supportsTopP !== "" ||
                draft.supportsTemperature !== "" ||
                draft.headers.trim() !== "" ||
                draft.paramMap.trim() !== "" ||
                draft.extraBody.trim() !== ""
              }
              hint="留空＝跟随协议默认。整家生效，单个模型可以再覆盖。"
            >
              <div className="grid grid-cols-3 gap-md">
                <Field>
                  <FieldLabel
                    hint="接在接入地址后面的那一段。"
                    {...FIELD_LABEL_A11Y}
                    htmlFor="provider-chat-path"
                  >
                    端点后缀
                  </FieldLabel>
                  <Input
                    id="provider-chat-path"
                    value={draft.chatPath}
                    onChange={(e) =>
                      setDraft({ ...draft, chatPath: e.target.value })
                    }
                    placeholder="/chat/completions"
                    className="font-mono"
                  />
                </Field>
                <Field>
                  <FieldLabel
                    hint="密钥放在哪个头里送。"
                    {...FIELD_LABEL_A11Y}
                    htmlFor="provider-auth-style"
                  >
                    鉴权样式
                  </FieldLabel>
                  <NativeSelect
                    id="provider-auth-style"
                    value={draft.authStyle}
                    onChange={(e) =>
                      setDraft({ ...draft, authStyle: e.target.value })
                    }
                  >
                    <option value="">跟随协议默认</option>
                    <option value="bearer">bearer（Authorization）</option>
                    <option value="x-api-key">x-api-key</option>
                    <option value="none">none（不带凭据）</option>
                  </NativeSelect>
                </Field>
                <Field>
                  <FieldLabel
                    hint="选 none＝这家流式不回 usage，那些调用不会被计量。"
                    {...FIELD_LABEL_A11Y}
                    htmlFor="provider-stream-usage"
                  >
                    流式 usage
                  </FieldLabel>
                  <NativeSelect
                    id="provider-stream-usage"
                    value={draft.streamUsage}
                    onChange={(e) =>
                      setDraft({ ...draft, streamUsage: e.target.value })
                    }
                  >
                    <option value="">跟随协议默认</option>
                    <option value="stream_options">
                      stream_options（要显式要）
                    </option>
                    <option value="native">native（上游自己带）</option>
                    <option value="none">none（流里不回）</option>
                  </NativeSelect>
                </Field>
              </div>
              <div className="grid grid-cols-4 gap-md">
                {(
                  [
                    ["provider-supports-tools", "工具调用", "supportsTools"],
                    [
                      "provider-supports-tool-choice",
                      "指定工具",
                      "supportsToolChoice",
                    ],
                    ["provider-supports-top-p", "top_p", "supportsTopP"],
                    [
                      "provider-supports-temperature",
                      "temperature",
                      "supportsTemperature",
                    ],
                  ] as const
                ).map(([id, label, key]) => (
                  <Field key={key}>
                    <FieldLabel htmlFor={id}>{label}</FieldLabel>
                    <NativeSelect
                      id={id}
                      value={draft[key]}
                      onChange={(e) =>
                        setDraft({ ...draft, [key]: e.target.value })
                      }
                    >
                      <option value="">跟随默认</option>
                      <option value="true">支持</option>
                      <option value="false">不支持</option>
                    </NativeSelect>
                  </Field>
                ))}
              </div>
              <div className="grid grid-cols-3 gap-md">
                <Field>
                  <FieldLabel
                    hint="JSON 对象，值必须是字符串。"
                    {...FIELD_LABEL_A11Y}
                    htmlFor="provider-headers"
                  >
                    附加请求头
                  </FieldLabel>
                  <Textarea
                    id="provider-headers"
                    rows={2}
                    value={draft.headers}
                    onChange={(e) =>
                      setDraft({ ...draft, headers: e.target.value })
                    }
                    placeholder={'{"anthropic-version":"2023-06-01"}'}
                    className="font-mono"
                  />
                </Field>
                <Field>
                  <FieldLabel
                    hint="只能给已有参数换名字，塞不进新字段。"
                    {...FIELD_LABEL_A11Y}
                    htmlFor="provider-param-map"
                  >
                    参数改名
                  </FieldLabel>
                  <Textarea
                    id="provider-param-map"
                    rows={2}
                    value={draft.paramMap}
                    onChange={(e) =>
                      setDraft({ ...draft, paramMap: e.target.value })
                    }
                    placeholder={'{"maxTokens":"max_completion_tokens"}'}
                    className="font-mono"
                  />
                </Field>
                <Field>
                  <FieldLabel
                    hint="整家默认的新字段。单个模型的开关在模型表单里配。"
                    {...FIELD_LABEL_A11Y}
                    htmlFor="provider-extra-body"
                  >
                    厂商开关
                  </FieldLabel>
                  <Textarea
                    id="provider-extra-body"
                    rows={2}
                    value={draft.extraBody}
                    onChange={(e) =>
                      setDraft({ ...draft, extraBody: e.target.value })
                    }
                    placeholder={'{"user_id":"vxture"}'}
                    className="font-mono"
                  />
                </Field>
              </div>
            </FieldTier>

            <FieldTier
              tier="advanced"
              title="低谷定价（config.pricing.offPeak）"
              defaultOpen={draft.offPeakPricing.trim() !== ""}
              hint="留空＝不打折，全周期按峰价估。声明的是高峰窗口，低谷是补集。"
            >
              <Field>
                <FieldLabel
                  hint={
                    "JSON 对象。`timezone` 只能是 UTC（分桶在 UTC 做）；`multiplier` 是十进制字符串、最多 8 位小数（金额不走 float）；`appliesTo` 与 `peakWindows` 都不能为空——空不当成「全部」，也不当成「没有高峰」。`fromHour`/`toHour` 左闭右开。"
                  }
                  {...FIELD_LABEL_A11Y}
                  htmlFor="provider-off-peak"
                >
                  低谷定价策略
                </FieldLabel>
                <Textarea
                  id="provider-off-peak"
                  rows={8}
                  value={draft.offPeakPricing}
                  onChange={(e) =>
                    setDraft({ ...draft, offPeakPricing: e.target.value })
                  }
                  placeholder={DEEPSEEK_OFF_PEAK_PRESET}
                  className="font-mono"
                />
                <div>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      setDraft({
                        ...draft,
                        offPeakPricing: DEEPSEEK_OFF_PEAK_PRESET,
                      })
                    }
                  >
                    填入 DeepSeek 现行策略
                  </Button>
                </div>
              </Field>
            </FieldTier>

            <FieldTier
              tier="advanced"
              title={FIELD_TIER_TITLE.advanced}
              hint="填不填都不影响接入。"
            >
              <div className="grid grid-cols-2 gap-md">
                <Field>
                  <FieldLabel
                    hint="纯登记。"
                    {...FIELD_LABEL_A11Y}
                    htmlFor="provider-homepage"
                  >
                    主页 URL
                  </FieldLabel>
                  <Input
                    id="provider-homepage"
                    value={draft.homepageUrl}
                    onChange={(e) =>
                      setDraft({ ...draft, homepageUrl: e.target.value })
                    }
                  />
                </Field>
              </div>
            </FieldTier>
          </div>

          {/* ── 验证接入 ─────────────────────────────────────────────────── */}
          {!isCreate ? (
            <Section icon="target" title="验证接入" level={2}>
              <div className="flex flex-col gap-md">
                <ProbeWarning scope="provider" />
                <div>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={verify.kind === "running"}
                    onClick={() => void runVerify()}
                  >
                    <Icon name="target" size="xs" aria-hidden="true" />
                    {verify.kind === "running"
                      ? "验证中…"
                      : "验证接入（真实调用）"}
                  </Button>
                </div>
                <ProbeInspection state={verify} />
              </div>
            </Section>
          ) : null}

          <div className="flex flex-col gap-lg">
            <Separator />
            <div className="flex flex-wrap items-center justify-between gap-md">
              <div className="flex items-center gap-sm">
                {canManage ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!row}
                    onClick={openKeys}
                  >
                    <Icon name="key" size="xs" aria-hidden="true" />
                    密钥管理
                  </Button>
                ) : null}
                {!row ? (
                  <span className="text-body-sm text-muted-foreground">
                    密钥与验证接入保存后可用
                  </span>
                ) : null}
              </div>
              {canManage ? (
                <div className="flex items-center gap-sm">
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
                    {saving ? "保存中…" : isCreate ? "接入" : "保存"}
                  </Button>
                </div>
              ) : null}
            </div>
          </div>
        </form>
      </ViewLayout>

      {/* ── 密钥抽屉 ─────────────────────────────────────────────────────── */}
      <Drawer
        open={keysOpen}
        onClose={() => {
          setKeysOpen(false);
          setKeys([]);
          setKeysLoad({ kind: "ready" });
        }}
        width="lg"
        title="密钥管理"
        description={
          row ? `${row.providerName}（${row.providerCode}）` : undefined
        }
      >
        {row ? (
          <div className="flex flex-col gap-lg">
            <Banner
              tone="info"
              title="零明文持有"
              description="密钥只在这里录入一次，之后任何读接口都不会回显——包括这个页面自己。忘记了只能轮换，不能查看。"
            />
            {keysLoad.kind === "loading" ? (
              <EmptyState
                title={tShared("common.loading")}
                description="正在读取密钥清单。"
              />
            ) : keysLoad.kind === "error" ? (
              <EmptyState
                title={tShared("common.loadFailed")}
                description={keysLoad.message}
                action={
                  <Button
                    variant="secondary"
                    onClick={() => void loadKeys(row.providerCode)}
                  >
                    {tShared("common.retry")}
                  </Button>
                }
              />
            ) : (
              <div className="flex flex-col gap-sm">
                {keys.length === 0 ? (
                  <p className="text-body-sm text-muted-foreground">
                    暂无密钥。
                  </p>
                ) : (
                  keys.map((k) => (
                    <div
                      key={k.id}
                      className="flex items-center justify-between gap-sm rounded-md border border-border p-sm"
                    >
                      <div className="flex flex-col gap-2xs">
                        <div className="flex items-center gap-sm">
                          <span className="font-mono text-code-sm">
                            {k.keyAlias}
                          </span>
                          <Badge variant="outline">
                            {KEY_SCOPES.find((s) => s.value === k.keyScope)
                              ?.label ?? k.keyScope}
                          </Badge>
                          <StatusBadge
                            tone={isEnabled(k.state) ? "success" : "neutral"}
                            dot
                          >
                            {isEnabled(k.state)
                              ? tShared("actions.enable")
                              : tShared("actions.disable")}
                          </StatusBadge>
                        </div>
                        <span className="text-body-sm text-muted-foreground">
                          最近轮换：{k.lastRotatedAt ?? tShared("common.never")}
                        </span>
                      </div>
                      {canManage ? (
                        <ActionMenu
                          label={`${k.keyAlias} 操作`}
                          disabled={saving}
                          items={[
                            {
                              id: "rotate",
                              label: "轮换",
                              icon: "refresh",
                              onSelect: () => {
                                setPlaintextKey("");
                                setKeyDialog({ kind: "rotate", key: k });
                              },
                            },
                            {
                              id: "toggle",
                              label: isEnabled(k.state)
                                ? tShared("actions.disable")
                                : tShared("actions.enable"),
                              icon: isEnabled(k.state) ? "pause" : "play",
                              onSelect: () => void toggleKeyActive(k),
                            },
                          ]}
                        />
                      ) : null}
                    </div>
                  ))
                )}
                {canManage ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="self-start"
                    onClick={() => {
                      setKeyAlias("");
                      setKeyScope("shared");
                      setPlaintextKey("");
                      setKeyDialog({ kind: "create" });
                    }}
                  >
                    <Icon name="plus" size="sm" aria-hidden="true" />
                    录入密钥
                  </Button>
                ) : null}
              </div>
            )}
          </div>
        ) : null}
      </Drawer>

      {keyDialog ? (
        <Drawer
          open={keyDialog !== null}
          onClose={() => setKeyDialog(null)}
          width="lg"
          title={
            keyDialog.kind === "rotate"
              ? `轮换「${keyDialog.key.keyAlias}」`
              : "录入密钥"
          }
          description={
            keyDialog.kind === "rotate"
              ? "新值会替换旧密文，旧值不保留、不可找回。"
              : undefined
          }
        >
          <form onSubmit={submitKeyDialog} className="flex flex-col gap-lg">
            <FieldGroup columns={keyDialog.kind === "create" ? 2 : 1}>
              {keyDialog.kind === "create" ? (
                <>
                  <Field>
                    <FieldLabel
                      required
                      hint="同一 Provider 下唯一；模型注册时按 Provider + Alias 引用。"
                      {...FIELD_LABEL_A11Y}
                      htmlFor="key-alias"
                    >
                      Alias
                    </FieldLabel>
                    <Input
                      id="key-alias"
                      value={keyAlias}
                      onChange={(e) => setKeyAlias(e.target.value)}
                      placeholder="default"
                      className="font-mono"
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="key-scope">范围</FieldLabel>
                    <NativeSelect
                      id="key-scope"
                      value={keyScope}
                      onChange={(e) => setKeyScope(e.target.value)}
                    >
                      {KEY_SCOPES.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                </>
              ) : null}
              <Field span="full">
                <FieldLabel
                  required
                  hint="提交后立即加密入库，这个页面不会再显示它——包括你自己刷新之后。"
                  {...FIELD_LABEL_A11Y}
                  htmlFor="key-plaintext"
                >
                  密钥明文
                </FieldLabel>
                <Input
                  id="key-plaintext"
                  type="password"
                  value={plaintextKey}
                  onChange={(e) => setPlaintextKey(e.target.value)}
                  placeholder="sk-…"
                  autoComplete="off"
                  className="font-mono"
                />
              </Field>
            </FieldGroup>
            <div className="flex items-center justify-end gap-sm">
              <Button
                type="button"
                variant="ghost"
                disabled={saving}
                onClick={() => setKeyDialog(null)}
              >
                {tShared("actions.cancel")}
              </Button>
              <Button
                type="submit"
                disabled={
                  saving ||
                  (keyDialog.kind === "create"
                    ? keyAlias.trim() === "" || plaintextKey.trim() === ""
                    : plaintextKey.trim() === "")
                }
              >
                {keyDialog.kind === "rotate" ? "轮换" : "入库"}
              </Button>
            </div>
          </form>
        </Drawer>
      ) : null}
    </>
  );
}
