import { describe, expect, it } from "vitest";
import { assignToolNames, deriveToolName } from "./tool-name.js";

describe("deriveToolName", () => {
  it("names a collection GET as list_<plural>", () => {
    expect(deriveToolName("GET", "/users")).toBe("list_users");
  });

  it("names a single-resource GET as get_<singular>", () => {
    expect(deriveToolName("GET", "/users/:id")).toBe("get_user");
  });

  it("names POST as create_<singular>", () => {
    expect(deriveToolName("POST", "/users")).toBe("create_user");
  });

  it("names PUT/PATCH as update_<singular>", () => {
    expect(deriveToolName("PUT", "/users/:id")).toBe("update_user");
    expect(deriveToolName("PATCH", "/users/:id")).toBe("update_user");
  });

  it("names DELETE as delete_<singular>", () => {
    expect(deriveToolName("DELETE", "/users/:id")).toBe("delete_user");
  });

  it("singularizes common plural endings", () => {
    expect(deriveToolName("GET", "/categories/:id")).toBe("get_category");
    expect(deriveToolName("GET", "/addresses/:id")).toBe("get_address");
  });
});

describe("assignToolNames", () => {
  it("is a no-op when names don't collide", () => {
    const result = assignToolNames([
      { method: "GET", path: "/users", item: "a" },
      { method: "GET", path: "/products", item: "b" },
    ]);
    expect(result.map((r) => r.name)).toEqual(["list_users", "list_products"]);
  });

  it("resolves collisions by folding in a preceding path segment", () => {
    const result = assignToolNames([
      { method: "GET", path: "/admin/users/:id", item: "a" },
      { method: "GET", path: "/public/users/:id", item: "b" },
    ]);
    expect(result.map((r) => r.name)).toEqual(["get_admin_user", "get_public_user"]);
  });

  it("falls back to a numeric suffix when no distinguishing segment exists", () => {
    const result = assignToolNames([
      { method: "GET", path: "/users/:id", item: "a" },
      { method: "GET", path: "/users/:userId", item: "b" },
    ]);
    expect(result[0]!.name).toBe("get_user");
    expect(result[1]!.name).toBe("get_user_2");
  });
});
