import type { JSONSchema } from "./json-schema.js";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

export const MUTATING_METHODS: ReadonlySet<HttpMethod> = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export type ParamType = "string" | "number" | "boolean" | "array";

export interface ParamDescriptor {
  name: string;
  in: "path" | "query";
  type: ParamType;
  required: boolean;
  description?: string;
  enum?: Array<string | number>;
}

export interface BodyDescriptor {
  contentType: "application/json";
  schema: JSONSchema;
}

export interface RouteMcpOverride {
  /** Explicit opt-out: this route never becomes an MCP tool. */
  enabled?: boolean;
  name?: string;
  description?: string;
  /**
   * Bypasses OpenAPI/body-derived schema generation entirely for this route —
   * used by the manual `mcp.register()` escape hatch when automatic
   * discovery can't produce a schema (see requirement.md §4.1 / architecture.md §1).
   */
  inputSchema?: JSONSchema;
}

/**
 * Framework-agnostic description of a single REST endpoint. Produced by
 * adapters (@restmcp/express, @restmcp/nestjs), consumed by @restmcp/core.
 */
export interface RouteDescriptor {
  method: HttpMethod;
  /** Express-style path, e.g. "/users/:id" */
  path: string;
  operationId?: string;
  summary?: string;
  description?: string;
  params: ParamDescriptor[];
  body?: BodyDescriptor;
  mcp?: RouteMcpOverride;
  /**
   * Opaque, adapter-owned reference to the real handler. Core never reads
   * this directly — it only ever calls the adapter's `invoke()` function.
   */
  handlerRef?: unknown;
}

/**
 * Adapter-supplied function that actually calls the underlying route handler
 * for a given route + resolved arguments, and returns a JSON-serializable result.
 */
export type RouteInvoker = (route: RouteDescriptor, args: Record<string, unknown>) => Promise<unknown>;
