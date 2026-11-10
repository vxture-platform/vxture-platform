"use client";

/**
 * Scope-cancelled application activity with explicit persistence feedback.
 * @package @vxture/workbench
 * @layer Presentation
 * @category hook
 * @author AI-Generated
 * @date 2026-11-10
 */
import { useEffect, useRef, useState } from "react";
import { loadAppActivity, saveAppActivity } from "../../lib/api";
import type {
  AppActivity,
  AppView,
  LoadResult,
  WorkApp,
  WorkData,
} from "../../lib/contracts";

// ============================================================================
// Requests belong to the exact account and workspace which initiated them.
// ============================================================================
/**
 * Keep preferences consistent across launch surfaces without blocking navigation.
 * @param data - Current authenticated portal projection.
 * @returns Decorated applications, view controls and persistence feedback.
 */
export function useAppActivity(data: WorkData | null) {
  const key = data
    ? `${data.user.id}:${data.scope.id}:${data.scope.workspace}`
    : "";
  const scope = key;
  const [state, setState] = useState<{
    key: string;
    result: LoadResult<AppActivity>;
  } | null>(null);
  const [revision, setRevision] = useState(0);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const locked = useRef(false);
  const launchRevision = useRef(0);
  useEffect(() => {
    if (!data) return;
    const request = new AbortController();
    controller.current = request;
    locked.current = false;
    setBusy(false);
    setMessage("");
    setState(null);
    void loadAppActivity(request.signal)
      .then((result) => {
        if (!request.signal.aborted) setState({ key, result });
      })
      .catch(() => {
        /* Scope cancellation is not an empty history. */
      });
    return () => {
      request.abort();
      controller.current = null;
    };
  }, [data, key, revision]);
  const result = state?.key === key ? state.result : null;
  const activity = result?.status === "ready" ? result.data : null;
  const apps =
    data?.catalog.status === "ready"
      ? data.catalog.data.map((app) => ({
          ...app,
          ...activity?.items.find((item) => item.code === app.code),
        }))
      : [];

  // ========================================================================
  // Favorite and view changes are serialized; launch actions remain independent.
  // ========================================================================
  const mutate = async (
    path: string,
    body: Record<string, unknown>,
    success: string,
    update: (previous: AppActivity) => AppActivity,
  ): Promise<void> => {
    const request = controller.current;
    if (!request || !activity || locked.current) return;
    locked.current = true;
    setBusy(true);
    setMessage("");
    try {
      await saveAppActivity(path, body, scope, request.signal);
      if (!request.signal.aborted) {
        setState((previous) =>
          previous?.key === key && previous.result.status === "ready"
            ? {
                key,
                result: { status: "ready", data: update(previous.result.data) },
              }
            : previous,
        );
        setMessage(success);
      }
    } catch {
      if (!request.signal.aborted) setMessage("操作未保存，请重试");
    } finally {
      if (!request.signal.aborted) {
        locked.current = false;
        setBusy(false);
      }
    }
  };
  const favorite = (app: WorkApp): void => {
    const desired = !app.favorite;
    void mutate(
      `${encodeURIComponent(app.code)}/favorite`,
      { favorite: desired },
      desired ? `已收藏${app.name}` : `已取消收藏${app.name}`,
      (previous) => ({
        ...previous,
        items: previous.items.map((item) =>
          item.code === app.code ? { ...item, favorite: desired } : item,
        ),
      }),
    );
  };
  const changeView = (view: AppView): void => {
    if (view === activity?.view) return;
    void mutate("view", { view }, "", (previous) => ({ ...previous, view }));
  };
  const launch = (app: WorkApp): void => {
    const request = controller.current;
    if (!request || !app.available || !app.href) return;
    const sequence = ++launchRevision.current;
    void saveAppActivity(
      `${encodeURIComponent(app.code)}/launch`,
      { eventId: crypto.randomUUID() },
      scope,
      request.signal,
    )
      .then(async () => {
        const next = await loadAppActivity(request.signal);
        if (!request.signal.aborted && sequence === launchRevision.current) {
          setState((previous) => {
            if (
              next.status === "ready" &&
              previous?.key === key &&
              previous.result.status === "ready"
            ) {
              const current = previous.result.data;
              return {
                key,
                result: {
                  status: "ready",
                  data: {
                    ...next.data,
                    view: current.view,
                    items: next.data.items.map((item) => ({
                      ...item,
                      favorite:
                        current.items.find((entry) => entry.code === item.code)
                          ?.favorite ?? item.favorite,
                    })),
                  },
                },
              };
            }
            return { key, result: next };
          });
        }
      })
      .catch(() => {
        if (!request.signal.aborted)
          setMessage("应用已打开，使用记录未保存，可刷新后重试");
      });
  };
  return {
    apps,
    view: activity?.view ?? "favorites",
    result,
    busy,
    enabled: Boolean(activity) && !busy,
    message,
    favorite,
    changeView,
    launch,
    retry: () => setRevision((value) => value + 1),
  };
}
