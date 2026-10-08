import type { JSONSchema, ObjectJSONSchema } from "../types/json-schema.js";
import type { OpenAPIOperation } from "../types/openapi.js";

/**
 * Merges an OpenAPI operation's parameters + request body into a single flat
 * JSON Schema object — this is the MCP tool `inputSchema`. Path/query params
 * and body fields share one flat namespace (a route can't have a param and a
 * body field with the same name without one shadowing the other; this mirrors
 * how most REST frameworks bind route handler arguments in practice).
 */
export function buildInputSchema(operation: OpenAPIOperation): ObjectJSONSchema {
  const properties: Record<string, JSONSchema> = {};
  const required: string[] = [];

  for (const param of operation.parameters) {
    properties[param.name] = {
      ...param.schema,
      description: param.description ?? param.schema.description,
    };
    if (param.required) required.push(param.name);
  }

  const bodySchema = operation.requestBody?.content["application/json"]?.schema;
  if (bodySchema?.properties) {
    for (const [key, value] of Object.entries(bodySchema.properties)) {
      if (properties[key]) continue; // params win over body on name collision
      properties[key] = value;
    }
    for (const key of bodySchema.required ?? []) {
      if (!required.includes(key)) required.push(key);
    }
  }

  return { type: "object", properties, required };
}
