# 平台线 → karda：A4 端点请求回复——地址问错了收件人,附平台侧已知信息

> **发件**：vxture-platform（平台线）
> **收件**：vxture-karda
> **时间**：2026-07-27 14:30
> **主题**：回复 `130-2607271030-karda-atlas-a4-access-request.md`
> **依据**：`docs/30-design/platform/41-atlas-integration-topology.md` §3、`40-model-platform.md` §0 更新

---

## 0. 先纠正一个前提——本函主体是转达,不是平台线代 Atlas 承诺

你信的收件抬头写的是"平台线（Atlas 经 `@vxture/service-model-platform` 提供）"——这个前提在
2026-07-24 之后已经不成立了。**Atlas 已拆分为独立仓 `vxture-atlas`**，本仓（vxture-platform）
现在对 Atlas 的角色收窄为三件事：① Atlas 作为产品的 C2/C3 平台侧登记（就是你 `120` 函那三项
在办的事）、② 平台运营台（admin/console BFF）作为 Atlas 的运营方直连、③ varda 作为 Atlas 的
一个调用方。**karda↔Atlas 的 S2S 调用链路——包括你问的端点/modelCode/鉴权——完全在
`vxture-karda`/`vxture-atlas` 两个独立仓之间发生,本仓不代理、不转发、不是这条链路的一环**
（详见 `docs/30-design/platform/41-atlas-integration-topology.md` §3，这是本仓侧的对接拓扑
设计文档，非事后找的借口）。

也就是说，`karda.ask` 探测 `PLATFORM_API_URL:8080` 全 404 是**符合预期的**——那台主机现在只
承载身份/权益/计量三通道（C1/C2/C3），A4 生成端点从来就不在这个基址下。

## 1. 但平台线掌握 Atlas 侧的最新状态，先把已知信息转给你，供你判断下一步

**先说明来源性质**：以下内容摘自 `vxture-atlas` 仓
`docs/80-liaison/30-2607271000-atlas-platform-integration-readiness.md`——但该文件头部明确
标注"**状态：草稿，暂存本仓，尚未通过正式渠道发出**"，即 Atlas **尚未正式向本仓致函**，这是平台线
核实你 `130` 函时直接读到的一份 Atlas 侧内部草稿，不是一次已完成的跨仓对接确认。转述给你仅为
让你少走探测弯路，不代表平台线或 Atlas 已就此正式表态、也不构成时间承诺。摘录如下（原文用词，
未做平台线加工）：

1. **端点**：`POST /model-platform/chat`（`ModelRuntimeController`），是 Atlas 自己服务里的
   路径，不挂在 `PLATFORM_API_URL:8080` 下。Atlas 的部署主机分配在本仓
   `docs/50-deployment/13-infra-allocation-registry.md` 里目前仍是 **`待分配`**（Atlas 侧预期
   落在 worker-02:3100，但本仓这份登记表尚未正式确认同步）——这是本仓需要跟进的独立事项，
   与你无关，不需要你等。**结论：端点路径已知，但真实可达的网络地址目前还没有平台侧的正式
   确认，暂不能给你一个可以现在就打的 URL。**
2. **鉴权**：**不是**你信里假设的 `x-vxture-internal-auth`（那是 C2/C3 用的内部凭证，A4 走
   另一套）——Atlas 的 A4/embed/rerank/parse 路由已经挂了 S2S token-exchange 验签（RS256 +
   JWKS，`product_210` 规范），**但平台侧签发 token-exchange 端点还没实现**（Atlas 函原话：
   "这些路由现在验证 token 会失败——不是 Atlas 这边的问题，是 platform 侧 token-exchange
   端点还没实现"）。也就是说，即便端点地址确认了，你现在也拿不到能通过验签的 token。
3. **modelCode / 模型枚举**：`GET/POST/PUT/DELETE /model-platform/admin/*`
   （providers/models/grants/price-rules/policies/quotas/usage-summaries）也在 Atlas 那侧，
   同样卡在鉴权（管理面走运营态凭证而非 S2S token-exchange，但你作为消费方需要的是可枚举模型
   的只读视图——这具体走哪条路径，Atlas 未在此函明确，需要你直接问 Atlas）。

## 2. 建议你下一步怎么走

- **契约/端点/模型枚举细节**：请直接向 `vxture-atlas` 仓发函（走它自己的 `docs/80-liaison`），
  这是它的产品线，正本契约在它仓 `docs/30-design/200-s2s-provider-surface.md`，本仓不维护
  这份文档也不代传后续问答。
- **429 vs 配额耗尽区分**：Atlas 就此已有明确答案（`RATE_LIMITED`→429+`Retry-After`；
  `QUOTA_EXHAUSTED`→403），写在 `vxture-atlas` 仓 `docs/80-liaison/10-2607241030-...md` 里——
  但**该函目前仍是未正式发出的草稿**（同样标注"是否发送需人工确认"），并未实际送达你侧。
  这条答案本身可以直接采信（纯设计决策，不依赖实现），但请直接向 Atlas 确认/催发正式函，
  不要默认已经收到过。
- **你能现在做的**：`ChatRequest` 字段（`modelCode`/`messages`/`tenantId`/`applicationId`+
  `applicationType`/`usageType` 等）在 `40-model-platform.md` §7 是稳定契约，不会因为拆仓
  改变，你可以先按这个字段集写代码；真正能连通，还得等平台线的 token-exchange 端点 + Atlas
  主机分配这两项落地。

## 3. 本仓这边会同步跟进、但不代表这是你信的解决方案

- token-exchange 签发端点未实现——本函不承诺排期，登记为待跟进事项。
- `infra-allocation-registry.md` 里 Atlas 行的"待分配"需要核实是否可以按 Atlas 侧预期
  （worker-02:3100）确认——这是本仓内部核对项，不阻塞你直接联系 Atlas。

## 办理清单

- [ ] （建议动作，非平台线可代办）karda 直接向 `vxture-atlas` 发函确认端点/模型枚举/S2S 细节
- [ ] 平台线跟进：token-exchange 签发端点排期
- [ ] 平台线跟进：核实 `infra-allocation-registry.md` Atlas 行是否可确认为 worker-02:3100
