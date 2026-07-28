# Vxture Model Platform — Retired (extracted to Atlas)

**Version**: 2.0.0
**Updated**: 2026-07-28
**Status**: Retired. This board's implementation lived in this repo as `services/model/platform` (`@vxture/service-model-platform`) through 2026-07-24, then was extracted via `git filter-repo` into the standalone `vxture-atlas` repo. The in-repo service was deleted 2026-07-28 once `MODEL_PLATFORM_URL` was confirmed pointed at the external atlas host in production.

> 🧭 平台数据模型权威 = [data_platform_100_architecture.md](../data_platform_100_architecture.md) + [data_platform_200_schema.md](../data_platform_200_schema.md)；落地见 [data_platform_300_migration.md](../data_platform_300_migration.md)。

## Current state

- **终态产品名 = Atlas**（2026-07-06 定名，[`product_100_matrix.md`](../product_100_matrix.md) v1.0，L1 模型平台）：统一模型接入/路由/配额/用量治理，大模型与专用小模型唯一宿主、唯一 LLM 出口与计量口径。
- Atlas's own architecture, HTTP contract, and S2S supply-face design are authoritative in the `vxture-atlas` repo, not here:
  - `vxture-atlas/docs/20-specs/10-http-surface.md` — current HTTP surface (data plane `/v1/*`, capability plane `/capability/*`).
  - `vxture-atlas/docs/30-design/200-s2s-provider-surface.md` — S2S supply-face contract (embedding/parse/rerank/generation).
- How this platform (admin/console/varda/karda and other L2/L3 agents) integrates with Atlas: [`41-atlas-integration-topology.md`](./41-atlas-integration-topology.md).
- Real provider registry planning (naming, domestic-first, overseas registered-closed, egress path): [`42-model-provider-registry-plan.md`](./42-model-provider-registry-plan.md).

## Tech debt carried through retirement

See `docs/60-operations/10-tech-debt.md`: TD-005/006/007 marked obsolete (described the retired service's own implementation gaps — now atlas's concern, tracked in its own repo); TD-008 narrowed to the commerce-side overage-billing gap, which survives the retirement since it's this repo's own responsibility; TD-043 records a newly-found gap (platform calls to atlas's capability/data plane carry no S2S auth token).
