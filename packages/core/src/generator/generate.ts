import type { RouteDescriptor } from "../types/route.js";
import type { MCPConfig } from "../types/config.js";
import type { ToolDefinition, McpToolsManifest } from "../types/tool.js";
import { toManifestEntry } from "../types/tool.js";
import { routesToOpenAPI, iterateOperations } from "../openapi/convert.js";
import { buildInputSchema } from "../schema/input-schema.js";
import { filterRoute, filterToolName } from "../permissions/filter.js";
import { assignToolNames, type NamedRoute } from "../naming/tool-name.js";
import type { LogEntry } from "../types/config.js";
import { DEFAULT_ENDPOINT } from "../types/config.js";

export interface GenerationWarning {
  route: string;
  message: string;
}

export interface GenerationResult {
  tools: ToolDefinition[];
  excluded: Array<{ method: string; path: string; reason: string }>;
  warnings: GenerationWarning[];
}

function defaultDescription(method: string, path: string): string {
  const verbMap: Record<string, string> = {
    GET: "Get",
    POST: "Create",
    PUT: "Update",
    PATCH: "Update",
    DELETE: "Delete",
    HEAD: "Check",
    OPTIONS: "Describe",
  };
  return `${verbMap[method] ?? method} ${path}`;
}

function emit(config: MCPConfig, entry: LogEntry): void {
  if (!config.logging) return;
  if (typeof config.logging === "function") {
    config.logging(entry);
    return;
  }
  // logging: true -> stderr, keeps stdout clean for CLI JSON output.
  // eslint-disable-next-line no-console
  console.error(`[restmcp] ${entry.level.toUpperCase()} ${entry.message}`);
}

/**
 * Full pipeline: RouteDescriptor[] -> (filter) -> OpenAPI -> JSON Schema ->
 * (name) -> (filter by name) -> ToolDefinition[]. This is the one place all
 * five stages described in architecture.md §1 are wired together.
 */
export function generateTools(routes: RouteDescriptor[], config: MCPConfig): GenerationResult {
  const excluded: GenerationResult["excluded"] = [];
  const warnings: GenerationWarning[] = [];

  // The MCP endpoint itself is a POST route on the host app by the time any
  // adapter's route discovery runs. It must never become a tool, regardless
  // of which adapter (or the CLI) produced `routes` — enforced once, here,
  // rather than relying on every call site to filter it out itself.
  const endpoint = config.endpoint ?? DEFAULT_ENDPOINT;
  const withoutOwnEndpoint = routes.filter((r) => {
    const isOwnEndpoint = r.method === "POST" && r.path === endpoint;
    if (isOwnEndpoint) excluded.push({ method: r.method, path: r.path, reason: "the MCP endpoint itself" });
    return !isOwnEndpoint;
  });

  const eligible = withoutOwnEndpoint.filter((route) => {
    const decision = filterRoute(route, config);
    if (!decision.include) {
      excluded.push({ method: route.method, path: route.path, reason: decision.reason ?? "excluded" });
      emit(config, { level: "debug", message: `skipped ${route.method} ${route.path}: ${decision.reason}` });
    }
    return decision.include;
  });

  const openapi = routesToOpenAPI(eligible, { title: config.name, version: config.version });

  const prepared: NamedRoute<{ route: RouteDescriptor; description: string; schema: ReturnType<typeof buildInputSchema> }>[] = [];

  for (const { method, path, operation } of iterateOperations(openapi)) {
    const route = eligible.find((r) => r.method === method && r.path === path);
    if (!route) continue;

    const override = config.tools?.overrides?.[`${method} ${path}`];
    const schema = buildInputSchema(operation);

    const description =
      override?.description ?? operation.description ?? operation.summary ?? defaultDescription(method, path);

    prepared.push({ method: route.method, path: route.path, item: { route, description, schema } });
  }

  const named = assignToolNames(prepared);

  const tools: ToolDefinition[] = [];

  for (const { name: derivedName, item } of named) {
    const override = item.route.mcp?.name ?? config.tools?.overrides?.[`${item.route.method} ${item.route.path}`]?.name;
    const name = override ?? derivedName;

    const nameDecision = filterToolName(name, config);
    if (!nameDecision.include) {
      excluded.push({ method: item.route.method, path: item.route.path, reason: nameDecision.reason ?? "excluded" });
      continue;
    }

    tools.push({
      name,
      description: item.route.mcp?.description ?? item.description,
      inputSchema: item.route.mcp?.inputSchema ?? item.schema,
      route: item.route,
    });
  }

  if (tools.length === 0) {
    warnings.push({ route: "*", message: "no routes produced MCP tools — check include/exclude and allowMutations" });
  }

  return { tools, excluded, warnings };
}

export function buildManifest(tools: ToolDefinition[], config: MCPConfig): McpToolsManifest {
  return {
    name: config.name,
    version: config.version,
    tools: tools.map(toManifestEntry),
  };
}
