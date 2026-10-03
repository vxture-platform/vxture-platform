/**
 * pool-mocks.ts - pg Pool / PoolClient doubles for router write-path specs.
 * @package  @vxture/bff-admin
 * @layer    Application
 * @category testing
 * @description
 *   Shared by the products router specs. Three shapes cover every write path:
 *   a pool that must never be touched (guards run before DB access), a
 *   transaction client that records every statement and its outcome
 *   (commit / rollback / release), and a read-only pool that answers one
 *   fixed row set. Keeping them here means a new spec asserts the same
 *   "authorize first, roll back on failure" contract as the existing ones
 *   instead of re-describing the doubles.
 *
 * @author AI-Generated
 * @date 2026-08-31
 */
import { vi } from "vitest";
import type { Pool, PoolClient } from "pg";
import type { Request } from "express";
import type { NotificationDispatcher } from "@vxture/service-notification";
import type { RequestContext } from "../types/console.types";

export const OPERATOR_ID = "11111111-1111-4111-8111-111111111111";

/**
 * 产品域四条线的写码（2026-10-04 拆门后 products.router 逐入口判这些；此前是一个遗留
 * 扁平码 platform.product.manage）。既有用例只关心「有权的人走到哪一步」，所以给全。
 * 要写「门分开了」的反例，别用它——注入单独一条线的码，见 products-role-matrix.spec.ts。
 */
export const MANAGE = [
  "product:capability.manage",
  "product:solution.manage",
  "product:plan.manage",
  "product:price.manage",
];

export function makeReq(capabilities: string[]): Request & RequestContext {
  return {
    user: { id: OPERATOR_ID },
    capabilities,
    ip: "127.0.0.1",
    headers: {},
    socket: { remoteAddress: "127.0.0.1" },
  } as unknown as Request & RequestContext;
}

/**
 * 客户通知分发器的替身：记下每一次 `notify`，本身什么都不做。
 *
 * **只有这一个形状，没有「一调用就抛」的那一种。** 路由里的 emit 是 best-effort
 * （按设计吞掉异常），所以一个会抛的替身根本传不出信号——用它写「这条路径不该发」
 * 会变成一条永远绿的断言。要断言「不该发」就断言 `notify` 没被调用过。
 */
export function notifierSpy(): {
  notifier: NotificationDispatcher;
  notify: ReturnType<typeof vi.fn>;
} {
  const notify = vi.fn(async () => ({
    inboxCreated: 1,
    emailsSent: 0,
    emailsFailed: 0,
    smsSent: 0,
    smsFailed: 0,
    skipped: 0,
  }));
  return { notifier: { notify } as unknown as NotificationDispatcher, notify };
}

/** A pool whose every use throws — proves a guard fired before DB access. */
export function noDbPool(): { pool: Pool; connect: ReturnType<typeof vi.fn> } {
  const connect = vi.fn(() => {
    throw new Error("DB must not be touched");
  });
  const query = vi.fn(() => {
    throw new Error("DB must not be touched");
  });
  return { pool: { connect, query } as unknown as Pool, connect };
}

/** Answers a statement (lower-cased SQL + its parameters) with rows, or nothing. */
export type Responder = (
  sqlLower: string,
  params: readonly unknown[],
) => unknown[] | undefined;

export interface TxClientOutcome {
  committed: boolean;
  rolledBack: boolean;
  released: boolean;
}

/**
 * Transaction client double: records every statement (`calls`, in order, with
 * `params` parallel to it) and reports whether the unit committed or rolled
 * back and released its client.
 */
export function makeTxClient(responder?: Responder): {
  pool: Pool;
  calls: string[];
  params: unknown[][];
  outcome: () => TxClientOutcome;
} {
  const calls: string[] = [];
  const params: unknown[][] = [];
  const release = vi.fn();
  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    const text = String(sql);
    calls.push(text);
    params.push(values ?? []);
    const rows = responder?.(text.toLowerCase(), values ?? []);
    return { rows: rows ?? [], rowCount: rows?.length ?? 0 };
  });
  const client = { query, release } as unknown as PoolClient;
  const connect = vi.fn(async () => client);
  const pool = { connect, query: vi.fn() } as unknown as Pool;
  const outcome = (): TxClientOutcome => {
    const norm = calls.map((c) => c.trim().toLowerCase());
    return {
      committed: norm.includes("commit"),
      rolledBack: norm.includes("rollback"),
      released: release.mock.calls.length > 0,
    };
  };
  return { pool, calls, params, outcome };
}

/** Read-only pool that answers every query with the same rows. */
export function readerOf(rows: unknown[]): Pool {
  return { query: vi.fn(async () => ({ rows })) } as unknown as Pool;
}

/**
 * 从一条 INSERT 里按**列名**取参数值。
 *
 * ── 为什么要有它 ──
 * 2026-09-21：给审计表加了一列 `tenant_id`（第 2 位），于是后面每个占位符整体右移
 * 一位，五处写成 `audit[1]` / `audit[4]` 的断言当场全碎（两个文件、四条用例）。
 *
 * 碎了还算好的。真正的风险是**不碎**：`audit[4]` 原来指 resource_id，移位后指
 * resource_type，只要两边的值凑巧相近，断言会**带着错的含义继续通过**——那就成了
 * 「一致性守卫抓不到两边一样地错」的同一类毛病。
 *
 * 按名取值让这类断言对「加列」免疫：SQL 自己写着列序，测试从 SQL 里读，加一列
 * 两边同时变，不用人去对位置。
 *
 * 只认 `insert into <表> (a, b, c) values (...)` 这一种形状——审计与大多数写路径
 * 都是它。取不到就**抛**，不返回 undefined：断言拿到 undefined 会报成「值不对」，
 * 把「这个助手没看懂这条 SQL」伪装成「被测代码写错了」。
 */
export function insertParam(
  sql: string,
  values: unknown[],
  column: string,
): unknown {
  const shape =
    /insert\s+into\s+[\w."]+\s*\(([^)]*)\)\s*values\s*\(([^)]*)\)/i.exec(sql);
  if (!shape) {
    throw new Error(
      `insertParam: 这条 SQL 不是可识别的 INSERT ... VALUES，取不到列名：${sql.slice(0, 120)}`,
    );
  }
  const columns = shape[1]!.split(",").map((c) => c.trim().toLowerCase());
  const exprs = shape[2]!.split(",").map((e) => e.trim());
  if (columns.length !== exprs.length) {
    throw new Error(
      `insertParam: ${columns.length} 列对 ${exprs.length} 个值，对不上`,
    );
  }
  const index = columns.indexOf(column.toLowerCase());
  if (index < 0) {
    throw new Error(
      `insertParam: 列 ${column} 不在列表里（有 ${columns.join(", ")}）`,
    );
  }
  const placeholder = /^\$(\d+)/.exec(exprs[index]!);
  if (!placeholder) {
    throw new Error(
      `insertParam: 列 ${column} 写的是字面量 ${exprs[index]}，没有对应参数`,
    );
  }
  const at = Number(placeholder[1]) - 1;
  if (at >= values.length) {
    throw new Error(
      `insertParam: 列 ${column} 用 $${at + 1}，但只送了 ${values.length} 个参数`,
    );
  }
  return values[at];
}
