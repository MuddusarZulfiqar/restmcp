import { describe, expect, it } from "vitest";
import { validateArgs } from "./validator.js";
import type { JSONSchema } from "../types/json-schema.js";

const schema: JSONSchema = {
  type: "object",
  properties: { id: { type: "string" }, limit: { type: "number" } },
  required: ["id"],
};

describe("validateArgs", () => {
  it("accepts valid arguments", () => {
    expect(validateArgs(schema, { id: "123", limit: 10 }).valid).toBe(true);
  });

  it("rejects missing required fields", () => {
    const result = validateArgs(schema, {});
    expect(result.valid).toBe(false);
    expect(result.errors?.[0]).toMatch(/id/);
  });

  it("coerces numeric strings for number fields", () => {
    const result = validateArgs(schema, { id: "123", limit: "10" });
    expect(result.valid).toBe(true);
  });
});
