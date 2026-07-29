import type {
  LLMConfig,
  LLMError,
  LLMFinishReason,
  LLMMessage,
  LLMOptions,
  LLMResponse,
  LLMStreamChunk,
  LLMTool,
  LLMToolCall,
  LLMToolChoice,
  ModelRuntimeApplicationType,
} from "./types";

export interface ModelRuntimeLLMClientOptions {
  /**
   * TD-016: required — this package has no NestJS DI, so it cannot read
   * validated config itself. The caller must resolve ATLAS_API_URL
   * through its own Zod-validated VxConfigService (packages/core/config
   * platform.schema.ts) and pass it here; this client no longer falls back
   * to reading process.env.ATLAS_API_URL directly (that value was
   * never Zod-validated at this call site).
   */
  atlasApiUrl: string;
  tenantId: string;
  applicationId?: string;
  applicationType?: ModelRuntimeApplicationType;
  /**
   * @deprecated 使用 applicationId + applicationType。保留该字段仅用于旧 agent-server 迁移期。
   */
  agentId?: string;
  defaultTimeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface ModelRuntimeLLMChatOptions extends LLMOptions {
  tenantId?: string;
  applicationId?: string;
  applicationType?: ModelRuntimeApplicationType;
  /**
   * @deprecated 使用 applicationId + applicationType。保留该字段仅用于旧 agent-server 迁移期。
   */
  agentId?: string;
}

interface ModelRuntimeChatMessage {
  role: LLMMessage["role"];
  content: string;
  toolCalls?: LLMToolCall[];
  toolCallId?: string;
  name?: string;
}

interface ModelRuntimeChatRequest {
  modelCode: string;
  messages: ModelRuntimeChatMessage[];
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  tools?: LLMTool[];
  toolChoice?: LLMToolChoice;
  stream?: boolean;
  tenantId: string;
  applicationId?: string;
  applicationType?: ModelRuntimeApplicationType;
  /**
   * @deprecated Model Platform 会把 agentId 兼容映射为 agent 类型应用。
   */
  agentId?: string;
}

interface ModelRuntimeChatResponse {
  id: string;
  modelCode: string;
  message: {
    role: "assistant";
    content: string;
    toolCalls?: LLMToolCall[];
  };
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  latencyMs: number;
  finishReason?: LLMFinishReason;
}

export class ModelRuntimeLLMError extends Error implements LLMError {
  constructor(
    readonly code: string,
    message: string,
    readonly originalError?: unknown,
  ) {
    super(message);
    this.name = "ModelRuntimeLLMError";
  }
}

export class ModelRuntimeLLMClient {
  private readonly atlasApiUrl: string;
  private readonly tenantId: string;
  private readonly applicationId: string | undefined;
  private readonly applicationType: ModelRuntimeApplicationType | undefined;
  private readonly agentId: string | undefined;
  private readonly defaultTimeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ModelRuntimeLLMClientOptions) {
    this.atlasApiUrl = normalizeAtlasApiUrl(options.atlasApiUrl);
    if (!options.tenantId.trim()) {
      throw new ModelRuntimeLLMError(
        "MISSING_TENANT_ID",
        "tenantId is required for ModelRuntimeLLMClient",
      );
    }

    this.tenantId = options.tenantId;
    this.applicationId = options.applicationId;
    this.applicationType = options.applicationType;
    this.agentId = options.agentId;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 60_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async chat(
    messages: LLMMessage[],
    config: LLMConfig,
    options: ModelRuntimeLLMChatOptions = {},
  ): Promise<LLMResponse> {
    if (options.stream) {
      throw new ModelRuntimeLLMError(
        "STREAM_NOT_SUPPORTED",
        "Use chatStream() for streaming responses",
      );
    }

    const request = this.buildRequest(messages, config, options, false);
    const response = await this.post<ModelRuntimeChatResponse>(
      "/v1/chat",
      request,
      options.timeout ?? this.defaultTimeoutMs,
    );

    return {
      content: response.message.content,
      ...(response.message.toolCalls !== undefined
        ? { toolCalls: response.message.toolCalls }
        : {}),
      ...(response.finishReason !== undefined
        ? { finishReason: response.finishReason }
        : {}),
      usage: response.usage,
      model: response.modelCode,
      latency: response.latencyMs,
    };
  }

  /**
   * 流式对话，返回 AsyncGenerator<LLMStreamChunk>
   *
   * 调用方按事件类型增量处理：
   * - 'text' 事件 → 拼接到对外输出
   * - 'tool_call' 事件 → 中断本轮，执行工具，把结果以 role:'tool' 消息追加后再次调用
   * - 'done' 事件 → 本轮结束
   * - 'error' 事件 → 流内错误（HTTP 层错误以异常形式抛出）
   *
   * @example
   * for await (const chunk of client.chatStream(messages, config, { tools })) {
   *   if (chunk.type === 'text') process.stdout.write(chunk.delta);
   *   if (chunk.type === 'tool_call') await runTool(chunk.toolCall);
   * }
   */
  async *chatStream(
    messages: LLMMessage[],
    config: LLMConfig,
    options: ModelRuntimeLLMChatOptions = {},
  ): AsyncGenerator<LLMStreamChunk, void, void> {
    const request = this.buildRequest(messages, config, options, true);
    const controller = new AbortController();
    const timeoutMs = options.timeout ?? this.defaultTimeoutMs;
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.atlasApiUrl}/v1/chat`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "text/event-stream",
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timer);
      throw new ModelRuntimeLLMError(
        "MODEL_RUNTIME_REQUEST_FAILED",
        "Model runtime streaming request failed",
        error,
      );
    }

    if (!response.ok) {
      const errorText = await safeReadText(response);
      const error = parseErrorPayload(errorText, response.status);
      clearTimeout(timer);
      throw new ModelRuntimeLLMError(error.code, error.message);
    }

    if (!response.body) {
      clearTimeout(timer);
      throw new ModelRuntimeLLMError(
        "EMPTY_MODEL_RUNTIME_STREAM",
        "Model runtime returned an empty stream",
      );
    }

    try {
      yield* parseSseStream(response.body);
    } finally {
      clearTimeout(timer);
    }
  }

  private buildRequest(
    messages: LLMMessage[],
    config: LLMConfig,
    options: ModelRuntimeLLMChatOptions,
    stream: boolean,
  ): ModelRuntimeChatRequest {
    const scopeInput: {
      applicationId?: string;
      applicationType?: ModelRuntimeApplicationType;
      agentId?: string;
    } = {};
    const applicationId = options.applicationId ?? this.applicationId;
    const applicationType = options.applicationType ?? this.applicationType;
    const agentId = options.agentId ?? this.agentId;
    if (applicationId !== undefined) scopeInput.applicationId = applicationId;
    if (applicationType !== undefined)
      scopeInput.applicationType = applicationType;
    if (agentId !== undefined) scopeInput.agentId = agentId;

    const scope = resolveApplicationScope(scopeInput);

    return {
      modelCode: String(config.model),
      messages: messages.map(toWireMessage),
      ...(config.temperature !== undefined
        ? { temperature: config.temperature }
        : {}),
      ...(config.maxTokens !== undefined
        ? { maxTokens: config.maxTokens }
        : {}),
      ...(config.topP !== undefined ? { topP: config.topP } : {}),
      ...(options.tools !== undefined ? { tools: options.tools } : {}),
      ...(options.toolChoice !== undefined
        ? { toolChoice: options.toolChoice }
        : {}),
      stream,
      tenantId: options.tenantId ?? this.tenantId,
      ...(scope.applicationId !== undefined
        ? { applicationId: scope.applicationId }
        : {}),
      ...(scope.applicationType !== undefined
        ? { applicationType: scope.applicationType }
        : {}),
      ...(scope.agentId !== undefined ? { agentId: scope.agentId } : {}),
    };
  }

  private async post<TResponse>(
    path: string,
    body: ModelRuntimeChatRequest,
    timeoutMs: number,
  ): Promise<TResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await this.fetchImpl(`${this.atlasApiUrl}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const responseText = await response.text();

      if (!response.ok) {
        const error = parseErrorPayload(responseText, response.status);
        throw new ModelRuntimeLLMError(error.code, error.message);
      }

      return parseJson<TResponse>(responseText);
    } catch (error) {
      if (error instanceof ModelRuntimeLLMError) {
        throw error;
      }

      throw new ModelRuntimeLLMError(
        "MODEL_RUNTIME_REQUEST_FAILED",
        "Model runtime request failed",
        error,
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

function resolveApplicationScope(input: {
  applicationId?: string;
  applicationType?: ModelRuntimeApplicationType;
  agentId?: string;
}): {
  applicationId?: string;
  applicationType?: ModelRuntimeApplicationType;
  agentId?: string;
} {
  const applicationId = input.applicationId?.trim();
  const agentId = input.agentId?.trim();

  if (applicationId) {
    if (!input.applicationType) {
      throw new ModelRuntimeLLMError(
        "MISSING_APPLICATION_TYPE",
        "applicationType is required when applicationId is provided",
      );
    }

    return {
      applicationId,
      applicationType: input.applicationType,
      ...(agentId ? { agentId } : {}),
    };
  }

  if (agentId) {
    return {
      applicationId: agentId,
      applicationType: "agent",
      agentId,
    };
  }

  if (input.applicationType) {
    throw new ModelRuntimeLLMError(
      "MISSING_APPLICATION_ID",
      "applicationId is required when applicationType is provided",
    );
  }

  return {};
}

function toWireMessage(message: LLMMessage): ModelRuntimeChatMessage {
  const wire: ModelRuntimeChatMessage = {
    role: message.role,
    content: message.content,
  };
  if (message.toolCalls?.length) {
    wire.toolCalls = message.toolCalls;
  }
  if (message.toolCallId) {
    wire.toolCallId = message.toolCallId;
  }
  if (message.name) {
    wire.name = message.name;
  }
  return wire;
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

/**
 * 解析 SSE 流为 LLMStreamChunk 序列
 *
 * Model Runtime 约定：每个 `data:` 行的内容是一段 JSON，
 * 形态为 LLMStreamChunk；流尾以 `data: [DONE]` 结束。
 */
async function* parseSseStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<LLMStreamChunk, void, void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });

      let separatorIndex = findEventBoundary(buffer);
      while (separatorIndex !== -1) {
        const rawEvent = buffer.slice(0, separatorIndex);
        buffer = buffer.slice(separatorIndex).replace(/^(\r?\n){1,2}/, "");
        const chunk = parseSseEvent(rawEvent);
        if (chunk === "done") {
          return;
        }
        if (chunk) {
          yield chunk;
        }
        separatorIndex = findEventBoundary(buffer);
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function findEventBoundary(buffer: string): number {
  const lf = buffer.indexOf("\n\n");
  const crlf = buffer.indexOf("\r\n\r\n");
  if (lf === -1) return crlf;
  if (crlf === -1) return lf;
  return Math.min(lf, crlf);
}

function parseSseEvent(raw: string): LLMStreamChunk | "done" | null {
  const dataLines: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).replace(/^ /, ""));
    }
  }
  if (dataLines.length === 0) return null;

  const payload = dataLines.join("\n").trim();
  if (!payload) return null;
  if (payload === "[DONE]") return "done";

  try {
    return JSON.parse(payload) as LLMStreamChunk;
  } catch {
    return {
      type: "error",
      code: "PARSE_FAILED",
      message: `Invalid SSE payload: ${payload}`,
    };
  }
}

