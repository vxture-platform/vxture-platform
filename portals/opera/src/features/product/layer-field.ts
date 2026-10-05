/**
 * layer-field.ts — 产品页「产品分层」下拉的三条纯逻辑（owner 2026-10-04，决策 3）。
 * @package @vxture/opera
 * @layer Presentation
 * @category Features - Product
 *
 * 搬出组件是为了能测（opera 的 vitest 不装 jsdom，见 vitest.config.ts）。三件事：
 *
 *   1. **选项**：登记（新建）时没有「未分类」——分层必填，登记处（opera-bff）对空值 400。
 *      改一个已有分层的产品时也没有——分层没有「清空」这条路。只有改一个**还没分层**的
 *      产品（umbra 这类刻意不占层的外部边界、或登记处之外的历史行）时，「未分类」作为
 *      **现值**出现在首位：它说的是库里现在就是空，不是一个可以选的目标。
 *   2. **类型蕴含层**：L2 ⇒ 平台族、L3 ⇒ 智能体族（DDL `chk_products_layer_type_family`）。
 *      选了类型就把分层预选上；`undefined` 型推不出层，保留现值。预填不是锁死。
 *   3. **载荷**：空分层**不送**（缺席即不改），而不是送 null——送 null 在登记时会被当成
 *      「送了个空值」拒掉，在改时会被当成「要清空」拒掉；缺席才是「我不动它」。
 */

import { productTypeFamily } from "@vxture/core-utils";
import {
  PRODUCT_LAYER_CHOICES,
  productLayerLabel,
} from "@vxture-platform/shared";

export interface LayerOption {
  readonly value: string;
  readonly label: string;
}

/**
 * 下拉选项。`currentLayer` 是库里的现值（新建时为 null）。
 * `labels.unclassified` 由调用方按当前语言给（opera 的词条 `common.uncategorized`）。
 */
export function layerOptions(
  ctx: { readonly isCreate: boolean; readonly currentLayer: string | null },
  locale: "zh" | "en",
  labels: { readonly unclassified: string },
): readonly LayerOption[] {
  const choices = PRODUCT_LAYER_CHOICES.map((value) => ({
    value,
    label: productLayerLabel(value, locale),
  }));
  const storedEmpty = !ctx.currentLayer?.trim();
  if (ctx.isCreate || !storedEmpty) return choices;
  return [{ value: "", label: labels.unclassified }, ...choices];
}

/** 类型蕴含的层；`undefined` 型（或空）推不出，返回 null。 */
export function impliedLayerForType(productType: string): "L2" | "L3" | null {
  const t = productType.trim();
  if (!t || t === "undefined") return null;
  const family = productTypeFamily(t);
  if (family === "agent") return "L3";
  if (family === "platform") return "L2";
  return null;
}

/** 送进接口的那一段：有值才带 `layer` 键，空值缺席。 */
export function layerPayload(draftLayer: string): { layer?: string } {
  const value = draftLayer.trim();
  return value ? { layer: value } : {};
}
