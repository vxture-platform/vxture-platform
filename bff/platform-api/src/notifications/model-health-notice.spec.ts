/**
 * model-health-notice.spec.ts — #562 纯组合器测试。
 */
import { describe, expect, it } from "vitest";
import type { CreateSystemNoticeInput } from "@vxture/service-notice";

import {
  composeModelHealthNotices,
  MODEL_HEALTH_REFERENCE_TYPE,
  type ServiceHealthView,
} from "./model-health-notice";

const NOW = new Date("2026-10-09T00:00:00.000Z");

function view(partial: Partial<ServiceHealthView>): ServiceHealthView {
  return {
    generatedAt: NOW.toISOString(),
    models: [],
    routes: [],
    vendors: [],
    atlas: [],
    ...partial,
  };
}

/** 取第一条并断言非空（strict 下数组元素可能 undefined）。 */
function first(arr: CreateSystemNoticeInput[]): CreateSystemNoticeInput {
  expect(arr.length).toBeGreaterThan(0);
  return arr[0] as CreateSystemNoticeInput;
}

describe("composeModelHealthNotices", () => {
  it("emits nothing for an all-ok snapshot", () => {
    const out = composeModelHealthNotices(
      view({
        models: [{ modelCode: "m1", providerCode: "deepseek", state: "ok" }],
        routes: [
          {
            code: "chat/default",
            state: "ok",
            severity: null,
            primary: { modelCode: "m1", state: "ok" },
            fallback: null,
            configIssues: [],
          },
        ],
        vendors: [{ providerCode: "deepseek", state: "ok" }],
        atlas: [{ component: "usage_reporting", state: "ok" }],
      }),
      NOW,
    );
    expect(out).toEqual([]);
  });

  it("route down → critical, opera+admin, no expiry, route_down key", () => {
    const n = first(
      composeModelHealthNotices(
        view({
          routes: [
            {
              code: "chat/pro",
              state: "down",
              severity: "critical",
              primary: { modelCode: "p", state: "unavailable" },
              fallback: null,
              configIssues: [],
            },
          ],
        }),
        NOW,
      ),
    );
    expect(n.severity).toBe("critical");
    expect(n.targetPlanes).toEqual(["opera", "admin"]);
    expect(n.expiresAt).toBeNull();
    expect(n.referenceType).toBe(MODEL_HEALTH_REFERENCE_TYPE);
    expect(n.referenceId).toBe("route_down:chat/pro");
  });

  it("route configIssues (not down) → warning, opera-only, fingerprint key", () => {
    const n = first(
      composeModelHealthNotices(
        view({
          routes: [
            {
              code: "chat/x",
              state: "degraded",
              severity: "warning",
              primary: { modelCode: "p", state: "ok" },
              fallback: { modelCode: "f", state: "ok" },
              configIssues: [
                {
                  role: "primary",
                  modelCode: "p",
                  code: "no_key",
                  detail: "no key",
                },
              ],
            },
          ],
        }),
        NOW,
      ),
    );
    expect(n.severity).toBe("warning");
    expect(n.targetPlanes).toEqual(["opera"]);
    expect(n.referenceId).toBe("route_config:chat/x:primary:p:no_key");
    expect(n.expiresAt).toBeInstanceOf(Date);
  });

  it("model failing → warning; model_<state> key carries the state", () => {
    const n = first(
      composeModelHealthNotices(
        view({
          models: [
            {
              modelCode: "dsv4",
              providerCode: "deepseek",
              state: "rate_limited",
            },
          ],
        }),
        NOW,
      ),
    );
    expect(n.severity).toBe("warning");
    expect(n.referenceId).toBe("model_rate_limited:dsv4");
  });

  it("vendor out of money → critical opera+admin; low-but-positive → warning opera", () => {
    const crit = first(
      composeModelHealthNotices(
        view({
          vendors: [
            { providerCode: "deepseek", state: "balance_low", balance: 0 },
          ],
        }),
        NOW,
      ),
    );
    expect(crit.severity).toBe("critical");
    expect(crit.targetPlanes).toEqual(["opera", "admin"]);
    expect(crit.referenceId).toBe("vendor_balance:deepseek:critical");

    const warn = first(
      composeModelHealthNotices(
        view({
          vendors: [
            { providerCode: "zhipu", state: "balance_low", balance: 12 },
          ],
        }),
        NOW,
      ),
    );
    expect(warn.severity).toBe("warning");
    expect(warn.referenceId).toBe("vendor_balance:zhipu:warning");
  });

  it("redacts UUIDs from upstream detail text", () => {
    const n = first(
      composeModelHealthNotices(
        view({
          models: [
            {
              modelCode: "m",
              providerCode: "p",
              state: "unavailable",
              detail: "订阅 123e4567-e89b-12d3-a456-426614174000 不存在",
            },
          ],
        }),
        NOW,
      ),
    );
    expect(n.body).not.toMatch(/123e4567-e89b-12d3-a456-426614174000/);
    expect(n.body).toContain("已隐去内部 id");
  });

  it("atlas component down → critical; degraded → warning", () => {
    const out = composeModelHealthNotices(
      view({
        atlas: [
          { component: "request_log", state: "down" },
          { component: "partitions", state: "degraded" },
        ],
      }),
      NOW,
    );
    expect(
      out.find((n) => n.referenceId === "atlas_component:request_log:down")
        ?.severity,
    ).toBe("critical");
    expect(
      out.find((n) => n.referenceId === "atlas_component:partitions:degraded")
        ?.severity,
    ).toBe("warning");
  });
});
