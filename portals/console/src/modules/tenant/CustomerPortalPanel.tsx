"use client";
/**
 * Organization portal draft editor and immutable review history.
 * @package @vxture/console
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
  customerPortalRequest,
  uploadCustomerPortalAsset,
  customerPortalAssetUrl,
} from "@/api/console-bff";
import type {
  PortalConfiguration,
  PortalRecord,
  PortalVersion,
} from "@/api/customer-portal.types";

// ============================================================================
// Drafts are shared; a submitted version is an immutable review snapshot.
// ============================================================================
export function CustomerPortalPanel({ tenantId }: { tenantId: string }) {
  const locale = useLocale();
  const label = (zh: string, en: string) => (locale.startsWith("zh") ? zh : en);
  const [record, setRecord] = useState<PortalRecord | null>(null);
  const [draft, setDraft] = useState<PortalConfiguration | null>(null);
  const [loading, setLoading] = useState(true);
  const [available, setAvailable] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [note, setNote] = useState("");
  const [appCode, setAppCode] = useState("");

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError("");
    setRecord(null);
    setDraft(null);
    setAvailable(false);
    async function load() {
      const access = await customerPortalRequest<{ available: boolean }>(
        tenantId,
        "/availability",
      );
      if (!live) return;
      setAvailable(access.available);
      if (!access.available) return;
      const { portal: result } = await customerPortalRequest<{
        portal: PortalRecord | null;
      }>(tenantId);
      if (!live) return;
      setRecord(result);
      setDraft(result?.draft ?? null);
    }
    void load()
      .catch((e) => {
        if (live)
          setError(e instanceof Error ? e.message : "Portal request failed");
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [tenantId, reload]);

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
      const result = await action();
      setRecord(result);
      setDraft(result?.draft ?? null);
      setMessage(label("操作已完成", "Changes applied"));
    } catch (e) {
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
  function withdraw(version: PortalVersion) {
    void act(() =>
      customerPortalRequest<PortalRecord>(
        tenantId,
        `/versions/${version.id}/withdraw`,
        "POST",
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

  if (!available) return null;
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
            {record && draft && (
              <>
                <p className="text-body-sm text-muted-foreground">
                  {record.hostname} · {label("草稿修订", "Draft revision")}{" "}
                  {record.revision} · {label("最近修改", "Last edited")}:{" "}
                  {record.updatedSurface === "admin" ? "Admin" : "Console"} ·{" "}
                  {new Date(record.updatedAt).toLocaleString(locale)}
                </p>
                <fieldset disabled={busy} className="grid gap-lg">
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
                      {label("提交说明", "Submission note")}
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
                      {
                        <div className="flex flex-wrap gap-sm">
                          {version.status === "pending" && (
                            <Button
                              variant="outline"
                              disabled={busy || dirty}
                              onClick={() => withdraw(version)}
                            >
                              {label("撤回", "Withdraw")}
                            </Button>
                          )}
                        </div>
                      }
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
