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
  const t = useTranslations("customerPortal");
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
        if (live) setError(e instanceof Error ? e.message : t("requestFailed"));
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [tenantId, reload, t]);

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
      setMessage(t("changesApplied"));
    } catch (e) {
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
      pending: t("statusPending"),
      rejected: t("statusRejected"),
      approved: t("statusApproved"),
      withdrawn: t("statusWithdrawn"),
    })[value];

  if (!available) return null;
  return (
    <Card>
      <CardHeader>
        <h2 className="text-heading-sm">{t("title")}</h2>
        <p className="text-body-sm text-muted-foreground">{t("description")}</p>
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
                <span className="text-body-sm text-muted-foreground">
                  {t("unsavedChanges")}
                </span>
              )}
              {record?.publishedVersionId && (
                <a
                  href={`https://${record.hostname}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-body-sm underline"
                >
                  {t("openPublished")}
                </a>
              )}
            </div>
            {record && draft && (
              <>
                <p className="text-body-sm text-muted-foreground">
                  {record.hostname} · {t("draftRevision")} {record.revision} ·{" "}
                  {t("lastEdited")}:{" "}
                  {record.updatedSurface === "admin" ? "Admin" : "Console"} ·{" "}
                  {formatDateTime(record.updatedAt, locale)}
                </p>
                <fieldset disabled={busy} className="grid gap-lg">
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
                  <p className="text-body-sm text-muted-foreground">
                    {t("assetRights")}
                  </p>
                  <section className="grid gap-sm">
                    <h3>{t("applicationRules")}</h3>
                    <p className="text-body-sm text-muted-foreground">
                      {t("applicationRulesHelp")}
                    </p>
                    {draft.applications.map((app, i) => (
                      <div
                        key={app.code}
                        className="flex flex-wrap items-center gap-sm"
                      >
                        <span className="text-body-sm">{app.code}</span>
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
                      {t("submissionNote")}
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
                    <p className="text-body-sm text-muted-foreground">
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
                      <p className="text-body-sm">
                        {formatDateTime(version.submittedAt, locale)} ·{" "}
                        {version.note}
                      </p>
                      {version.reviewNote && (
                        <p className="text-body-sm">
                          {t("reviewNote")}: {version.reviewNote}
                        </p>
                      )}
                      <details>
                        <summary className="cursor-pointer text-body-sm">
                          {t("viewSnapshot")}
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
                              {t("withdraw")}
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
