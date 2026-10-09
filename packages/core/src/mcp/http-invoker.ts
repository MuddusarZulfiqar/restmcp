import http, { type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { RouteDescriptor, RouteInvoker } from "../types/route.js";

export type HttpRequestListener = (req: IncomingMessage, res: ServerResponse) => void;

function splitArgs(route: RouteDescriptor, args: Record<string, unknown>): { url: string; body: Record<string, unknown> } {
  const rest: Record<string, unknown> = { ...args };
  let path = route.path;

  for (const param of route.params) {
    if (param.in === "path" && param.name in rest) {
      path = path.replace(`:${param.name}`, encodeURIComponent(String(rest[param.name])));
      delete rest[param.name];
    }
  }

  const queryNames = new Set(route.params.filter((p) => p.in === "query").map((p) => p.name));
  const queryParts: string[] = [];
  const body: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(rest)) {
    if (queryNames.has(key)) queryParts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    else body[key] = value;
  }

  const url = queryParts.length > 0 ? `${path}?${queryParts.join("&")}` : path;
  return { url, body };
}

/**
 * Dispatches tool calls as real loopback HTTP requests against the host
 * app's own request listener, via a dedicated ephemeral, localhost-only
 * server used purely for internal invocation (never exposed externally,
 * started lazily on first call).
 *
 * This is deliberately a REAL socket round trip rather than an in-process
 * "fake request" shim (e.g. a hand-rolled IncomingMessage, or a test-only
 * injection library). Both of those were tried and both broke in production:
 * body-parser's `raw-body` and the MCP SDK's own Node/Fetch HTTP bridging
 * each assume real http.IncomingMessage/ServerResponse internals in ways
 * that only surface when a synthetic request is nested *inside* a live one
 * being served over a real socket — exactly what invoking a tool from
 * within the live /mcp request handler requires. A real loopback socket
 * sidesteps that class of bug entirely and, as a bonus, exercises the host
 * app's full middleware chain (auth, rate-limiting, logging) exactly as a
 * real client request would.
 */
export function createLoopbackInvoker(requestListener: HttpRequestListener): { invoke: RouteInvoker; close: () => Promise<void> } {
  const server = http.createServer(requestListener);
  let listening: Promise<number> | undefined;

  function ensureListening(): Promise<number> {
    if (!listening) {
      listening = new Promise<number>((resolveListen, rejectListen) => {
        server.once("error", rejectListen);
        server.listen(0, "127.0.0.1", () => {
          resolveListen((server.address() as AddressInfo).port);
        });
      });
    }
    return listening;
  }

  const invoke: RouteInvoker = async (route, args) => {
    const port = await ensureListening();
    const { url, body } = splitArgs(route, args);
    // HEAD responses (and, by the same convention, requests) must not carry
    // a body — but GET carrying one is unusual, not invalid: HTTP doesn't
    // forbid it, and real routes (e.g. a GET that validates a field via
    // req.body for historical reasons) do rely on it. Don't silently drop
    // leftover args just because the method is GET.
    const hasBody = route.method !== "HEAD" && Object.keys(body).length > 0;
    const payload = hasBody ? JSON.stringify(body) : undefined;

    return new Promise((resolveCall, rejectCall) => {
      const req = http.request(
        {
          host: "127.0.0.1",
          port,
          method: route.method,
          path: url,
          headers: payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : undefined,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf-8");
            const statusCode = res.statusCode ?? 500;

            if (statusCode >= 400) {
              rejectCall(new Error(`${route.method} ${route.path} responded ${statusCode}: ${text}`));
              return;
            }

            const contentType = res.headers["content-type"];
            if (typeof contentType === "string" && contentType.includes("application/json")) {
              try {
                resolveCall(JSON.parse(text));
                return;
              } catch {
                resolveCall(text);
                return;
              }
            }
            resolveCall(text);
          });
        },
      );

      req.on("error", rejectCall);
      if (payload) req.write(payload);
      req.end();
    });
  };

  const close = (): Promise<void> => new Promise((resolveClose) => server.close(() => resolveClose()));

  return { invoke, close };
}
