/**
 * chat.router.ts - POST /varda/chat 流式透传路由
 * @package @vxture/bff-varda
 * @layer Application
 * @category Router
 *
 * @description
 *   接收前端的聊天请求，将 CallerContext 以 base64 JSON 编码后写入
 *   X-Varda-Context Header，透传给 agent-server/varda，并将 SSE 流式响应
 *   原样回传给前端，不缓冲、不解析内容（spec §6.3）。
 *
 *   目标地址由环境变量 VARDA_SERVER_INTERNAL_URL 控制（默认 http://localhost:3091）。
 *
 * @author AI-Generated
 * @date 2026-04-30
 */

import {
  BadRequestException,
  Body,
  Controller,
  Inject,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { VxConfigService } from "@vxture/core-config";
import type { ChatRequestDto, VardaRequest } from "../types/chat.types";

// ============================================================================
// 辅助：构造 SSE 错误事件（在流已打开时回传错误）
// ============================================================================

function writeSseError(res: Response, message: string): void {
  res.write(`data: ${JSON.stringify({ type: "error", message })}\n\n`);
  res.end();
}

// ============================================================================
// ChatRouter
// ============================================================================

@Controller("varda")
export class ChatRouter {
  private readonly vardaServerUrl: string;

  constructor(@Inject(VxConfigService) configService: VxConfigService) {
    this.vardaServerUrl =
      configService.platform.VARDA_SERVER_INTERNAL_URL.trim().replace(
        /\/+$/,
        "",
      );
  }

  @Post("chat")
  async chat(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: ChatRequestDto,
  ): Promise<void> {
    if (
      !body.message ||
      typeof body.message !== "string" ||
      body.message.trim() === ""
    ) {
      throw new BadRequestException({
        statusCode: 400,
        code: "BAD_REQUEST",
        message: "message is required",
      });
    }

    const ctx = (req as VardaRequest).callerContext;
    const encoded = Buffer.from(JSON.stringify(ctx)).toString("base64");

    // SSE 响应头，Nginx 需配置 proxy_buffering off
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    let upstream: globalThis.Response;
    try {
      upstream = await fetch(`${this.vardaServerUrl}/internal/varda/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Varda-Context": encoded,
        },
        body: JSON.stringify({
          sessionId: body.sessionId ?? null,
          message: body.message,
        }),
      });
    } catch {
      writeSseError(res, "Upstream service unavailable");
      return;
    }

    if (!upstream.ok || !upstream.body) {
      writeSseError(res, `Upstream error: ${upstream.status}`);
      return;
    }

    // 透传 SSE 流
    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(decoder.decode(value, { stream: true }));
      }
    } catch {
      writeSseError(res, "Stream interrupted");
    } finally {
      reader.releaseLock();
      res.end();
    }
  }
}
