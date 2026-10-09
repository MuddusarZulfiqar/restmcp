import { describe, expect, it } from "vitest";
import { generateTools, buildManifest } from "./generate.js";
import type { RouteDescriptor } from "../types/route.js";
import type { MCPConfig } from "../types/config.js";

const routes: RouteDescriptor[] = [
  { method: "GET", path: "/users", params: [] },
  {
    method: "GET",
    path: "/users/:id",
    params: [{ name: "id", in: "path", type: "string", required: true }],
  },
  {
    method: "POST",
    path: "/users",
    params: [],
    body: {
      contentType: "application/json",
      schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
    },
  },
  { method: "DELETE", path: "/users/:id", params: [{ name: "id", in: "path", type: "string", required: true }] },
  { method: "GET", path: "/internal/debug", params: [], mcp: { enabled: false } },
];

function config(overrides: Partial<MCPConfig> = {}): MCPConfig {
  return { name: "My API", version: "1.0.0", ...overrides };
}

describe("generateTools", () => {
  it("produces one tool per eligible route with deterministic names", () => {
    const result = generateTools(routes, config());
    expect(result.tools.map((t) => t.name).sort()).toEqual(["create_user", "delete_user", "get_user", "list_users"]);
  });

  it("excludes routes marked mcp:false", () => {
    const result = generateTools(routes, config());
    expect(result.excluded.some((e) => e.path === "/internal/debug")).toBe(true);
    expect(result.tools.some((t) => t.route.path === "/internal/debug")).toBe(false);
  });

  it("respects allowMutations: false", () => {
    const result = generateTools(routes, config({ allowMutations: false }));
    expect(result.tools.map((t) => t.name)).toEqual(["list_users", "get_user"]);
  });

  it("applies per-route name/description overrides from config.tools.overrides", () => {
    const result = generateTools(
      routes,
      config({ tools: { overrides: { "GET /users/:id": { name: "get_customer", description: "Get a customer" } } } }),
    );
    const tool = result.tools.find((t) => t.route.path === "/users/:id" && t.route.method === "GET");
    expect(tool?.name).toBe("get_customer");
    expect(tool?.description).toBe("Get a customer");
  });

  it("builds a manifest matching the mcp-tools.json shape", () => {
    const result = generateTools(routes, config());
    const manifest = buildManifest(result.tools, config());
    expect(manifest).toMatchObject({ name: "My API", version: "1.0.0" });
    expect(manifest.tools.every((t) => typeof t.name === "string" && t.inputSchema.type === "object")).toBe(true);
  });

  it("warns when no routes produce tools", () => {
    const result = generateTools([], config());
    expect(result.warnings).toHaveLength(1);
  });

  it("never turns the MCP endpoint itself into a tool, even when discovery re-finds it", () => {
    // Regression: adapters mount POST /mcp on the host app's own router
    // *before* tools are (re)generated, so a live route re-discovery would
    // otherwise see — and expose — the MCP endpoint as a tool named "create_mcp".
    const withSelfRoute = [...routes, { method: "POST" as const, path: "/mcp", params: [] }];
    const result = generateTools(withSelfRoute, config());
    expect(result.tools.some((t) => t.route.path === "/mcp")).toBe(false);
    expect(result.excluded.some((e) => e.path === "/mcp")).toBe(true);
  });

  it("respects a custom config.endpoint when excluding the MCP endpoint itself", () => {
    const withSelfRoute = [...routes, { method: "POST" as const, path: "/api/mcp-gateway", params: [] }];
    const result = generateTools(withSelfRoute, config({ endpoint: "/api/mcp-gateway" }));
    expect(result.tools.some((t) => t.route.path === "/api/mcp-gateway")).toBe(false);
  });

  it("a later route wins on (method, path) collision — e.g. a manually mcp.register()'d override for an also-auto-discovered route", () => {
    // Regression: the OpenAPI layer already resolves same (method, path)
    // collisions last-wins (routesToOpenAPI overwrites per key as it
    // iterates); the tool-building lookup used to resolve them first-wins
    // instead, so a manual override placed after the auto-discovered route
    // it was meant to replace had its name/description/params silently
    // discarded in favor of the discovered one.
    const autoDiscovered: RouteDescriptor = { method: "GET", path: "/search", params: [] };
    const manualOverride: RouteDescriptor = {
      method: "GET",
      path: "/search",
      params: [{ name: "q", in: "query", type: "string", required: false }],
      mcp: { name: "search_things", description: "Search things" },
    };
    const result = generateTools([autoDiscovered, manualOverride], config());
    expect(result.tools).toHaveLength(1);
    expect(result.tools[0]!.name).toBe("search_things");
    expect(result.tools[0]!.route).toBe(manualOverride);
  });
});
