import { describe, expect, it } from "vitest";
import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import type { RequestContext } from "../types/console.types";
import {
  assertAnyCapability,
  evaluateAccessPolicy,
  holdsAnyCapability,
  type AccessPolicy,
} from "./capability";

function req(partial: Partial<RequestContext> = {}): Request & RequestContext {
  return partial as Request & RequestContext;
}

const user = { id: "u1", name: "u", email: "u@x", roleLabel: "" };
const tenant = {
  id: "t1",
  name: "t",
  mode: "tenant" as const,
  workspace: "default",
};

describe("evaluateAccessPolicy", () => {
  it("fails closed on an unannotated route", () => {
    expect(() =>
      evaluateAccessPolicy(undefined, req({ user, tenant }), "X.y"),
    ).toThrow(ForbiddenException);
    expect(() =>
      evaluateAccessPolicy(undefined, req({ user, tenant }), "X.y"),
    ).toThrow(/X\.y has no access policy/);
  });

  it("public passes without a session", () => {
    expect(evaluateAccessPolicy({ kind: "public" }, req())).toBe(true);
  });

  it("self requires a user but no capability", () => {
    expect(() => evaluateAccessPolicy({ kind: "self" }, req())).toThrow(
      UnauthorizedException,
    );
    expect(evaluateAccessPolicy({ kind: "self" }, req({ user }))).toBe(true);
  });

  it("capability requires user, tenant and one of the codes (manage implies read)", () => {
    const policy: AccessPolicy = {
      kind: "capability",
      anyOf: ["tenant.billing.read"],
    };
    expect(() => evaluateAccessPolicy(policy, req({ user }))).toThrow(
      UnauthorizedException,
    );
    expect(() =>
      evaluateAccessPolicy(policy, req({ user, tenant, capabilities: [] })),
    ).toThrow(ForbiddenException);
    expect(() =>
      evaluateAccessPolicy(
        policy,
        req({ user, tenant, capabilities: ["tenant.quota.read"] }),
      ),
    ).toThrow(/Missing capability: tenant\.billing\.read/);
    expect(
      evaluateAccessPolicy(
        policy,
        req({ user, tenant, capabilities: ["tenant.billing.manage"] }),
      ),
    ).toBe(true);
    expect(
      evaluateAccessPolicy(
        {
          kind: "capability",
          anyOf: ["tenant.member.manage", "tenant.role.assign"],
        },
        req({ user, tenant, capabilities: ["tenant.role.assign"] }),
      ),
    ).toBe(true);
  });

  it("helpers: assert throws, holds does not", () => {
    const r = req({ user, tenant, capabilities: ["tenant.member.read"] });
    expect(holdsAnyCapability(r, ["tenant.member.read"])).toBe(true);
    expect(holdsAnyCapability(r, ["tenant.member.manage"])).toBe(false);
    expect(() => assertAnyCapability(r, ["tenant.member.manage"])).toThrow(
      ForbiddenException,
    );
    expect(() => assertAnyCapability(r, ["tenant.member.read"])).not.toThrow();
  });
});
