import type { RouteDescriptor } from "../types/route.js";
import type { OpenAPIDocument, OpenAPIOperation, OpenAPIParameter, OpenAPIPathItem } from "../types/openapi.js";

const METHOD_KEY: Record<string, keyof OpenAPIPathItem> = {
  GET: "get",
  POST: "post",
  PUT: "put",
  PATCH: "patch",
  DELETE: "delete",
  HEAD: "head",
  OPTIONS: "options",
};

function toOperation(route: RouteDescriptor): OpenAPIOperation {
  const parameters: OpenAPIParameter[] = route.params.map((p) => ({
    name: p.name,
    in: p.in,
    required: p.in === "path" ? true : p.required,
    description: p.description,
    schema: { type: p.type === "array" ? "array" : p.type, enum: p.enum },
  }));

  const operation: OpenAPIOperation = {
    operationId: route.operationId ?? `${route.method.toLowerCase()}_${route.path}`,
    summary: route.summary,
    description: route.description,
    parameters,
  };

  if (route.body) {
    operation.requestBody = {
      required: true,
      content: { "application/json": { schema: route.body.schema } },
    };
  }

  return operation;
}

/**
 * Converts framework-agnostic RouteDescriptors into an OpenAPI document.
 * This is the mandatory intermediate representation: everything downstream
 * (JSON Schema generation, MCP tool generation) consumes OpenAPIDocument,
 * never RouteDescriptor[] directly, per architecture.md §1/§5.
 */
export function routesToOpenAPI(routes: RouteDescriptor[], info: { title: string; version: string }): OpenAPIDocument {
  const paths: Record<string, OpenAPIPathItem> = {};

  for (const route of routes) {
    const key = METHOD_KEY[route.method];
    if (!key) continue;
    const pathItem = (paths[route.path] ??= {});
    pathItem[key] = toOperation(route);
  }

  return { openapi: "3.0.3", info, paths };
}

/** Flattens an OpenAPI document back into (method, path, operation) triples. */
export function* iterateOperations(doc: OpenAPIDocument): Generator<{ method: string; path: string; operation: OpenAPIOperation }> {
  for (const [path, pathItem] of Object.entries(doc.paths)) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (operation) yield { method: method.toUpperCase(), path, operation };
    }
  }
}
