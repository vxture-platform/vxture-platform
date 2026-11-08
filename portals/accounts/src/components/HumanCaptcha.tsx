/**
 * Runtime-configured Aliyun Captcha 2.0 and bounded one-time proof lifecycle.
 * @package @vxture/accounts
 * @layer Presentation
 * @category component
 * @author AI-Generated
 * @date 2026-11-07
 */
"use client";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Button } from "@vxture/design-system";

type Realm = "customer" | "workforce";
type Config =
  | { enabled: false }
  | { enabled: true; sceneId: string; prefix: string; region: "cn" | "sgp" };
type Status = "loading" | "challenge" | "verified" | "disabled" | "error";
interface CaptchaInstance {
  destroy?: () => void;
}
interface CaptchaOptions {
  SceneId: string;
  prefix: string;
  region: "cn" | "sgp";
  mode: "embed";
  element: string;
  button: string;
  language: "cn";
  captchaVerifyCallback: (
    param: string,
  ) => Promise<{ captchaResult: boolean; bizResult: boolean }>;
  onBizResultCallback: (result: boolean) => void;
  getInstance: (instance: CaptchaInstance) => void;
}
declare global {
  interface Window {
    initAliyunCaptcha?: (options: CaptchaOptions) => void;
  }
}

// ============================================================================
// Shared SDK loading (failed loads can be retried)
// ============================================================================

const API_BASE =
  process.env.NEXT_PUBLIC_OIDC_API_BASE ?? "http://localhost:3081";
let sdkPromise: Promise<void> | undefined;
function loadSdk(): Promise<void> {
  if (window.initAliyunCaptcha) return Promise.resolve();
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src =
      "https://o.alicdn.com/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js";
    script.async = true;
    const timer = setTimeout(() => {
      script.remove();
      sdkPromise = undefined;
      reject(new Error("timeout"));
    }, 12000);
    script.onload = () => {
      clearTimeout(timer);
      if (window.initAliyunCaptcha) resolve();
      else {
        sdkPromise = undefined;
        script.remove();
        reject(new Error("sdk_unavailable"));
      }
    };
    script.onerror = () => {
      clearTimeout(timer);
      sdkPromise = undefined;
      script.remove();
      reject(new Error("script_unavailable"));
    };
    document.head.appendChild(script);
  });
  return sdkPromise;
}

/**
 * Own the proof separately from credentials so every failed POST spends its proof.
 * @param realm - Page's server-validated identity domain.
 * @returns Current proof, readiness, reset and the verification component.
 */
export function useHumanCaptcha(realm: Realm) {
  const [token, setToken] = useState("");
  const [status, setStatus] = useState<Status>("loading");
  const [generation, setGeneration] = useState(0);
  const reset = useCallback(() => {
    setToken("");
    setStatus("loading");
    setGeneration((value) => value + 1);
  }, []);
  const update = useCallback((next: Status, proof = "") => {
    setStatus(next);
    setToken(proof);
  }, []);
  return {
    token,
    ready: status === "verified" || status === "disabled",
    reset,
    node: (
      <HumanCaptcha
        key={`${realm}-${generation}`}
        realm={realm}
        onStatus={update}
        onRetry={reset}
      />
    ),
  };
}

// ============================================================================
// Widget lifecycle
// ============================================================================

function HumanCaptcha({
  realm,
  onStatus,
  onRetry,
}: {
  realm: Realm;
  onStatus: (status: Status, token?: string) => void;
  onRetry: () => void;
}) {
  const formText = useTranslations("accountsForms");

  const id = `captcha-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const [status, setStatus] = useState<Status>("loading");
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let cancelled = false;
    let instance: CaptchaInstance | undefined;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    const host = container.current;
    const update = (next: Status, proof = "") => {
      if (!cancelled) {
        setStatus(next);
        onStatus(next, proof);
      }
    };
    const init = async () => {
      try {
        const response = await fetch(
          `${API_BASE}/auth/captcha/config?realm=${realm}`,
          { cache: "no-store", signal: AbortSignal.timeout(10000) },
        );
        if (!response.ok) throw new Error("config_unavailable");
        const config = (await response.json()) as Config;
        if (config.enabled === false) {
          update("disabled");
          return;
        }
        if (
          config.enabled !== true ||
          !config.sceneId ||
          !config.prefix ||
          !["cn", "sgp"].includes(config.region)
        )
          throw new Error("invalid_config");
        await loadSdk();
        if (cancelled) return;
        update("challenge");
        window.initAliyunCaptcha!({
          SceneId: config.sceneId,
          prefix: config.prefix,
          region: config.region,
          mode: "embed",
          element: `#${id}`,
          button: `#${id}-button`,
          language: "cn",
          getInstance: (value) => {
            if (cancelled) value.destroy?.();
            else instance = value;
          },
          captchaVerifyCallback: async (param) => {
            if (cancelled) return { captchaResult: false, bizResult: false };
            try {
              const verified = await fetch(`${API_BASE}/auth/captcha/verify`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ realm, captchaVerifyParam: param }),
                signal: AbortSignal.timeout(10000),
              });
              if (!verified.ok) throw new Error("verification_failed");
              const proof = (await verified.json()) as {
                token?: string;
                expiresIn?: number;
              };
              if (
                typeof proof.token !== "string" ||
                !/^[0-9a-f-]{36}$/.test(proof.token) ||
                proof.expiresIn !== 120
              )
                throw new Error("invalid_proof");
              if (cancelled) return { captchaResult: false, bizResult: false };
              update("verified", proof.token);
              clearTimeout(expiry);
              expiry = setTimeout(() => update("error"), 110000);
              return { captchaResult: true, bizResult: true };
            } catch {
              update("error");
              return { captchaResult: false, bizResult: false };
            }
          },
          onBizResultCallback: (result) => {
            if (!result) update("error");
          },
        });
      } catch {
        update("error");
      }
    };
    void init();
    return () => {
      cancelled = true;
      clearTimeout(expiry);
      instance?.destroy?.();
      host?.replaceChildren();
    };
  }, [realm, id, onStatus]);
  return (
    <div className="flex w-full flex-col gap-sm" data-testid="human-captcha">
      <div id={id} ref={container} />
      <button
        id={`${id}-button`}
        type="button"
        hidden={status !== "challenge"}
        className="text-body-sm text-primary"
      >
        {formText("complete_human_verification")}
      </button>
      <p role="status" className="text-body-sm text-muted-foreground">
        {status === "loading"
          ? formText("loading_human_verification")
          : status === "verified"
            ? formText("human_verification_complete")
            : status === "error"
              ? formText("verification_incomplete_or_expired_please_try_again")
              : status === "challenge"
                ? formText("complete_human_verification_first")
                : ""}
      </p>
      {status === "error" ? (
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          {formText("retry_human_verification")}
        </Button>
      ) : null}
    </div>
  );
}
