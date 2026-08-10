/**
 * atlas.ts — Atlas 域演示数据。
 *
 * 界面先行、功能排期（owner 2026-08-03）：页面全部以本文件的静态数据渲染，
 * 后续接 BFF 时替换取数层即可，页面结构不动。数据形状照抄
 * docs/opera-atlas-design.md 的接口定义。
 */

import type { KeyStatus, LogLevel, ResourceStatus } from "@/lib/status";

export interface ProviderRow {
  id: string;
  code: string;
  name: string;
  status: ResourceStatus;
  region: string;
  proxy: string;
  models: number;
  latencyMs: number;
  successRate: string;
}

export const providers: ProviderRow[] = [
  {
    id: "p-openai",
    code: "openai",
    name: "OpenAI",
    status: "active",
    region: "us",
    proxy: "egress-us-1",
    models: 6,
    latencyMs: 420,
    successRate: "99.6%",
  },
  {
    id: "p-anthropic",
    code: "anthropic",
    name: "Anthropic",
    status: "active",
    region: "us",
    proxy: "egress-us-1",
    models: 4,
    latencyMs: 380,
    successRate: "99.8%",
  },
  {
    id: "p-google",
    code: "google",
    name: "Google",
    status: "degraded",
    region: "us",
    proxy: "egress-us-2",
    models: 3,
    latencyMs: 940,
    successRate: "97.1%",
  },
  {
    id: "p-deepseek",
    code: "deepseek",
    name: "DeepSeek",
    status: "active",
    region: "cn",
    proxy: "direct",
    models: 2,
    latencyMs: 210,
    successRate: "99.9%",
  },
  {
    id: "p-qwen",
    code: "qwen",
    name: "Qwen",
    status: "active",
    region: "cn",
    proxy: "direct",
    models: 5,
    latencyMs: 180,
    successRate: "99.7%",
  },
  {
    id: "p-glm",
    code: "glm",
    name: "GLM",
    status: "disabled",
    region: "cn",
    proxy: "direct",
    models: 0,
    latencyMs: 0,
    successRate: "—",
  },
];

export interface ModelRow {
  id: string;
  code: string;
  name: string;
  provider: string;
  version: string;
  contextWindow: string;
  capabilities: string[];
  status: ResourceStatus;
}

export const models: ModelRow[] = [
  {
    id: "m-1",
    code: "gpt-5",
    name: "GPT-5",
    provider: "OpenAI",
    version: "2026-05",
    contextWindow: "400K",
    capabilities: ["Chat", "Reasoning", "Vision", "Tool Calling"],
    status: "active",
  },
  {
    id: "m-2",
    code: "gpt-5-mini",
    name: "GPT-5 Mini",
    provider: "OpenAI",
    version: "2026-05",
    contextWindow: "200K",
    capabilities: ["Chat", "Tool Calling"],
    status: "active",
  },
  {
    id: "m-3",
    code: "claude-opus",
    name: "Claude Opus",
    provider: "Anthropic",
    version: "4.6",
    contextWindow: "500K",
    capabilities: ["Chat", "Reasoning", "Vision", "Tool Calling"],
    status: "active",
  },
  {
    id: "m-4",
    code: "claude-sonnet",
    name: "Claude Sonnet",
    provider: "Anthropic",
    version: "4.6",
    contextWindow: "500K",
    capabilities: ["Chat", "Reasoning", "Tool Calling"],
    status: "active",
  },
  {
    id: "m-5",
    code: "gemini-3",
    name: "Gemini 3",
    provider: "Google",
    version: "3.0",
    contextWindow: "1M",
    capabilities: ["Chat", "Vision", "Audio", "Video"],
    status: "degraded",
  },
  {
    id: "m-6",
    code: "deepseek-r1",
    name: "DeepSeek R1",
    provider: "DeepSeek",
    version: "r1",
    contextWindow: "128K",
    capabilities: ["Chat", "Reasoning"],
    status: "active",
  },
  {
    id: "m-7",
    code: "qwen-max",
    name: "Qwen Max",
    provider: "Qwen",
    version: "3.5",
    contextWindow: "256K",
    capabilities: ["Chat", "Reasoning", "Embedding"],
    status: "active",
  },
  {
    id: "m-8",
    code: "text-embedding-4",
    name: "Text Embedding 4",
    provider: "OpenAI",
    version: "4",
    contextWindow: "8K",
    capabilities: ["Embedding"],
    status: "active",
  },
];

