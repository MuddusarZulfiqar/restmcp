import http from "node:http";
import { describe, expect, it, afterEach } from "vitest";
import { createLoopbackInvoker } from "./http-invoker.js";
import type { RouteDescriptor } from "../types/route.js";

function jsonListener(req: http.IncomingMessage, res: http.ServerResponse) {
  const chunks: Buffer[] = [];
  req.on("data", (c: Buffer) => chunks.push(c));
  req.on("end", () => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.method === "GET" && url.pathname.startsWith("/users/")) {
      const id = url.pathname.split("/")[2];
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id, search: url.searchParams.get("search") }));
      return;
    }
    if (req.method === "POST" && url.pathname === "/users") {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf-8") || "{}");
      res.writeHead(201, { "content-type": "application/json" });
      res.end(JSON.stringify({ created: body }));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });
}

describe("createLoopbackInvoker", () => {
  let close: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await close?.();
    close = undefined;
  });

  it("substitutes path params and forwards query params", async () => {
    const invoker = createLoopbackInvoker(jsonListener);
    close = invoker.close;

    const route: RouteDescriptor = {
      method: "GET",
      path: "/users/:id",
      params: [
        { name: "id", in: "path", type: "string", required: true },
        { name: "search", in: "query", type: "string", required: false },
      ],
    };

    const result = await invoker.invoke(route, { id: "42", search: "ada" });
    expect(result).toEqual({ id: "42", search: "ada" });
  });

  it("sends remaining args as a JSON body on mutating methods", async () => {
    const invoker = createLoopbackInvoker(jsonListener);
    close = invoker.close;

    const route: RouteDescriptor = { method: "POST", path: "/users", params: [] };
    const result = await invoker.invoke(route, { name: "Ada" });
    expect(result).toEqual({ created: { name: "Ada" } });
  });

  it("rejects when the underlying handler responds with an error status", async () => {
    const invoker = createLoopbackInvoker(jsonListener);
    close = invoker.close;

    const route: RouteDescriptor = { method: "GET", path: "/missing", params: [] };
    await expect(invoker.invoke(route, {})).rejects.toThrow(/404/);
  });

  it("reuses the same ephemeral server across multiple calls", async () => {
    const invoker = createLoopbackInvoker(jsonListener);
    close = invoker.close;

    const route: RouteDescriptor = {
      method: "GET",
      path: "/users/:id",
      params: [{ name: "id", in: "path", type: "string", required: true }],
    };

    await invoker.invoke(route, { id: "1" });
    const second = await invoker.invoke(route, { id: "2" });
    expect(second).toEqual({ id: "2", search: null });
  });
});
