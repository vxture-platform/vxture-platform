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
import type { RequestContext } from "../types/console.types";

export const OPERATOR_ID = "11111111-1111-4111-8111-111111111111";

export const MANAGE = ["platform.product.manage"];

export function makeReq(capabilities: string[]): Request & RequestContext {
  return {
    user: { id: OPERATOR_ID },
    capabilities,
    ip: "127.0.0.1",
    headers: {},
    socket: { remoteAddress: "127.0.0.1" },
  } as unknown as Request & RequestContext;
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