export interface EndpointRow {
  id: string;
  code: string;
  category: string;
  primaryModel: string;
  fallbackModel: string | null;
  enabled: boolean;
  qps: number;
}

export const endpoints: EndpointRow[] = [
  {
    id: "e-1",
    code: "chat/default",
    category: "Chat",
    primaryModel: "gpt-5",
    fallbackModel: "claude-opus",
    enabled: true,
    qps: 42,
  },
  {
    id: "e-2",
    code: "reasoning/default",
    category: "Reasoning",
    primaryModel: "claude-opus",
    fallbackModel: "deepseek-r1",
    enabled: true,
    qps: 11,
  },
  {
    id: "e-3",
    code: "embedding/default",
    category: "Embedding",
    primaryModel: "text-embedding-4",
    fallbackModel: null,
    enabled: true,
    qps: 87,
  },
  {
    id: "e-4",
    code: "vision/default",
    category: "Vision",
    primaryModel: "gemini-3",
    fallbackModel: "gpt-5",
    enabled: true,
    qps: 6,
  },
  {
    id: "e-5",
    code: "audio/default",
    category: "Audio",
    primaryModel: "gemini-3",
    fallbackModel: null,
    enabled: false,
    qps: 0,
  },
];

export interface ApiKeyRow {
  id: string;
  name: string;
  kind: "internal" | "external";
  owner: string;
  prefix: string;
  status: KeyStatus;
  lastUsed: string;
  createdAt: string;
}

export const apiKeys: ApiKeyRow[] = [
  {
    id: "k-1",
    name: "runos-engine",
    kind: "internal",
    owner: "Runos",
    prefix: "vxk_int_9f2…",
    status: "active",
    lastUsed: "2 分钟前",
    createdAt: "2026-06-01",
  },
  {
    id: "k-2",
    name: "arda-service",
    kind: "internal",
    owner: "Arda",
    prefix: "vxk_int_b41…",
    status: "active",
    lastUsed: "8 分钟前",
    createdAt: "2026-06-01",
  },
  {
    id: "k-3",
    name: "varda-assistant",
    kind: "internal",
    owner: "Varda",
    prefix: "vxk_int_c07…",
    status: "active",
    lastUsed: "1 小时前",
    createdAt: "2026-06-14",
  },
  {
    id: "k-4",
    name: "partner-lab",
    kind: "external",
    owner: "外部合作方",
    prefix: "vxk_ext_55a…",
    status: "disabled",
    lastUsed: "3 天前",
    createdAt: "2026-07-02",
  },
  {
    id: "k-5",
    name: "legacy-probe",
    kind: "external",
    owner: "已下线探针",
    prefix: "vxk_ext_d19…",
    status: "revoked",
    lastUsed: "30 天前",
    createdAt: "2026-05-11",
  },
];

export interface MeteringRow {
  id: string;
  dimension: string;
  requests: string;
  inputTokens: string;
  outputTokens: string;
  avgTtftMs: number;
  rawCost: string;
}

export const meteringByProvider: MeteringRow[] = [
  {
    id: "mt-1",
    dimension: "OpenAI",
    requests: "1,284,003",
    inputTokens: "2.41B",
    outputTokens: "812M",
    avgTtftMs: 310,
    rawCost: "$12,406",
  },
  {
    id: "mt-2",
    dimension: "Anthropic",
    requests: "934,110",
    inputTokens: "1.87B",
    outputTokens: "690M",
    avgTtftMs: 280,
    rawCost: "$10,982",
  },
  {
    id: "mt-3",
    dimension: "Google",
    requests: "201,554",
    inputTokens: "410M",
    outputTokens: "98M",
    avgTtftMs: 720,
    rawCost: "$1,204",
  },
  {
    id: "mt-4",
    dimension: "DeepSeek",
    requests: "1,772,900",
    inputTokens: "3.02B",
    outputTokens: "1.21B",
    avgTtftMs: 190,
    rawCost: "$3,377",
  },
  {
    id: "mt-5",
    dimension: "Qwen",
    requests: "655,320",
    inputTokens: "1.11B",
    outputTokens: "402M",
    avgTtftMs: 170,
    rawCost: "$1,911",
  },
];

