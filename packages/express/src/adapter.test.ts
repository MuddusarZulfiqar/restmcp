import express from "express";
import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { MCPExpress, type McpExpressInstance } from "./adapter.js";

const openInstances: McpExpressInstance[] = [];
const openServers: Server[] = [];

function setup(app: express.Application, config: Parameters<typeof MCPExpress.setup>[1]) {
  const instance = MCPExpress.setup(app, config);
  openInstances.push(instance);
  return instance;
}

/**
 * Starts the app on a real (ephemeral, loopback-only) port and returns a
 * fetch() helper bound to it. Tests deliberately go over a real socket end
 * to end — see http-invoker.ts's comment for why mixing a fake/injected
 * request with the adapter's own real loopback invocation is unsafe.
 */
async function startServer(app: express.Application): Promise<{ baseUrl: string }> {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      openServers.push(server);
      resolve({ baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

afterEach(async () => {
  await Promise.all(openInstances.map((i) => i.close()));
  openInstances.length = 0;
  await Promise.all(openServers.map((s) => new Promise<void>((r) => s.close(() => r()))));
  openServers.length = 0;
});

function buildApp() {
  const app = express();
  app.use(express.json());

  const users = [
    { id: "1", name: "Ada", email: "ada@example.com" },
    { id: "2", name: "Grace", email: "grace@example.com" },
  ];

  app.get("/users", (_req, res) => res.json(users));
  app.get("/users/:id", (req, res) => {
    const user = users.find((u) => u.id === req.params.id);
    if (!user) return res.status(404).json({ error: "not found" });
    return res.json(user);
  });
  app.post("/users", (req, res) => res.status(201).json({ id: "3", ...req.body }));
  app.delete("/users/:id", (req, res) => res.json({ deleted: req.params.id }));
  app.get("/admin/secrets", (_req, res) => res.json({ secret: "nope" }));

  return app;
}

async function rpc(baseUrl: string, method: string, params?: unknown, id = 1, headers: Record<string, string> = {}) {
  const res = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  const body = (await res.json()) as { result?: { tools?: unknown[]; content?: Array<{ text: string }>; isError?: boolean } };
  return { statusCode: res.status, body };
}

describe("MCPExpress.setup", () => {
  it("exposes discovered routes as MCP tools via tools/list", async () => {
    const app = buildApp();
    setup(app, { name: "Test API", version: "1.0.0" });
    const { baseUrl } = await startServer(app);

    const res = await rpc(baseUrl, "tools/list");
    expect(res.statusCode).toBe(200);
    const names = (res.body.result?.tools as Array<{ name: string }>).map((t) => t.name);
    expect(names).toContain("list_users");
    expect(names).toContain("get_user");
    expect(names).toContain("create_user");
    // Regression: the /mcp endpoint itself must never show up as a tool.
    expect(names).not.toContain("create_mcp");
    expect(names.some((n) => n.includes("mcp"))).toBe(false);
    expect(names).toContain("delete_user");
  });

  it("invokes the underlying Express route on tools/call and returns its JSON result", async () => {
    const app = buildApp();
    setup(app, { name: "Test API", version: "1.0.0" });
    const { baseUrl } = await startServer(app);

    const res = await rpc(baseUrl, "tools/call", { name: "get_user", arguments: { id: "1" } });
    const content = JSON.parse(res.body.result!.content![0]!.text);
    expect(content).toEqual({ id: "1", name: "Ada", email: "ada@example.com" });
  });

  it("creates a resource through a POST tool and reflects the body", async () => {
    const app = buildApp();
    setup(app, { name: "Test API", version: "1.0.0" });
    const { baseUrl } = await startServer(app);

    const res = await rpc(baseUrl, "tools/call", {
      name: "create_user",
      arguments: { name: "Alan", email: "alan@example.com" },
    });
    const content = JSON.parse(res.body.result!.content![0]!.text);
    expect(content).toMatchObject({ name: "Alan", email: "alan@example.com" });
  });

  it("excludes routes matching config.exclude", async () => {
    const app = buildApp();
    setup(app, { name: "Test API", version: "1.0.0", exclude: ["/admin/*"] });
    const { baseUrl } = await startServer(app);

    const res = await rpc(baseUrl, "tools/list");
    const names = (res.body.result?.tools as Array<{ name: string }>).map((t) => t.name);
    expect(names.some((n) => n.includes("secret"))).toBe(false);
  });

  it("rejects calls when bearer auth fails, before reaching the route", async () => {
    const app = buildApp();
    setup(app, {
      name: "Test API",
      version: "1.0.0",
      auth: { type: "bearer", validate: async (ctx) => ctx.credential === "right-token" },
    });
    const { baseUrl } = await startServer(app);

    const unauthorized = await rpc(baseUrl, "tools/list");
    expect(unauthorized.statusCode).toBe(401);

    const authorized = await rpc(baseUrl, "tools/list", undefined, 1, { authorization: "Bearer right-token" });
    expect(authorized.statusCode).toBe(200);
  });

  it("rejects tools/call with invalid arguments before invoking the route", async () => {
    const app = buildApp();
    setup(app, { name: "Test API", version: "1.0.0" });
    const { baseUrl } = await startServer(app);

    const res = await rpc(baseUrl, "tools/call", { name: "get_user", arguments: {} });
    expect(res.body.result?.isError).toBe(true);
    expect(res.body.result!.content![0]!.text).toMatch(/Invalid arguments/);
  });

  it("supports MCPExpress.tool() name/description overrides applied after setup", async () => {
    const app = buildApp();
    setup(app, { name: "Test API", version: "1.0.0" });
    MCPExpress.tool("/users/:id", { name: "get_customer", description: "Retrieve customer by id" }, "GET");
    const { baseUrl } = await startServer(app);

    const res = await rpc(baseUrl, "tools/list");
    const tools = res.body.result?.tools as Array<{ name: string; description: string }>;
    const tool = tools.find((t) => t.name === "get_customer");
    expect(tool).toBeDefined();
    expect(tool?.description).toBe("Retrieve customer by id");
    expect(tools.some((t) => t.name === "get_user")).toBe(false);
  });
});
