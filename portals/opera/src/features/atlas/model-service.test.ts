/**
 * Regression coverage for model configuration declaration round trips.
 * @package @vxture/opera
 * @layer Presentation
 * @category Features - Atlas
 * @author AI-Generated
 * @date 2026-10-12
 */

import { describe, expect, it } from "vitest";
import { OperaApiError } from "@/lib/api";
import {
  buildModelConfig,
  describeError,
  emptyModelDraft,
  modelDraftFrom,
  parseExtraBody,
  parseWireJson,
  type AiModelRecord,
  type ModelDraft,
} from "./model-service";

// ============================================================================
// Fixtures and the page's draft-to-payload path
// ============================================================================

function model(config: AiModelRecord["config"]): AiModelRecord {
  return {
    id: "model-id",
    providerId: "provider-id",
    modelCode: "vendor/model",
    modelName: "Model",
    provider: "vendor",
    endpointUrl: "https://vendor.example/v1",
    protocol: "openai-compatible",
    modelType: "chat",
    description: null,
    contextWindow: null,
    maxOutputTokens: null,
    capabilities: ["chat"],
    supportsStreaming: true,
    sort: 999,
    behaviorVersion: "fingerprint",
    config,
    resolvedWire: {
      schemaVersion: 4,
      chatPath: null,
      authStyle: "bearer",
      headers: {},
      streamUsage: "include_usage",
      supports: {},
      paramMap: {},
      extraBody: { inherited: true },
      thinking: { off: { inherited: true }, on: {} },
      contextOverflow: [{ code: "inherited_overflow" }],
    },
    keyReference: null,
    state: "active",
    deprecatedAt: null,
    grantCount: 0,
    endpointRefCount: 0,
    createdAt: "2026-10-12T00:00:00.000Z",
    updatedAt: "2026-10-12T00:00:00.000Z",
  };
}

/** @throws {Error} When a fixture contains malformed JSON. */
function buildFromDraft(
  config: AiModelRecord["config"],
  draft: ModelDraft,
  version: number | null = 4,
) {
  const extraBody = parseExtraBody(draft.extraBody);
  const thinking = parseWireJson(draft.thinking);
  const contextOverflow = parseWireJson(draft.contextOverflow);
  if (!extraBody.ok || !thinking.ok || !contextOverflow.ok) {
    throw new Error("Fixture must contain parseable JSON");
  }
  return buildModelConfig(
    config,
    draft.upstreamModel,
    {
      extraBody: extraBody.value,
      thinking: thinking.value,
      contextOverflow: contextOverflow.value,
    },
    version,
  );
}

// ============================================================================
// Declaration round trips and inheritance
// ============================================================================

