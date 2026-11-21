/**
 * voucher-step-up.ts - Canonical voucher action bindings and ceremony context.
 * @package @vxture/bff-admin
 * @layer Application
 * @category auth
 * @author AI-Generated
 * @date 2026-11-20
 */
import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { Request } from "express";
import type { RequestContext } from "../types/console.types";

// ===========================================================================
// Hash the entire JSON command; object ordering alone does not change intent.
// ===========================================================================
export interface VoucherStepUpIntent {
  requestHash: string;
  action: string;
  target: string;
}
export interface StepUpActionBinding {
  requestHash: string;
  sessionHash: string;
}

function canonical(value: unknown, depth = 0): string {
  if (depth > 32) throw new BadRequestException("invalid_action_request");
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value))
    return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map((v) => canonical(v, depth + 1)).join(",")}]`;
  if (
    value &&
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype
  )
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key], depth + 1)}`,
      )
      .join(",")}}`;
  throw new BadRequestException("invalid_action_request");
}

/**
 * Build the server's intent from the exact routed JSON request.
 * @param req - Authenticated request; session binding is populated by middleware.
 * @returns A safe dialog summary and digest covering every request field.
 * @throws {BadRequestException} For unsupported routes or malformed commands.
 * @throws {ForbiddenException} When the authenticated RP session is unavailable.
 */
export function voucherStepUpIntent(
  req: Request & RequestContext,
): VoucherStepUpIntent {
  if (
    !req.operatorSessionHash ||
    !/^[a-f0-9]{64}$/.test(req.operatorSessionHash)
  )
    throw new ForbiddenException("step_up_session_required");
  const path = req.path.replace(/\/+$/, "");
  const body: unknown = req.body;
  if (
    req.method !== "POST" ||
    !body ||
    typeof body !== "object" ||
    Array.isArray(body)
  )
    throw new BadRequestException("invalid_action_request");
  const key = "idempotencyKey" in body ? body.idempotencyKey : undefined;
  if (typeof key !== "string" || !key.trim() || key.length > 128)
    throw new BadRequestException("invalid_action_request");
  let action: string, target: string;
  if (path === "/api/commercial/voucher-batches") {
    action = "创建卡券批次";
    target = "新批次";
  } else if (path === "/api/commercial/vouchers/assign") {
    action = "定向发放卡券";
    target =
      "batchId" in body && typeof body.batchId === "string"
        ? body.batchId
        : "卡券批次";
  } else {
    const match =
      /^\/api\/commercial\/(voucher-batches|vouchers)\/([a-f0-9-]{36})\/(actions|issue|revoke)$/i.exec(
        path,
      );
    if (
      !match ||
      (match[1] === "vouchers"
        ? match[3] !== "revoke"
        : !["actions", "issue"].includes(match[3]!))
    )
      throw new BadRequestException("invalid_action_request");
    const labels: Record<string, string> = {
      configure: "修改批次",
      review: "审核启用",
      pause: "暂停批次",
      resume: "恢复批次",
      archive: "归档批次",
      request_budget: "申请增额",
      approve_budget: "批准增额",
    };
    action =
      match[3] === "issue"
        ? "生成领取凭证"
        : match[3] === "revoke"
          ? "撤回卡券"
          : "action" in body && typeof body.action === "string"
            ? (labels[body.action] ?? "批次操作")
            : "批次操作";
    target = match[2]!;
  }
  if (target.length > 128)
    throw new BadRequestException("invalid_action_request");
  return {
    action,
    target,
    requestHash: createHash("sha256")
      .update(
        canonical({
          method: req.method,
          path,
          query: req.originalUrl?.split("?")[1] ?? "",
          body,
        }),
      )
      .digest("hex"),
  };
}

/**
 * Return an actionable gate response without issuing a credential.
 * @param req - The server's current authenticated command.
 * @returns The exception used for a fresh, per-action ceremony.
 * @throws {BadRequestException} When the command cannot be bound.
 */
export function voucherStepUpRequired(
  req: Request & RequestContext,
): ForbiddenException {
  return new ForbiddenException({
    message: "step_up_required",
    stepUpAction: voucherStepUpIntent(req),
  });
}
