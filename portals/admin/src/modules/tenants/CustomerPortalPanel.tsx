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
import { useLocale, useTranslations } from "next-intl";
import { formatDateTime } from "@vxture-platform/shared";
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
  const t = useTranslations("customerPortal");
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
          setError(e instanceof Error ? e.message : t("requestFailed"));
        }
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [tenantId, reload, t]);

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
    checking: t("hostnameChecking"),
    available: t("hostnameAvailable"),
    occupied: t("hostnameOccupied"),
    invalid: t("hostnameInvalid"),
    failed: t("hostnameCheckFailed"),
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
      setMessage(t("changesApplied"));
    } catch (e) {
      if (!record && e instanceof AdminBffError && e.status === 409)
        setCheckAttempt((current) => current + 1);
      if (!isStepUpCancelled(e))
        setError(e instanceof Error ? e.message : t("requestFailed"));
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
      setError(t("imageValidation"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      const asset = await uploadCustomerPortalAsset(tenantId, file);
      change({ [key]: asset.hash });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("uploadFailed"));
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
      pending: t("statusPending"),
      rejected: t("statusRejected"),
      approved: t("statusApproved"),
      withdrawn: t("statusWithdrawn"),
    })[value];

  return (
    <Card>
      <CardHeader>
        <h2 className="text-heading-sm">{t("title")}</h2>
        <p className="text-body-small text-muted-foreground">
          {t("description")}
        </p>
      </CardHeader>
      <CardContent className="grid gap-lg">
        {error && <Banner tone="danger" title={error} />}
        {message && <Banner tone="success" title={message} />}
        {loading ? (
          <p>{t("loading")}</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-sm">
              <Button
                variant="outline"
                size="sm"
                disabled={busy || dirty}
                onClick={() => setReload((n) => n + 1)}
              >
                {t("refresh")}
              </Button>
              {dirty && (
                <span className="text-body-small text-muted-foreground">
                  {t("unsavedChanges")}
                </span>
              )}
              {record?.publishedVersionId && (
                <a
                  href={`https://${record.hostname}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-body-small underline"
                >
                  {t("openPublished")}
                </a>
              )}
            </div>
            {
              <fieldset
                className="grid gap-md rounded-md border p-lg"
                disabled={!canWrite || busy}
              >
                <legend>{t("bindingTitle")}</legend>
                <Field>
                  <FieldLabel htmlFor={`portal-prefix-${tenantId}`}>
                    {t("hostname")}
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
                        className="text-body-small text-muted-foreground"
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
                          {t("checkAgain")}
                        </Button>
                      )}
                    </div>
                  )}
                </Field>
                <Field>
                  <FieldLabel htmlFor={`portal-workspace-${tenantId}`}>
                    {t("defaultWorkspace")}
                  </FieldLabel>
                  <NativeSelect
                    id={`portal-workspace-${tenantId}`}
                    value={workspaceId}
                    disabled={Boolean(record)}
                    onChange={(e) => setWorkspaceId(e.target.value)}
                  >
                    <option value="">{t("selectWorkspace")}</option>
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
                  {t("allowSelfService")}
                </label>
                <label className="flex items-center gap-sm">
                  <Switch checked={enabled} onCheckedChange={setEnabled} />
                  {t("enableAccess")}
                </label>
                <p className="text-body-small text-muted-foreground">
                  {t("hostnameRules")}
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
                  {record ? t("updateBinding") : t("provision")}
                </Button>
              </fieldset>
            }
            {record && draft && (
              <>
                <p className="text-body-small text-muted-foreground">
                  {record.hostname} · {t("draftRevision")} {record.revision} ·{" "}
                  {t("lastEdited")}:{" "}
                  {record.updatedSurface === "admin" ? "Admin" : "Console"} ·{" "}
                  {formatDateTime(record.updatedAt, locale)}
                </p>
                <fieldset disabled={busy || !canWrite} className="grid gap-lg">
                  <div className="grid gap-md md:grid-cols-2">
                    <Field>
                      <FieldLabel htmlFor="portal-name">
                        {t("institutionName")}
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
                        {t("brandColor")}
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
                      {t("loginTitle")}
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
                      {t("loginDescription")}
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
                        {t("density")}
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
                        <option value="comfortable">{t("comfortable")}</option>
                        <option value="compact">{t("compact")}</option>
                      </NativeSelect>
                    </Field>
                  </div>
                  <div className="grid gap-md md:grid-cols-3">
                    {(
                      [
                        ["logo", t("logo")],
                        ["favicon", t("favicon")],
                        ["background", t("background")],
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
                          {t("useDefault")}
                        </Button>
                      </Field>
                    ))}
                  </div>
                  <p className="text-body-small text-muted-foreground">
                    {t("assetRights")}
                  </p>
                  <section className="grid gap-sm">
                    <h3>{t("applicationRules")}</h3>
                    <p className="text-body-small text-muted-foreground">
                      {t("applicationRulesHelp")}
                    </p>
                    {draft.applications.map((app, i) => (
                      <div
                        key={app.code}
                        className="flex flex-wrap items-center gap-sm"
                      >
                        <span className="text-body-small">{app.code}</span>
                        <Input
                          aria-label={t("group")}
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
                          {t("hidden")}
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
                          {t("useDefault")}
                        </Button>
                      </div>
                    ))}
                    <div className="flex gap-sm">
                      <Input
                        aria-label={t("applicationCode")}
                        value={appCode}
                        maxLength={64}
                        onChange={(e) => setAppCode(e.target.value)}
                        placeholder={t("applicationCode")}
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
                        {t("addApplicationRule")}
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
                      {t("saveDraft")}
                    </Button>
                    <Button
                      variant="outline"
                      disabled={!dirty}
                      onClick={() => setDraft(record.draft)}
                    >
                      {t("discardChanges")}
                    </Button>
                  </div>
                  <Field>
                    <FieldLabel htmlFor="portal-note">
                      {t("reviewNoteLabel")}
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
                    {t("submit")}
                  </Button>
                </fieldset>
                <section className="grid gap-md">
                  <h3>{t("historyTitle")}</h3>
                  {record.versions.length === 0 && (
                    <p className="text-body-small text-muted-foreground">
                      {t("noSubmissions")}
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
                          <strong>{t("currentlyPublished")}</strong>
                        )}
                      </div>
                      <p className="text-body-small">
                        {formatDateTime(version.submittedAt, locale)} ·{" "}
                        {version.note}
                      </p>
                      {version.reviewNote && (
                        <p className="text-body-small">
                          {t("reviewNote")}: {version.reviewNote}
                        </p>
                      )}
                      <details>
                        <summary className="cursor-pointer text-body-small">
                          {t("viewSnapshot")}
                        </summary>
                        <pre className="mt-md max-h-80 overflow-auto whitespace-pre-wrap break-all rounded border p-md text-body-small">
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
                              {t("withdraw")}
                            </Button>
                          )}
                          {version.status === "pending" && (
                            <>
                              <Button
                                disabled={busy || dirty}
                                onClick={() => transition(version, "approve")}
                              >
                                {t("approve")}
                              </Button>
                              <Button
                                variant="outline"
                                disabled={busy || dirty || !note.trim()}
                                onClick={() => transition(version, "reject")}
                              >
                                {t("reject")}
                              </Button>
                            </>
                          )}
                          {version.status === "approved" &&
                            record.publishedVersionId !== version.id && (
                              <Button
                                disabled={busy || dirty}
                                onClick={() => transition(version, "publish")}
                              >
                                {t("publish")}
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
