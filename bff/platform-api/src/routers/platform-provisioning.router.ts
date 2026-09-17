/**
 * platform-provisioning.router.ts — 开通回执:产品 → 平台的反向信号。
 * @package @vxture/bff-platform-api
 *
 * ── 这条接口补的是哪个洞 ──
 * 在它之前，开通是**单向**的:平台入队一条 `tenant.provisioned` 投递，把
 * `provisionings.status` 当场写成 `provisioned`，然后就没有下文了。那一列回答的其实是
 * **平台已下令**，不是产品已就绪——而 opera 的接入检查把它当作「开通成功」在读，
 * 于是那一格在平台按下开通的瞬间就绿了，与对方建没建起空间无关。
 *
 * 《产品接入通则》此前把对账义务整个压在产品侧（「webhook 是提示，不是权威……启动时与
 * 定期各对账一次」「10 次用尽之后平台不再重投——这正是定期对账存在的理由」），平台这边
 * 没有任何反向证据。本接口就是那一侧。
 *
 * ── 本期只记事实，不动状态机 ──
 * 回执**不**改 `status` / `version` / `provisioned_at`。把 `provisioned` 的写入时机推迟到
 * 回执是对的终局，但不能一次做完:所有还没实现回执的产品会立刻全卡在 `pending`，
 * opera 的开通信号读的正是 `status='provisioned'`，等于用一次平台升级把在产的产品
 * 全判成没开通过。先单向加信号，等产品侧铺开再切——这是加法，走「生产者先发」，
 * 不是通则 X-4 那三步（那三步管的是**改形状**，且是消费方先动）。
 *
 * ── 为什么挂在 PlatformAuthGuard 下 ──
 * 那个 guard 的说明原先写着「只保护三个产品自助端点」，是 2026-07-12 评审拆分时有意划的
 * 爆炸半径。回执是第四个，属同一类:产品**用自己的 S2S 票上报自己的事实**，
 * `act.sub` 归因、`scopeToS2sCaller` 拒产品不符、工作区以 token 为准——与
 * `POST /usage/consume` 一字不差的形状。另起一个 guard 只会得到第二套一样的校验。
 *
 * 错误措辞跟随同域既有路由（`unknown_product` 一类的裸串），不在这一个文件里另造
 * 第三套封套。
 */
import {
  BadRequestException,
  Body,
  Controller,
  Inject,
  NotFoundException,
  Post,
  UseGuards,
} from "@nestjs/common";
import { PlatformAuthGuard } from "../authn/platform-auth.guard";
import { S2sCaller, type S2sCallerCtx } from "../authn/s2s-caller";
import { scopeToS2sCaller } from "../authn/s2s-scope";
import { PlatformProvisioningService } from "../platform/platform-provisioning.service";

/** `POST /provisioning/ack` 的响应体。`replayed` 与 C3 consume 同义。 */
export interface AckResponseBody {
  workspace_id: string;
  product: string;
  /** 首次回执的时间;重放时是**原来那一次**的时间，正是它对账有用的原因。 */
  acked_at: string;
  replayed: boolean;
}

interface ParsedAckBody {
  workspaceId: string;
  productCode: string;
  deliveryId: string | null;
  status: "ready" | "failed";
  detail?: Record<string, unknown>;
}

/**
 * 请求体校验。**读不出来就抛**，不给默认值——一个把 `status` 猜成 `ready` 的兜底，
 * 会把产品报上来的失败悄悄记成成功。
 */
export function parseAckBody(body: unknown): ParsedAckBody {
  const b = (body ?? {}) as Record<string, unknown>;
  const str = (v: unknown): string | null =>
    typeof v === "string" && v.trim() !== "" ? v.trim() : null;

  const workspaceId = str(b["workspace_id"]);
  if (!workspaceId) throw new Error("workspace_id_required");
  const productCode = str(b["product"]);
  if (!productCode) throw new Error("product_required");

  const rawStatus = str(b["status"]);
  if (rawStatus !== "ready" && rawStatus !== "failed") {
    throw new Error("status_must_be_ready_or_failed");
  }

  /* 投递 id 可缺省:产品按通则做定期对账补发的回执没有对应投递。缺省 = 不做幂等。 */
  const deliveryId = str(b["delivery_id"]);

  const rawDetail = b["detail"];
  const detail =
    typeof rawDetail === "object" &&
    rawDetail !== null &&
    !Array.isArray(rawDetail)
      ? (rawDetail as Record<string, unknown>)
      : undefined;

  return {
    workspaceId,
    productCode,
    deliveryId,
    status: rawStatus,
    ...(detail ? { detail } : {}),
  };
}

@Controller()
@UseGuards(PlatformAuthGuard)
export class PlatformProvisioningRouter {
  constructor(
    @Inject(PlatformProvisioningService)
    private readonly provisioning: PlatformProvisioningService,
  ) {}

  /** POST /provisioning/ack { workspace_id, product, status, delivery_id?, detail? } */
  @Post("provisioning/ack")
  async ack(
    @Body()
    body: {
      workspace_id?: unknown;
      product?: unknown;
      status?: unknown;
      delivery_id?: unknown;
      detail?: unknown;
    },
    @S2sCaller() s2sCaller?: S2sCallerCtx,
  ): Promise<AckResponseBody> {
    let parsed: ParsedAckBody;
    try {
      parsed = parseAckBody(body);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }

    /* TD-035，同 consume/gauge:产品只能为**自己**回执，工作区取 token 里的那个，
       请求体声明的直接丢弃——调用方自报身份等于没有鉴权（通则被调方纪律第 8 条）。 */
    const { workspaceId } = scopeToS2sCaller(s2sCaller, {
      workspaceId: parsed.workspaceId,
      productCodes: [parsed.productCode],
    });

    const productId = await this.provisioning.resolveProductId(
      parsed.productCode,
    );
    if (!productId) throw new BadRequestException("unknown_product");

    const result = await this.provisioning.recordAck({
      workspaceId,
      applicationId: productId,
      deliveryId: parsed.deliveryId,
      status: parsed.status,
      ...(parsed.detail ? { detail: parsed.detail } : {}),
    });

    /* 没有开通行 = 平台从没对这个 (workspace, product) 下过开通令。这是 404 而不是
       400:请求本身没毛病，是被回执的那件事不存在。产品这边通常意味着它收到的投递
       属于别的工作区，或者开通已经被撤销（deprovisioned 会保留行，所以那种情况不会
       走到这里）。 */
    if (!result) throw new NotFoundException("provisioning_not_found");

    return {
      workspace_id: workspaceId,
      product: parsed.productCode,
      acked_at: result.ackedAt,
      replayed: result.replayed,
    };
  }
}
