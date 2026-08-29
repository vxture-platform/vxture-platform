import { Logger } from "@nestjs/common";
import type { VxConfigService } from "@vxture/core-config";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  MockOrganizationRepository,
  PgOrganizationRepository,
} from "../repository";
import { resolveOrganizationRepository } from "./organization.module";

/**
 * ORGANIZATION_REPOSITORY 选择器的 fail-closed 守卫（2026-08-30 审计）。
 *
 * 生产环境缺库配置时**必须抛**，不能让进程内假数据的 MockOrganizationRepository
 * 静默顶上；非生产的离线回退仍要可用。用假 config 与哨兵对象，验的是选择规则。
 * 生产判据是 NODE_ENV（不是 config.isProduction，见模块注释），所以用 stubEnv 拨它。
 */
const pg = { kind: "pg" } as unknown as PgOrganizationRepository;
const mock = { kind: "mock" } as unknown as MockOrganizationRepository;

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

describe("resolveOrganizationRepository —— 生产环境 fail-closed", () => {
  it("生产 + DATABASE_URL / DB_PASSWORD 均为空 → 抛错，错误点名缺的变量与模块", () => {
    vi.stubEnv("NODE_ENV", "production");

    expect(() =>
      resolveOrganizationRepository(configWith({}), pg, mock),
    ).toThrow(/OrganizationModule.*DATABASE_URL.*DB_PASSWORD/);
    expect(warn).not.toHaveBeenCalled();
  });

  it("生产 + 有 DATABASE_URL 或 DB_PASSWORD → PgOrganizationRepository", () => {
    vi.stubEnv("NODE_ENV", "production");

    expect(
      resolveOrganizationRepository(
        configWith({ DATABASE_URL: "postgresql://u:p@db/vx" }),
        pg,
        mock,
      ),
    ).toBe(pg);
    expect(
      resolveOrganizationRepository(
        configWith({ DB_PASSWORD: "s3cret" }),
        pg,
        mock,
      ),
    ).toBe(pg);
  });
});

describe("resolveOrganizationRepository —— 非生产保留离线回退", () => {
  it.each(["development", "test"])(
    "NODE_ENV=%s + 缺库配置 → MockOrganizationRepository，并告警一次",
    (nodeEnv) => {
      vi.stubEnv("NODE_ENV", nodeEnv);

      expect(resolveOrganizationRepository(configWith({}), pg, mock)).toBe(
        mock,
      );
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toMatch(
        /MockOrganizationRepository/,
      );
    },
  );

  it("非生产 + 有库配置 → PgOrganizationRepository，不告警", () => {
    vi.stubEnv("NODE_ENV", "development");

    expect(
      resolveOrganizationRepository(
        configWith({ DB_PASSWORD: "dev" }),
        pg,
        mock,
      ),
    ).toBe(pg);
    expect(warn).not.toHaveBeenCalled();
  });
});
