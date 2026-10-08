import express from "express";
import { Router } from "express";
import { describe, expect, it } from "vitest";
import { discoverExpressRoutes } from "./route-discovery.js";

function key(r: { method: string; path: string }) {
  return `${r.method} ${r.path}`;
}

describe("discoverExpressRoutes", () => {
  it("discovers top-level GET/POST/PUT/DELETE routes with path params", () => {
    const app = express();
    app.get("/users", (_req, res) => res.json([]));
    app.get("/users/:id", (_req, res) => res.json({}));
    app.post("/users", (_req, res) => res.json({}));
    app.put("/users/:id", (_req, res) => res.json({}));
    app.delete("/users/:id", (_req, res) => res.json({}));

    const routes = discoverExpressRoutes(app);
    expect(routes.map(key).sort()).toEqual(
      ["DELETE /users/:id", "GET /users", "GET /users/:id", "POST /users", "PUT /users/:id"].sort(),
    );

    const getById = routes.find((r) => r.method === "GET" && r.path === "/users/:id");
    expect(getById?.params).toEqual([{ name: "id", in: "path", type: "string", required: true }]);
  });

  it("recovers the mount prefix for routes added via a nested router", () => {
    const app = express();
    const router = Router();
    router.get("/:id", (_req, res) => res.json({}));
    router.post("/", (_req, res) => res.json({}));
    app.use("/api/v1/products", router);

    const routes = discoverExpressRoutes(app);
    expect(routes.map(key).sort()).toEqual(["GET /api/v1/products/:id", "POST /api/v1/products"].sort());
  });

  it("recovers prefixes through multiple levels of nested routers", () => {
    const app = express();
    const inner = Router();
    inner.get("/:id", (_req, res) => res.json({}));
    const outer = Router();
    outer.use("/users", inner);
    app.use("/api", outer);

    const routes = discoverExpressRoutes(app);
    expect(routes.map(key)).toEqual(["GET /api/users/:id"]);
  });

  it("returns an empty array for an app with no routes", () => {
    const app = express();
    expect(discoverExpressRoutes(app)).toEqual([]);
  });

  it("does not list middleware-only layers as routes", () => {
    const app = express();
    app.use(express.json());
    app.get("/health", (_req, res) => res.send("ok"));

    const routes = discoverExpressRoutes(app);
    expect(routes.map(key)).toEqual(["GET /health"]);
  });
});