export const meteringByModel: MeteringRow[] = [
  {
    id: "mt-m1",
    dimension: "gpt-5",
    requests: "902,441",
    inputTokens: "1.82B",
    outputTokens: "604M",
    avgTtftMs: 330,
    rawCost: "$9,880",
  },
  {
    id: "mt-m2",
    dimension: "claude-opus",
    requests: "611,207",
    inputTokens: "1.31B",
    outputTokens: "498M",
    avgTtftMs: 290,
    rawCost: "$8,204",
  },
  {
    id: "mt-m3",
    dimension: "deepseek-r1",
    requests: "1,772,900",
    inputTokens: "3.02B",
    outputTokens: "1.21B",
    avgTtftMs: 190,
    rawCost: "$3,377",
  },
  {
    id: "mt-m4",
    dimension: "qwen-max",
    requests: "655,320",
    inputTokens: "1.11B",
    outputTokens: "402M",
    avgTtftMs: 170,
    rawCost: "$1,911",
  },
  {
    id: "mt-m5",
    dimension: "text-embedding-4",
    requests: "1,204,880",
    inputTokens: "1.44B",
    outputTokens: "0",
    avgTtftMs: 40,
    rawCost: "$412",
  },
];

export const meteringByEndpoint: MeteringRow[] = [
  {
    id: "mt-e1",
    dimension: "chat/default",
    requests: "2,410,663",
    inputTokens: "4.92B",
    outputTokens: "1.88B",
    avgTtftMs: 280,
    rawCost: "$18,220",
  },
  {
    id: "mt-e2",
    dimension: "reasoning/default",
    requests: "588,102",
    inputTokens: "1.71B",
    outputTokens: "902M",
    avgTtftMs: 610,
    rawCost: "$9,104",
  },
  {
    id: "mt-e3",
    dimension: "embedding/default",
    requests: "1,204,880",
    inputTokens: "1.44B",
    outputTokens: "0",
    avgTtftMs: 40,
    rawCost: "$412",
  },
  {
    id: "mt-e4",
    dimension: "vision/default",
    requests: "201,554",
    inputTokens: "410M",
    outputTokens: "98M",
    avgTtftMs: 720,
    rawCost: "$1,204",
  },
];

export const meteringByTenant: MeteringRow[] = [
  {
    id: "mt-t1",
    dimension: "Arda",
    requests: "1,908,220",
    inputTokens: "3.71B",
    outputTokens: "1.42B",
    avgTtftMs: 260,
    rawCost: "$13,902",
  },
  {
    id: "mt-t2",
    dimension: "Runos",
    requests: "1,402,551",
    inputTokens: "2.88B",
    outputTokens: "1.01B",
    avgTtftMs: 310,
    rawCost: "$10,118",
  },
  {
    id: "mt-t3",
    dimension: "Varda",
    requests: "994,003",
    inputTokens: "1.62B",
    outputTokens: "588M",
    avgTtftMs: 240,
    rawCost: "$4,806",
  },
  {
    id: "mt-t4",
    dimension: "外部合作方",
    requests: "540,110",
    inputTokens: "600M",
    outputTokens: "192M",
    avgTtftMs: 350,
    rawCost: "$1,054",
  },
];

export interface LogRow {
  id: string;
  time: string;
  level: LogLevel;
  source: string;
  message: string;
  trace: string;
}