export function createModelRuntimeLLMClient(
  options: ModelRuntimeLLMClientOptions,
): ModelRuntimeLLMClient {
  return new ModelRuntimeLLMClient(options);
}

function normalizeAtlasApiUrl(url: string | undefined): string {
  if (!url?.trim()) {
    throw new ModelRuntimeLLMError(
      "MISSING_ATLAS_API_URL",
      "ATLAS_API_URL is required for ModelRuntimeLLMClient",
    );
  }

  let normalized = url;
  while (normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }
  try {
    new URL(normalized);
  } catch {
    throw new ModelRuntimeLLMError(
      "INVALID_ATLAS_API_URL",
      `atlasApiUrl is not a valid URL: ${normalized}`,
    );
  }
  return normalized;
}

function parseJson<TResponse>(text: string): TResponse {
  if (!text.trim()) {
    throw new ModelRuntimeLLMError(
      "EMPTY_MODEL_RUNTIME_RESPONSE",
      "Model runtime returned an empty response",
    );
  }

  return JSON.parse(text) as TResponse;
}

function parseErrorPayload(
  responseText: string,
  status: number,
): { code: string; message: string } {
  if (!responseText.trim()) {
    return {
      code: `HTTP_${status}`,
      message: `Model runtime request failed with status ${status}`,
    };
  }

  try {
    const parsed = JSON.parse(responseText) as {
      code?: unknown;
      message?: unknown;
    };
    return {
      code: typeof parsed.code === "string" ? parsed.code : `HTTP_${status}`,
      message:
        typeof parsed.message === "string"
          ? parsed.message
          : `Model runtime request failed with status ${status}`,
    };
  } catch {
    return {
      code: `HTTP_${status}`,
      message: responseText,
    };
  }
}
