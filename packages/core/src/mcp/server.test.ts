import http from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it, afterEach } from "vitest";
import { createMcpRequestHandler } from "./server.js";
import type { MCPConfig } from "../types/config.js";
import type { InvokeContext } from "../types/route.js";
import type { ToolDefinition } from "../types/tool.js";

const tools: ToolDefinition[] = [
  {
    name: "get_thing",
    description: "Get a thing",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    route: { method: "GET", path: "/things/:id", params: [{ name: "id", in: "path", type: "string", required: true }] },
  },
];

function startServer(config: MCPConfig) {
  const handler = createMcpRequestHandler({ config, getTools: () => tools, invoke: async () => ({ ok: true }) });
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      let parsed: unknown;
      try {
        parsed = body.length > 0 ? JSON.parse(body.toString("utf-8")) : undefined;
      } catch {
        parsed = undefined;
      }
      void handler(req, res, parsed);
    });
  });

  return new Promise<{ baseUrl: string; close: () => Promise<void> }>((resolveStart) => {
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      resolveStart({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

/**
 * Like startServer, but never pre-reads the body itself — simulating an
 * adapter with no body-parser middleware, where `createMcpRequestHandler`
 * is the first thing to ever touch the request stream. This is the path
 * that must enforce maxRequestSize against actual bytes, not Content-Length.
 */
function startServerNoBodyParsing(config: MCPConfig) {
  const handler = createMcpRequestHandler({ config, getTools: () => tools, invoke: async () => ({ ok: true }) });
  const server = http.createServer((req, res) => {
    void handler(req, res, undefined);
  });

  return new Promise<{ port: number; close: () => Promise<void> }>((resolveStart) => {
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      resolveStart({ port, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

/** Like startServer, but records the context each invoke() call received, so tests can assert on it. */
function startServerCapturingInvoke(config: MCPConfig) {
  const calls: InvokeContext[] = [];
  const handler = createMcpRequestHandler({
    config,
    getTools: () => tools,
    invoke: async (_route, _args, context) => {
      calls.push(context ?? {});
      return { ok: true };
    },
  });
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      let parsed: unknown;
      try {
        parsed = body.length > 0 ? JSON.parse(body.toString("utf-8")) : undefined;
      } catch {
        parsed = undefined;
      }
      void handler(req, res, parsed);
    });
  });

  return new Promise<{ baseUrl: string; calls: InvokeContext[]; close: () => Promise<void> }>((resolveStart) => {
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      resolveStart({
        baseUrl: `http://127.0.0.1:${port}`,
        calls,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

async function rpc(baseUrl: string, method: string, headers: Record<string, string> = {}, bodyOverride?: string) {
  const payload = bodyOverride ?? JSON.stringify({ jsonrpc: "2.0", id: 1, method });
  const res = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    body: payload,
  });
  return res;
}

async function callTool(baseUrl: string, toolName: string, requestHeaders: Record<string, string> = {}) {
  return rpc(
    baseUrl,
    "tools/call",
    requestHeaders,
    JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: toolName, arguments: { id: "1" } } }),
  );
}

describe("createMcpRequestHandler security enforcement", () => {
  let close: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await close?.();
    close = undefined;
  });

  it("rejects requests over security.maxRequestSize with 413, before touching auth/tools", async () => {
    const started = await startServer({
      name: "T",
      version: "1.0.0",
      security: { maxRequestSize: 10 },
      auth: { type: "bearer", validate: async () => false }, // would 401 if reached
    });
    close = started.close;

    const res = await rpc(started.baseUrl, "tools/list", {}, JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", pad: "x".repeat(100) }));
    expect(res.status).toBe(413);
  });

  it("allows requests within security.maxRequestSize", async () => {
    const started = await startServer({ name: "T", version: "1.0.0", security: { maxRequestSize: 10_000 } });
    close = started.close;

    const res = await rpc(started.baseUrl, "tools/list");
    expect(res.status).toBe(200);
  });

  it("enforces maxRequestSize against actual bytes for a chunked request with no Content-Length (the header check alone can't catch this)", async () => {
    const started = await startServerNoBodyParsing({ name: "T", version: "1.0.0", security: { maxRequestSize: 20 } });
    close = started.close;

    const status = await new Promise<number>((resolveStatus) => {
      const req = http.request(
        { host: "127.0.0.1", port: started.port, method: "POST", path: "/mcp", headers: { "content-type": "application/json" } },
        (res) => resolveStatus(res.statusCode ?? 0),
      );
      // No Content-Length header is set because we stream the body across
      // multiple writes — Node sends this as Transfer-Encoding: chunked.
      req.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", pad: "x".repeat(50) }).slice(0, 15));
      req.write("padding-well-past-the-20-byte-cap-to-make-sure-it-trips");
      req.end();
    });

    expect(status).toBe(413);
  });

  it("still works correctly for a small chunked request under the limit", async () => {
    const started = await startServerNoBodyParsing({ name: "T", version: "1.0.0", security: { maxRequestSize: 10_000 } });
    close = started.close;

    const status = await new Promise<number>((resolveStatus) => {
      const req = http.request(
        {
          host: "127.0.0.1",
          port: started.port,
          method: "POST",
          path: "/mcp",
          headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        },
        (res) => resolveStatus(res.statusCode ?? 0),
      );
      req.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }));
      req.end();
    });

    expect(status).toBe(200);
  });

  it("rejects with 429 once security.rateLimit is exceeded", async () => {
    const started = await startServer({ name: "T", version: "1.0.0", security: { rateLimit: { requests: 2, windowMs: 60_000 } } });
    close = started.close;

    expect((await rpc(started.baseUrl, "tools/list")).status).toBe(200);
    expect((await rpc(started.baseUrl, "tools/list")).status).toBe(200);
    expect((await rpc(started.baseUrl, "tools/list")).status).toBe(429);
  });

  it("rate limits before auth runs (limits brute-force auth attempts too)", async () => {
    const started = await startServer({
      name: "T",
      version: "1.0.0",
      security: { rateLimit: { requests: 1, windowMs: 60_000 } },
      auth: { type: "bearer", validate: async () => false },
    });
    close = started.close;

    const first = await rpc(started.baseUrl, "tools/list");
    expect(first.status).toBe(401); // auth still runs for the first allowed request
    const second = await rpc(started.baseUrl, "tools/list");
    expect(second.status).toBe(429); // but further attempts are rate limited, not re-auth-checked
  });

  it("warns (via the logging hook) when no auth is configured", async () => {
    const entries: Array<{ level: string; message: string }> = [];
    const started = await startServer({ name: "T", version: "1.0.0", logging: (e) => entries.push(e) });
    close = started.close;

    expect(entries.some((e) => e.level === "warn" && /no auth configured/.test(e.message))).toBe(true);
  });

  it("does not warn when auth is configured", async () => {
    const entries: Array<{ level: string; message: string }> = [];
    const started = await startServer({
      name: "T",
      version: "1.0.0",
      logging: (e) => entries.push(e),
      auth: { type: "bearer", validate: async () => true },
    });
    close = started.close;

    expect(entries.some((e) => /no auth configured/.test(e.message))).toBe(false);
  });

  describe("auth.forwardCredential", () => {
    it("forwards the original Authorization header to invoke() when enabled with type bearer", async () => {
      const started = await startServerCapturingInvoke({
        name: "T",
        version: "1.0.0",
        auth: { type: "bearer", validate: async () => true, forwardCredential: true },
      });
      close = started.close;

      await callTool(started.baseUrl, "get_thing", { authorization: "Bearer caller-token" });
      expect(started.calls).toHaveLength(1);
      expect(started.calls[0]!.forwardHeaders).toEqual({ authorization: "Bearer caller-token" });
    });

    it("forwards the configured apiKey header when enabled with type apiKey", async () => {
      const started = await startServerCapturingInvoke({
        name: "T",
        version: "1.0.0",
        auth: { type: "apiKey", headerName: "x-service-key", validate: async () => true, forwardCredential: true },
      });
      close = started.close;

      await callTool(started.baseUrl, "get_thing", { "x-service-key": "secret-value" });
      expect(started.calls[0]!.forwardHeaders).toEqual({ "x-service-key": "secret-value" });
    });

    it("forwards nothing by default (forwardCredential unset) — this is a deliberate opt-in, not a default", async () => {
      const started = await startServerCapturingInvoke({
        name: "T",
        version: "1.0.0",
        auth: { type: "bearer", validate: async () => true },
      });
      close = started.close;

      await callTool(started.baseUrl, "get_thing", { authorization: "Bearer caller-token" });
      expect(started.calls[0]!.forwardHeaders).toBeUndefined();
    });

    it("forwards nothing for type custom or none, even if enabled — there's no single well-defined credential header for those", async () => {
      const started = await startServerCapturingInvoke({
        name: "T",
        version: "1.0.0",
        auth: { type: "custom", validate: async () => true, forwardCredential: true },
      });
      close = started.close;

      await callTool(started.baseUrl, "get_thing", { authorization: "Bearer caller-token" });
      expect(started.calls[0]!.forwardHeaders).toBeUndefined();
    });
  });
});
