import type { VxConfigService } from "@vxture/core-config";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  MockOrganizationRepository,
  PgOrganizationRepository,
} from "../repository";
import { resolveOrganizationRepository } from "./organization.module";

/**
 * 只钉本模块的接线；fail-closed 矩阵见 core-utils `dev-fallback.utils.spec.ts`。
 */
const pg = { kind: "pg" } as unknown as PgOrganizationRepository;
const mock = { kind: "mock" } as unknown as MockOrganizationRepository;

afterEach(() => vi.unstubAllEnvs());

describe("resolveOrganizationRepository 接线", () => {
  it("生产 + 缺库配置 → 抛错点名 OrganizationModule；有 DB_PASSWORD 则走 Pg", () => {
    vi.stubEnv("NODE_ENV", "production");
    const empty = { database: {} } as unknown as Pick<
      VxConfigService,
      "database"
    >;
    const withPassword = { database: { DB_PASSWORD: "x" } } as unknown as Pick<
      VxConfigService,
      "database"
    >;
    expect(() => resolveOrganizationRepository(empty, pg, mock)).toThrow(
      /OrganizationModule.*MockOrganizationRepository/,
    );
    expect(resolveOrganizationRepository(withPassword, pg, mock)).toBe(pg);
  });
});
