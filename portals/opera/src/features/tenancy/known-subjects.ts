/**
 * known-subjects.ts — 平台库里没有、但**已查明来历**的用量主体。
 * @package @vxture/opera
 * @layer Presentation
 *
 * 查号台查不到的 id 默认显示「平台无此租户 / 工作区」。其中查明了来历的，登记在这里，
 * 显示成它真正是什么——owner 2026-09-15：「追一下，然后可以正确登记。」
 *
 * 登记的门槛是**有据可查**：每一条都写明证据在哪。id 只用来匹配，**永不显示**
 * （owner 铁律：任何界面不展示 UUID）。
 */

export interface KnownSubject {
  /** 主显示名（租户位 / 工作区主行）。 */
  name: string;
  /** 副标题（工作区次行 / 租户可视码位）。 */
  detail: string;
  /** 悬停说明：它是什么、为什么平台库里没有。 */
  title: string;
}

/**
 * Atlas 上线前的生产实测。
 *
 * 证据（2026-09-15 追查）：
 *  - Atlas 请求日志里这对租户 / 工作区共 114 条，2026-07-28 至 08-10：doubao 对话 6 条、
 *    embedding-3 1 条、zhipu rerank 108 条（08-10 05:43–07:52 UTC，5 次预热 + 100 次顺序
 *    调用 + 几次判别 canary）。全部 productCode / downstreamIdentityHash 为空——令牌里
 *    没有 act.sub，不是经平台令牌交换来的产品调用。
 *  - 108 条 rerank 就是 Atlas 交付给 karda 的延迟基准：vxture-atlas
 *    docs/30-design/200-s2s-provider-surface.md「measured 2026-08-10 in production …
 *    100 sequential runs after 5 warmups, on-host caller」，karda#89 / vxture-karda d1d1637。
 *  - 租户 id 是 Atlas 单测里的固定夹具（request-log.service.spec.ts 的 VALID_UUID 等），
 *    工作区 id 在任何仓库里都没有——是实测时临时填的。平台库从来没有这两个主体。
 */
const ATLAS_PRELAUNCH_TEST: KnownSubject = {
  name: "Atlas 实测",
  detail: "上线前测试",
  title:
    "Atlas 上线前在生产环境做的实测（2026-07-28 至 08-10，含 8-10 的 rerank 百次延迟基准）。租户号取自 Atlas 测试用例里的固定值，平台库里本来就没有这个主体——不属于任何租户，也没有计费。",
};

const KNOWN_TENANTS: Readonly<Record<string, KnownSubject>> = {
  "2a4271d4-ac9a-4fa6-b479-4f71d8e996e8": ATLAS_PRELAUNCH_TEST,
};

const KNOWN_WORKSPACES: Readonly<Record<string, KnownSubject>> = {
  "13306e79-73ec-42a3-b6ba-4eb73ee07f8c": ATLAS_PRELAUNCH_TEST,
};

export function knownTenant(id: string): KnownSubject | undefined {
  return KNOWN_TENANTS[id.trim().toLowerCase()];
}

export function knownWorkspace(id: string): KnownSubject | undefined {
  return KNOWN_WORKSPACES[id.trim().toLowerCase()];
}
