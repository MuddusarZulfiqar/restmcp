import express from "express";
import { Router } from "express";
// Real Express 5, aliased in package.json ("express5": "npm:express@^5.0.0") —
// not a mock. Express 5 changed internal router structure (app._router ->
// app.router, Layer.regexp -> opaque Layer.matchers) in ways that silently
// broke route discovery; see the regression tests below.
import express5 from "express5";
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

  describe("Express 5 (real express5 alias, not express4)", () => {
    it("discovers top-level routes — regression: Express 5 renamed app._router to app.router", () => {
      const app = express5();
      app.get("/users", (_req: unknown, res: { json: (b: unknown) => void }) => res.json([]));
      app.get("/users/:id", (_req: unknown, res: { json: (b: unknown) => void }) => res.json({}));
      app.post("/users", (_req: unknown, res: { json: (b: unknown) => void }) => res.json({}));

      const routes = discoverExpressRoutes(app);
      expect(routes.map(key).sort()).toEqual(["GET /users", "GET /users/:id", "POST /users"].sort());
    });

    it("skips (does not mis-path) routes under a nested router it can't recover a prefix for, rather than crash or register a broken path", () => {
      const app = express5();
      const router = express5.Router();
      router.get("/:id", (_req: unknown, res: { json: (b: unknown) => void }) => res.json({}));
      app.use("/api/v1/products", router);
      app.get("/health", (_req: unknown, res: { send: (b: unknown) => void }) => res.send("ok"));

      // Must not throw (the original bug: `layer.regexp.toString()` on
      // undefined crashed discovery for the whole app, not just the nested part).
      const routes = discoverExpressRoutes(app);

      // Top-level route still found.
      expect(routes.map(key)).toContain("GET /health");
      // Nested-router route is currently unrecoverable under Express 5 — it
      // must be absent, never present with a wrong/incomplete path that
      // would 404 when actually invoked.
      expect(routes.some((r) => r.path.includes(":id"))).toBe(false);
    });
  });
});