export const logs: LogRow[] = [
  {
    id: "l-1",
    time: "14:32:07",
    level: "error",
    source: "gateway",
    message: "provider google timeout after 30s (endpoint vision/default)",
    trace: "tr_8f21c",
  },
  {
    id: "l-2",
    time: "14:31:52",
    level: "warn",
    source: "router",
    message: "chat/default failover engaged: gpt-5 → claude-opus",
    trace: "tr_8f1e0",
  },
  {
    id: "l-3",
    time: "14:30:11",
    level: "info",
    source: "gateway",
    message: "key vxk_int_9f2 rate normalized (2.1k rpm)",
    trace: "tr_8ef99",
  },
  {
    id: "l-4",
    time: "14:28:45",
    level: "info",
    source: "metering",
    message: "hourly rollup complete: 214,006 requests aggregated",
    trace: "tr_8ee71",
  },
  {
    id: "l-5",
    time: "14:27:03",
    level: "warn",
    source: "health",
    message: "provider google latency p95 940ms (threshold 800ms)",
    trace: "tr_8ed15",
  },
  {
    id: "l-6",
    time: "14:25:40",
    level: "info",
    source: "registry",
    message: "model qwen-max version 3.5 published",
    trace: "tr_8ec02",
  },
  {
    id: "l-7",
    time: "14:24:18",
    level: "error",
    source: "gateway",
    message: "key vxk_ext_55a rejected: key disabled",
    trace: "tr_8eb80",
  },
  {
    id: "l-8",
    time: "14:22:59",
    level: "info",
    source: "router",
    message: "embedding/default single route resolved: text-embedding-4",
    trace: "tr_8ea44",
  },
  {
    id: "l-9",
    time: "14:21:07",
    level: "warn",
    source: "metering",
    message: "cost lookup missed for model gemini-3, fell back to list price",
    trace: "tr_8e912",
  },
  {
    id: "l-10",
    time: "14:19:33",
    level: "info",
    source: "health",
    message: "probe cycle complete: 23/24 providers healthy",
    trace: "tr_8e7f1",
  },
];

export interface AuditRow {
  id: string;
  time: string;
  actor: string;
  action: string;
  target: string;
  detail: string;
}

export const auditTrail: AuditRow[] = [
  {
    id: "a-1",
    time: "2026-08-03 13:58",
    actor: "op-chen",
    action: "Router 变更",
    target: "chat/default",
    detail: "fallback claude-sonnet → claude-opus",
  },
  {
    id: "a-2",
    time: "2026-08-03 11:24",
    actor: "op-chen",
    action: "Key 轮换",
    target: "runos-engine",
    detail: "internal key rotated (vxk_int_8d1 → 9f2)",
  },
  {
    id: "a-3",
    time: "2026-08-02 19:41",
    actor: "op-liu",
    action: "Provider 禁用",
    target: "GLM",
    detail: "quota exhausted, disabled until renewal",
  },
  {
    id: "a-4",
    time: "2026-08-02 16:03",
    actor: "op-liu",
    action: "Model 注册",
    target: "qwen-max",
    detail: "version 3.5, capabilities +Embedding",
  },
  {
    id: "a-5",
    time: "2026-08-01 10:12",
    actor: "op-chen",
    action: "Endpoint 停用",
    target: "audio/default",
    detail: "no consumer, disabled",
  },
];

/** Opera 六域，opera-top-level-design.md §2.1。授权域是它们的子集。 */
export const OPERA_DOMAINS = [
  "Resource",
  "Runtime",
  "Metering",
  "Delivery",
  "Observability",
  "Security",
] as const;

export type OperaDomain = (typeof OPERA_DOMAINS)[number];

export interface RoleRow {
  id: string;
  role: string;
  domains: OperaDomain[];
  permissions: string;
}

export const roles: RoleRow[] = [
  {
    id: "r-1",
    role: "Platform Admin",
    domains: [...OPERA_DOMAINS],
    permissions: "读写 + 授权管理",
  },
  {
    id: "r-2",
    role: "Operator",
    domains: ["Resource", "Runtime", "Security"],
    permissions: "读写",
  },
  {
    id: "r-3",
    role: "Developer",
    domains: ["Resource", "Observability"],
    permissions: "读 + 受限写",
  },
  {
    id: "r-4",
    role: "Viewer",
    domains: [...OPERA_DOMAINS],
    permissions: "只读",
  },
];

export interface MemberRow {
  id: string;
  name: string;
  handle: string;
  roleId: string;
}

export const members: MemberRow[] = [
  { id: "u-1", name: "陈平", handle: "op-chen", roleId: "r-1" },
  { id: "u-2", name: "刘岸", handle: "op-liu", roleId: "r-1" },
  { id: "u-3", name: "赵岐", handle: "op-zhao", roleId: "r-2" },
  { id: "u-4", name: "孙珂", handle: "op-sun", roleId: "r-2" },
  { id: "u-5", name: "周砚", handle: "dev-zhou", roleId: "r-3" },
  { id: "u-6", name: "吴桐", handle: "dev-wu", roleId: "r-3" },
  { id: "u-7", name: "郑霖", handle: "dev-zheng", roleId: "r-3" },
  { id: "u-8", name: "钱菲", handle: "view-qian", roleId: "r-4" },
];
