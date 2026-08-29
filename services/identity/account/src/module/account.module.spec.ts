import { Logger } from "@nestjs/common";
import type { VxConfigService } from "@vxture/core-config";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MockUserRepository, PgUserRepository } from "../repository";
import { resolveUserRepository } from "./account.module";

/**
 * USER_REPOSITORY 选择器的 fail-closed 守卫（2026-08-30 审计）。
 *
 * 要证的不是「有库就用库」，而是那条反向的边：生产环境缺库配置时**必须抛**，
 * 不能让内置公开口令哈希的 MockUserRepository 静默顶上。同时钉住非生产的离线
 * 回退仍然可用——本地 / CI 没有库也要能起。
 *
 * 用假 config 与哨兵对象：这里验的是选择规则，不是 Pool 或仓库本身。
 * 生产判据是 NODE_ENV（不是 config.isProduction，见模块注释），所以用 stubEnv 拨它。
 */
const pg = { kind: "pg" } as unknown as PgUserRepository;
const mock = { kind: "mock" } as unknown as MockUserRepository;

const configWith = (database: {
  DATABASE_URL?: string;
  DB_PASSWORD?: string;
}) => ({ database }) as unknown as Pick<VxConfigService, "database">;

const warn = vi
  .spyOn(Logger.prototype, "warn")
  .mockImplementation(() => undefined);

afterEach(() => {
  vi.unstubAllEnvs();
  warn.mockClear();
});

describe("resolveUserRepository —— 生产环境 fail-closed", () => {
  it("生产 + DATABASE_URL / DB_PASSWORD 均为空 → 抛错，错误点名缺的变量与模块", () => {
    vi.stubEnv("NODE_ENV", "production");

    expect(() => resolveUserRepository(configWith({}), pg, mock)).toThrow(
      /AccountModule.*DATABASE_URL.*DB_PASSWORD/,
    );
    // 抛错就是全部：不能先告警再放行。
    expect(warn).not.toHaveBeenCalled();
  });

  it("生产 + 只有 DATABASE_URL → PgUserRepository", () => {
    vi.stubEnv("NODE_ENV", "production");

    expect(
      resolveUserRepository(
        configWith({ DATABASE_URL: "postgresql://u:p@db/vx" }),
        pg,
        mock,
      ),
    ).toBe(pg);
  });

  it("生产 + 只有 DB_PASSWORD（分项注入形态）→ PgUserRepository", () => {
    vi.stubEnv("NODE_ENV", "production");

    expect(
      resolveUserRepository(configWith({ DB_PASSWORD: "s3cret" }), pg, mock),
    ).toBe(pg);
  });
});

describe("resolveUserRepository —— 非生产保留离线回退", () => {
  it.each(["development", "test"])(
    "NODE_ENV=%s + 缺库配置 → MockUserRepository，并告警一次",
    (nodeEnv) => {
      vi.stubEnv("NODE_ENV", nodeEnv);

      expect(resolveUserRepository(configWith({}), pg, mock)).toBe(mock);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toMatch(/MockUserRepository/);
    },
  );

  it("非生产 + 有库配置 → PgUserRepository，不告警", () => {
    vi.stubEnv("NODE_ENV", "development");

    expect(
      resolveUserRepository(configWith({ DB_PASSWORD: "dev" }), pg, mock),
    ).toBe(pg);
    expect(warn).not.toHaveBeenCalled();
  });
});
