import { minimatch } from "minimatch";
import type { RouteDescriptor } from "../types/route.js";
import { MUTATING_METHODS } from "../types/route.js";
import type { MCPConfig } from "../types/config.js";

export interface FilterDecision {
  include: boolean;
  reason?: string;
}

/**
 * A trailing "/*" is treated as "everything under this prefix" (i.e. "/**"),
 * not a strict single-segment glob — "/admin/*" is expected to exclude
 * "/admin/users/:id" and "/admin/users/:id/orders", not just one-level-deep
 * paths. Any other glob syntax passes through to minimatch unchanged.
 */
function normalizePattern(pattern: string): string {
  return pattern.endsWith("/*") ? `${pattern.slice(0, -1)}**` : pattern;
}

function matchesAny(value: string, patterns: string[] | undefined): boolean {
  if (!patterns || patterns.length === 0) return false;
  return patterns.some((p) => minimatch(value, normalizePattern(p)));
}

/**
 * Route-path-level filtering: config.include/exclude, per-route mcp:false,
 * and allowMutations. Operates BEFORE tool names exist (on the raw path),
 * per architecture.md — this is distinct from tools.include/exclude, which
 * runs after naming (see filterByToolName below).
 */
export function filterRoute(route: RouteDescriptor, config: MCPConfig): FilterDecision {
  if (route.mcp?.enabled === false) {
    return { include: false, reason: "excluded via per-route mcp:false" };
  }

  if (config.allowMutations === false && MUTATING_METHODS.has(route.method)) {
    return { include: false, reason: `excluded: allowMutations is false and method is ${route.method}` };
  }

  if (config.exclude && matchesAny(route.path, config.exclude)) {
    return { include: false, reason: `excluded by config.exclude pattern` };
  }

  if (config.include && config.include.length > 0 && !matchesAny(route.path, config.include)) {
    return { include: false, reason: `not matched by config.include` };
  }

  return { include: true };
}

/** Tool-name-level filtering: config.tools.include/exclude, run after naming. */
export function filterToolName(name: string, config: MCPConfig): FilterDecision {
  const toolsConfig = config.tools;
  if (!toolsConfig) return { include: true };

  if (toolsConfig.exclude && matchesAny(name, toolsConfig.exclude)) {
    return { include: false, reason: "excluded by config.tools.exclude pattern" };
  }

  if (toolsConfig.include && toolsConfig.include.length > 0 && !matchesAny(name, toolsConfig.include)) {
    return { include: false, reason: "not matched by config.tools.include" };
  }

  return { include: true };
}
