import { Ajv, type ValidateFunction } from "ajv";
import * as ajvFormatsModule from "ajv-formats";
import type { JSONSchema } from "../types/json-schema.js";

// ajv-formats' CJS/ESM interop under NodeNext resolves the default export
// inconsistently depending on the importing context; grabbing .default
// explicitly (falling back to the module itself) works in both cases.
const addFormats = ((ajvFormatsModule as { default?: unknown }).default ?? ajvFormatsModule) as (
  ajvInstance: Ajv,
) => Ajv;

const ajv = addFormats(new Ajv({ allErrors: true, strict: false, coerceTypes: true }));

const compiledCache = new WeakMap<JSONSchema, ValidateFunction>();

/** Compiles (and caches) an AJV validator for a tool's inputSchema. Compiled once at generation time, reused per call. */
export function compileInputSchema(schema: JSONSchema): ValidateFunction {
  const cached = compiledCache.get(schema);
  if (cached) return cached;
  const validate = ajv.compile(schema);
  compiledCache.set(schema, validate);
  return validate;
}

export interface ValidationResult {
  valid: boolean;
  errors?: string[];
}

export function validateArgs(schema: JSONSchema, args: unknown): ValidationResult {
  const validate = compileInputSchema(schema);
  const valid = validate(args) as boolean;
  if (valid) return { valid: true };
  return {
    valid: false,
    errors: (validate.errors ?? []).map((e) => `${e.instancePath || "(root)"} ${e.message ?? "is invalid"}`),
  };
}
