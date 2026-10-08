import { describe, expect, it } from "vitest";
import { filterRoute, filterToolName } from "./filter.js";
import type { RouteDescriptor } from "../types/route.js";
import type { MCPConfig } from "../types/config.js";

const baseConfig: MCPConfig = { name: "Test", version: "1.0.0" };

function route(overrides: Partial<RouteDescriptor> = {}): RouteDescriptor {
  return { method: "GET", path: "/users/:id", params: [], ...overrides };
}

describe("filterRoute", () => {
  it("excludes routes with mcp:false", () => {
    const decision = filterRoute(route({ mcp: { enabled: false } }), baseConfig);
    expect(decision.include).toBe(false);
  });

  it("excludes mutating routes when allowMutations is false", () => {
    const decision = filterRoute(route({ method: "POST" }), { ...baseConfig, allowMutations: false });
    expect(decision.include).toBe(false);
  });

  it("keeps GET/HEAD when allowMutations is false", () => {
    expect(filterRoute(route({ method: "GET" }), { ...baseConfig, allowMutations: false }).include).toBe(true);
  });

  it("applies exclude glob on route path", () => {
    const decision = filterRoute(route({ path: "/admin/users/:id" }), { ...baseConfig, exclude: ["/admin/*"] });
    expect(decision.include).toBe(false);
  });

  it("applies include glob on route path", () => {
    const config: MCPConfig = { ...baseConfig, include: ["/products/*"] };
    expect(filterRoute(route({ path: "/users/:id" }), config).include).toBe(false);
    expect(filterRoute(route({ path: "/products/:id" }), config).include).toBe(true);
  });
});

describe("filterToolName", () => {
  it("applies tools.exclude", () => {
    const config: MCPConfig = { ...baseConfig, tools: { exclude: ["delete_*"] } };
    expect(filterToolName("delete_user", config).include).toBe(false);
    expect(filterToolName("get_user", config).include).toBe(true);
  });

  it("applies tools.include", () => {
    const config: MCPConfig = { ...baseConfig, tools: { include: ["get_*"] } };
    expect(filterToolName("get_user", config).include).toBe(true);
    expect(filterToolName("delete_user", config).include).toBe(false);
  });
});
