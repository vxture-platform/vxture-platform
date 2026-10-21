"use client";

/**
 * Read-only Atlas current status and ordered event history in Admin.
 * @package @vxture/admin
 * @layer Presentation
 * @category component
 * @author AI-Generated
 * @date 2026-10-20
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Banner, Button, DataTable, Section } from "@vxture/design-system";
import { useTableLabels } from "@/modules/shared/table";
import { fetchAtlasMonitoring } from "@/api/admin-bff";

// ============================================================================
// Local wire projections: portals consume HTTP, never BFF package imports
// ============================================================================

interface HealthSnapshot {
  generatedAt: string;
  models: {
    modelCode: string;
    providerCode: string;
    state: string;
    detail?: string;
  }[];
  routes: { code: string; state: string; configIssues: { detail: string }[] }[];
  vendors: { providerCode: string; state: string; detail?: string }[];
  atlas: { component: string; state: string; detail?: string }[];
}
interface HealthEvent {
  id: string;
  createdAt: string;
  subjectKind: string;
  subjectKey: string;
  from: string;
  to: string;
  severity: string;
  detail: string | null;
  upstreamStatus: number | null;
  affectedRoutes: string[];
}
interface EventPage {
  items: HealthEvent[];
  nextCursor: string | null;
}

const object = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const rowsOf = (v: unknown, fields: string[]): boolean =>
  Array.isArray(v) &&
  v.every(
    (r) =>
      object(r) &&
      fields.every((k) => typeof r[k] === "string") &&
      (r.detail === undefined || typeof r.detail === "string"),
  );
function snapshotBody(v: unknown, invalidMessage: string): HealthSnapshot {
  if (
    !object(v) ||
    typeof v.generatedAt !== "string" ||
    !rowsOf(v.models, ["modelCode", "providerCode", "state"]) ||
    !rowsOf(v.vendors, ["providerCode", "state"]) ||
    !rowsOf(v.atlas, ["component", "state"]) ||
    !rowsOf(v.routes, ["code", "state"]) ||
    !(v.routes as Record<string, unknown>[]).every((r) =>
      rowsOf(r.configIssues, ["detail"]),
    )
  )
    throw new Error(invalidMessage);
  return v as unknown as HealthSnapshot;
}
function eventBody(v: unknown, invalidMessage: string): EventPage {
  if (
    !object(v) ||
    !(v.nextCursor === null || typeof v.nextCursor === "string") ||
    !Array.isArray(v.items) ||
    !v.items.every(
      (e) =>
        object(e) &&
        [
          "id",
          "createdAt",
          "subjectKind",
          "subjectKey",
          "from",
          "to",
          "severity",
        ].every((k) => typeof e[k] === "string") &&
        (e.detail === null || typeof e.detail === "string") &&
        (e.upstreamStatus === null || typeof e.upstreamStatus === "number") &&
        Array.isArray(e.affectedRoutes) &&
        e.affectedRoutes.every((r) => typeof r === "string"),
    )
  )
    throw new Error(invalidMessage);
  return v as unknown as EventPage;
}

// ============================================================================
// Independent snapshot and history reads, with pagination and retryable errors
// ============================================================================

export function ModelHealthPanel() {
  const t = useTranslations("atlasMonitoring");
  const labels = useTableLabels();
  const [snapshot, setSnapshot] = useState<HealthSnapshot | null>(null);
  const [events, setEvents] = useState<HealthEvent[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const reload = useCallback(async () => {
    setBusy(true);
    setError("");
    const [health, history] = await Promise.allSettled([
      fetchAtlasMonitoring<unknown>("health").then((v) =>
        snapshotBody(v, t("snapshotInvalid")),
      ),
      fetchAtlasMonitoring<unknown>("health/events").then((v) =>
        eventBody(v, t("eventsInvalid")),
      ),
    ]);
    if (health.status === "fulfilled") setSnapshot(health.value);
    if (history.status === "fulfilled") {
      setEvents(history.value.items);
      setCursor(history.value.nextCursor);
      setHasMore(history.value.items.length === 50);
    }
    if (health.status === "rejected" || history.status === "rejected")
      setError(t("partialFailure"));
    setBusy(false);
  }, [t]);
  useEffect(() => {
    void reload();
  }, [reload]);
  async function more() {
    if (!cursor) return;
    setBusy(true);
    setError("");
    try {
      const page = eventBody(
        await fetchAtlasMonitoring<unknown>("health/events", cursor),
        t("eventsInvalid"),
      );
      if (page.items.length && page.nextCursor === cursor)
        throw new Error(t("cursorStalled"));
      setEvents((old) => [
        ...new Map([...old, ...page.items].map((e) => [e.id, e])).values(),
      ]);
      setCursor(page.nextCursor);
      setHasMore(page.items.length === 50);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("historyFailed"));
    } finally {
      setBusy(false);
    }
  }
  const rows = snapshot
    ? [
        ...snapshot.vendors.map((v) => ({
          id: `vendor:${v.providerCode}`,
          kind: t("vendor"),
          key: v.providerCode,
          state: v.state,
          detail: v.detail ?? "",
        })),
        ...snapshot.routes.map((r) => ({
          id: `route:${r.code}`,
          kind: t("route"),
          key: r.code,
          state: r.state,
          detail: r.configIssues.map((i) => i.detail).join("; "),
        })),
        ...snapshot.models.map((m) => ({
          id: `model:${m.modelCode}`,
          kind: t("model"),
          key: m.modelCode,
          state: m.state,
          detail: m.detail ?? "",
        })),
        ...snapshot.atlas.map((c) => ({
          id: `atlas:${c.component}`,
          kind: t("component"),
          key: c.component,
          state: c.state,
          detail: c.detail ?? "",
        })),
      ]
    : [];
  return (
    <Section title={t("title")} level={2}>
      {error ? <Banner tone="danger" title={error} /> : null}
      <Button variant="secondary" disabled={busy} onClick={() => void reload()}>
        {t("refresh")}
      </Button>
      {snapshot ? (
        <p>{t("snapshotTime", { time: snapshot.generatedAt })}</p>
      ) : null}
      <DataTable
        labels={labels}
        rows={rows}
        rowKey={(r) => r.id}
        columns={[
          { id: "kind", header: t("subject"), cell: (r) => r.kind },
          { id: "key", header: t("name"), cell: (r) => r.key },
          { id: "state", header: t("currentState"), cell: (r) => r.state },
          {
            id: "detail",
            header: t("detail"),
            cell: (r) => (
              <span className="whitespace-pre-wrap break-words">
                {r.detail}
              </span>
            ),
          },
        ]}
      />
      <p>{t("historyOrder")}</p>
      <DataTable
        labels={labels}
        rows={events}
        rowKey={(r) => r.id}
        columns={[
          { id: "time", header: t("occurredAt"), cell: (r) => r.createdAt },
          {
            id: "subject",
            header: t("subject"),
            cell: (r) => `${r.subjectKind} · ${r.subjectKey}`,
          },
          {
            id: "state",
            header: t("transition"),
            cell: (r) => `${r.from} → ${r.to} · ${r.severity}`,
          },
          {
            id: "detail",
            header: t("upstreamDetail"),
            cell: (r) => (
              <span className="whitespace-pre-wrap break-words">
                {r.upstreamStatus ?? ""} {r.detail ?? ""}
                {r.affectedRoutes.length
                  ? ` · ${r.affectedRoutes.join(", ")}`
                  : ""}
              </span>
            ),
          },
        ]}
      />
      {hasMore ? (
        <Button variant="secondary" disabled={busy} onClick={() => void more()}>
          {t("loadMore")}
        </Button>
      ) : null}
    </Section>
  );
}
