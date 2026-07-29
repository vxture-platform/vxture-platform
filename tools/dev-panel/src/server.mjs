/**
 * server.mjs - Vxture Dev Panel 开发服务管理面板
 *
 * 本地开发环境的服务编排与监控面板。
 * 提供有序启动（P0→P1→P2）、健康检查门控、进程生命周期管理和日志查看。
 *
 * @version 2.0
 */

import http from "node:http";
import { spawn } from "node:child_process";
import net from "node:net";
import { URL, fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// ─── 全局常量 ──────────────────────────────────────────────────────────────────

// 从文件位置推导 repo 根目录，避免硬编码路径
const __dir = fileURLToPath(new URL(".", import.meta.url));
const ROOT_DIR = path.resolve(__dir, "..", "..", ".."); // src/ → dev-panel/ → tools/ → repo root

const PANEL_PORT = Number(process.env.DEV_PANEL_PORT ?? 8090);
const MAX_LOG_LINES = 500;
const START_WAIT_TIMEOUT_MS = 30_000;
const START_WAIT_INTERVAL_MS = 1_000;
const ROOT_ENV = loadRootEnv();

// ─── 服务清单 ──────────────────────────────────────────────────────────────────

/** @type {Array<{id:string,name:string,port:number,url:string,command:string,priority:number,env?:Record<string,string>,healthChecks:Array<{label:string,kind?:'http'|'tcp',url?:string,port?:number,okStatuses?:number[]}>}>} */
const SERVICES = [
  {
    id: "website-bff",
    name: "Website BFF",
    port: 3011,
    priority: 0,
    url: "http://localhost:3011",
    command: "pnpm --filter @vxture/bff-website dev",
    env: {
      AUTH_BFF_URL: "http://localhost:3090",
    },
    healthChecks: [
      {
        label: "healthz",
        url: "http://localhost:3011/healthz",
        okStatuses: [200],
      },
      {
        label: "api.me",
        url: "http://localhost:3011/api/me",
        okStatuses: [401],
      },
    ],
  },
  {
    id: "auth-bff",
    name: "Auth BFF",
    port: 3090,
    priority: 0,
    url: "http://localhost:3090",
    command: "pnpm --filter @vxture/bff-auth dev",
    env: {
      AUTH_BFF_PORT: "3090",
    },
    healthChecks: [
      {
        label: "healthz",
        url: "http://localhost:3090/healthz",
        okStatuses: [200],
      },
    ],
  },
  {
    id: "varda-server",
    name: "Varda Server",
    port: 3122,
    priority: 0,
    url: "http://localhost:3122",
    command: "pnpm --filter @vxture/agent-server-varda dev",
    env: {
      ATLAS_API_URL: "http://localhost:3100",
      VARDA_SERVER_PORT: "3122",
      VARDA_PLATFORM_LLM_TENANT_ID: "82cf3e39-f7f0-4597-bb55-b1303ca19d46",
      VARDA_DEFAULT_MODEL_CODE: "doubao-seed-2-0-lite-260215",
    },
    healthChecks: [{ label: "port", kind: "tcp", port: 3122 }],
  },
  {
    id: "varda-bff",
    name: "Varda BFF",
    port: 3121,
    priority: 0,
    url: "http://localhost:3121",
    command: "pnpm --filter @vxture/bff-varda dev",
    env: {
      VARDA_BFF_PORT: "3121",
      VARDA_SERVER_INTERNAL_URL: "http://localhost:3122",
    },
    healthChecks: [
      {
        label: "health",
        url: "http://localhost:3121/health",
        okStatuses: [200],
      },
    ],
  },
  {
    id: "console-bff",
    name: "Console BFF",
    port: 3021,
    priority: 0,
    url: "http://localhost:3021",
    command: "pnpm --filter @vxture/bff-console dev",
    env: {
      ATLAS_API_URL: "http://localhost:3100",
      AUTH_BFF_URL: "http://localhost:3090",
    },
    healthChecks: [
      {
        label: "healthz",
        url: "http://localhost:3021/healthz",
        okStatuses: [200],
      },
      {
        label: "auth.session",
        url: "http://localhost:3021/api/auth/session",
        okStatuses: [401],
      },
    ],
  },
  {
    id: "admin-bff",
    name: "Admin BFF",
    port: 3031,
    priority: 0,
    url: "http://localhost:3031",
    command: "pnpm --filter @vxture/bff-admin dev",
    env: {
      ATLAS_API_URL: "http://localhost:3100",
      ADMIN_BFF_PORT: "3031",
      AUTH_BFF_URL: "http://localhost:3090",
    },
    healthChecks: [
      {
        label: "healthz",
        url: "http://localhost:3031/healthz",
        okStatuses: [200],
      },
      {
        label: "auth.session",
        url: "http://localhost:3031/api/auth/session",
        okStatuses: [401],
      },
      {
        label: "model-platform",
        url: "http://localhost:3031/api/model-platform/models",
        okStatuses: [401],
      },
    ],
  },
  {
    id: "gateway",
    name: "Gateway BFF",
    port: 8000,
    priority: 1,
    url: "http://localhost:8000",
    command: "pnpm dev:gateway",
    env: {
      WEBSITE_BFF_ORIGIN: "http://localhost:3011",
      CONSOLE_BFF_ORIGIN: "http://localhost:3021",
      ADMIN_BFF_ORIGIN: "http://localhost:3031",
      AUTH_BFF_ORIGIN: "http://localhost:3090",
    },
    healthChecks: [
      {
        label: "healthz",
        url: "http://localhost:8000/healthz",
        okStatuses: [200],
      },
      {
        label: "website-api",
        url: "http://localhost:8000/website-api/api/me",
        okStatuses: [401],
      },
      {
        label: "console-api",
        url: "http://localhost:8000/console-api/api/auth/session",
        okStatuses: [401],
      },
      {
        label: "admin-api",
        url: "http://localhost:8000/admin-api/api/auth/session",
        okStatuses: [401],
      },
      {
        label: "auth-api",
        url: "http://localhost:8000/auth-api/healthz",
        okStatuses: [200],
      },
    ],
  },
  {
    id: "website",
    name: "Website",
    port: 3010,
    priority: 2,
    url: "http://localhost:3010",
    command: "pnpm --filter @vxture/website dev",
    healthChecks: [{ label: "port", kind: "tcp", port: 3010 }],
  },
  {
    id: "console",
    name: "Console",
    port: 3020,
    priority: 2,
    url: "http://localhost:3020",
    command: "pnpm --filter @vxture/console dev",
    healthChecks: [{ label: "port", kind: "tcp", port: 3020 }],
  },
  {
    id: "admin",
    name: "Admin",
    port: 3030,
    priority: 2,
    url: "http://localhost:3030",
    command: "pnpm --filter @vxture/admin dev",
    healthChecks: [{ label: "port", kind: "tcp", port: 3030 }],
  },
  {
    id: "varda-studio",
    name: "Varda Studio",
    port: 3120,
    priority: 2,
    url: "http://localhost:3120",
    command: "pnpm --filter @vxture/agent-studio-varda dev",
    healthChecks: [{ label: "port", kind: "tcp", port: 3120 }],
  },
  {
    id: "website-alias",
    name: "Website :3000 Alias",
    port: 3000,
    priority: 2,
    url: "http://localhost:3000",
    command: "node tools/dev-panel/redirect-3000.mjs",
    healthChecks: [{ label: "port", kind: "tcp", port: 3000 }],
  },
];

/**
 * 卡片展示顺序 — 每层保持同一产品族顺序：
 * 基础平台 → website/console/admin → varda → 辅助入口。
 */
const CARD_ORDER = [
  "auth-bff",
  "website-bff",
  "console-bff",
  "admin-bff",
  "varda-server",
  "varda-bff",
  "gateway",
  "website",
  "console",
  "admin",
  "varda-studio",
  "website-alias",
];

const CARD_ORDER_INDEX = new Map(CARD_ORDER.map((id, index) => [id, index]));

/** 启动顺序 — 按依赖顺序逐级等待健康检查通过，并尽量贴近卡片分组顺序 */
const START_ORDER = [
  "auth-bff",
  "website-bff",
  "console-bff",
  "admin-bff",
  "varda-server",
  "varda-bff",
  "gateway",
  "website",
  "console",
  "admin",
  "varda-studio",
  "website-alias",
];

// ─── 运行时状态 ─────────────────────────────────────────────────────────────────

const runtime = new Map(
  SERVICES.map((service) => [
    service.id,
    { child: null, logs: [], startedAt: null, stopping: false },
  ]),
);

/** 全量启动进度跟踪 */
let bulkStarting = false;
let bulkCurrentSvcId = null;
let bulkStartPromise = null;
let bulkOperationVersion = 0;

// ─── 工具函数 ──────────────────────────────────────────────────────────────────

function shellForPlatform(command) {
  return process.platform === "win32"
    ? { file: "cmd.exe", args: ["/d", "/s", "/c", command] }
    : { file: "sh", args: ["-lc", command] };
}

function loadRootEnv() {
  const envPath = path.join(ROOT_DIR, ".env.local");
  if (!existsSync(envPath)) return {};
  const env = {};
  for (const rawLine of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const sep = line.indexOf("=");
    if (sep <= 0) continue;
    const key = line.slice(0, sep).trim();
    const val = unwrapEnvValue(line.slice(sep + 1).trim());
    if (key) env[key] = val;
  }
  return env;
}

function unwrapEnvValue(value) {
  const q = value[0];
  if ((q === '"' || q === "'") && value.endsWith(q)) return value.slice(1, -1);
  return value;
}

function appendLog(serviceId, line) {
  const state = runtime.get(serviceId);
  if (!state) return;
  const chunks = String(line)
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.trimEnd())
    .filter(Boolean);
  state.logs.push(...chunks);
  if (state.logs.length > MAX_LOG_LINES) {
    state.logs.splice(0, state.logs.length - MAX_LOG_LINES);
  }
}

