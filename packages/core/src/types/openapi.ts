import type { JSONSchema } from "./json-schema.js";

/** Minimal OpenAPI 3.0 subset — only what the pipeline needs to round-trip through. */
export interface OpenAPIParameter {
  name: string;
  in: "path" | "query";
  required?: boolean;
  description?: string;
  schema: JSONSchema;
}

export interface OpenAPIRequestBody {
  required?: boolean;
  content: {
    "application/json": { schema: JSONSchema };
  };
}

export interface OpenAPIOperation {
  operationId: string;
  summary?: string;
  description?: string;
  parameters: OpenAPIParameter[];
  requestBody?: OpenAPIRequestBody;
}

export type OpenAPIPathItem = Partial<Record<"get" | "post" | "put" | "patch" | "delete" | "head" | "options", OpenAPIOperation>>;

export interface OpenAPIDocument {
  openapi: "3.0.3";
  info: { title: string; version: string };
  paths: Record<string, OpenAPIPathItem>;
}