describe("model wire declarations", () => {
  it("starts registration without declarations", () => {
    const draft = emptyModelDraft("provider-id", "openai-compatible");
    expect(draft.thinking).toBe("");
    expect(draft.contextOverflow).toBe("");
    expect(buildFromDraft(null, draft)).toBeNull();
  });

  it("does not copy effective Provider values into model declarations", () => {
    const draft = modelDraftFrom(model(null));
    expect(draft.extraBody).toBe("");
    expect(draft.thinking).toBe("");
    expect(draft.contextOverflow).toBe("");
    expect(buildFromDraft(null, draft)).toBeNull();
  });

  it("preserves all config and wire keys during ordinary edits without mutating input", () => {
    const config = {
      upstreamModel: "upstream-name",
      vendorMetadata: { region: "eu" },
      pricing: { opaque: true },
      wire: {
        schemaVersion: 4,
        headers: { "x-vendor": "custom" },
        paramMap: { max_tokens: "max_completion_tokens" },
        futureKey: { nested: [1, 2] },
        extraBody: { vendor_option: true },
        thinking: { off: { thinking: { type: "disabled" } }, on: {} },
        contextOverflow: [{ code: "too_long", message: "maximum context" }],
      },
    };
    const original = JSON.stringify(config);
    const draft = modelDraftFrom(model(config));
    draft.modelName = "Renamed model";
    const result = buildFromDraft(config, draft);
    expect(result).toEqual(config);
    expect(result).not.toBe(config);
    expect(result?.["wire"]).not.toBe(config.wire);
    expect(JSON.stringify(config)).toBe(original);
  });

  it("preserves an explicitly supported empty mode without inventing another mode", () => {
    const config = { wire: { thinking: { on: {} }, schemaVersion: 4 } };
    const draft = modelDraftFrom(model(config));
    expect(JSON.parse(draft.thinking)).toEqual({ on: {} });
    expect(buildFromDraft(config, draft)).toEqual(config);
    expect(config.wire.thinking).not.toHaveProperty("off");
  });

  it("preserves explicit empty thinking maps and rule arrays", () => {
    const config = {
      wire: { schemaVersion: 4, thinking: {}, contextOverflow: [] },
    };
    const draft = modelDraftFrom(model(config));
    expect(draft.thinking).toBe("{}");
    expect(draft.contextOverflow).toBe("[]");
    expect(buildFromDraft(config, draft)).toEqual(config);
  });

  it("removes only cleared model declarations to restore inheritance", () => {
    const config = {
      metadata: { keep: true },
      wire: {
        schemaVersion: 4,
        thinking: { on: {} },
        contextOverflow: [{ code: "too_long" }],
        headers: { "x-preserved": "yes" },
      },
    };
    const draft = modelDraftFrom(model(config));
    draft.thinking = "  ";
    draft.contextOverflow = "";
    expect(buildFromDraft(config, draft)).toEqual({
      metadata: { keep: true },
      wire: { schemaVersion: 4, headers: { "x-preserved": "yes" } },
    });
    expect(config.wire.thinking).toEqual({ on: {} });
  });

  it("removes a wire containing only a version after its declarations are cleared", () => {
    const config = { wire: { schemaVersion: 4, thinking: { on: {} } } };
    const draft = modelDraftFrom(model(config));
    draft.thinking = "";
    expect(buildFromDraft(config, draft)).toBeNull();
  });

  it("takes the wire version from the catalog instead of a fixed constant", () => {
    const config = { wire: { schemaVersion: 3, thinking: { on: {} } } };
    const result = buildFromDraft(config, modelDraftFrom(model(config)), 17);
    expect(result?.["wire"]).toEqual({
      schemaVersion: 17,
      thinking: { on: {} },
    });
  });

  it("never invents a version when the catalog is unavailable", () => {
    const config = { wire: { schemaVersion: 4, thinking: { on: {} } } };
    expect(buildFromDraft(config, modelDraftFrom(model(config)), null)).toEqual(
      config,
    );
    const draft = emptyModelDraft("", "openai-compatible");
    draft.thinking = '{"on":{}}';
    expect(buildFromDraft(null, draft, null)).toEqual({
      wire: { thinking: { on: {} } },
    });
  });
});

// ============================================================================
// Syntax-only parsing and upstream validation boundaries
// ============================================================================

describe("wire JSON parsing", () => {
  it.each(["", " \n\t "])("treats blank %j as absent", (raw) => {
    expect(parseWireJson(raw)).toEqual({ ok: true, value: undefined });
  });

  it.each(["{", '{"on":}', '[{"code":"long"},]', "undefined"])(
    "rejects malformed JSON %j",
    (raw) => expect(parseWireJson(raw)).toEqual({ ok: false }),
  );

  it.each([
    "null",
    "false",
    "0",
    '"text"',
    "[]",
    "{}",
    '{"auto":{}}',
    '{"on":{"model":"reserved"}}',
    '[{"message":""}]',
    JSON.stringify([{ message: "x".repeat(201) }]),
  ])("passes parseable %j unchanged to Atlas for validation", (raw) => {
    const value: unknown = JSON.parse(raw);
    expect(parseWireJson(raw)).toEqual({ ok: true, value });
    const draft = emptyModelDraft("", "openai-compatible");
    draft.thinking = raw;
    draft.contextOverflow = raw;
    expect(buildFromDraft(null, draft)).toEqual({
      wire: { schemaVersion: 4, thinking: value, contextOverflow: value },
    });
  });

  it("round-trips JSON null instead of silently clearing it", () => {
    const config = {
      wire: { schemaVersion: 4, thinking: null, contextOverflow: null },
    };
    const draft = modelDraftFrom(model(config));
    expect(draft.thinking).toBe("null");
    expect(draft.contextOverflow).toBe("null");
    expect(buildFromDraft(config, draft)).toEqual(config);
  });

  it("preserves the original Atlas error explanation", () => {
    const message = "config.wire.thinking.on.model is reserved by the adapter";
    expect(describeError(new OperaApiError(message, 400))).toEqual({
      description: message,
    });
  });
});