/** 带时间戳的面板自身日志 */
function panelLog(serviceId, message) {
  const t = new Date().toTimeString().slice(0, 8);
  appendLog(serviceId, `[${t}] [panel] ${message}`);
}

function isChildAlive(child) {
  return Boolean(
    child &&
    child.exitCode === null &&
    child.signalCode === null &&
    !child.killed,
  );
}

function findService(id) {
  return SERVICES.find((s) => s.id === id) ?? null;
}

function orderForCards(items) {
  return [...items].sort((a, b) => {
    const pa = Number(a.priority ?? 99);
    const pb = Number(b.priority ?? 99);
    if (pa !== pb) return pa - pb;
    const ia = CARD_ORDER_INDEX.get(a.id) ?? Number.MAX_SAFE_INTEGER;
    const ib = CARD_ORDER_INDEX.get(b.id) ?? Number.MAX_SAFE_INTEGER;
    if (ia !== ib) return ia - ib;
    return String(a.name ?? a.id).localeCompare(String(b.name ?? b.id));
  });
}

function runProcess(file, args, { timeoutMs = 10_000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(file, args, { windowsHide: true });
    let stdout = "",
      stderr = "",
      settled = false;
    const finish = (payload) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, ...payload });
    };
    const timer = setTimeout(() => {
      child.kill();
      finish({ code: null, timedOut: true });
    }, timeoutMs);
    child.stdout?.on("data", (c) => {
      stdout += c;
    });
    child.stderr?.on("data", (c) => {
      stderr += c;
    });
    child.on("error", (error) => finish({ code: null, error }));
    child.on("close", (code) => finish({ code, timedOut: false }));
  });
}

function parsePidLines(text) {
  return [
    ...new Set(
      String(text)
        .split(/\s+/)
        .map((v) => Number(v.trim()))
        .filter(
          (pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid,
        ),
    ),
  ];
}

async function findListeningPids(port) {
  if (process.platform === "win32") {
    const cmd = [
      `Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue`,
      "Select-Object -ExpandProperty OwningProcess -Unique",
    ].join(" | ");
    const ps = await runProcess("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      cmd,
    ]);
    if (ps.stdout.trim()) return parsePidLines(ps.stdout);
    const ns = await runProcess("netstat.exe", ["-ano", "-p", "tcp"]);
    return [
      ...new Set(
        ns.stdout
          .split(/\r?\n/)
          .filter((l) => l.includes("LISTENING"))
          .map((l) => l.trim().split(/\s+/))
          .filter((c) => c.length >= 5 && c[1].endsWith(`:${port}`))
          .map((c) => Number(c[4]))
          .filter(
            (pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid,
          ),
      ),
    ];
  }
  const lsof = await runProcess(
    "lsof",
    ["-nP", "-ti", `TCP:${port}`, "-sTCP:LISTEN"],
    { timeoutMs: 5_000 },
  );
  if (lsof.stdout.trim()) return parsePidLines(lsof.stdout);
  const fuser = await runProcess("fuser", [`${port}/tcp`], {
    timeoutMs: 5_000,
  });
  return parsePidLines(`${fuser.stdout}\n${fuser.stderr}`);
}

async function waitForPortClosed(port, timeoutMs = 7_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (!(await checkPort(port))) return true;
    await sleep(300);
  }
  return !(await checkPort(port));
}

async function killProcessTree(pid) {
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return false;
  if (process.platform === "win32") {
    const r = await runProcess(
      "taskkill.exe",
      ["/pid", String(pid), "/t", "/f"],
      { timeoutMs: 15_000 },
    );
    return r.code === 0;
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      return false;
    }
  }
  await sleep(900);
  try {
    process.kill(pid, 0);
    process.kill(pid, "SIGKILL");
  } catch {
    /* already exited */
  }
  return true;
}

function checkPort(port) {
  return Promise.all([
    checkPortOnHost(port, "127.0.0.1"),
    checkPortOnHost(port, "::1"),
  ]).then((results) => results.some(Boolean));
}

function checkPortOnHost(port, host) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (v) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(v);
    };
    socket.setTimeout(500);
    socket.once("connect", () => {
      settled = true;
      socket.end();
      resolve(true);
    });
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(port, host);
  });
}

