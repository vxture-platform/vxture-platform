/**
 * ui.constants.ts - UI constants
 * @package @vxture-platform/shared
 * @description UI-related constants shared across all layers. Contains semantic color values for consistent UI styling across the platform.
 */

import type { SemanticColor } from "../types/ui.types";

export const SEMANTIC_COLORS: readonly SemanticColor[] = [
  "primary",
  "secondary",
  "brand",
  "info",
  "success",
  "warning",
  "danger",
] as const;
