/**
 * Captcha retries, popup closure and bounded sign-in continuation regressions.
 * @package @vxture/accounts
 * @layer Presentation
 * @category test
 * @author AI-Generated
 * @date 2026-11-16
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Button } from "@vxture/design-system";
import { useHumanCaptcha } from "./HumanCaptcha";

vi.mock("next-intl", () => ({
  useLocale: () => "zh-CN",
  useTranslations: () => (key: string) => key,
}));

// ============================================================================
// Provider boundary and sign-in continuation harness
// ============================================================================

type Options = Parameters<NonNullable<Window["initAliyunCaptcha"]>>[0];
let options: Options;
let host: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;
const continued = vi.fn();
const destroy = vi.fn();
const proof = "00000000-0000-4000-a000-000000000001";
function Harness() {
  const captcha = useHumanCaptcha("workforce", true);
  return (
    <>
      {captcha.node}
      <Button onClick={() => void captcha.verify().then(continued)}>
        Sign in
      </Button>
    </>
  );
}
function success() {
  return Response.json({ token: proof, expiresIn: 120 });
}
async function begin() {
  await act(async () => root.render(<Harness />));
  await act(async () => {
    [...host.querySelectorAll("button")]
      .find((button) => button.textContent === "Sign in")!
      .click();
  });
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  continued.mockReset();
  destroy.mockReset();
  fetchMock = vi.fn().mockResolvedValue(
    Response.json({
      enabled: true,
      sceneId: "scene",
      prefix: "prefix",
      region: "cn",
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  window.initAliyunCaptcha = (value) => {
    options = value;
    value.getInstance({ destroyCaptcha: destroy });
  };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  delete window.initAliyunCaptcha;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// ============================================================================
// Only server-approved proofs can continue the waiting sign-in
// ============================================================================

describe("captcha sign-in continuation", () => {
  it("continues the original sign-in after a rejected challenge is retried successfully", async () => {
    await begin();
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));
    await act(async () => {
      expect(await options.captchaVerifyCallback("rejected")).toEqual({
        captchaResult: false,
        bizResult: false,
      });
      options.onBizResultCallback(false);
    });
    expect(continued).not.toHaveBeenCalled();
    fetchMock.mockResolvedValueOnce(success());
    await act(async () => {
      await options.captchaVerifyCallback("accepted");
    });
    expect(continued).toHaveBeenCalledExactlyOnceWith(proof);
  });

  it("waits for server verification when the popup closes during the request", async () => {
    await begin();
    let finish!: (response: Response) => void;
    fetchMock.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
    );
    await act(async () => {
      const verification = options.captchaVerifyCallback("accepted");
      options.onClose?.();
      finish(success());
      await verification;
    });
    expect(continued).toHaveBeenCalledExactlyOnceWith(proof);
  });

  it("shares duplicate SDK callbacks without spending the same ceremony twice", async () => {
    await begin();
    let finish!: (response: Response) => void;
    fetchMock.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
    );
    await act(async () => {
      const first = options.captchaVerifyCallback("same-ceremony");
      const second = options.captchaVerifyCallback("same-ceremony");
      expect(fetchMock).toHaveBeenCalledTimes(2);
      finish(success());
      expect(await first).toEqual({ captchaResult: true, bizResult: true });
      expect(await second).toEqual({ captchaResult: true, bizResult: true });
      options.onBizResultCallback(false);
    });
    expect(continued).toHaveBeenCalledExactlyOnceWith(proof);
    expect(
      host
        .querySelector('[data-testid="human-captcha"]')
        ?.getAttribute("data-state"),
    ).toBe("verified");
  });

  it("cancels a closed popup when the outstanding verification is rejected", async () => {
    await begin();
    let finish!: (response: Response) => void;
    fetchMock.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
    );
    await act(async () => {
      const verification = options.captchaVerifyCallback("rejected");
      options.onClose?.();
      finish(new Response(null, { status: 401 }));
      await verification;
    });
    expect(continued).toHaveBeenCalledExactlyOnceWith(null);
  });

  it("does not resume sign-in with an invalid server proof", async () => {
    await begin();
    fetchMock.mockResolvedValueOnce(
      Response.json({ token: "invalid", expiresIn: 120 }),
    );
    await act(async () => {
      await options.captchaVerifyCallback("invalid-proof");
    });
    expect(continued).toHaveBeenCalledExactlyOnceWith(null);
  });

  it("cancels an idle popup and ignores callbacks from its destroyed instance", async () => {
    await begin();
    const old = options;
    await act(async () => old.onClose?.());
    expect(continued).toHaveBeenCalledExactlyOnceWith(null);
    const requests = fetchMock.mock.calls.length;
    await act(async () => {
      await old.captchaVerifyCallback("late");
    });
    expect(fetchMock).toHaveBeenCalledTimes(requests);
  });

  it("bounds retries to the original two-minute wait", async () => {
    await begin();
    await act(async () => vi.advanceTimersByTime(120000));
    expect(continued).toHaveBeenCalledExactlyOnceWith(null);
  });

  it("fails closed on a verification network failure", async () => {
    await begin();
    fetchMock.mockRejectedValueOnce(new TypeError("offline"));
    await act(async () => {
      await options.captchaVerifyCallback("network-failure");
    });
    expect(continued).toHaveBeenCalledExactlyOnceWith(null);
  });
});