function formatUptime(ms) {
  if (ms < 0) return "0s";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── 健康检查 ──────────────────────────────────────────────────────────────────

async function runHealthChecks(service) {
  return Promise.all(
    (service.healthChecks ?? []).map(async (check) => {
      const t0 = Date.now();
      if (check.kind === "tcp") {
        const port = check.port ?? service.port;
        const ok = await checkPort(port);
        return {
          label: check.label,
          url: `tcp://127.0.0.1:${port}`,
          status: ok ? "open" : null,
          okStatuses: null,
          durationMs: Date.now() - t0,
          ok,
        };
      }
      try {
        if (!check.url || !check.okStatuses) throw new Error("invalid");
        const res = await fetch(check.url, {
          method: "GET",
          redirect: "manual",
          cache: "no-store",
          signal: AbortSignal.timeout(1_500),
        });
        return {
          label: check.label,
          url: check.url,
          status: res.status,
          okStatuses: check.okStatuses,
          durationMs: Date.now() - t0,
          ok: check.okStatuses.includes(res.status),
        };
      } catch {
        return {
          label: check.label,
          url: check.url,
          status: null,
          okStatuses: check.okStatuses,
          durationMs: Date.now() - t0,
          ok: false,
        };
      }
    }),
  );
}

async function getServiceSnapshot(service) {
  const state = runtime.get(service.id);
  const listening = await checkPort(service.port);
  const running = isChildAlive(state?.child);
  const health = await runHealthChecks(service);
  const uptimeMs = state?.startedAt
    ? Date.now() - new Date(state.startedAt).getTime()
    : null;
  return {
    id: service.id,
    name: service.name,
    port: service.port,
    priority: service.priority,
    url: service.url,
    command: service.command,
    running,
    listening,
    healthy: health.every((h) => h.ok),
    health,
    pid: state?.child?.pid ?? null,
    startedAt: state?.startedAt ?? null,
    uptimeMs,
    uptime: uptimeMs !== null ? formatUptime(uptimeMs) : null,
    stopping: Boolean(state?.stopping),
    logs: state?.logs ?? [],
  };
}

// ─── 服务生命周期 ──────────────────────────────────────────────────────────────

async function startService(service) {
  const state = runtime.get(service.id);
  if (!state) throw new Error(`Unknown service: ${service.id}`);
  if (isChildAlive(state.child)) {
    panelLog(service.id, "跳过启动：进程已在运行");
    return;
  }
  if (await checkPort(service.port)) {
    panelLog(service.id, `跳过启动：端口 ${service.port} 已被占用`);
    return;
  }

  const shell = shellForPlatform(service.command);
  const child = spawn(shell.file, shell.args, {
    cwd: ROOT_DIR,
    env: { ...process.env, ...ROOT_ENV, ...(service.env ?? {}) },
    windowsHide: true,
  });

  state.child = child;
  state.logs = [];
  state.startedAt = new Date().toISOString();
  state.stopping = false;
  panelLog(service.id, `启动中: ${service.command}`);

  child.stdout?.on("data", (c) => appendLog(service.id, c));
  child.stderr?.on("data", (c) => appendLog(service.id, c));
  child.on("exit", (code, signal) => {
    panelLog(
      service.id,
      `进程已退出 code=${code ?? "null"} signal=${signal ?? "null"}`,
    );
    const cur = runtime.get(service.id);
    if (cur) {
      cur.child = null;
      cur.stopping = false;
    }
  });
}

async function stopService(service) {
  const state = runtime.get(service.id);
  if (!state || state.stopping) return;
  state.stopping = true;
  panelLog(service.id, "正在停止服务进程树");

  const pids = new Set();
  if (isChildAlive(state.child)) pids.add(state.child.pid);
  for (const pid of await findListeningPids(service.port)) pids.add(pid);

  if (pids.size === 0) {
    panelLog(service.id, `端口 ${service.port} 无需停止`);
    state.child = null;
    state.startedAt = null;
    state.stopping = false;
    return;
  }

  for (const pid of pids) {
    const killed = await killProcessTree(pid);
    panelLog(service.id, killed ? `已停止 pid=${pid}` : `停止失败 pid=${pid}`);
  }

  const closed = await waitForPortClosed(service.port);
  panelLog(
    service.id,
    closed ? `端口 ${service.port} 已关闭` : `端口 ${service.port} 仍在监听`,
  );
  state.child = null;
  state.startedAt = null;
  state.stopping = false;
}

async function waitForHealthy(
  serviceId,
  timeoutMs = START_WAIT_TIMEOUT_MS,
  shouldCancel = () => false,
) {
  const service = findService(serviceId);
  if (!service) return false;
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (shouldCancel()) return false;
    const snap = await getServiceSnapshot(service);
    if (snap.listening && snap.healthy) return true;
    await sleep(START_WAIT_INTERVAL_MS);
  }
  return false;
}

async function startAllOrdered() {
  if (bulkStartPromise) return bulkStartPromise;
  const version = ++bulkOperationVersion;
  bulkStarting = true;
  bulkCurrentSvcId = null;

  bulkStartPromise = (async () => {
    for (const serviceId of START_ORDER) {
      if (version !== bulkOperationVersion) break;
      bulkCurrentSvcId = serviceId;
      const service = findService(serviceId);
      if (!service) continue;
      await startService(service);
      panelLog(service.id, "等待健康检查通过");
      const ready = await waitForHealthy(
        service.id,
        START_WAIT_TIMEOUT_MS,
        () => version !== bulkOperationVersion,
      );
      if (version !== bulkOperationVersion) {
        panelLog(service.id, "启动队列已取消");
        break;
      }
      panelLog(service.id, ready ? "服务已就绪 ✓" : "健康检查等待超时");
    }
  })();

  try {
    await bulkStartPromise;
  } finally {
    bulkStartPromise = null;
    bulkStarting = false;
    bulkCurrentSvcId = null;
  }
}

async function stopAll() {
  bulkOperationVersion += 1;
  for (const serviceId of [...START_ORDER].reverse()) {
    const service = findService(serviceId);
    if (service) await stopService(service);
  }
}

// ─── HTTP 工具 ─────────────────────────────────────────────────────────────────

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    Pragma: "no-cache",
  });
  res.end(JSON.stringify(payload));
}

// ─── HTML 面板 ─────────────────────────────────────────────────────────────────

