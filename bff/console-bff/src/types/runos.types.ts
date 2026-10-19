/**
 * Public desktop catalog projection and upstream validation.
 * @package @vxture/bff-console
 * @layer Application
 * @category Types
 * @author AI-Generated
 * @date 2026-10-19
 */
// --- Public metadata ------------------------------------------------------

export interface RunosCapabilityMetadata {
  capability_id: string;
  title: string;
  display_name: Record<string, string>;
  primitive_type: string;
  category: string;
  tags: string[];
}

export interface RunosCatalogPage {
  items: RunosCapabilityMetadata[];
  nextCursor: string | null;
  total: number;
  version: string;
}

// --- Upstream validation --------------------------------------------------

/** Copy only public keys; malformed upstream data must never poison a cache. */
export function parseRunosCatalogPage(
  value: unknown,
  limit: number,
): RunosCatalogPage {
  if (
    !record(value) ||
    !Array.isArray(value.items) ||
    value.items.length > limit ||
    !Number.isSafeInteger(value.total) ||
    (value.total as number) < value.items.length ||
    typeof value.version !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.version) ||
    !(
      value.nextCursor === null ||
      (typeof value.nextCursor === "string" &&
        /^[A-Za-z0-9_-]{1,4096}$/.test(value.nextCursor))
    )
  ) {
    throw new Error("Invalid catalog page");
  }
  const ids = new Set<string>();
  const items = value.items.map((item: unknown): RunosCapabilityMetadata => {
    if (
      !record(item) ||
      typeof item.capability_id !== "string" ||
      !item.capability_id ||
      typeof item.title !== "string" ||
      !record(item.display_name) ||
      Object.values(item.display_name).some(
        (name) => typeof name !== "string",
      ) ||
      typeof item.primitive_type !== "string" ||
      !["skill", "connector", "executor", "asset"].includes(
        item.primitive_type,
      ) ||
      typeof item.category !== "string" ||
      !Array.isArray(item.tags) ||
      item.tags.some((tag) => typeof tag !== "string") ||
      ids.has(item.capability_id)
    ) {
      throw new Error("Invalid catalog item");
    }
    ids.add(item.capability_id);
    return {
      capability_id: item.capability_id,
      title: item.title,
      display_name: Object.fromEntries(
        Object.entries(item.display_name),
      ) as Record<string, string>,
      primitive_type: item.primitive_type,
      category: item.category,
      tags: [...item.tags] as string[],
    };
  });
  if (
    value.nextCursor !== null &&
    (items.length === 0 || (value.total as number) <= items.length)
  ) {
    throw new Error("Invalid catalog continuation");
  }
  return {
    items,
    nextCursor: value.nextCursor as string | null,
    total: value.total as number,
    version: value.version,
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
