import { describe, expect, it } from "vitest";
import { buildInputSchema } from "./input-schema.js";
import type { OpenAPIOperation } from "../types/openapi.js";

describe("buildInputSchema", () => {
  it("merges path params as required properties", () => {
    const operation: OpenAPIOperation = {
      operationId: "get_user",
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
    };
    const schema = buildInputSchema(operation);
    expect(schema).toEqual({
      type: "object",
      properties: { id: { type: "string", description: undefined } },
      required: ["id"],
    });
  });

  it("merges query params as optional unless flagged required", () => {
    const operation: OpenAPIOperation = {
      operationId: "list_users",
      parameters: [
        { name: "search", in: "query", required: false, schema: { type: "string" } },
        { name: "page", in: "query", required: false, schema: { type: "number" } },
      ],
    };
    const schema = buildInputSchema(operation);
    expect(Object.keys(schema.properties)).toEqual(["search", "page"]);
    expect(schema.required).toEqual([]);
  });

  it("merges request body properties without overriding params on name collision", () => {
    const operation: OpenAPIOperation = {
      operationId: "create_user",
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: { id: { type: "number" }, name: { type: "string" } },
              required: ["name"],
            },
          },
        },
      },
    };
    const schema = buildInputSchema(operation);
    expect(schema.properties.id).toEqual({ type: "string", description: undefined });
    expect(schema.properties.name).toEqual({ type: "string" });
    expect(schema.required).toEqual(["id", "name"]);
  });
});
