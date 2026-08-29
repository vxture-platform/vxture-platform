import { NextResponse } from "next/server";
import type { DevServiceSnapshot } from "@/entities/console";

export const dynamic = "force-dynamic";

function trimTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) {
    end -= 1;
  }
  return end === value.length ? value : value.slice(0, end);
}

const DEV_PANEL_ORIGIN =
  process.env.DEV_PANEL_URL ??
  process.env.NEXT_PUBLIC_DEV_PANEL_URL ??
  "http://localhost:8090";
const NORMALIZED_DEV_PANEL_ORIGIN = trimTrailingSlashes(DEV_PANEL_ORIGIN);

function devToolsSnapshot(
  ok: boolean,
  status: number | string | null,
  durationMs: number,
): DevServiceSnapshot {
  return {
    id: "dev-tools",
    name: "Dev Tools Panel",
    port: 8090,
    priority: 0,
    url: NORMALIZED_DEV_PANEL_ORIGIN,
    command: "tools/dev-panel/src/server.mjs",
    running: ok,
    listening: ok,
    healthy: ok,
    health: [
      {
        label: "api.services",
        url: `${NORMALIZED_DEV_PANEL_ORIGIN}/api/services`,
        status,
        okStatuses: [200],
        durationMs,
        ok,
      },
    ],
    pid: null,
    startedAt: null,
    uptimeMs: null,
    uptime: ok ? "在线" : "不可用",
    stopping: false,
    logs: [],
    source: "dev-tools",
  };
}

function panelServiceSnapshot(service: DevServiceSnapshot): DevServiceSnapshot {
  return {
    ...service,
    logs: [],
    source: "dev-panel",
  };
}

export async function GET() {
  /* 这条代理只服务本地开发面板（localhost:8090）。生产没有那个面板，之前它照样
   * 注册、照样去连、等 5 秒超时再返回一条"不可用"快照——首页把它当"服务监控"
   * 数据源，也就把一次必然失败的探测当成了一条监控读数。生产直接 404：没有这份
   * 数据，就不假装去取（2026-08-30；首页那侧对 404 静默为"待建设"空态）。 */
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { error: "dev-services is development-only" },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }

  const startedAt = Date.now();

  try {
    const response = await fetch(
      `${NORMALIZED_DEV_PANEL_ORIGIN}/api/services?ts=${Date.now()}`,
      {
        cache: "no-store",
        signal: AbortSignal.timeout(5_000),
      },
    );
    const durationMs = Date.now() - startedAt;

    if (!response.ok) {
      return NextResponse.json(
        [devToolsSnapshot(false, response.status, durationMs)],
        {
          headers: { "Cache-Control": "no-store" },
        },
      );
    }

    const services = (await response.json()) as DevServiceSnapshot[];
    return NextResponse.json(
      [
        devToolsSnapshot(true, response.status, durationMs),
        ...services.map(panelServiceSnapshot),
      ],
      {
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.name : "FetchError";
    return NextResponse.json(
      [devToolsSnapshot(false, message, Date.now() - startedAt)],
      {
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
