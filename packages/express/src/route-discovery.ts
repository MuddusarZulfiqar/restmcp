import type { Application } from "express";
import type { HttpMethod, ParamDescriptor, RouteDescriptor } from "@restmcp/core";

/**
 * Express's Layer objects don't store their mount path as a plain string
 * (it's only computed per-request by Layer.prototype.match). For a route
 * layer (`layer.route`), the original literal path IS stored statically on
 * the Route object — that's the common, reliable case. For a layer added
 * via `router.use(mountPath, subRouter)`, the mount path only exists baked
 * into the compiled `layer.regexp` (built by path-to-regexp). We recover it
 * by pattern-matching that regexp's own source against the small set of
 * shapes path-to-regexp is known to produce for plain string paths, and
 * substituting back `:paramName` for the `(?:(...))`-style capture groups
 * using `layer.keys`. This is runtime framework metadata inspection (the
 * Layer/Route objects Express itself builds), not source-code scanning —
 * same technique used by the `express-list-endpoints` package.
 */
const MOUNT_PATH_REGEXP = /^\/\^\\\/(?:(:?[\w\\.-]*(?:\\\/:?[\w\\.-]*)*)|(\(\?:\([^)]+\)\)))\\\/.*/;
const PARAM_CAPTURE_GROUP = /\(\?:\([^)]+\)\)/;

interface ExpressKey {
  name: string | number;
}

interface ExpressLayer {
  name?: string;
  path?: string;
  /** Express 4 only — Express 5 replaced this with opaque `matchers` (see recoverMountSegment). */
  regexp?: RegExp;
  keys: ExpressKey[];
  route?: ExpressRoute;
  handle?: { stack?: ExpressLayer[] } & ((...args: unknown[]) => unknown);
}

interface ExpressRoute {
  path: string | string[];
  methods: Record<string, boolean>;
  stack: Array<{ method: string }>;
}

/** The handful of layer.name values Express/Router use for "this wraps another stack of layers". */
const NESTED_STACK_NAMES = new Set(["router", "bound dispatch", "mounted_app"]);

function hasParamPlaceholders(source: string): boolean {
  return PARAM_CAPTURE_GROUP.test(source);
}

function recoverMountSegment(layer: ExpressLayer): string | null {
  // Express 5 (path-to-regexp v8) no longer exposes a `regexp` to introspect —
  // mount layers only carry an opaque `matchers` function, which doesn't
  // reveal its compiled pattern. Recovering the prefix isn't currently
  // possible there; callers must skip (not guess) when this returns null.
  if (!layer.regexp) return null;

  let source = layer.regexp.toString();
  let match = MOUNT_PATH_REGEXP.exec(source);
  if (!match) return null;

  let paramIndex = 0;
  while (hasParamPlaceholders(source)) {
    const key = layer.keys[paramIndex];
    if (!key) break;
    source = source.replace(PARAM_CAPTURE_GROUP, `:${key.name}`);
    paramIndex += 1;
  }

  match = MOUNT_PATH_REGEXP.exec(source) ?? match;
  const captured = match[1] ?? match[2];
  if (!captured) return null;

  return captured.replace(/\\\//g, "/");
}

function joinPath(base: string, segment: string): string {
  if (segment === "/" || segment === "") return base || "/";
  const normalizedBase = base.endsWith("/") ? base.slice(0, -1) : base;
  const normalizedSegment = segment.startsWith("/") ? segment : `/${segment}`;
  return `${normalizedBase}${normalizedSegment}`;
}

function extractPathParams(path: string): ParamDescriptor[] {
  const names = path.match(/:[A-Za-z0-9_]+/g) ?? [];
  return names.map((n) => ({ name: n.slice(1), in: "path", type: "string", required: true }));
}

const ALL_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

function routeDescriptorsFromRoute(route: ExpressRoute, basePath: string): RouteDescriptor[] {
  const paths = Array.isArray(route.path) ? route.path : [route.path];
  const methods = Object.keys(route.methods)
    .filter((m) => m !== "_all")
    .map((m) => m.toUpperCase())
    .filter((m): m is HttpMethod => ALL_METHODS.includes(m));

  const descriptors: RouteDescriptor[] = [];
  for (const path of paths) {
    const fullPath = joinPath(basePath, path);
    const params = extractPathParams(fullPath);
    for (const method of methods) {
      descriptors.push({ method, path: fullPath, params });
    }
  }
  return descriptors;
}

function walkStack(stack: ExpressLayer[], basePath: string, out: RouteDescriptor[]): void {
  for (const layer of stack) {
    if (layer.route) {
      out.push(...routeDescriptorsFromRoute(layer.route, basePath));
      continue;
    }

    if (!layer.name || !NESTED_STACK_NAMES.has(layer.name)) continue;
    const nestedStack = layer.handle?.stack;
    if (!nestedStack) continue;

    const mountSegment = recoverMountSegment(layer);
    if (!mountSegment) {
      // Can't recover this mount's prefix (e.g. Express 5 — see
      // recoverMountSegment) — skip routes under it rather than register
      // them with a silently wrong/incomplete path that would 404 when
      // actually invoked. Use mcp.register() for these routes instead.
      continue;
    }
    walkStack(nestedStack, joinPath(basePath, mountSegment), out);
  }
}

/**
 * Walks an Express application's router stack and returns one RouteDescriptor
 * per (method, path). Only path params are populated automatically — Express
 * has no declarative convention for query params or request bodies, so those
 * stay empty unless supplied via MCPExpress.tool()/register() overrides (see
 * adapter.ts) or an OpenAPI document the developer provides.
 */
function getRootStack(app: Application): ExpressLayer[] | undefined {
  const appWithRouter = app as unknown as { _router?: { stack?: ExpressLayer[] }; router?: { stack?: ExpressLayer[] } };

  // Express 4 exposes the root router as `app._router` (undefined until the
  // first route is registered, since it's created lazily).
  if (appWithRouter._router?.stack) return appWithRouter._router.stack;

  // Express 5 renamed it to `app.router` and dropped `_router` entirely —
  // but Express 4 *also* still has an `app.router` property, kept only as a
  // deprecated accessor that throws on access ("'app.router' is deprecated!").
  // So this must be a try, not a plain `??`: on Express 4 with zero routes
  // registered yet, reading `.router` at all throws, and the right answer
  // here is still "no routes", not an uncaught exception.
  try {
    return appWithRouter.router?.stack;
  } catch {
    return undefined;
  }
}

export function discoverExpressRoutes(app: Application): RouteDescriptor[] {
  const stack = getRootStack(app);
  if (!stack) return [];

  const routes: RouteDescriptor[] = [];
  walkStack(stack, "", routes);

  // De-duplicate identical (method, path) pairs that can arise from multiple
  // middleware layers matching the same route definition.
  const seen = new Set<string>();
  return routes.filter((r) => {
    const key = `${r.method} ${r.path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
