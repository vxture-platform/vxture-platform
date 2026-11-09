/**
 * Validate RP return targets and silent authentication parameters.
 * @package @vxture/workbench
 * @layer Presentation
 * @category test
 * @author AI-Generated
 * @date 2026-11-09
 */
import { describe, expect, it } from "vitest";
import { authNavigation } from "./navigation";

describe("workbench RP navigation", () => {
  it("preserves route and fragment without carrying untrusted query parameters", () => {
    const target = new URL(
      authNavigation(
        "login",
        "https://ruyin.work/apps?filter=all&vx_sso_silent=0#catalog",
        { prompt: "none" },
      ),
      "https://ruyin.work",
    );
    expect(target.pathname).toBe("/auth/login");
    expect(target.searchParams.get("returnTo")).toBe(
      "https://ruyin.work/apps#catalog",
    );
    expect(target.searchParams.get("prompt")).toBe("none");
  });
  it("does not permit arbitrary authorization parameters", () => {
    const target = new URL(
      authNavigation("login", "https://ruyin.work/", {
        prompt: "login",
        redirect_uri: "https://other.invalid",
        userId: "other",
      }),
      "https://ruyin.work",
    );
    expect([...target.searchParams.keys()]).toEqual(["returnTo"]);
  });
  it("never adds a login prompt or return target to logout", () => {
    expect(
      authNavigation("logout", "https://ruyin.work/apps", { prompt: "none" }),
    ).toBe("/auth/logout");
  });
  it("preserves explicit workspace switching", () => {
    const target = new URL(
      authNavigation("switch-workspace", "https://ruyin.work/apps", {
        workspaceId: "workspace",
        prompt: "none",
      }),
      "https://ruyin.work",
    );
    expect(target.searchParams.get("workspaceId")).toBe("workspace");
    expect(target.searchParams.has("prompt")).toBe(false);
  });
});