function pageHtml() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Vxture Dev Panel</title>
  <style>
    /* ── 变量 ── */
    :root {
      --brand:       #3b5bdb;
      --brand-dark:  #1a2e9a;
      --brand-dim:   #4f75ff;
      --brand-light: #eef2ff;
      --brand-border:#c5d0ff;
      --bg:          #f0f4ff;
      --surface:     #ffffff;
      --border:      #dde6ff;
      --border-med:  #b0c0ff;
      --ink:         #1e2532;
      --ink-muted:   #6b7280;
      --ink-faint:   #9ca3af;
      --ok:          #0d7c3e;
      --ok-bg:       #dcfce7;
      --ok-border:   #86efac;
      --warn:        #92400e;
      --warn-bg:     #fef3c7;
      --warn-border: #fcd34d;
      --err:         #9f1239;
      --err-bg:      #ffe4e6;
      --err-border:  #fca5a5;
      --card-bg:     #f7f9ff;
      --card-hover:  #ffffff;
      --card-head:   #dce6ff;
      --card-head-hover: #d3ddfb;
      --topbar-h:    56px;
      --radius:      8px;
      --radius-sm:   6px;
    }

    /* ── 重置 ── */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif; font-size: 14px; line-height: 1.5; color: var(--ink); background: var(--bg); }
    button { font: inherit; cursor: pointer; border: none; border-radius: var(--radius-sm); transition: background .12s, box-shadow .12s, opacity .12s, transform .1s; }
    button:disabled { cursor: not-allowed; opacity: .44; pointer-events: none; }
    button:hover:not(:disabled) { transform: translateY(-1px); }
    a { color: inherit; text-decoration: none; }
    code { font-family: Consolas, "SFMono-Regular", monospace; }

    /* ── 顶栏 ── */
    .topbar {
      position: sticky;
      top: 0;
      z-index: 200;
      display: flex;
      align-items: center;
      gap: 12px;
      height: var(--topbar-h);
      padding: 0 24px;
      background: #0d1b5e;
      border-bottom: 1px solid rgba(255,255,255,.07);
      box-shadow: 0 2px 16px rgba(0,0,0,.22);
    }
    .topbar-brand {
      display: flex;
      align-items: baseline;
      gap: 8px;
      color: #e8eeff;
      font-size: 16px;
      font-weight: 800;
      letter-spacing: -.01em;
      white-space: nowrap;
      user-select: none;
    }
    .topbar-brand span {
      font-size: 11px;
      font-weight: 500;
      color: rgba(200,210,255,.55);
      padding-left: 4px;
      border-left: 1px solid rgba(200,210,255,.2);
    }
    .topbar-status {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 3px 10px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 700;
      background: rgba(255,255,255,.08);
      color: #c8d4ff;
      border: 1px solid rgba(255,255,255,.11);
      white-space: nowrap;
    }
    .topbar-status.all-ok { background: rgba(13,124,62,.3); color: #86efac; border-color: rgba(134,239,172,.3); }
    .topbar-status::before {
      content: '';
      display: inline-block;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: currentColor;
    }
    .topbar-progress {
      display: none;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: #fcd34d;
      white-space: nowrap;
    }
    .topbar-progress.visible { display: flex; }
    .topbar-progress::before {
      content: '';
      display: inline-block;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #fcd34d;
      animation: pulse 1s ease-in-out infinite;
    }
    .topbar-gap { flex: 1; }
    .topbar-actions { display: flex; gap: 6px; }
    .btn-tb {
      padding: 6px 12px;
      font-size: 12px;
      font-weight: 700;
      border-radius: var(--radius-sm);
      background: rgba(255,255,255,.09);
      color: #c8d4ff;
      border: 1px solid rgba(255,255,255,.14);
    }
    .btn-tb:hover:not(:disabled) { background: rgba(255,255,255,.16); color: #fff; }
    .btn-tb.primary {
      background: var(--brand-dim);
      color: #fff;
      border-color: transparent;
      box-shadow: 0 2px 12px rgba(79,117,255,.35);
    }
    .btn-tb.primary:hover:not(:disabled) { background: #6b8cff; }

    /* ── 主体 ── */
    .main { padding: 20px 24px; }
    .workspace {
      display: grid;
      grid-template-columns: 1fr 0;
      gap: 0;
      align-items: start;
      transition: grid-template-columns .2s ease, gap .2s ease;
    }
    .workspace.log-open {
      grid-template-columns: minmax(440px, 62fr) minmax(320px, 38fr);
      gap: 14px;
    }

    /* ── 服务面板 ── */
    .svc-panel {
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 24px;
      container-type: inline-size;
    }

    /* ── 优先级分组 ── */
    .group { display: flex; flex-direction: column; gap: 10px; }
    .group-header {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 0 2px;
    }
    .group-label {
      font-size: 11px;
      font-weight: 800;
      letter-spacing: .06em;
      text-transform: uppercase;
      color: var(--ink-faint);
      white-space: nowrap;
    }
    .group-line { flex: 1; height: 1px; background: var(--border); }
    .group-cards {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
    }

    @container (max-width: 1180px) {
      .group-cards { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    }
    @container (max-width: 820px) {
      .group-cards { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    @container (max-width: 540px) {
      .group-cards { grid-template-columns: 1fr; }
    }

    /* ── 卡片 ── */
    .card {
      display: flex;
      flex-direction: column;
      min-width: 0;
      height: 100%;
      min-height: 236px;
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      overflow: hidden;
      box-shadow: 0 1px 6px rgba(30,50,180,.04);
      transition: background .15s, box-shadow .15s, border-color .15s, transform .12s;
    }
    .card:hover {
      background: var(--card-hover);
      border-color: var(--border-med);
      box-shadow: 0 4px 20px rgba(30,60,200,.07);
      transform: translateY(-1px);
    }
    .card.selected {
      border-color: var(--brand-dim);
      box-shadow: 0 4px 24px rgba(79,117,255,.14);
    }
    .card.state-healthy {
      background: #f2fbf6;
      border-color: #b7e4c7;
    }
    .card.state-healthy .card-head {
      background: #dff6e8;
      border-bottom-color: #a7d7b7;
    }
    .card.state-issue {
      background: #fff1f2;
      border-color: #fda4af;
      box-shadow: 0 0 0 1px rgba(225,29,72,.12), 0 8px 24px rgba(159,18,57,.08);
    }
    .card.state-issue .card-head {
      background: #ffe4e6;
      border-bottom-color: #fda4af;
    }
    .card.state-stopped {
      background: #f3f4f6;
      border-color: #d1d5db;
    }
    .card.state-stopped .card-head {
      background: #e5e7eb;
      border-bottom-color: #d1d5db;
    }
    .card.state-changing,
    .card.is-busy {
      background: #fff7d6;
      border-color: #fbbf24;
      box-shadow: 0 0 0 2px rgba(245,158,11,.18), 0 10px 30px rgba(180,83,9,.12);
    }
    .card.state-changing .card-head,
    .card.is-busy .card-head {
      background: #fde68a;
      border-bottom-color: #f59e0b;
    }
    .card.selected .card-head {
      box-shadow: inset 0 0 0 2px rgba(79,117,255,.18);
    }
    .busy-label {
      display: none;
      align-items: center;
      height: 22px;
      padding: 0 8px;
      border-radius: 999px;
      background: #111827;
      color: #ffffff;
      font-size: 11px;
      font-weight: 900;
      white-space: nowrap;
      box-shadow: 0 1px 5px rgba(17,24,39,.22);
    }
    .busy-label:empty { display: none; }

    /* 第一行：优先级 + 名称 + 端口 + 状态 */
    .card-head {
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: 46px;
      padding: 10px 12px;
      background: var(--card-head);
      border-bottom: 1px solid var(--border-med);
      cursor: pointer;
      user-select: none;
      transition: background .15s;
    }
    .card:not(.state-healthy):not(.state-issue):not(.state-stopped):not(.state-changing):hover .card-head {
      background: var(--card-head-hover);
    }
    .svc-name {
      min-width: 0;
      font-size: 14px;
      font-weight: 800;
      color: var(--ink);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .card-head-spacer {
      flex: 1;
      min-width: 8px;
    }
    .svc-port {
      font-size: 11px;
      font-weight: 700;
      color: var(--brand);
      padding: 2px 7px;
      background: var(--brand-light);
      border: 1px solid var(--brand-border);
      border-radius: var(--radius-sm);
      white-space: nowrap;
    }
    .probe-summary {
      display: none;
      align-items: center;
      gap: 4px;
      flex-shrink: 0;
    }
    .probe-issue-count {
      display: none;
      align-items: center;
      justify-content: center;
      min-width: 34px;
      height: 22px;
      padding: 0 7px;
      border-radius: var(--radius-sm);
      font-size: 11px;
      font-weight: 900;
      border: 1px solid var(--err-border);
      background: var(--err-bg);
      color: var(--err);
    }
    .probe-issue-count.visible {
      display: inline-flex;
    }

    .card-content {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: 14px;
      min-height: 0;
      padding: 14px;
    }

    /* 第二行：健康探针 */
    .probe-row {
      display: flex;
      min-width: 0;
      flex-direction: column;
      gap: 7px;
      flex-shrink: 0;
    }
    .checks {
      display: grid;
      grid-template-columns: repeat(var(--probe-cols, 1), minmax(0, 1fr));
      grid-template-rows: repeat(2, auto);
      gap: 6px;
      min-width: 0;
      align-items: stretch;
    }
    .check {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      min-width: 0;
      padding: 4px 7px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 600;
      border: 1px solid var(--border);
      background: #ffffff;
      color: var(--ink-muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .check .dur { opacity: .55; font-size: 10px; }
    .check.ok  { background: var(--ok-bg);  color: var(--ok);  border-color: var(--ok-border);  }
    .check.bad { background: var(--err-bg); color: var(--err); border-color: var(--err-border); }
    .svc-meta {
      display: flex;
      gap: 10px;
      flex-shrink: 0;
      font-size: 11px;
      color: var(--ink-faint);
      white-space: nowrap;
    }
    .svc-meta b { color: var(--ink-muted); font-weight: 600; }
    .svc-meta:empty { display: none; }

    /* 第三行：命令 */
    .command-row {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
      margin-top: auto;
      padding: 8px 9px;
      background: #ffffff;
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
    }
    .svc-cmd {
      flex: 1;
      min-width: 0;
      font-size: 11px;
      color: var(--ink-muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .btn-copy {
      flex-shrink: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      font-size: 13px;
      background: #f8f9ff;
      color: var(--ink-faint);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
    }
    .btn-copy:hover:not(:disabled) { background: var(--brand-light); color: var(--brand); border-color: var(--brand-border); }

    /* 第四行：操作 */
    .card-actions {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 8px;
      flex-shrink: 0;
    }
    .card-actions button {
      min-width: 0;
      height: 32px;
      padding: 0 8px;
      font-size: 12px;
      font-weight: 800;
      border: 1px solid transparent;
    }
    .btn-start,
    .btn-stop,
    .btn-restart {
      background: var(--brand);
      color: #fff;
      box-shadow: 0 2px 8px rgba(59,91,219,.22);
    }
    .btn-start:hover:not(:disabled),
    .btn-stop:hover:not(:disabled),
    .btn-restart:hover:not(:disabled) {
      background: var(--brand-dark);
    }
    .btn-open {
      background: #edf2ff;
      color: var(--brand-dark);
      border-color: #9fb0f8;
      box-shadow: inset 0 0 0 1px rgba(59,91,219,.08);
    }
    .btn-open:hover:not(:disabled) {
      background: #dfe7ff;
      color: #10207a;
      border-color: var(--brand-dim);
      box-shadow: 0 2px 8px rgba(59,91,219,.16);
    }

    /* ── 状态徽章 ── */
    .badge-p {
      flex-shrink: 0;
      display: inline-flex;
      align-items: center;
      padding: 2px 6px;
      border-radius: 5px;
      font-size: 10px;
      font-weight: 800;
      letter-spacing: .03em;
      border: 1px solid;
    }
    .badge-p.p0 { background: var(--err-bg);  color: var(--err);  border-color: var(--err-border);  }
    .badge-p.p1 { background: var(--warn-bg); color: var(--warn); border-color: var(--warn-border); }
    .badge-p.p2 { background: var(--brand-light); color: var(--brand); border-color: var(--brand-border); }

    .status-badge {
      flex-shrink: 0;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 3px 9px;
      border-radius: var(--radius-sm);
      font-size: 12px;
      font-weight: 700;
      white-space: nowrap;
    }
    .status-badge::before {
      content: '';
      display: inline-block;
      width: 6px;
      height: 6px;
      border-radius: 50%;
    }
    .status-badge.healthy { background: var(--ok-bg); color: var(--ok); border: 1px solid var(--ok-border); }
    .status-badge.healthy::before { background: var(--ok); }
    .status-badge.issue { background: var(--err-bg); color: var(--err); border: 1px solid var(--err-border); }
    .status-badge.issue::before { background: #e11d48; }
    .status-badge.stopped { background: #f9fafb; color: #4b5563; border: 1px solid #d1d5db; }
    .status-badge.stopped::before { background: #6b7280; }
    .status-badge.changing { background: var(--warn-bg); color: var(--warn); border: 1px solid var(--warn-border); }
    .status-badge.changing::before { background: #f59e0b; animation: pulse .9s ease-in-out infinite; }

    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: .2; } }

    /* ── 紧凑视图 ── */
    .workspace.compact-mode .card {
      min-height: 92px;
    }
    .workspace.compact-mode .card-content {
      flex: 0;
      padding: 10px 12px 12px;
      gap: 0;
    }
    .workspace.compact-mode .probe-row,
    .workspace.compact-mode .command-row {
      display: none;
    }
    .workspace.compact-mode .probe-summary {
      display: inline-flex;
    }
    .workspace.compact-mode .card-actions button {
      height: 30px;
    }

    /* ── 日志面板 ── */
    .log-panel {
      position: sticky;
      top: calc(var(--topbar-h) + 20px);
      min-width: 0;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: #0b1024;
      overflow: hidden;
      opacity: 0;
      pointer-events: none;
      visibility: hidden;
      transform: translateX(16px);
      transition: transform .2s ease, opacity .16s ease, visibility .16s ease;
    }
    .workspace.log-open .log-panel {
      opacity: 1;
      pointer-events: auto;
      visibility: visible;
      transform: translateX(0);
    }
    .log-header {
      display: flex;
      align-items: center;
      gap: 8px;
      height: 42px;
      padding: 0 10px 0 14px;
      background: #0f1930;
      border-bottom: 1px solid rgba(200,214,255,.14);
    }
    .log-title {
      flex: 1;
      min-width: 0;
      font-size: 13px;
      font-weight: 700;
      color: #d8e4ff;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .log-controls { display: flex; gap: 5px; flex-shrink: 0; }
    .btn-log {
      padding: 3px 8px;
      font-size: 11px;
      font-weight: 700;
      background: rgba(255,255,255,.07);
      color: #a8bcff;
      border: 1px solid rgba(255,255,255,.1);
      border-radius: var(--radius-sm);
    }
    .btn-log:hover:not(:disabled) { background: rgba(255,255,255,.13); color: #c8d4ff; }
    .btn-log.active { background: rgba(79,117,255,.3); color: #a8c0ff; border-color: rgba(79,117,255,.4); }
    .btn-log-close {
      padding: 3px 8px;
      font-size: 16px;
      line-height: 1;
      background: transparent;
      color: rgba(200,214,255,.5);
      border: none;
    }
    .btn-log-close:hover:not(:disabled) { color: #d8e4ff; transform: none; }
    pre.log-box {
      margin: 0;
      padding: 12px 14px;
      height: calc(100vh - var(--topbar-h) - 20px - 42px - 2px);
      min-height: 200px;
      overflow: auto;
      font: 12px/1.65 Consolas, "SFMono-Regular", monospace;
      color: #c8d8f8;
      white-space: pre-wrap;
      word-break: break-all;
      user-select: text;
      background: transparent;
    }

    /* ── 반응형 ── */
    @media (max-width: 860px) {
      .main { padding: 16px; }
      .workspace, .workspace.log-open { grid-template-columns: 1fr; gap: 14px; }
      .log-panel { position: static; transform: none; opacity: 1; pointer-events: auto; visibility: visible; }
      .workspace:not(.log-open) .log-panel { display: none; }
      pre.log-box { height: 400px; }
    }
  </style>
</head>
<body>
  <header class="topbar">
    <div class="topbar-brand">Vxture Dev Panel <span>localhost · workspace</span></div>
    <div class="topbar-status" id="topbar-status">- / - 健康</div>
    <div class="topbar-progress" id="topbar-progress">正在启动…</div>
    <div class="topbar-gap"></div>
    <div class="topbar-actions">
      <button type="button" class="btn-tb primary" onclick="bulkAction('start')">全部启动</button>
      <button type="button" class="btn-tb"         onclick="bulkAction('restart')">全部重启</button>
      <button type="button" class="btn-tb"         onclick="bulkAction('stop')">全部停止</button>
      <button type="button" class="btn-tb" id="btn-view-mode" onclick="toggleViewMode()">压缩</button>
      <button type="button" class="btn-tb"         onclick="refreshOnce()">刷新</button>
    </div>
  </header>

  <main class="main">
    <div class="workspace" id="workspace">
      <section class="svc-panel" id="svc-panel"></section>
      <aside class="log-panel" id="log-panel" aria-live="polite">
        <div class="log-header">
          <div class="log-title" id="log-title">日志</div>
          <div class="log-controls">
            <button type="button" class="btn-log" id="btn-autoscroll" onclick="toggleAutoScroll()">自动滚动</button>
            <button type="button" class="btn-log" id="btn-copy-log" onclick="copyLog()">复制</button>
            <button type="button" class="btn-log" onclick="clearLog()">清除</button>
            <button type="button" class="btn-log-close" onclick="closeLog()" aria-label="关闭日志">×</button>
          </div>
        </div>
        <pre class="log-box" id="log-box">[点击卡片查看日志]</pre>
      </aside>
    </div>
  </main>

  <script>
    /* ── 状态 ── */
    let selectedId      = null;
    let latestServices  = [];
    let autoScroll      = true;
    let pollBusy        = false;
    let bulkBusy        = false;
    let bulkCurrentServiceId = null;
    let compactMode     = localStorage.getItem('dev-panel:view-mode') === 'compact';
    const pendingOps    = new Map();

    const GROUP_LABELS = { 0: 'P0 · 后端基础', 1: 'P1 · 网关聚合', 2: 'P2 · 前端应用' };

    /* ── 工具 ── */
    function esc(v) {
      return String(v)
        .replace(/&/g,'&amp;').replace(/</g,'&lt;')
        .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    async function req(path, options = {}) {
      const { ms = 5_000, ...rest } = options;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), ms);
      try {
        const res = await fetch(path, { ...rest, cache: 'no-store', signal: ctrl.signal, headers: { 'Content-Type': 'application/json', ...(rest.headers ?? {}) } });
        if (!res.ok) throw new Error(\`HTTP \${res.status}\`);
        return res.json();
      } finally {
        clearTimeout(timer);
      }
    }

    async function copyText(text) {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
      }
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      ta.style.top = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      if (!ok) throw new Error('copy failed');
    }

    function flashButton(btn, text = '✓') {
      if (!btn) return;
      const orig = btn.textContent;
      btn.textContent = text;
      setTimeout(() => { btn.textContent = orig; }, 1200);
    }

    /* ── 状态分类 ── */
    function statusCls(s)  {
      if (pendingOps.has(s.id) || bulkCurrentServiceId === s.id || s.stopping) return 'changing';
      if (s.listening && s.healthy) return 'healthy';
      if (s.listening && !s.healthy) return 'issue';
      if (s.running) return 'changing';
      return 'stopped';
    }
    function statusTxt(s) {
      const pendingAction = pendingOps.get(s.id);
      if (pendingAction) return actionLabel(pendingAction);
      if (bulkCurrentServiceId === s.id) return '启动中';
      if (s.stopping) return '停止中';
      if (s.listening && s.healthy) return '健康';
      if (s.listening && !s.healthy) return '未就绪';
      if (s.running)  return '启动中';
      return '已停止';
    }

    function actionLabel(action) {
      if (action === 'start') return '启动中';
      if (action === 'stop') return '停止中';
      if (action === 'restart') return '重启中';
      return '操作中';
    }

    function busyLabel(s) {
      const pendingAction = pendingOps.get(s.id);
      if (pendingAction) return actionLabel(pendingAction);
      if (bulkCurrentServiceId === s.id) return '启动中';
      if (s.stopping) return '停止中';
      if (s.running && (!s.listening || !s.healthy)) return '启动中';
      return '';
    }

    function probeCols(health) {
      return Math.max(1, Math.ceil((health?.length ?? 0) / 2));
    }

    function probeStats(health) {
      const checks = health ?? [];
      return { total: checks.length, bad: checks.filter((h) => !h.ok).length };
    }

    function shouldShowProbeIssue(s) {
      const probes = probeStats(s.health);
      return statusCls(s) === 'issue' && probes.bad > 0;
    }

    /* ── 渲染健康检查 ── */
    function renderChecks(health) {
      return health.map((h) => {
        const cls = h.ok ? 'ok' : 'bad';
        const dot = h.ok ? '●' : '○';
        const dur = h.durationMs != null ? \`<span class="dur">\${h.durationMs}ms</span>\` : '';
        return \`<span class="check \${cls}" title="\${esc(h.url ?? '')}">
          \${dot} \${esc(h.label)} \${h.status ?? '—'} \${dur}
        </span>\`;
      }).join('');
    }

    /* ── 渲染单张卡片 ── */
    function renderCard(s) {
      const cls  = statusCls(s);
      const txt  = statusTxt(s);
      const canStart  = !s.listening && !s.running && !s.stopping;
      const canStop   = s.listening || s.running || s.stopping;
      const sel = selectedId === s.id ? ' selected' : '';
      const busy = busyLabel(s);
      const busyCls = busy ? ' is-busy' : '';
      const stateCls = statusCls(s);
      const pid = s.pid ? \`PID <b>\${s.pid}</b>\` : '';
      const up  = s.uptime ? \`运行 <b>\${s.uptime}</b>\` : '';
      const meta = [pid, up].filter(Boolean).join(' · ');
      const probes = probeStats(s.health);
      const showProbeIssue = shouldShowProbeIssue(s);

      return \`
        <div class="card state-\${stateCls}\${sel}\${busyCls}" id="card-\${esc(s.id)}">
          <div class="card-head" onclick="toggleLog('\${esc(s.id)}')" title="打开/关闭日志">
            <span class="badge-p p\${s.priority}">P\${s.priority}</span>
            <span class="svc-name">\${esc(s.name)}</span>
            <span class="status-badge \${cls}">\${txt}</span>
            <span class="card-head-spacer"></span>
            <span class="svc-port">:\${s.port}</span>
            <span class="probe-summary" aria-label="探针总数和问题探针数">
              <span class="probe-issue-count\${showProbeIssue ? ' visible' : ''}" title="问题探针数量">\${probes.bad}/\${probes.total}</span>
            </span>
            <span class="busy-label">\${esc(busy)}</span>
          </div>
          <div class="card-content">
            <div class="probe-row">
              <div class="checks" style="--probe-cols: \${probeCols(s.health)}">\${renderChecks(s.health)}</div>
              <div class="svc-meta">\${meta}</div>
            </div>
            <div class="command-row">
              <code class="svc-cmd" title="\${esc(s.command)}">\${esc(s.command)}</code>
              <button type="button" class="btn-copy" onclick="copyCmd('\${esc(s.id)}')" title="复制命令">⎘</button>
            </div>
            <div class="card-actions">
              <button type="button" class="btn-start"
                \${canStart ? '' : 'disabled'}
                onclick="svcAction('\${esc(s.id)}','start')">启动</button>
              <button type="button" class="btn-stop"
                \${canStop ? '' : 'disabled'}
                onclick="svcAction('\${esc(s.id)}','stop')">停止</button>
              <button type="button" class="btn-restart"
                \${canStop ? '' : 'disabled'}
                onclick="svcAction('\${esc(s.id)}','restart')">重启</button>
              <button type="button" class="btn-open"
                onclick="window.open('\${esc(s.url)}','_blank')">打开</button>
            </div>
          </div>
        </div>
      \`;
    }

    /* ── 渲染带分组的服务列表 ── */
    function renderGroups(services) {
      const groups = {};
      for (const s of services) {
        (groups[s.priority] ??= []).push(s);
      }
      return Object.entries(groups)
        .sort(([a],[b]) => Number(a) - Number(b))
        .map(([p, svcs]) => \`
          <div class="group">
            <div class="group-header">
              <span class="group-label">\${esc(GROUP_LABELS[p] ?? 'P' + p)}</span>
              <div class="group-line"></div>
            </div>
            <div class="group-cards">
              \${svcs.map(renderCard).join('')}
            </div>
          </div>
        \`).join('');
    }

    /* ── 局部更新已有卡片（不破坏结构，不影响日志滚动） ── */
    function patchCard(s) {
      const card = document.getElementById('card-' + s.id);
      if (!card) return;

      card.classList.toggle('selected', selectedId === s.id);
      const busy = busyLabel(s);
      card.classList.toggle('is-busy', Boolean(busy));
      card.classList.remove('state-healthy', 'state-issue', 'state-stopped', 'state-changing');
      card.classList.add('state-' + statusCls(s));
      const busyEl = card.querySelector('.busy-label');
      if (busyEl) busyEl.textContent = busy;

      const badge = card.querySelector('.status-badge');
      if (badge) { badge.className = 'status-badge ' + statusCls(s); badge.textContent = statusTxt(s); }

      const probes = probeStats(s.health);
      const probeIssueEl = card.querySelector('.probe-issue-count');
      if (probeIssueEl) {
        probeIssueEl.textContent = \`\${probes.bad}/\${probes.total}\`;
        probeIssueEl.classList.toggle('visible', shouldShowProbeIssue(s));
      }

      const checksEl = card.querySelector('.checks');
      if (checksEl) {
        checksEl.style.setProperty('--probe-cols', String(probeCols(s.health)));
        checksEl.innerHTML = renderChecks(s.health);
      }

      const metaEl = card.querySelector('.svc-meta');
      if (metaEl) {
        const pid = s.pid ? \`PID <b>\${s.pid}</b>\` : '';
        const up  = s.uptime ? \`运行 <b>\${s.uptime}</b>\` : '';
        metaEl.innerHTML = [pid, up].filter(Boolean).join(' · ');
      }

      if (!pendingOps.has(s.id)) {
        const canStart = !s.listening && !s.running && !s.stopping;
        const canStop  = s.listening || s.running || s.stopping;
        const startBtn   = card.querySelector('.btn-start');
        const stopBtn    = card.querySelector('.btn-stop');
        const restartBtn = card.querySelector('.btn-restart');
        if (startBtn)   startBtn.disabled   = !canStart;
        if (stopBtn)    stopBtn.disabled    = !canStop;
        if (restartBtn) restartBtn.disabled = !canStop;
      }
    }

    /* ── 主渲染入口 ── */
    function render(services) {
      latestServices = services;

      /* 顶栏：健康汇总 */
      const healthy = services.filter((s) => s.listening && s.healthy).length;
      const statusEl = document.getElementById('topbar-status');
      if (statusEl) {
        statusEl.textContent = \`\${healthy} / \${services.length} 健康\`;
        statusEl.classList.toggle('all-ok', healthy === services.length);
      }

      /* 判断是否需要整体重建 */
      const panel   = document.getElementById('svc-panel');
      const cardIds = [...panel.querySelectorAll('.card')].map((el) => el.id);
      const newIds  = services.map((s) => 'card-' + s.id);
      const same    = cardIds.length === newIds.length && newIds.every((id, i) => id === cardIds[i]);

      if (!same) {
        panel.innerHTML = renderGroups(services);
      } else {
        for (const s of services) patchCard(s);
      }

      renderLog();
    }

    function isSelectingLogText(logBox) {
      const selection = window.getSelection?.();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) return false;
      const range = selection.getRangeAt(0);
      return logBox.contains(range.commonAncestorContainer);
    }

    /* ── 日志面板 ── */
    function renderLog() {
      const svc     = latestServices.find((s) => s.id === selectedId);
      const titleEl = document.getElementById('log-title');
      const logBox  = document.getElementById('log-box');
      const copyBtn = document.getElementById('btn-copy-log');
      if (!logBox) return;

      if (!svc) {
        if (titleEl) titleEl.textContent = '日志';
        if (copyBtn) copyBtn.disabled = true;
        if (logBox.textContent !== '[点击卡片查看日志]') logBox.textContent = '[点击卡片查看日志]';
        return;
      }

      const atBottom = logBox.scrollHeight - logBox.scrollTop - logBox.clientHeight < 40;
      const nextText = svc.logs.length ? svc.logs.join('\\n') : '[暂无日志]';
      if (titleEl) titleEl.textContent = \`\${svc.name}  :\${svc.port}\`;
      if (copyBtn) copyBtn.disabled = !svc.logs.length;
      if (logBox.textContent !== nextText && !isSelectingLogText(logBox)) {
        logBox.textContent = nextText;
        if ((autoScroll || atBottom) && svc.logs.length) logBox.scrollTop = logBox.scrollHeight;
      } else if ((autoScroll || atBottom) && svc.logs.length && !isSelectingLogText(logBox)) {
        logBox.scrollTop = logBox.scrollHeight;
      }
    }

    function select(id) {
      const workspace = document.getElementById('workspace');
      selectedId = id;
      workspace?.classList.add('log-open');
      document.querySelectorAll('.card').forEach((c) => c.classList.toggle('selected', c.id === 'card-' + id));
      renderLog();
    }

    function toggleLog(id) {
      if (selectedId === id && document.getElementById('workspace')?.classList.contains('log-open')) {
        closeLog();
        return;
      }
      select(id);
    }

    function closeLog() {
      selectedId = null;
      document.getElementById('workspace')?.classList.remove('log-open');
      document.querySelectorAll('.card').forEach((c) => c.classList.remove('selected'));
      renderLog();
    }

    async function clearLog() {
      if (!selectedId) return;
      try {
        await req('/api/service/' + selectedId + '/logs/clear', { method: 'POST' });
        /* 立即清空本地缓存 */
        const svc = latestServices.find((s) => s.id === selectedId);
        if (svc) svc.logs = [];
        renderLog();
      } catch { /* ignore */ }
    }

    async function copyLog() {
      const svc = latestServices.find((s) => s.id === selectedId);
      const text = (svc?.logs ?? []).join('\\n');
      if (!text) return;
      try {
        await copyText(text);
        flashButton(document.getElementById('btn-copy-log'));
      } catch { /* clipboard api not available */ }
    }

    function toggleAutoScroll() {
      autoScroll = !autoScroll;
      const btn = document.getElementById('btn-autoscroll');
      if (btn) btn.classList.toggle('active', autoScroll);
      if (autoScroll) {
        const logBox = document.getElementById('log-box');
        if (logBox) logBox.scrollTop = logBox.scrollHeight;
      }
    }

    function applyViewMode() {
      const workspace = document.getElementById('workspace');
      const btn = document.getElementById('btn-view-mode');
      workspace?.classList.toggle('compact-mode', compactMode);
      if (btn) btn.textContent = compactMode ? '全部' : '压缩';
    }

    function toggleViewMode() {
      compactMode = !compactMode;
      localStorage.setItem('dev-panel:view-mode', compactMode ? 'compact' : 'full');
      applyViewMode();
    }

    /* 手动上滚时关闭自动滚动 */
    document.getElementById('log-box')?.addEventListener('scroll', () => {
      const logBox = document.getElementById('log-box');
      if (!logBox) return;
      const atBottom = logBox.scrollHeight - logBox.scrollTop - logBox.clientHeight < 40;
      if (!atBottom && autoScroll) { autoScroll = false; document.getElementById('btn-autoscroll')?.classList.remove('active'); }
      else if (atBottom && !autoScroll) { autoScroll = true; document.getElementById('btn-autoscroll')?.classList.add('active'); }
    });

    /* ── 复制命令 ── */
    async function copyCmd(id) {
      const svc = latestServices.find((s) => s.id === id);
      if (!svc) return;
      try {
        await copyText(svc.command);
        flashButton(document.querySelector(\`#card-\${id} .btn-copy\`));
      } catch { /* clipboard api not available */ }
    }

    /* ── 加载服务列表 ── */
    async function loadServices() {
      const services = await req('/api/services');
      render(services);
    }

    async function loadStatus() {
      try {
        const status = await req('/api/status');
        const prog = document.getElementById('topbar-progress');
        if (!prog) return;
        if (status.bulkStarting) {
          const name = latestServices.find((s) => s.id === status.currentService)?.name ?? status.currentService ?? '';
          prog.textContent = \`正在启动: \${name}\`;
          prog.classList.add('visible');
          bulkCurrentServiceId = status.currentService ?? null;
        } else {
          prog.classList.remove('visible');
          bulkCurrentServiceId = null;
        }
        latestServices.forEach(patchCard);
      } catch { /* ignore */ }
    }

    async function refreshOnce() {
      try { await loadServices(); await loadStatus(); } catch { /* ignore */ }
    }

    /* ── 单个服务操作 ── */
    async function svcAction(id, action) {
      if (pendingOps.has(id)) return;
      pendingOps.set(id, action);
      const svc = latestServices.find((s) => s.id === id);
      if (svc) patchCard(svc);
      const card = document.getElementById('card-' + id);
      if (card) {
        card.classList.add('is-busy');
        const busyEl = card.querySelector('.busy-label');
        if (busyEl) busyEl.textContent = actionLabel(action);
        card.querySelectorAll('.btn-start,.btn-stop,.btn-restart').forEach((b) => b.disabled = true);
      }
      try {
        await req('/api/service/' + id + '/' + action, { method: 'POST', ms: 35_000 });
      } catch (err) {
        console.warn('[panel] svcAction error:', err);
      } finally {
        pendingOps.delete(id);
        await refreshOnce();
      }
    }

    /* ── 批量操作 ── */
    function setTopbarBusy(busy) {
      document.querySelectorAll('.topbar-actions button').forEach((b) => b.disabled = busy);
    }

    async function bulkAction(action) {
      if (bulkBusy) return;
      bulkBusy = true;
      setTopbarBusy(true);
      try {
        await req('/api/bulk/' + action, { method: 'POST', ms: action === 'stop' ? 120_000 : 10_000 });
        await refreshOnce();
        if (action !== 'stop') {
          /* 批量启动是异步的，多刷几次反映进度 */
          setTimeout(refreshOnce, 800);
          setTimeout(refreshOnce, 2500);
        }
      } catch (err) {
        console.warn('[panel] bulkAction error:', err);
      } finally {
        bulkBusy = false;
        setTopbarBusy(false);
      }
    }

    /* ── 初始化自动滚动按钮状态 ── */
    document.getElementById('btn-autoscroll')?.classList.add('active');
    applyViewMode();

    /* ── 首次加载 ── */
    refreshOnce();

    /* ── 轮询：每 1.5s 刷新服务，每 2s 刷新状态 ── */
    setInterval(async () => {
      if (pollBusy) return;
      pollBusy = true;
      try { await loadServices(); } finally { pollBusy = false; }
    }, 1500);
    setInterval(loadStatus, 2000);
  </script>
</body>
</html>`;
}

async function detectExistingPanel(port) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/status",
        method: "GET",
        timeout: 700,
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          if (res.statusCode !== 200) {
            finish(false);
            return;
          }
          try {
            const payload = JSON.parse(body);
            finish(Number.isInteger(payload?.total));
          } catch {
            finish(false);
          }
        });
      },
    );

    req.on("timeout", () => {
      req.destroy();
      finish(false);
    });
    req.on("error", () => finish(false));
    req.end();
  });
}

async function handleListenError(err) {
  if (err?.code !== "EADDRINUSE") {
    console.error(err);
    process.exit(1);
  }

  const existingPanel = await detectExistingPanel(PANEL_PORT);
  if (existingPanel) {
    console.log(
      `[dev-panel] already running at http://localhost:${PANEL_PORT}`,
    );
    process.exit(0);
  }

  console.error(
    `[dev-panel] port ${PANEL_PORT} is already in use by another process.`,
  );
  console.error(
    "[dev-panel] stop that process or set DEV_PANEL_PORT to a free port.",
  );
  process.exit(1);
}

async function startPanelServer() {
  const existingPanel = await detectExistingPanel(PANEL_PORT);
  if (existingPanel) {
    console.log(
      `[dev-panel] already running at http://localhost:${PANEL_PORT}`,
    );
    return;
  }

  server.on("error", (err) => {
    handleListenError(err).catch((error) => {
      console.error(error);
      process.exit(1);
    });
  });

  server.listen(PANEL_PORT, () => {
    console.log(
      `[dev-panel] http://localhost:${PANEL_PORT}  (ROOT_DIR: ${ROOT_DIR})`,
    );
  });
}

// ─── HTTP 路由 ─────────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const method = req.method ?? "GET";
  const url = new URL(
    req.url ?? "/",
    `http://${req.headers.host ?? "localhost"}`,
  );

  /* 面板页面 */
  if (method === "GET" && url.pathname === "/") {
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(pageHtml());
    return;
  }

  /* 服务快照列表 */
  if (method === "GET" && url.pathname === "/api/services") {
    const snaps = await Promise.all(SERVICES.map(getServiceSnapshot));
    sendJson(res, 200, orderForCards(snaps));
    return;
  }

  /* 全量启动进度状态 */
  if (method === "GET" && url.pathname === "/api/status") {
    sendJson(res, 200, {
      bulkStarting,
      currentService: bulkCurrentSvcId,
      total: SERVICES.length,
    });
    return;
  }

  /* 清除服务日志 */
  const clearMatch = url.pathname.match(
    /^\/api\/service\/([^/]+)\/logs\/clear$/,
  );
  if (method === "POST" && clearMatch) {
    const state = runtime.get(clearMatch[1]);
    if (state) state.logs = [];
    sendJson(res, 200, { status: "ok" });
    return;
  }

  /* 单个服务操作 */
  const svcMatch = url.pathname.match(
    /^\/api\/service\/([^/]+)\/(start|stop|restart)$/,
  );
  if (method === "POST" && svcMatch) {
    const [, serviceId, action] = svcMatch;
    const service = findService(serviceId);
    if (!service) {
      sendJson(res, 404, { message: "Service not found" });
      return;
    }
    try {
      if (action === "start") await startService(service);
      if (action === "stop") await stopService(service);
      if (action === "restart") {
        await stopService(service);
        await startService(service);
      }
    } catch (err) {
      sendJson(res, 500, { message: String(err?.message ?? err) });
      return;
    }
    sendJson(res, 200, { status: "ok" });
    return;
  }

  /* 批量操作 */
  const bulkMatch = url.pathname.match(/^\/api\/bulk\/(start|stop|restart)$/);
  if (method === "POST" && bulkMatch) {
    const action = bulkMatch[1];
    if (action === "start") {
      startAllOrdered().catch(() => {});
    } else if (action === "stop") {
      try {
        await stopAll();
      } catch (err) {
        sendJson(res, 500, { message: String(err?.message ?? err) });
        return;
      }
    } else if (action === "restart") {
      (async () => {
        await stopAll();
        await startAllOrdered();
      })().catch(() => {});
    }
    sendJson(res, 200, { status: "ok" });
    return;
  }

  sendJson(res, 404, { message: "Not found" });
});

startPanelServer().catch((err) => {
  console.error(err);
  process.exit(1);
});
