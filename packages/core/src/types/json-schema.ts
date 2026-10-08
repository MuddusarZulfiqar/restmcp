/**
 * Minimal JSON Schema (draft-07 subset) type — enough to describe MCP tool
 * input schemas without depending on a heavyweight JSON Schema library's types.
 */
export interface JSONSchema {
  type?: "object" | "string" | "number" | "integer" | "boolean" | "array" | "null";
  description?: string;
  properties?: Record<string, JSONSchema>;
  items?: JSONSchema;
  required?: string[];
  enum?: Array<string | number | boolean | null>;
  format?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  additionalProperties?: boolean | JSONSchema;
  default?: unknown;
  nullable?: boolean;
}

export interface ObjectJSONSchema extends JSONSchema {
  type: "object";
  properties: Record<string, JSONSchema>;
  required: string[];
}
