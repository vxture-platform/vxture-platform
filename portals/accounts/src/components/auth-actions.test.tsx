/**
 * @vitest-environment jsdom
 * Authentication action geometry, recovery destinations and disabled behavior.
 * @package @vxture/accounts
 * @layer Presentation
 * @category test
 * @author AI-Generated
 * @date 2026-11-13
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ path: "/login", context: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => mocks.path }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("./AccountsChrome", () => ({
  AccountsHeader: () => null,
  AccountsFooter: () => null,
}));
vi.mock("./OidcLoginForm", () => ({ OidcLoginForm: () => null }));
vi.mock("@/api/customer-self", () => ({ accountsRequest: vi.fn() }));
vi.mock("@/api/oidc", () => ({
  fetchLoginContext: mocks.context,
  SessionExpiredError: class SessionExpiredError extends Error {},
}));
import { Button } from "@vxture/design-system";
import { SessionExpiredError } from "@/api/oidc";
import { AuthPrimaryButton, AuthResultPanel } from "./auth/AuthLogin";
import { LoginEntry } from "./LoginEntry";
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.path = "/login";
  mocks.context.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function show(node: React.ReactNode) {
  await act(async () => root.render(node));
}

// ============================================================================
// Forms and result pages share one action contract
// ============================================================================
describe("authentication actions", () => {
  it("keeps the form primary button full-width and rectangular when disabled or loading", async () => {
    for (const props of [
      { disabled: true, loading: false },
      { loading: true, disabled: false },
    ]) {
      await show(
        <AuthPrimaryButton
          label="Sign in"
          loadingLabel="Signing in"
          {...props}
        />,
      );
      const button = host.querySelector("button")!;
      expect(button.disabled).toBe(true);
      expect(button.className).toContain("h-control-3xl");
      expect(button.className).toContain("rounded-action");
      expect(button.className).toContain("w-full");
      expect(button.className).not.toContain("rounded-full");
    }
  });
  it.each(["customer", "workforce"] as const)(
    "offers a fresh %s login after challenge expiration",
    async (realm) => {
      mocks.context.mockRejectedValue(new SessionExpiredError());
      await show(
        <LoginEntry loginChallenge="expired-challenge" entryRealm={realm} />,
      );
      const link = host.querySelector("a[href]")!;
      expect(link.getAttribute("href")).toBe(
        realm === "workforce" ? "/workforce/login" : "/login",
      );
      expect(link.textContent).toBe("sign_in_again");
      expect(link.className).toContain("h-control-3xl");
      expect(link.getAttribute("href")).not.toContain("challenge");
    },
  );
  it("retries temporary failures without replacing the login challenge", async () => {
    mocks.context
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ realm: "customer" });
    await show(
      <LoginEntry loginChallenge="valid-challenge" entryRealm="customer" />,
    );
    const button = [...host.querySelectorAll("button")].find(
      (entry) => entry.textContent === "retry",
    )!;
    await act(async () => button.click());
    expect(mocks.context).toHaveBeenCalledTimes(2);
    expect(mocks.context).toHaveBeenLastCalledWith("valid-challenge");
  });
  it.each([
    ["/login", "danger", "/login"],
    ["/workforce/login", "danger", "/workforce/login"],
    ["/reset-password", "success", "/login"],
    ["/operator/reset-password", "success", "/workforce/login"],
    ["/account", "success", "/account"],
    ["/workforce/account", "success", "/workforce/account"],
  ] as const)(
    "provides a usable %s result destination",
    async (path, tone, href) => {
      mocks.path = path;
      await show(<AuthResultPanel tone={tone} title="Result" />);
      expect(host.querySelector("a")?.getAttribute("href")).toBe(href);
    },
  );
  it("keeps waiting pages free of premature navigation", async () => {
    await show(<AuthResultPanel tone="neutral" title="Waiting" />);
    expect(host.querySelector("a,button")).toBeNull();
  });
  it("preserves custom action behavior while normalizing result geometry", async () => {
    const click = vi.fn();
    await show(
      <AuthResultPanel
        title="Result"
        action={
          <Button size="lg" className="w-full" onClick={click}>
            Return to app
          </Button>
        }
      />,
    );
    const button = host.querySelector("button")!;
    await act(async () => button.click());
    expect(click).toHaveBeenCalledOnce();
    expect(button.className).toContain("h-control-3xl");
    expect(button.className).not.toContain("w-full");
    expect(host.querySelector("a")).toBeNull();
  });
});
