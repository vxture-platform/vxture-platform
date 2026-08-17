/**
 * 产品上线检查 —— 平台侧配置就绪度的实测。
 *
 * ── 这五项检查**只测平台这一侧** ─────────────────────────────────────────────
 *
 * 每一项都是读平台自己已经拥有的状态：产品行、OIDC 客户端、两个域的授权、webhook
 * 登记。**没有任何一项会向对方的端点发请求。** 这是有意的，两个理由：
 *
 * 1. `docs/70-workplan/20-opera-ia-restructure.md` B4 的依赖写着「不新造探针」。
 * 2. 那份依赖同时写着「复用已有的 webhook test-delivery」——**这个能力全仓不存在**
 *    （`test-delivery` 零处实现）。发一次真实回调是对**对方生产端点**的外部动作，
 *    不是"复用"，所以这里退回到读登记：配没配得出来，通没通不知道。
 *
 * 因此本页能回答的是「**我方**配齐了没有」，不是「对方接好了没有」。后者平台从外面
 * 观测不到（C2 权益接入、C3 计量上报、端到端验收三项都是如此），它们留在接入检查单
 * 上由操作员按对方回报勾选——这一点在页面上写明，不含糊过去。
 *
 * ── 检查结果写不写回检查单 ───────────────────────────────────────────────────
 *
 * 写，但**只写自动检查能完整判定的那一项**（`catalog_registered`）。
 * `product_launch_statuses.checked_by` 的 DDL 注释本来就写着「自动校验为 NULL」，
 * 这张表从一开始就预留了自动结果的位置。
 *
 * 两个授权检查**不写**：检查单里没有对应的 item_code，硬塞进 `acceptance` 会把
 * 「端到端跑通了」这个结论替换成「授权配了」——后者远弱于前者，而勾上之后没人分得清
 * 当时勾的是哪个意思。它们作为就绪度信息呈现，供操作员判断 `acceptance` 该不该勾。
 *
 * `c1_identity` 也不写，理由更硬：**它的定义里有一半是对方的事**（RP 实现），自动打勾
 * 等于替对方声明完成。判据统一成一句——**一项检查只有在它的全部内容都被本次实测覆盖时
 * 才写回检查单**，否则只呈现不落库。
 */

import { api, OperaApiError } from "@/lib/api";

export type CheckStatus = "pass" | "fail" | "skipped";

/** 谁能让这一项通过。「对方」的项本页测不了，只会出现在检查单上。 */
export type CheckSide = "ours" | "theirs";

export interface CheckResult {
  id: string;
  label: string;
  /** 这一项在测什么，一句话。 */
  what: string;
  side: CheckSide;
  status: CheckStatus;
  /** 通过时的事实、失败时的原因——都要具体，不要「检查失败」。 */
  detail: string;
  /** 失败时该做什么；通过时为 null。 */
  remedy: string | null;
  /** 对应的接入检查项，有则把结果写回去。 */
  itemCode?: string;
  /** 去哪儿修。 */
  href?: string;
}

interface ProductLike {
  id: string;
  productCode: string;
  origin: string;
  originProvider: string | null;
}

interface OidcClientLite {
  clientId: string;
  state: string;
  redirectUris: string[];
}

interface AtlasGrantLite {
  endpointCode: string;
  isActive: boolean;
  expiresAt: string | null;
}

interface RunosGrantLite {
  capabilityId: string;
  state: string;
}

interface WebhookLite {
  webhookUrl: string | null;
  webhookSecretRef: string | null;
}

function reason(error: unknown, fallback: string): string {
  return error instanceof OperaApiError ? error.message : fallback;
}

/**
 * 跑一遍平台侧检查。
 *
 * 五项**并发**发出：它们互不依赖，串行只是把五个来回排成一队。任何一项自身抛错
 * （上游 500、鉴权失败）都记成 `fail` 并把原文带出来——**不记成通过**。读不到不等于
 * 没问题，这一点与目录页上线门槛的失败方向一致。
 */
