import type { Application, RequestHandler } from "express";
import {
  type HttpMethod,
  type JSONSchema,
  type MCPConfig,
  type McpToolsManifest,
  type OpenAPIDocument,
  type ParamDescriptor,
  type RouteDescriptor,
  type ToolDefinition,
  type GenerationResult,
  DEFAULT_ENDPOINT,
  buildManifest,
  createLoopbackInvoker,
  createMcpRequestHandler,
  generateTools,
  routesToOpenAPI,
} from "@restmcp/core";
import { discoverExpressRoutes } from "./route-discovery.js";

export interface ManualRouteRegistration {
  method: HttpMethod;
  path: string;
  name?: string;
  description?: string;
  inputSchema?: JSONSchema;
  /**
   * Explicit path/query param declarations — needed whenever a registered
   * route takes query params, since without this every non-path field in
   * `inputSchema` would be treated as body-destined (and silently dropped
   * on a GET/HEAD request that has no path-param-matching field for it).
   * Path params named in `path` (":id" etc.) are inferred automatically and
   * don't need to be repeated here unless you want to override their type.
   */
  params?: ParamDescriptor[];
}

interface ToolOverride {
  name?: string;
  description?: string;
}

/**
 * Handle returned by MCPExpress.setup(). Tool set is recomputed on every
 * access (re-discovers routes + re-applies overrides) rather than frozen at
 * setup time, so `.tool()`/`.exclude()`/`.register()` calls made after
 * setup(), or routes registered after setup(), both take effect.
 */
export interface McpExpressInstance {
  readonly app: Application;
  readonly config: MCPConfig;
  tool(path: string, override: ToolOverride, method?: HttpMethod): void;
  exclude(path: string, method?: HttpMethod): void;
  register(route: ManualRouteRegistration): void;
  getTools(): ToolDefinition[];
  getExcluded(): GenerationResult["excluded"];
  getManifest(): McpToolsManifest;
  getOpenAPI(): OpenAPIDocument;
  /** Closes the internal loopback server used to invoke tool calls. Call this when shutting the host app down (tests especially — otherwise each setup() call leaks one listening socket). */
  close(): Promise<void>;
}


interface InternalInstance extends McpExpressInstance {
  invoke: ReturnType<typeof createLoopbackInvoker>["invoke"];
}

function createInstance(app: Application, config: MCPConfig): InternalInstance {
  const toolOverrides = new Map<string, ToolOverride>();
  const exclusions = new Set<string>();
  const manualRoutes: RouteDescriptor[] = [];
  const loopback = createLoopbackInvoker(app);

  function key(method: HttpMethod | undefined, path: string): string {
    return `${method ?? "*"} ${path}`;
  }

  const endpoint = config.endpoint ?? DEFAULT_ENDPOINT;

  function currentRoutes(): RouteDescriptor[] {
    // The MCP endpoint itself is mounted on `app` by the time setup() runs,
    // so a live re-discovery (see getTools() below) would otherwise find
    // and re-expose it as a tool (e.g. "create_mcp") on every call.
    const discovered = discoverExpressRoutes(app).filter((r) => !(r.method === "POST" && r.path === endpoint));
    const all = [...discovered, ...manualRoutes];

    return all.map((route) => {
      const override = toolOverrides.get(key(route.method, route.path)) ?? toolOverrides.get(key(undefined, route.path));
      const excluded = exclusions.has(key(route.method, route.path)) || exclusions.has(key(undefined, route.path));

      if (!override && !excluded) return route;

      return {
        ...route,
        mcp: {
          ...route.mcp,
          enabled: excluded ? false : route.mcp?.enabled,
          name: override?.name ?? route.mcp?.name,
          description: override?.description ?? route.mcp?.description,
        },
      };
    });
  }

  function generate() {
    return generateTools(currentRoutes(), config);
  }

  return {
    app,
    config,
    tool(path, override, method) {
      toolOverrides.set(key(method, path), override);
    },
    exclude(path, method) {
      exclusions.add(key(method, path));
    },
    register(route) {
      const pathParamNames = new Set((route.path.match(/:[A-Za-z0-9_]+/g) ?? []).map((p) => p.slice(1)));
      const explicit = route.params ?? [];
      const explicitNames = new Set(explicit.map((p) => p.name));

      const derivedPathParams: ParamDescriptor[] = [...pathParamNames]
        .filter((name) => !explicitNames.has(name))
        .map((name) => ({ name, in: "path" as const, type: "string" as const, required: true }));

      manualRoutes.push({
        method: route.method,
        path: route.path,
        params: [...derivedPathParams, ...explicit],
        mcp: { name: route.name, description: route.description, inputSchema: route.inputSchema },
      });
    },
    getTools() {
      return generate().tools;
    },
    getExcluded() {
      return generate().excluded;
    },
    getManifest() {
      return buildManifest(generate().tools, config);
    },
    getOpenAPI() {
      return routesToOpenAPI(currentRoutes(), { title: config.name, version: config.version });
    },
    close() {
      return loopback.close();
    },
    invoke: loopback.invoke,
  };
}

let lastInstance: McpExpressInstance | undefined;

function requireLastInstance(): McpExpressInstance {
  if (!lastInstance) {
    throw new Error("MCPExpress.setup() must be called before using MCPExpress.tool()/exclude()/register()");
  }
  return lastInstance;
}

export const MCPExpress = {
  /**
   * Wires MCP support into an existing Express app: discovers routes,
   * generates tools, and mounts `config.endpoint` (default "/mcp"). Opt-in
   * and additive — it only adds the one route, it never wraps or replaces
   * existing app behavior.
   */
  setup(app: Application, config: MCPConfig): McpExpressInstance {
    const instance = createInstance(app, config);
    lastInstance = instance;

    const endpoint = config.endpoint ?? DEFAULT_ENDPOINT;

    const handler = createMcpRequestHandler({
      config,
      getTools: () => instance.getTools(),
      invoke: instance.invoke,
    });

    const middlewares = (config.middleware ?? []) as RequestHandler[];

    app.post(endpoint, ...middlewares, async (req, res) => {
      try {
        await handler(req, res, req.body);
      } catch (error) {
        if (!res.headersSent) {
          res.status(500).json({ error: error instanceof Error ? error.message : "internal error" });
        }
      }
    });

    return instance;
  },

  tool(path: string, override: ToolOverride, method?: HttpMethod): void {
    requireLastInstance().tool(path, override, method);
  },

  exclude(path: string, method?: HttpMethod): void {
    requireLastInstance().exclude(path, method);
  },

  register(route: ManualRouteRegistration): void {
    requireLastInstance().register(route);
  },
};
