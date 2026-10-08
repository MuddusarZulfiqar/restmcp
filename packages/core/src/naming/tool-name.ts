import type { HttpMethod } from "../types/route.js";

const METHOD_VERB: Record<HttpMethod, string> = {
  GET: "get",
  POST: "create",
  PUT: "update",
  PATCH: "update",
  DELETE: "delete",
  HEAD: "get",
  OPTIONS: "describe",
};

/** Singularizes a very small set of common pluralization patterns ("users" -> "user"). Good enough for REST resource nouns; not a general inflector. */
function singularize(segment: string): string {
  if (segment.endsWith("ies")) return segment.slice(0, -3) + "y";
  if (segment.endsWith("ses")) return segment.slice(0, -2);
  if (segment.endsWith("s") && !segment.endsWith("ss")) return segment.slice(0, -1);
  return segment;
}

function toSnake(segment: string): string {
  return segment
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase();
}

interface PathSegment {
  raw: string;
  isParam: boolean;
}

function splitPath(path: string): PathSegment[] {
  return path
    .split("/")
    .filter(Boolean)
    .map((seg) => ({ raw: seg, isParam: seg.startsWith(":") || (seg.startsWith("{") && seg.endsWith("}")) }));
}

/**
 * Derives a deterministic base tool name from method + path.
 *   GET    /users          -> list_users
 *   GET    /users/:id      -> get_user
 *   POST   /users          -> create_user
 *   PUT    /users/:id      -> update_user
 *   DELETE /users/:id      -> delete_user
 *
 * `extraSegments` controls how many additional leading path segments (beyond
 * the last resource noun) are folded in — used for collision resolution.
 */
export function deriveToolName(method: HttpMethod, path: string, extraSegments = 0): string {
  const segments = splitPath(path);
  const resourceSegments = segments.filter((s) => !s.isParam);
  const lastResource = resourceSegments[resourceSegments.length - 1];
  const endsWithParam = segments.length > 0 && segments[segments.length - 1]!.isParam;

  const isList = method === "GET" && !endsWithParam && resourceSegments.length > 0;
  const verb = isList ? "list" : METHOD_VERB[method];

  const noun = lastResource ? toSnake(isList ? lastResource.raw : singularize(lastResource.raw)) : "root";

  if (extraSegments <= 0 || resourceSegments.length <= 1) {
    return `${verb}_${noun}`;
  }

  const precedingResource = resourceSegments[resourceSegments.length - 1 - extraSegments];
  if (!precedingResource) return `${verb}_${noun}`;

  return `${verb}_${toSnake(singularize(precedingResource.raw))}_${noun}`;
}

export interface NamedRoute<T> {
  method: HttpMethod;
  path: string;
  item: T;
}

/**
 * Assigns deterministic, collision-free tool names to a batch of routes.
 * Resolution order on collision: every route sharing a base name is
 * disambiguated together by folding in preceding path segments (so
 * "/admin/users/:id" and "/public/users/:id" both become prefixed —
 * "get_admin_user" / "get_public_user" — rather than the first claiming the
 * plain name and the second getting an arbitrary suffix), then (if segments
 * run out and names still collide) a numeric suffix per the brief's example.
 */
export function assignToolNames<T>(routes: NamedRoute<T>[]): Array<{ name: string; item: T }> {
  const baseNames = routes.map((r) => deriveToolName(r.method, r.path, 0));

  const groups = new Map<string, number[]>();
  baseNames.forEach((name, i) => {
    const indices = groups.get(name);
    if (indices) indices.push(i);
    else groups.set(name, [i]);
  });

  const resolved = new Array<string>(routes.length);

  for (const indices of groups.values()) {
    if (indices.length === 1) {
      resolved[indices[0]!] = baseNames[indices[0]!]!;
      continue;
    }

    let extra = 1;
    let candidates = indices.map((i) => deriveToolName(routes[i]!.method, routes[i]!.path, extra));

    while (new Set(candidates).size < candidates.length) {
      const next = indices.map((i) => deriveToolName(routes[i]!.method, routes[i]!.path, extra + 1));
      const changed = next.some((n, j) => n !== candidates[j]);
      if (!changed) break; // no more preceding segments left to fold in
      extra += 1;
      candidates = next;
    }

    const seenInGroup = new Map<string, number>();
    indices.forEach((idx, j) => {
      const candidate = candidates[j]!;
      const count = seenInGroup.get(candidate) ?? 0;
      seenInGroup.set(candidate, count + 1);
      resolved[idx] = count === 0 ? candidate : `${candidate}_${count + 1}`;
    });
  }

  // Final global pass: numeric-suffix the rare case where two different
  // groups' resolved names still collide with each other.
  const used = new Set<string>();
  return routes.map((route, i) => {
    let name = resolved[i]!;
    if (used.has(name)) {
      let suffix = 2;
      let candidate = `${name}_${suffix}`;
      while (used.has(candidate)) {
        suffix += 1;
        candidate = `${name}_${suffix}`;
      }
      name = candidate;
    }
    used.add(name);
    return { name, item: route.item };
  });
}
