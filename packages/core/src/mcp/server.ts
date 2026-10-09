import type { IncomingMessage, ServerResponse } from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { ToolDefinition } from "../types/tool.js";
import type { MCPConfig, AuthContext } from "../types/config.js";
import type { RouteInvoker } from "../types/route.js";
import { createAuthChecker } from "../authentication/strategies.js";
import { validateArgs } from "../schema/validator.js";
import { createRateLimiter } from "./rate-limiter.js";

function emitWarning(config: MCPConfig, message: string): void {
  if (typeof config.logging === "function") {
    config.logging({ level: "warn", message });
    return;
  }
  if (config.logging === false) return;
  // eslint-disable-next-line no-console
  console.warn(`[restmcp] WARN ${message}`);
}

function requestSize(req: IncomingMessage): number | undefined {
  const header = req.headers["content-length"];
  const value = Array.isArray(header) ? header[0] : header;
  const size = value ? Number(value) : undefined;
  return size !== undefined && Number.isFinite(size) ? size : undefined;
}

function clientKey(req: IncomingMessage): string {
  // Direct socket address only — deliberately not X-Forwarded-For, which a
  // client can set to anything unless a trusted proxy strips/overwrites it
  // first. If you're behind a proxy, rate-limit there instead (see rate-limiter.ts).
  return req.socket.remoteAddress ?? "unknown";
}

function headerValue(headers: IncomingMessage["headers"], name: string): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Builds the headers to forward to the underlying route on this tool call,
 * per auth.forwardCredential (see AuthConfig) — only the one well-defined
 * credential header for bearer/apiKey/oauth2; nothing for custom/none,
 * since there's no single header that means "the credential" for those.
 */
function buildForwardHeaders(config: MCPConfig, req: IncomingMessage): Record<string, string> | undefined {
  const auth = config.auth;
  if (!auth?.forwardCredential) return undefined;

  const headers: Record<string, string> = {};

  if (auth.type === "bearer" || auth.type === "oauth2") {
    const value = headerValue(req.headers, "authorization");
    if (value) headers.authorization = value;
  }
  if (auth.type === "apiKey" || auth.type === "oauth2") {
    const headerName = (auth.headerName ?? "x-api-key").toLowerCase();
    const value = headerValue(req.headers, headerName);
    if (value) headers[headerName] = value;
  }

  return Object.keys(headers).length > 0 ? headers : undefined;
}

/**
 * Reads the request body ourselves, enforcing `limit` against the actual
 * byte count as it arrives — not the (spoofable, or absent under chunked
 * transfer-encoding) Content-Length header. Only called when nobody has
 * parsed the body yet (see the `parsedBody === undefined` check at the call
 * site): if an adapter's own body-parser already consumed it, that
 * middleware's own limit already bounded it, and the stream can't be read
 * twice anyway.
 */
function readLimitedBody(req: IncomingMessage, limit: number): Promise<{ ok: true; body: unknown } | { ok: false }> {
  return new Promise((resolveRead) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let rejected = false;

    // On overflow we stop buffering but keep draining the stream to 'end'
    // rather than destroying it: `req.destroy()` also tears down the shared
    // underlying socket, which can prevent the 413 response below from
    // actually being sent and, on a keep-alive connection, leave unread
    // body bytes that corrupt the next request on the same socket.
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > limit) {
        if (!rejected) {
          rejected = true;
          resolveRead({ ok: false });
        }
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      if (rejected) return;
      const text = Buffer.concat(chunks).toString("utf-8");
      if (text.length === 0) {
        resolveRead({ ok: true, body: undefined });
        return;
      }
      try {
        resolveRead({ ok: true, body: JSON.parse(text) });
      } catch {
        resolveRead({ ok: true, body: undefined });
      }
    });

    req.on("error", () => {
      if (!rejected) resolveRead({ ok: false });
    });
  });
}

export interface McpHandlerOptions {
  config: MCPConfig;
  /** Returns the current tool set. A function (not a static array) so adapters can regenerate on the fly. */
  getTools: () => ToolDefinition[];
  /** Adapter-supplied function that actually calls the underlying route handler. */
  invoke: RouteInvoker;
}

