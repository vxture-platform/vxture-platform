import {
  Inject,
  Injectable,
  NotFoundException,
  ConflictException,
} from "@nestjs/common";
import { PgTicketRepository } from "../repository/pg-ticket.repository";
import type {
  TicketRecord,
  TicketEventRecord,
  AuditLogRecord,
  ListTicketsParams,
  ListTicketsResult,
  CreateTicketInput,
  UpdateTicketInput,
  AddTicketEventInput,
  AppendAuditLogInput,
} from "../types/ticket.types";

@Injectable()
export class TicketService {
  // 必须显式 @Inject。esbuild 不产 emitDecoratorMetadata，靠类型推断的注入在
  // 打包后拿到 undefined，而这一处在 service 上：**boot-smoke 照样绿**，造出一个
  // 依赖为 undefined 的壳，第一次调用才 500（2026-09-20 的评价提交 500
  // 就是这个）。本包一直没被加载过，所以这颗雷一直没响。
  constructor(
    @Inject(PgTicketRepository) private readonly repo: PgTicketRepository,
  ) {}

  async listTickets(params: ListTicketsParams): Promise<ListTicketsResult> {
    return this.repo.listTickets(params);
  }

  async getTicket(id: string): Promise<TicketRecord> {
    const record = await this.repo.getById(id);
    if (!record) throw new NotFoundException(`工单 ${id} 不存在`);
    return record;
  }

  async createTicket(input: CreateTicketInput): Promise<TicketRecord> {
    const ticket = await this.repo.create(input);
    await this.repo.addEvent({
      ticketId: ticket.id,
      eventType: "created",
      actorType: "user",
      ...(input.accountId !== undefined ? { actorId: input.accountId } : {}),
      actorName: input.reporterName ?? "unknown",
      payload: { title: ticket.title, category: ticket.category },
    });
    return ticket;
  }

  async assignTicket(
    id: string,
    assigneeId: string,
    assigneeName: string,
    operatorId: string,
    operatorName: string,
  ): Promise<TicketRecord> {
    await this.getTicket(id);
    const result = await this.repo.update(id, { assigneeId, assigneeName });
    await this.repo.addEvent({
      ticketId: id,
      eventType: "assigned",
      actorType: "operator",
      actorId: operatorId,
      actorName: operatorName,
      payload: { assigneeId, assigneeName },
    });
    return result!;
  }

  async replyTicket(
    id: string,
    content: string,
    actorType: string,
    actorId: string,
    actorName: string,
    attachments?: string[],
  ): Promise<TicketEventRecord> {
    const ticket = await this.getTicket(id);
    if (ticket.status === "closed")
      throw new ConflictException("已关闭工单不可回复");

    const event = await this.repo.addEvent({
      ticketId: id,
      eventType: "replied",
      actorType,
      actorId,
      actorName,
      payload: { content, attachments: attachments ?? [] },
    });

    // 记录首次响应时间（仅运营人员首次回复时）
    if (!ticket.firstResponseAt && actorType === "operator") {
      await this.repo.update(id, {
        status: "in_progress",
      } as UpdateTicketInput);
    }

    return event;
  }

  async resolveTicket(
    id: string,
    operatorId: string,
    operatorName: string,
    remark?: string,
  ): Promise<TicketRecord> {
    const ticket = await this.getTicket(id);
    if (ticket.status === "resolved" || ticket.status === "closed") {
      throw new ConflictException("工单已处理");
    }

    const result = await this.repo.update(id, {
      status: "resolved",
      resolvedAt: new Date(),
    });
    await this.repo.addEvent({
      ticketId: id,
      eventType: "resolved",
      actorType: "operator",
      actorId: operatorId,
      actorName: operatorName,
      payload: { remark: remark ?? "" },
    });
    return result!;
  }

  async closeTicket(
    id: string,
    actorId: string,
    actorName: string,
    actorType: string,
  ): Promise<TicketRecord> {
    const ticket = await this.getTicket(id);
    if (ticket.status === "closed") throw new ConflictException("工单已关闭");

    const result = await this.repo.update(id, {
      status: "closed",
      closedAt: new Date(),
    });
    await this.repo.addEvent({
      ticketId: id,
      eventType: "closed",
      actorType,
      actorId,
      actorName,
      payload: {},
    });
    return result!;
  }

  async updateTicket(
    id: string,
    input: UpdateTicketInput,
  ): Promise<TicketRecord> {
    await this.getTicket(id);
    const result = await this.repo.update(id, input);
    if (!result) throw new NotFoundException(`工单 ${id} 不存在`);
    return result;
  }

  async getTicketEvents(id: string): Promise<TicketEventRecord[]> {
    await this.getTicket(id);
    return this.repo.getEvents(id);
  }

  async addEvent(input: AddTicketEventInput): Promise<TicketEventRecord> {
    await this.getTicket(input.ticketId);
    return this.repo.addEvent(input);
  }

  async appendAuditLog(input: AppendAuditLogInput): Promise<AuditLogRecord> {
    return this.repo.appendAuditLog(input);
  }

  async listAuditLogs(params: {
    actorId?: string;
    tenantId?: string;
    action?: string;
    resourceType?: string;
    page?: number;
    pageSize?: number;
  }): Promise<{ items: AuditLogRecord[]; total: number }> {
    return this.repo.listAuditLogs(params);
  }
}
