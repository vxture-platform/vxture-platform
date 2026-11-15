"use client";
/**
 * Organization portal draft editor and immutable review history.
 * @package @vxture/admin
 * @layer Presentation
 * @category module
 * @author AI-Generated
 * @date 2026-11-15
 */
import { useEffect, useState } from "react";
import Image from "next/image";
import { useLocale } from "next-intl";
import {
  Banner,
  Button,
  Card,
  CardContent,
  CardHeader,
  Field,
  FieldLabel,
  Input,
  NativeSelect,
  Switch,
  Textarea,
} from "@vxture/design-system";
import {
  AdminBffError,
  customerPortalRequest,
  uploadCustomerPortalAsset,
  customerPortalAssetUrl,
} from "@/api/admin-bff";
import type {
  PortalConfiguration,
  PortalRecord,
  PortalVersion,
} from "@/api/customer-portal.types";
import { useStepUp, isStepUpCancelled } from "@/providers/StepUpProvider";
import { useAdminSession } from "@/features/session/AdminSessionProvider";

interface Workspace {
  id: string;
  name: string;
  status: string;
  isDefault: boolean;
}

type HostnameStatus = "available" | "occupied" | "invalid" | "failed";

// ============================================================================
// Drafts are shared; a submitted version is an immutable review snapshot.
// ============================================================================
export function CustomerPortalPanel({
  tenantId,
  workspaces = [],
}: {
  tenantId: string;
  workspaces?: Workspace[];
}) {
  const locale = useLocale();
  const label = (zh: string, en: string) => (locale.startsWith("zh") ? zh : en);
  const { runWithStepUp } = useStepUp();
  const { session } = useAdminSession();
  const canWrite = session.capabilities.includes("tenant:profile.manage");
  const [record, setRecord] = useState<PortalRecord | null>(null);
  const [draft, setDraft] = useState<PortalConfiguration | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [prefix, setPrefix] = useState("");
  const [workspaceId, setWorkspaceId] = useState(
    workspaces.find((w) => w.isDefault)?.id ?? workspaces[0]?.id ?? "",
  );
  const [selfService, setSelfService] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [note, setNote] = useState("");
  const [appCode, setAppCode] = useState("");
  const [checkAttempt, setCheckAttempt] = useState(0);
  const [hostnameCheck, setHostnameCheck] = useState<{
    tenantId: string;
    prefix: string;
    attempt: number;
    status: HostnameStatus;
    message?: string;
  } | null>(null);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setLoadFailed(false);
    setError("");
    setRecord(null);
    setDraft(null);
    async function load() {
      const { portal: result } = await customerPortalRequest<{
        portal: PortalRecord | null;
      }>(tenantId);
      if (!live) return;
      setRecord(result);
      setDraft(result?.draft ?? null);
      if (result) {
        setPrefix(result.hostname.replace(/\.ruyin\.work$/, ""));
        setWorkspaceId(result.workspaceId);
        setSelfService(result.selfService);
        setEnabled(result.enabled);
      }
    }
    void load()
      .catch((e) => {
        if (live) {
          setLoadFailed(true);
          setError(e instanceof Error ? e.message : "Portal request failed");
        }
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [tenantId, reload]);

  useEffect(() => {
    if (loading || loadFailed || !canWrite || record || !prefix) return;
    let live = true;
    const timer = window.setTimeout(() => {
      const query = new URLSearchParams({ prefix });
      const report = (status: HostnameStatus, message?: string) => {
        if (live)
          setHostnameCheck({
            tenantId,
            prefix,
            attempt: checkAttempt,
            status,
            ...(message ? { message } : {}),
          });
      };
      void customerPortalRequest<{
        status: Exclude<HostnameStatus, "failed">;
        message?: string;
      }>(tenantId, `/hostname-availability?${query.toString()}`).then(
        ({ status, message }) => report(status, message),
        () => report("failed"),
      );
    }, 300);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [canWrite, checkAttempt, loadFailed, loading, prefix, record, tenantId]);

  const hostnameStatus =
    hostnameCheck?.tenantId === tenantId &&
    hostnameCheck.prefix === prefix &&
    hostnameCheck.attempt === checkAttempt
      ? hostnameCheck.status
      : "checking";
  const hostnameHint = {
    checking: label("正在检查域名…", "Checking hostname…"),
    available: label("域名可绑定", "Hostname available"),
    occupied: label(
      "该域名已被占用，请更换",
      "This hostname is already in use",
    ),
    invalid: label(
      "须为 3–8 位小写字母或数字、字母开头，且不可使用平台保留名；a 为机构专属预留",
      "Use 3–8 lowercase letters or digits, starting with a letter; reserved names are blocked. a is institution-reserved.",
    ),
    failed: label("暂时无法检查域名", "Could not check the hostname"),
  }[hostnameStatus];
  const dirty = Boolean(
    record && draft && JSON.stringify(record.draft) !== JSON.stringify(draft),
  );
  const pending = record?.versions.some((v) => v.status === "pending");
  function change(patch: Partial<PortalConfiguration>) {
    setDraft((current) => (current ? { ...current, ...patch } : null));
    setMessage("");
  }
  async function act(action: () => Promise<PortalRecord | null>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await runWithStepUp(action);
      setRecord(result);
      setDraft(result?.draft ?? null);
      setMessage(label("操作已完成", "Changes applied"));
    } catch (e) {
      if (!record && e instanceof AdminBffError && e.status === 409)
        setCheckAttempt((current) => current + 1);
      if (!isStepUpCancelled(e))
        setError(e instanceof Error ? e.message : "Portal request failed");
    } finally {
      setBusy(false);
    }
  }
  async function upload(key: "logo" | "favicon" | "background", file?: File) {
    if (!file) return;
    if (
      !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
      file.size > 2 * 1024 * 1024
    ) {
      setError(
        label(
          "请选择不超过 2 MB 的 PNG、JPEG 或 WebP 图片",
          "Select PNG, JPEG or WebP up to 2 MB",
        ),
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      const asset = await uploadCustomerPortalAsset(tenantId, file);
      change({ [key]: asset.hash });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }
  function transition(
    version: PortalVersion,
    action: "withdraw" | "reject" | "approve" | "publish",
  ) {
    void act(() =>
      customerPortalRequest<PortalRecord>(
        tenantId,
        `/versions/${version.id}/actions`,
        "POST",
        { action, note },
      ),
    );
  }
  const status = (value: PortalVersion["status"]) =>
    ({
      pending: label("待审核", "Pending review"),
      rejected: label("已驳回", "Rejected"),
      approved: label("审核通过", "Approved"),
      withdrawn: label("已撤回", "Withdrawn"),
    })[value];

  return (
    <Card>
      <CardHeader>
        <h2 className="text-heading-sm">
          {label("客户专属门户", "Customer portal")}
        </h2>
        <p className="text-body-sm text-muted-foreground">
          {label(
            "品牌配置由机构维护，审核和发布由平台完成。",
            "Manage your branding here. The platform reviews and publishes every version.",
          )}
        </p>
      </CardHeader>
      <CardContent className="grid gap-lg">
        {error && <Banner tone="danger" title={error} />}
        {message && <Banner tone="success" title={message} />}
        {loading ? (
          <p>{label("正在载入…", "Loading…")}</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-sm">
              <Button
                variant="outline"
                size="sm"
                disabled={busy || dirty}
                onClick={() => setReload((n) => n + 1)}
              >
                {label("刷新配置", "Refresh")}
              </Button>
              {dirty && (
                <span className="text-body-sm text-muted-foreground">
                  {label(
                    "有未保存修改；保存后再提交审核",
                    "Save your changes before submitting",
                  )}
                </span>
              )}
              {record?.publishedVersionId && (
                <a
                  href={`https://${record.hostname}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-body-sm underline"
                >
                  {label("打开已发布门户", "Open published portal")}
                </a>
              )}
            </div>
            {
              <fieldset
                className="grid gap-md rounded-md border p-lg"
                disabled={!canWrite || busy}
              >
                <legend>
                  {label("域名绑定与组织授权", "Domain binding and delegation")}
                </legend>
                <Field>
                  <FieldLabel htmlFor={`portal-prefix-${tenantId}`}>
                    {label("门户域名", "Portal hostname")}
                  </FieldLabel>
                  <div className="flex items-center gap-sm">
                    <Input
                      id={`portal-prefix-${tenantId}`}
                      value={prefix}
                      maxLength={8}
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      placeholder="robot01"
                      disabled={Boolean(record)}
                      aria-describedby={
                        !record && prefix && canWrite && !loadFailed
                          ? `portal-host-status-${tenantId}`
                          : undefined
                      }
                      aria-invalid={
                        !record &&
                        prefix !== "" &&
                        (hostnameStatus === "invalid" ||
                          hostnameStatus === "occupied")
                      }
                      onChange={(e) => {
                        setPrefix(e.target.value);
                        setCheckAttempt((current) => current + 1);
                        if (!loadFailed) setError("");
                      }}
                    />
                    <span>.ruyin.work</span>
                  </div>
                  {!record && prefix && canWrite && !loadFailed && (
                    <div className="flex flex-wrap items-center gap-sm">
                      <p
                        id={`portal-host-status-${tenantId}`}
                        role="status"
                        className="text-body-sm text-muted-foreground"
                      >
                        {hostnameStatus === "invalid" && locale.startsWith("zh")
                          ? (hostnameCheck?.message ?? hostnameHint)
                          : hostnameHint}
                      </p>
                      {hostnameStatus === "failed" && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            setCheckAttempt((current) => current + 1)
                          }
                        >
                          {label("重新检查", "Check again")}
                        </Button>
                      )}
                    </div>
                  )}
                </Field>
                <Field>
                  <FieldLabel htmlFor={`portal-workspace-${tenantId}`}>
                    {label("默认工作空间", "Default workspace")}
                  </FieldLabel>
                  <NativeSelect
                    id={`portal-workspace-${tenantId}`}
                    value={workspaceId}
                    disabled={Boolean(record)}
                    onChange={(e) => setWorkspaceId(e.target.value)}
                  >
                    <option value="">
                      {label("选择工作空间", "Select workspace")}
                    </option>
                    {workspaces
                      .filter((w) => w.status === "active")
                      .map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name}
                        </option>
                      ))}
                  </NativeSelect>
                </Field>
                <label className="flex items-center gap-sm">
                  <Switch
                    checked={selfService}
                    onCheckedChange={setSelfService}
                  />
                  {label(
                    "授权客户在 Console 配置门户",
                    "Allow customer configuration in Console",
                  )}
                </label>
                <label className="flex items-center gap-sm">
                  <Switch checked={enabled} onCheckedChange={setEnabled} />
                  {label("启用门户访问", "Enable portal access")}
                </label>
                <p className="text-body-sm text-muted-foreground">
                  {label(
                    "前缀须为 3–8 位小写字母或数字，以字母开头。禁止空格、连字符和平台保留名；a 为平台专属预留。开通后绑定不可更换。",
                    "Use 3–8 lowercase letters or digits, starting with a letter. Spaces, hyphens and reserved names are blocked; a is platform-reserved. Binding cannot be changed after provisioning.",
                  )}
                </p>
                <Button
                  disabled={
                    busy ||
                    dirty ||
                    !prefix ||
                    !workspaceId ||
                    (!record && (loadFailed || hostnameStatus !== "available"))
                  }
                  onClick={() =>
                    void act(() =>
                      customerPortalRequest<PortalRecord>(
                        tenantId,
                        "/binding",
                        "PUT",
                        { prefix, workspaceId, selfService, enabled },
                      ),
                    )
                  }
                >
                  {record
                    ? label(
                        "更新授权与开通状态",
                        "Update delegation and access",
                      )
                    : label("开通并绑定", "Provision portal")}
                </Button>
              </fieldset>
            }
            {record && draft && (
              <>
                <p className="text-body-sm text-muted-foreground">
                  {record.hostname} · {label("草稿修订", "Draft revision")}{" "}
                  {record.revision} · {label("最近修改", "Last edited")}:{" "}
                  {record.updatedSurface === "admin" ? "Admin" : "Console"} ·{" "}
                  {new Date(record.updatedAt).toLocaleString(locale)}
                </p>
                <fieldset disabled={busy || !canWrite} className="grid gap-lg">
                  <div className="grid gap-md md:grid-cols-2">
                    <Field>
                      <FieldLabel htmlFor="portal-name">
                        {label("机构展示名称", "Institution name")}
                      </FieldLabel>
                      <Input
                        id="portal-name"
                        value={draft.name}
                        maxLength={96}
                        onChange={(e) => change({ name: e.target.value })}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="portal-color">
                        {label("品牌主色", "Brand color")}
                      </FieldLabel>
                      <Input
                        id="portal-color"
                        type="color"
                        value={draft.brandColor}
                        onChange={(e) => change({ brandColor: e.target.value })}
                      />
                    </Field>
                  </div>
                  <Field>
                    <FieldLabel htmlFor="portal-title">
                      {label("登录页标题", "Login headline")}
                    </FieldLabel>
                    <Textarea
                      id="portal-title"
                      value={draft.title}
                      maxLength={100}
                      onChange={(e) => change({ title: e.target.value })}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="portal-subtitle">
                      {label("登录页说明", "Login description")}
                    </FieldLabel>
                    <Textarea
                      id="portal-subtitle"
                      value={draft.subtitle}
                      maxLength={240}
                      onChange={(e) => change({ subtitle: e.target.value })}
                    />
                  </Field>
                  <div className="grid gap-md md:grid-cols-2">
                    <Field>
                      <FieldLabel htmlFor="portal-density">
                        {label("工作台密度", "Workspace density")}
                      </FieldLabel>
                      <NativeSelect
                        id="portal-density"
                        value={draft.density}
                        onChange={(e) =>
                          change({
                            density: e.target
                              .value as PortalConfiguration["density"],
                          })
                        }
                      >
                        <option value="comfortable">
                          {label("舒适", "Comfortable")}
                        </option>
                        <option value="compact">
                          {label("紧凑", "Compact")}
                        </option>
                      </NativeSelect>
                    </Field>
                  </div>
                  <div className="grid gap-md md:grid-cols-3">
                    {(
                      [
                        ["logo", label("机构标志", "Institution logo")],
                        ["favicon", label("浏览器图标", "Browser icon")],
                        ["background", label("登录页背景", "Login background")],
                      ] as const
                    ).map(([key, title]) => (
                      <Field key={key}>
                        <FieldLabel htmlFor={`portal-${key}`}>
                          {title}
                        </FieldLabel>
                        {draft[key] && (
                          <Image
                            unoptimized
                            src={customerPortalAssetUrl(tenantId, draft[key])}
                            alt={title}
                            width={160}
                            height={90}
                            className="h-24 w-full rounded border object-contain"
                          />
                        )}
                        <Input
                          id={`portal-${key}`}
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          onChange={(e) => {
                            void upload(key, e.target.files?.[0]);
                            e.target.value = "";
                          }}
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={!draft[key]}
                          onClick={() => change({ [key]: null })}
                        >
                          {label("恢复默认", "Use default")}
                        </Button>
                      </Field>
                    ))}
                  </div>
                  <p className="text-body-sm text-muted-foreground">
                    {label(
                      "图片不超过 2 MB。请确保名称、标志及图片拥有使用权；发布后登录页公开可见。",
                      "Images up to 2 MB. Use names and assets you have rights to. Published login pages are public.",
                    )}
                  </p>
                  <section className="grid gap-sm">
                    <h3>
                      {label(
                        "应用分组与显示",
                        "Application groups and visibility",
                      )}
                    </h3>
                    <p className="text-body-sm text-muted-foreground">
                      {label(
                        "仅调整已订阅应用的展示，不新增应用权限。",
                        "Presentation overrides apply only to subscribed applications.",
                      )}
                    </p>
                    {draft.applications.map((app, i) => (
                      <div
                        key={app.code}
                        className="flex flex-wrap items-center gap-sm"
                      >
                        <span className="text-body-sm">{app.code}</span>
                        <Input
                          aria-label={label("分组", "Group")}
                          value={app.group}
                          maxLength={40}
                          onChange={(e) =>
                            change({
                              applications: draft.applications.map((a, j) =>
                                j === i ? { ...a, group: e.target.value } : a,
                              ),
                            })
                          }
                        />
                        <label className="flex items-center gap-sm">
                          <Switch
                            checked={app.hidden}
                            onCheckedChange={(hidden) =>
                              change({
                                applications: draft.applications.map((a, j) =>
                                  j === i ? { ...a, hidden } : a,
                                ),
                              })
                            }
                          />
                          {label("隐藏", "Hidden")}
                        </label>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            change({
                              applications: draft.applications.filter(
                                (_, j) => j !== i,
                              ),
                            })
                          }
                        >
                          {label("恢复默认", "Use default")}
                        </Button>
                      </div>
                    ))}
                    <div className="flex gap-sm">
                      <Input
                        aria-label={label("应用代码", "Application code")}
                        value={appCode}
                        maxLength={64}
                        onChange={(e) => setAppCode(e.target.value)}
                        placeholder={label("应用代码", "Application code")}
                      />
                      <Button
                        variant="outline"
                        disabled={
                          !/^[a-z][a-z0-9-]*$/.test(appCode) ||
                          draft.applications.some((a) => a.code === appCode) ||
                          draft.applications.length >= 100
                        }
                        onClick={() => {
                          change({
                            applications: [
                              ...draft.applications,
                              { code: appCode, group: "", hidden: false },
                            ],
                          });
                          setAppCode("");
                        }}
                      >
                        {label("添加展示规则", "Add display rule")}
                      </Button>
                    </div>
                  </section>
                  <div className="flex gap-sm">
                    <Button
                      disabled={!dirty}
                      onClick={() =>
                        void act(() =>
                          customerPortalRequest<PortalRecord>(
                            tenantId,
                            "/draft",
                            "PUT",
                            { revision: record.revision, configuration: draft },
                          ),
                        )
                      }
                    >
                      {label("保存草稿", "Save draft")}
                    </Button>
                    <Button
                      variant="outline"
                      disabled={!dirty}
                      onClick={() => setDraft(record.draft)}
                    >
                      {label("放弃修改", "Discard changes")}
                    </Button>
                  </div>
                  <Field>
                    <FieldLabel htmlFor="portal-note">
                      {label(
                        "提交说明 / 驳回原因",
                        "Submission note / rejection reason",
                      )}
                    </FieldLabel>
                    <Textarea
                      id="portal-note"
                      value={note}
                      maxLength={1000}
                      onChange={(e) => setNote(e.target.value)}
                    />
                  </Field>
                  <Button
                    disabled={dirty || pending || !note.trim()}
                    onClick={() =>
                      void act(() =>
                        customerPortalRequest<PortalRecord>(
                          tenantId,
                          "/submissions",
                          "POST",
                          { revision: record.revision, note },
                        ),
                      )
                    }
                  >
                    {label("提交平台审核", "Submit for platform review")}
                  </Button>
                </fieldset>
                <section className="grid gap-md">
                  <h3>
                    {label("版本与审核记录", "Versions and review history")}
                  </h3>
                  {record.versions.length === 0 && (
                    <p className="text-body-sm text-muted-foreground">
                      {label("尚未提交版本", "No submissions yet")}
                    </p>
                  )}
                  {record.versions.map((version) => (
                    <div
                      className="grid gap-sm rounded-md border p-md"
                      key={version.id}
                    >
                      <div className="flex flex-wrap gap-sm">
                        <strong>V{version.version}</strong>
                        <span>{status(version.status)}</span>
                        {record.publishedVersionId === version.id && (
                          <strong>
                            {label("当前线上版本", "Currently published")}
                          </strong>
                        )}
                      </div>
                      <p className="text-body-sm">
                        {new Date(version.submittedAt).toLocaleString(locale)} ·{" "}
                        {version.note}
                      </p>
                      {version.reviewNote && (
                        <p className="text-body-sm">
                          {label("审核意见", "Review note")}:{" "}
                          {version.reviewNote}
                        </p>
                      )}
                      <details>
                        <summary className="cursor-pointer text-body-sm">
                          {label("查看本次提交内容", "View submitted snapshot")}
                        </summary>
                        <pre className="mt-md max-h-80 overflow-auto whitespace-pre-wrap break-all rounded border p-md text-body-sm">
                          {JSON.stringify(version.configuration, null, 2)}
                        </pre>
                        <div className="flex flex-wrap gap-md">
                          {(["logo", "favicon", "background"] as const).map(
                            (key) =>
                              version.configuration[key] ? (
                                <Image
                                  unoptimized
                                  key={key}
                                  src={customerPortalAssetUrl(
                                    tenantId,
                                    version.configuration[key],
                                  )}
                                  alt={key}
                                  width={160}
                                  height={100}
                                  className="object-contain"
                                />
                              ) : null,
                          )}
                        </div>
                      </details>
                      {canWrite && (
                        <div className="flex flex-wrap gap-sm">
                          {version.status === "pending" && (
                            <Button
                              variant="outline"
                              disabled={busy || dirty}
                              onClick={() => transition(version, "withdraw")}
                            >
                              {label("撤回", "Withdraw")}
                            </Button>
                          )}
                          {version.status === "pending" && (
                            <>
                              <Button
                                disabled={busy || dirty}
                                onClick={() => transition(version, "approve")}
                              >
                                {label("审核通过", "Approve")}
                              </Button>
                              <Button
                                variant="outline"
                                disabled={busy || dirty || !note.trim()}
                                onClick={() => transition(version, "reject")}
                              >
                                {label("驳回", "Reject")}
                              </Button>
                            </>
                          )}
                          {version.status === "approved" &&
                            record.publishedVersionId !== version.id && (
                              <Button
                                disabled={busy || dirty}
                                onClick={() => transition(version, "publish")}
                              >
                                {label("发布此版本", "Publish this version")}
                              </Button>
                            )}
                        </div>
                      )}
                    </div>
                  ))}
                </section>
              </>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