export type McpHttpHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  parsedBody?: unknown,
) => Promise<void>;

function textResult(text: string, isError = false) {
  return { content: [{ type: "text" as const, text }], isError };
}

/**
 * Builds the framework-agnostic /mcp request handler: auth gate, then a
 * fresh (stateless) MCP Server+Transport per request wired to the current
 * tool set, with AJV validation on every tools/call before invoke() runs.
 *
 * Adapters mount this directly against their own HTTP primitives — Express's
 * (req, res) are Node's IncomingMessage/ServerResponse already; NestJS's
 * default (Express-backed) HTTP adapter exposes the same objects.
 */
export function createMcpRequestHandler(options: McpHandlerOptions): McpHttpHandler {
  const checkAuth = createAuthChecker(options.config.auth);
  const checkRateLimit = createRateLimiter(options.config.security?.rateLimit);
  const maxRequestSize = options.config.security?.maxRequestSize;

  if (!options.config.auth || options.config.auth.type === "none") {
    emitWarning(
      options.config,
      `no auth configured for "${options.config.endpoint ?? "/mcp"}" — every discovered tool is callable by anyone who can reach this endpoint. Set config.auth if that's not intended.`,
    );
  }

  return async function handleMcpRequest(req, res, parsedBody) {
    if (maxRequestSize !== undefined) {
      // Fast path: a declared Content-Length over the limit is rejected
      // without reading anything.
      const declaredSize = requestSize(req);
      if (declaredSize !== undefined && declaredSize > maxRequestSize) {
        // Connection: close — we're rejecting before reading the body, so
        // leftover bytes the client still sends must not be left on the
        // socket to be misread as the start of a subsequent keep-alive request.
        res.writeHead(413, { "Content-Type": "application/json", Connection: "close" });
        res.end(JSON.stringify({ error: "payload too large" }));
        return;
      }

      // Nobody has consumed the body yet (no adapter-level body-parser ran) —
      // read it ourselves with a real byte-counted cap, since a chunked
      // request has no Content-Length to even check above.
      if (parsedBody === undefined) {
        const read = await readLimitedBody(req, maxRequestSize);
        if (!read.ok) {
          if (!res.headersSent) {
            res.writeHead(413, { "Content-Type": "application/json", Connection: "close" });
            res.end(JSON.stringify({ error: "payload too large" }));
          }
          return;
        }
        parsedBody = read.body;
      }
    }

    if (!checkRateLimit(clientKey(req))) {
      res.writeHead(429, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "rate limit exceeded" }));
      return;
    }

    const authorized = await checkAuth(req.headers as AuthContext["headers"]);
    if (!authorized) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }

    const server = new Server(
      { name: options.config.name, version: options.config.version },
      { capabilities: { tools: {} } },
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: options.getTools().map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
    }));

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      const tool = options.getTools().find((t) => t.name === name);
      if (!tool) {
        return textResult(`Unknown tool: ${name}`, true);
      }

      const validation = validateArgs(tool.inputSchema, args ?? {});
      if (!validation.valid) {
        return textResult(`Invalid arguments for ${name}: ${validation.errors?.join("; ")}`, true);
      }

      try {
        const forwardHeaders = buildForwardHeaders(options.config, req);
        const result = await options.invoke(tool.route, (args ?? {}) as Record<string, unknown>, { forwardHeaders });
        return textResult(typeof result === "string" ? result : JSON.stringify(result ?? null));
      } catch (error) {
        return textResult(`Tool "${name}" failed: ${error instanceof Error ? error.message : String(error)}`, true);
      }
    });

    // enableJsonResponse: plain HTTP responses rather than an SSE stream — matches
    // the brief's "POST /mcp" contract and keeps simple HTTP MCP clients working
    // without requiring them to consume an event stream for a single response.
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });

    res.on("close", () => {
      void transport.close();
      void server.close();
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, parsedBody);
  };
}