export async function runLaunchChecks(
  product: ProductLike,
): Promise<CheckResult[]> {
  const [clients, atlasGrants, runosGrants, webhook] = await Promise.all([
    api
      .get<
        OidcClientLite[]
      >(`/api/oidc-clients?productId=${encodeURIComponent(product.id)}`)
      .catch((e: unknown) => e as Error),
    api
      .get<
        AtlasGrantLite[]
      >(`/api/atlas/product-grants?includeInactive=true&productCode=${encodeURIComponent(product.productCode)}`)
      .catch((e: unknown) => e as Error),
    api
      .get<
        RunosGrantLite[]
      >(`/api/runos/grants/product/${encodeURIComponent(product.productCode)}`)
      .catch((e: unknown) => e as Error),
    api
      .get<WebhookLite | null>(`/api/products/${product.id}/webhook`)
      .catch((e: unknown) => e as Error),
  ]);

  const results: CheckResult[] = [];

  /* ① 产品登记 —— 纯本地判定，不打任何接口。third_party 缺 originProvider 时
        DB CHECK 其实会挡住写入，但目录里可能有更早写进去的历史行。 */
  const registrationOk =
    product.origin !== "third_party" || !!product.originProvider?.trim();
  results.push({
    id: "catalog",
    label: "产品登记",
    what: "产品码已存在，来源信息完整——它是后面每一项的前提（授权按产品码配，令牌的 act.sub 就是它）。",
    side: "ours",
    status: registrationOk ? "pass" : "fail",
    detail: registrationOk
      ? `产品码 ${product.productCode}`
      : "来源标为第三方接入，但没填接入方名称。",
    remedy: registrationOk ? null : "在产品目录里编辑这一行，补上「接入方」。",
    itemCode: "catalog_registered",
    href: `/product/catalog?productId=${encodeURIComponent(product.id)}`,
  });

  /* ② 接入凭据 —— 只测**我方**这一半：client 注册了、启用着、有回调地址。
        对方有没有把登录/回调/会话真正实现出来，平台从外面看不见。 */
  if (clients instanceof Error) {
    results.push({
      id: "client",
      label: "接入凭据",
      what: "产品有一个启用中的 OIDC 客户端，且配了回调地址。",
      side: "ours",
      status: "fail",
      detail: reason(clients, "读取 OIDC 客户端失败"),
      remedy: "读不到不等于没配。先解决读取失败，再重跑。",
      href: `/product/clients?productId=${encodeURIComponent(product.id)}`,
    });
  } else {
    const active = clients.filter((c) => c.state === "active");
    const withRedirect = active.filter((c) => c.redirectUris.length > 0);
    const ok = withRedirect.length > 0;
    results.push({
      id: "client",
      label: "接入凭据",
      what: "产品有一个启用中的 OIDC 客户端，且配了回调地址。**只测我方注册**——对方有没有把登录/回调/会话实现出来，平台观测不到。",
      side: "ours",
      status: ok ? "pass" : "fail",
      detail: ok
        ? `${withRedirect.length} 个启用中的客户端：${withRedirect.map((c) => c.clientId).join("、")}`
        : active.length === 0
          ? clients.length === 0
            ? "这个产品下没有任何 OIDC 客户端。"
            : `有 ${clients.length} 个客户端但全部处于禁用状态。`
          : "客户端启用着，但没有配任何回调地址——换票流程走不完。",
      remedy: ok
        ? null
        : "去「接入凭据」注册或启用一个客户端，并补上回调地址。",
      /* **刻意不写回 `c1_identity`。** 那个检查项的定义是「OIDC 客户端已注册 **且对方
         已实现登录/回调/会话**」，而本检查只看得到前半句——`lifecycle.ts` 的 `THEIR_SIDE`
         也把它归在对方那一侧。自动打勾等于替对方声明「我实现完了」，而验证态由检查单
         推导、确认上线又以验证态为门槛，一路下去就是**自己造出来的假绿灯**。
         平台侧结论照常在本页显示，勾不勾由操作员按对方回报决定。 */
      href: `/product/clients?productId=${encodeURIComponent(product.id)}`,
    });
  }

  /* ③ 模型路由授权 —— 到期在**读时**判定，所以"启用中但已过期"要算失败：
        isActive 说它有效，网关那边不会放行。 */
  if (atlasGrants instanceof Error) {
    results.push({
      id: "atlas-grants",
      label: "模型路由授权",
      what: "产品至少持有一条生效中的模型路由。",
      side: "ours",
      status: "fail",
      detail: reason(atlasGrants, "读取模型路由授权失败"),
      remedy: "读不到不等于没配。先解决读取失败，再重跑。",
      href: `/model/grants?productCode=${encodeURIComponent(product.productCode)}`,
    });
  } else {
    const now = Date.now();
    const live = atlasGrants.filter(
      (g) =>
        g.isActive && (!g.expiresAt || new Date(g.expiresAt).getTime() > now),
    );
    const expired = atlasGrants.filter(
      (g) =>
        g.isActive && g.expiresAt && new Date(g.expiresAt).getTime() <= now,
    );
    results.push({
      id: "atlas-grants",
      label: "模型路由授权",
      what: "产品至少持有一条生效中的模型路由。过期的不算——到期在读时判定，网关不会因为 isActive 还是 true 就放行。",
      side: "ours",
      status: live.length > 0 ? "pass" : "fail",
      detail:
        live.length > 0
          ? `${live.length} 条生效中${expired.length > 0 ? `（另有 ${expired.length} 条标着启用但已过期）` : ""}：${live
              .slice(0, 5)
              .map((g) => g.endpointCode)
              .join("、")}${live.length > 5 ? " 等" : ""}`
          : expired.length > 0
            ? `${expired.length} 条授权都标着启用但已经过期。`
            : "这个产品调不到任何模型路由。",
      remedy:
        live.length > 0
          ? null
          : expired.length > 0
            ? "去「路由授权」续期或重新发一条。"
            : "去「路由授权」为这个产品发一条。",
      href: `/model/grants?productCode=${encodeURIComponent(product.productCode)}`,
    });
  }

  /* ④ 能力授权 —— derived 行也算持有（ADR-005 闭包推导的结果与 direct 等效）。 */
  if (runosGrants instanceof Error) {
    results.push({
      id: "runos-grants",
      label: "能力授权",
      what: "产品至少持有一条 active 的能力授权。",
      side: "ours",
      status: "fail",
      detail: reason(runosGrants, "读取能力授权失败"),
      remedy: "读不到不等于没配。先解决读取失败，再重跑。",
      href: `/capability/grants?productCode=${encodeURIComponent(product.productCode)}`,
    });
  } else {
    const active = runosGrants.filter((g) => g.state === "active");
    results.push({
      id: "runos-grants",
      label: "能力授权",
      what: "产品至少持有一条 active 的能力授权（derived 行同样算——它是闭包推导的结果，与 direct 等效）。",
      side: "ours",
      status: active.length > 0 ? "pass" : "fail",
      detail:
        active.length > 0
          ? `${active.length} 条：${active
              .slice(0, 5)
              .map((g) => g.capabilityId)
              .join("、")}${active.length > 5 ? " 等" : ""}`
          : "这个产品调不到任何能力。",
      remedy: active.length > 0 ? null : "去「能力授权」为这个产品发一条。",
      href: `/capability/grants?productCode=${encodeURIComponent(product.productCode)}`,
    });
  }

  /* ⑤ Webhook 登记 —— **只看登记，不发投递**。理由见文件头。 */
  if (webhook instanceof Error) {
    results.push({
      id: "webhook",
      label: "Webhook 登记",
      what: "平台侧登记了回调地址与签名密钥引用。",
      side: "ours",
      status: "fail",
      detail: reason(webhook, "读取 webhook 登记失败"),
      remedy: "读不到不等于没配。先解决读取失败，再重跑。",
    });
  } else {
    const hasUrl = !!webhook?.webhookUrl?.trim();
    const hasSecret = !!webhook?.webhookSecretRef?.trim();
    results.push({
      id: "webhook",
      label: "Webhook 登记",
      what: "平台侧登记了回调地址与签名密钥引用。**不发测试投递**——那是对对方生产端点的真实请求，本页不做；投递能不能成功要看运行监控里的投递队列。",
      side: "ours",
      status: hasUrl && hasSecret ? "pass" : "fail",
      detail:
        hasUrl && hasSecret
          ? `回调 ${webhook!.webhookUrl}，密钥引用 ${webhook!.webhookSecretRef}`
          : !webhook
            ? "这个产品没有 webhook 登记行。"
            : hasUrl
              ? "登记了回调地址，但没有签名密钥引用——对方无法验签。"
              : "登记行存在，但没有回调地址。",
      remedy:
        hasUrl && hasSecret
          ? null
          : hasUrl
            ? "去产品目录的「Webhook 登记」补上签名密钥引用。"
            : "去产品目录的「Webhook 登记」填回调地址与签名密钥引用。",
      /* 原来指 `/ops/logs`（投递日志）——那是看结果的地方，不是配置的地方；配置入口
         2026-08-16 补在产品目录的行操作里，这里跟着指过去。 */
      href: `/product/catalog?productId=${encodeURIComponent(product.id)}`,
    });
  }

  return results;
}

export function allPassed(results: readonly CheckResult[]): boolean {
  return results.length > 0 && results.every((r) => r.status === "pass");
}
