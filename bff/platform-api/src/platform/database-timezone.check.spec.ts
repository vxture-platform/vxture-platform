/**
 * database-timezone.check.spec.ts — 启动期的时区信号只记日志、不拒启、不阻塞。
 *
 * 四种坏法各一条:会话是 UTC(含 Etc/UTC 拼法)时不许误报;不是 UTC 时 error 级日志里
 * 必须点名那个时区;库读不到时记 error 但不抛;boot-smoke 下根本不碰池。
 */
import { Logger } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { DatabaseTimezoneCheck } from "./database-timezone.check";

function poolShowing(value: string | null): Pool & {
  query: ReturnType<typeof vi.fn>;
} {
  const rows = value === null ? [] : [{ TimeZone: value }];
  const query = vi.fn(async () => ({ rows, rowCount: rows.length }));
  return { query } as unknown as Pool & { query: ReturnType<typeof vi.fn> };
}

function poolThrowing(): Pool & { query: ReturnType<typeof vi.fn> } {
  const query = vi.fn(async () => {
    throw new Error("ECONNREFUSED");
  });
  return { query } as unknown as Pool & { query: ReturnType<typeof vi.fn> };
}

describe("DatabaseTimezoneCheck.check", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("UTC → 不报 error,返回观测值", async () => {
    const error = vi
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    expect(await new DatabaseTimezoneCheck(poolShowing("UTC")).check()).toBe(
      "UTC",
    );
    expect(error).not.toHaveBeenCalled();
  });

  it("Etc/UTC 是同一个默认的另一种拼法,也不报", async () => {
    const error = vi
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    await new DatabaseTimezoneCheck(poolShowing("Etc/UTC")).check();
    expect(error).not.toHaveBeenCalled();
  });

  it("Asia/Shanghai → error 级日志点名该时区,仍返回它、不抛", async () => {
    const error = vi
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => undefined);
    const zone = await new DatabaseTimezoneCheck(
      poolShowing("Asia/Shanghai"),
    ).check();
    expect(zone).toBe("Asia/Shanghai");
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]?.[0])).toContain("Asia/Shanghai");
    expect(String(error.mock.calls[0]?.[0])).toContain("ALTER DATABASE");
  });

  it("库读不到 → error 日志,返回 null,不抛", async () => {
    const error = vi
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => undefined);
    await expect(
      new DatabaseTimezoneCheck(poolThrowing()).check(),
    ).resolves.toBeNull();
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]?.[0])).toContain("ECONNREFUSED");
  });

  it("BOOT_SMOKE=1 下 onApplicationBootstrap 不碰池", () => {
    const prev = process.env["BOOT_SMOKE"];
    process.env["BOOT_SMOKE"] = "1";
    try {
      const pool = poolShowing("Asia/Shanghai");
      new DatabaseTimezoneCheck(pool).onApplicationBootstrap();
      expect(pool.query).not.toHaveBeenCalled();
    } finally {
      if (prev === undefined) delete process.env["BOOT_SMOKE"];
      else process.env["BOOT_SMOKE"] = prev;
    }
  });
});
