/**
 * denied-audit.ts — 被拒的写操作也要留痕（product_251 X-3）。
 * @package @vxture/bff-opera
 * @layer BFF
 *
 * ## 为什么单独一层
 *
 * `audit-log.ts` 记的是**成功路径**：审计行写在业务事务里，与写操作同生共死。那条纪律
 * 是对的，但它有个结构性后果——**凡是没走到 COMMIT 的，一条记录都没有**。实测（2026-08-16
 * 联调）：三次被拒的写操作对应 0 行审计；全库 `denied` 为零。
 *
 * 于是「谁试图做但被拒了」答不出来——而这恰恰是我们当天开给上游的
 * [`runos#119`](https://github.com/vxture/vxture-runos/issues/119) 的原话。Runos 是没有
 * `outcome` 字段，platform 是有字段但从不写，**对消费方是同一个盲区**。
 *
 * ## 口径：哪些拒绝值得留痕（owner 2026-08-16 拍板）
 *
 * **授权与状态机拒绝留痕，纯格式校验不留。**
 *
 * | 状态 | 记不记 | 为什么 |
 * | --- | --- | --- |
 * | 403 | **记** | 没有授权、step-up 未过——这是安全事实，正是审计存在的理由 |
 * | 409 | **记** | 状态机拒绝（终态只读、非法迁移、锁定字段）——「有人想改一个不该改的东西」 |
 * | 400 | 不记 | 参数写错。每个手滑都留一行会把审计表淹掉，而它不回答任何安全问题 |
 * | 401 | 不记 | **写不了**：`actor_id` 是 NOT NULL，而没有会话就没有主体。这类进访问日志，不进审计 |
 * | 404 | 不记 | 「对象不存在」不是拒绝 |
 * | 5xx | 不记 | 本方故障，进错误日志与栈，不是「谁试图做什么」 |
 *
 * ## 保真度：比成功路径低，这是诚实的说明不是免责
 *
 * 过滤器看得见的是 **HTTP**，不是领域动词。成功行能写 `governance.maintenance.start`，
 * 这里只能从路径推 `maintenance_window.start`。**能答的是「谁、对哪类对象、想做什么、
 * 被什么码拒了」**，答不了业务语义上的精确动作名。`error_code` 存封套里的码——那一格
 * 往往比 action 更有用（`NOT_ENTITLED` 与 `MAINTENANCE_WINDOW_READ_ONLY` 是两回事）。
 */
import { extractClientIp } from "@vxture/core-utils";
import type { Request } from "express";
import type { Pool } from "pg";
import type { RequestContext } from "../types/request-context";

/** 写方法才留痕：读操作全平台都不进审计。 */
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** 上表里「记」的那两档。 */
const DENIED_STATUSES = new Set([403, 409]);

/**
 * 路径首段 → 审计里的 `resource_type`。
 *
 * 显式映射而不是机械去复数：成功行写的是 `maintenance_window`（单数），两边对不上
 * 就等于查不到一起去——而「查得到一起」正是记这行的全部意义。未登记的段原样落，
 * 保证新路由不会因为忘了改这张表而**不留痕**（宁可类型名难看，不可无记录）。
 */
const RESOURCE_TYPES: Record<string, string> = {
  products: "product",
  "oidc-clients": "oidc_client",
  "maintenance-windows": "maintenance_window",
  "tenancy-directory": "tenancy_directory",
  atlas: "atlas_proxy",
  runos: "runos_proxy",
};

const HTTP_VERBS: Record<string, string> = {
  POST: "create",
  PUT: "replace",
  PATCH: "update",
  DELETE: "delete",
};

const UUID_LIKE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DENIED_AUDIT_INSERT_SQL = `
insert into support.audit_logs
  (actor_type, actor_console, actor_id, action, result, resource_type, resource_id, error_code, ip_address, user_agent)
values
  ('operator', 'opera', $1, $2, 'denied', $3, $4, $5, $6, $7)
`;

export function shouldAuditDenial(req: Request, status: number): boolean {
  return WRITE_METHODS.has(req.method) && DENIED_STATUSES.has(status);
}

/**
 * 写一行 `outcome='denied'`。
 *
 * **绝不抛**：这是错误响应之后的补记，业务事务早已回滚。留痕失败不能再把一个已经
 * 发出去的 4xx 变成 5xx——那是拿观测性去换可用性，方向反了。
 */
export async function insertDeniedAuditLog(
  pool: Pool,
  req: Request & RequestContext,
  code: string | undefined,
): Promise<void> {
  const actorId = req.operator?.id;
  if (!actorId) return; // 无主体写不了（actor_id NOT NULL）——见文件头表格里的 401 一行

  const { resourceType, resourceId, action } = describe(req);
  await pool.query(DENIED_AUDIT_INSERT_SQL, [
    actorId,
    action,
    resourceType,
    resourceId,
    truncate(code ?? null, 64),
    truncate(extractClientIp(req), 64),
    truncate(headerValue(req, "user-agent"), 512),
  ]);
}

/** 从 `/api/maintenance-windows/<uuid>/start` 推出对象类别、对象 id 与动作。 */
export function describe(req: Request): {
  resourceType: string;
  resourceId: string;
  action: string;
} {
  const path = (req.originalUrl ?? "").split("?")[0] ?? "";
  const segments = path
    .split("/")
    .filter((s) => s !== "" && s !== "api")
    .map((s) => decodeURIComponent(s));

  const head = segments[0] ?? "unknown";
  const resourceType = RESOURCE_TYPES[head] ?? head.replace(/-/g, "_");

  /* 对象 id 取第一个像 uuid 的段；没有就用第二段（如 client_id 这种可视码），
     再没有就 `-`——列是 NOT NULL，不能留空。 */
  const resourceId =
    segments.find((s) => UUID_LIKE.test(s)) ?? segments[1] ?? "-";

  /* 动作取末段（start / cancel / activate / state …）。三种情况要落回 HTTP 方法：
       · 只有一段（`POST /api/products` 这种集合级创建）——末段就是集合名本身，
         取了会推出 `product.products` 这种废话（单测第一次跑就抓到了这个）；
       · 末段就是对象 id——这是对对象本身的操作；
       · 末段是个 uuid——同上。 */
  const tail = segments[segments.length - 1] ?? "";
  const tailIsVerb =
    segments.length > 1 &&
    tail !== "" &&
    tail !== resourceId &&
    !UUID_LIKE.test(tail);
  const verb = tailIsVerb
    ? tail.replace(/-/g, "_")
    : (HTTP_VERBS[req.method] ?? req.method.toLowerCase());

  return { resourceType, resourceId, action: `${resourceType}.${verb}` };
}

function headerValue(req: Request, name: string): string | null {
  const value = req.headers?.[name];
  if (Array.isArray(value)) return value[0] ?? null;
  return typeof value === "string" ? value : null;
}

function truncate(value: string | null, max: number): string | null {
  if (!value) return null;
  return value.length > max ? value.slice(0, max) : value;
}
