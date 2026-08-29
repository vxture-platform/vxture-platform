import { Logger } from "@nestjs/common";
import type { VxConfigService } from "@vxture/core-config";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MockUserRepository, PgUserRepository } from "../repository";
import { resolveUserRepository } from "./account.module";

/**
 * 只钉本模块的接线（模块名、"配置齐"的判据、回退到谁）；生产 fail-closed 的完整
 * 矩阵在 core-utils `dev-fallback.utils.spec.ts` 证过一次，这里不复制。
 */
const pg = { kind: "pg" } as unknown as PgUserRepository;
const mock = { kind: "mock" } as unknown as MockUserRepository;
const config = (database: object) =>
  ({ database }) as unknown as Pick<VxConfigService, "database">;

afterEach(() => vi.unstubAllEnvs());

describe("resolveUserRepository 接线", () => {
  it("DATABASE_URL 或 DB_PASSWORD 任一在场即算配置齐 → PgUserRepository", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(
      resolveUserRepository(
        config({ DATABASE_URL: "postgresql://db" }),
        pg,
        mock,
      ),
    ).toBe(pg);
    expect(
      resolveUserRepository(config({ DB_PASSWORD: "s3cret" }), pg, mock),
    ).toBe(pg);
  });

  it("生产 + 两者均空 → 抛错点名 AccountModule 与两个变量", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(() => resolveUserRepository(config({}), pg, mock)).toThrow(
      /AccountModule.*DATABASE_URL.*DB_PASSWORD.*MockUserRepository/,
    );
  });

  it("非生产 + 两者均空 → MockUserRepository，经 AccountModule 的 Logger 告警", () => {
    vi.stubEnv("NODE_ENV", "development");
    const warn = vi
      .spyOn(Logger.prototype, "warn")
      .mockImplementation(() => undefined);
    expect(resolveUserRepository(config({}), pg, mock)).toBe(mock);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
