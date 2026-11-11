/**
 * Protect the account-center boundary and retained business routes.
 * @package @vxture/bff-console
 * @layer Application
 * @category test
 * @author AI-Generated
 * @date 2026-11-11
 */
import "reflect-metadata";
import { PATH_METADATA, METHOD_METADATA } from "@nestjs/common/constants";
import { UnauthorizedException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { MeRouter } from "./me.router";
import { IamRouter } from "./iam.router";
import { ACCESS_POLICY } from "../auth/capability";

describe("console personal management retirement", () => {
  it("does not allow tenant administrators to reset platform credentials", () => {
    const routes = Object.getOwnPropertyNames(IamRouter.prototype).map(
      (name) => {
        const handler: unknown = Object.getOwnPropertyDescriptor(
          IamRouter.prototype,
          name,
        )?.value;
        return typeof handler === "function"
          ? (Reflect.getMetadata(PATH_METADATA, handler) as string)
          : undefined;
      },
    );
    expect(routes).not.toContain("members/:memberId/reset-password");
  });
  it("exposes only the retained business routes", () => {
    const routes = Object.getOwnPropertyNames(MeRouter.prototype)
      .filter((name) => name !== "constructor")
      .map((name) => {
        const handler: unknown = Object.getOwnPropertyDescriptor(
          MeRouter.prototype,
          name,
        )?.value;
        return typeof handler === "function"
          ? (Reflect.getMetadata(PATH_METADATA, handler) as string)
          : undefined;
      })
      .filter((path) => path !== undefined);
    expect(routes.sort()).toEqual(
      [
        "/",
        "apps",
        "workspaces",
        "tenants/:tenantId/default",
        "tenants/:tenantId/logo",
        "notification-preferences",
        "notification-preferences",
        "organization",
        "organization",
        "organization/convert",
        "organization/closure",
        "organization/closure",
        "organization/logo",
        "organization/logo",
        "organization/logo",
      ].sort(),
    );
    expect(Reflect.getMetadata(ACCESS_POLICY, MeRouter)).toEqual({
      kind: "self",
    });
    expect(
      Reflect.getMetadata(METHOD_METADATA, MeRouter.prototype.setDefaultTenant),
    ).toBeDefined();
  });

  it("scopes memberships and default selection to the authenticated user", async () => {
    const session = {
      getMyWorkspaces: vi.fn().mockResolvedValue([]),
      setDefaultTenant: vi.fn(),
    };
    const router = new MeRouter(
      session as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const req = { user: { id: "self" }, tenant: { id: "active" } } as never;
    await router.getMyWorkspaces(req);
    await router.setDefaultTenant(req, "target");
    expect(session.getMyWorkspaces).toHaveBeenCalledWith("self", "active");
    expect(session.setDefaultTenant).toHaveBeenCalledWith("self", "target");
    await expect(router.getMyWorkspaces({} as never)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(
      router.setDefaultTenant({} as never, "target"),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("retains separate organization closure permissions", () => {
    for (const handler of [
      MeRouter.prototype.getTenantClosure,
      MeRouter.prototype.requestTenantClosure,
    ]) {
      expect(Reflect.getMetadata(ACCESS_POLICY, handler)).toEqual({
        kind: "capability",
        anyOf: ["tenant.delete"],
      });
    }
  });
});
