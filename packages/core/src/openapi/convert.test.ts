import { describe, expect, it } from "vitest";
import { routesToOpenAPI, iterateOperations } from "./convert.js";
import type { RouteDescriptor } from "../types/route.js";

describe("routesToOpenAPI", () => {
  it("converts routes into an OpenAPI document with one operation per method+path", () => {
    const routes: RouteDescriptor[] = [
      { method: "GET", path: "/users", params: [] },
      { method: "POST", path: "/users", params: [] },
      {
        method: "GET",
        path: "/users/:id",
        params: [{ name: "id", in: "path", type: "string", required: true }],
      },
    ];

    const doc = routesToOpenAPI(routes, { title: "My API", version: "1.0.0" });
    expect(doc.paths["/users"]?.get).toBeDefined();
    expect(doc.paths["/users"]?.post).toBeDefined();
    expect(doc.paths["/users/:id"]?.get?.parameters).toEqual([
      { name: "id", in: "path", required: true, description: undefined, schema: { type: "string", enum: undefined } },
    ]);
  });

  it("round-trips through iterateOperations", () => {
    const routes: RouteDescriptor[] = [{ method: "GET", path: "/users", params: [] }];
    const doc = routesToOpenAPI(routes, { title: "My API", version: "1.0.0" });
    const ops = Array.from(iterateOperations(doc));
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ method: "GET", path: "/users" });
  });
});
