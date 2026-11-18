/**
 * selection.ts - Selection and batch execution for product grants.
 * @package @vxture/opera
 * @layer Presentation
 * @category utils
 * @author AI-Generated
 * @date 2026-11-18
 */

// ============================================================================
// Types
// ============================================================================

export interface GrantResource {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly category: string;
  readonly tags?: readonly string[];
  readonly held: boolean;
  readonly status?: string;
}

export interface ResourceFilter {
  readonly keyword: string;
  readonly category: string;
  readonly availability: "all" | "available" | "held";
  readonly selectedOnly: boolean;
}

export interface GrantFailure {
  readonly id: string;
  readonly message: string;
}

export interface BatchResult {
  readonly succeeded: string[];
  readonly failed: GrantFailure[];
}

// ============================================================================
// Selection
// ============================================================================

/**
 * Filter the whole catalog before pagination; selection remains independent.
 * @param rows Complete resource catalog.
 * @param filter Combined search and facet filters.
 * @param picked Selection shared across pages and filters.
 * @returns Matching resources in catalog order.
 */
export function filterResources(
  rows: readonly GrantResource[],
  filter: ResourceFilter,
  picked: ReadonlySet<string>,
): GrantResource[] {
  const keyword = filter.keyword.trim().toLocaleLowerCase();
  return rows.filter(
    (row) =>
      (!keyword ||
        [
          row.id,
          row.name,
          row.description,
          row.category,
          ...(row.tags ?? []),
        ].some((value) => value.toLocaleLowerCase().includes(keyword))) &&
      (!filter.category || row.category === filter.category) &&
      (filter.availability === "all" ||
        (filter.availability === "held" ? row.held : !row.held)) &&
      (!filter.selectedOnly || picked.has(row.id)),
  );
}

/**
 * Add or remove eligible matches while preserving choices outside the filter.
 * @param picked Current selection.
 * @param matches Resources affected by this selection action.
 * @param selected Whether to select or deselect eligible resources.
 * @returns A new, deduplicated selection without mutating the input.
 */
export function selectMatches(
  picked: ReadonlySet<string>,
  matches: readonly GrantResource[],
  selected: boolean,
): Set<string> {
  const next = new Set(picked);
  for (const row of matches) {
    if (row.held) continue;
    if (selected) next.add(row.id);
    else next.delete(row.id);
  }
  return next;
}

// ============================================================================
// Execution
// ============================================================================

/**
 * Keep writes sequential because each capability write recompiles its closure.
 * @param ids Resource identifiers selected for this batch.
 * @param write Existing upstream write operation.
 * @param onProgress Callback after each settled write.
 * @returns Successful identifiers and individual failure reasons.
 */
export async function executeGrantBatch(
  ids: readonly string[],
  write: (id: string) => Promise<void>,
  onProgress: (completed: number) => void,
): Promise<BatchResult> {
  const result: BatchResult = { succeeded: [], failed: [] };
  const unique = [...new Set(ids)];
  for (const [index, id] of unique.entries()) {
    try {
      await write(id);
      result.succeeded.push(id);
    } catch (error: unknown) {
      result.failed.push({
        id,
        message: error instanceof Error ? error.message : "授权失败，请重试",
      });
    }
    onProgress(index + 1);
  }
  return result;
}
