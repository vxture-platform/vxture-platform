import { describe, expect, it } from "vitest";
import { moduleAudFor } from "./oidc-auth.router";

describe("moduleAudFor (auth_request gate → operator-OBO audience)", () => {
  it("maps mounted module prefixes to their provider audience", () => {
    expect(moduleAudFor("/atlas")).toBe("atlas");
    expect(moduleAudFor("/atlas/")).toBe("atlas");
    expect(moduleAudFor("/atlas/providers?includeInactive=true")).toBe("atlas");
    expect(moduleAudFor("/runa/skills")).toBe("runa");
  });

  it("returns null for shell paths (no exchange on non-module requests)", () => {
    expect(moduleAudFor("/")).toBeNull();
    expect(moduleAudFor("/auth/session")).toBeNull();
    expect(moduleAudFor(undefined)).toBeNull();
  });

  it("does not treat lookalike prefixes as modules", () => {
    expect(moduleAudFor("/atlas-docs")).toBeNull();
    expect(moduleAudFor("/atlasx/foo")).toBeNull();
  });
});
