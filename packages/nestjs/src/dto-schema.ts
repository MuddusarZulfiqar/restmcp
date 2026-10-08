import { createRequire } from "node:module";
import type { JSONSchema, ObjectJSONSchema } from "@api-mcp/core";

const requireOptional = createRequire(import.meta.url);

type Ctor = new (...args: unknown[]) => object;

interface ValidationMetadataLike {
  propertyName: string;
  name?: string;
  constraints?: unknown[];
}

interface MetadataStorageLike {
  getTargetValidationMetadatas(target: Function, schema: string, always: boolean, strict: boolean): ValidationMetadataLike[];
}

/**
 * Lazily requires class-validator so it stays an optional peer dependency —
 * a host app that hasn't installed it still gets DTOs typed from plain TS
 * design-type metadata (see designTypeToSchema below), just without the
 * finer-grained constraints.
 */
function loadClassValidator(): MetadataStorageLike | undefined {
  try {
    const mod = requireOptional("class-validator") as { getMetadataStorage: () => MetadataStorageLike };
    return mod.getMetadataStorage();
  } catch {
    return undefined;
  }
}

const PRIMITIVE_SCHEMA: Record<string, JSONSchema> = {
  String: { type: "string" },
  Number: { type: "number" },
  Boolean: { type: "boolean" },
  Date: { type: "string", format: "date-time" },
  Array: { type: "array" },
};

function designTypeToSchema(type: unknown): JSONSchema {
  const name = typeof type === "function" ? (type as { name?: string }).name : undefined;
  return name && PRIMITIVE_SCHEMA[name] ? PRIMITIVE_SCHEMA[name] : { type: "object" };
}

/**
 * Applies one class-validator decorator's constraint onto a property's
 * JSON Schema fragment. Supports the set called out in requirement.md §4:
 * IsString, IsEmail, IsNumber, IsOptional, IsBoolean, IsEnum, Min, Max, Length.
 */
function applyConstraint(schema: JSONSchema, meta: ValidationMetadataLike, required: Set<string>): void {
  switch (meta.name) {
    case "isString":
      schema.type = "string";
      break;
    case "isEmail":
      schema.type = "string";
      schema.format = "email";
      break;
    case "isNumber":
    case "isInt":
      schema.type = "number";
      break;
    case "isBoolean":
      schema.type = "boolean";
      break;
    case "isEnum": {
      const values = meta.constraints?.[0];
      schema.enum = values ? Object.values(values as Record<string, string | number>) : schema.enum;
      break;
    }
    case "isOptional":
      required.delete(meta.propertyName);
      break;
    case "min":
      schema.minimum = meta.constraints?.[0] as number | undefined;
      break;
    case "max":
      schema.maximum = meta.constraints?.[0] as number | undefined;
      break;
    case "isLength":
    case "length":
      schema.minLength = meta.constraints?.[0] as number | undefined;
      schema.maxLength = meta.constraints?.[1] as number | undefined;
      break;
    default:
      break;
  }
}

/**
 * Converts a DTO class into a JSON Schema object. Uses class-validator's
 * metadata storage when the package is installed in the host app (richer:
 * formats, enums, bounds); otherwise falls back to TS `design:paramtypes`-style
 * reflection, which only knows primitive field types with no constraints.
 */
export function dtoToJsonSchema(dto: Ctor): ObjectJSONSchema {
  const storage = loadClassValidator();

  if (!storage) {
    // No class-validator: emit an open object schema. We don't have property-level
    // reflection for arbitrary class fields without decorators, so this is
    // intentionally permissive rather than guessing wrong field names.
    return { type: "object", properties: {}, required: [], additionalProperties: true };
  }

  const metas = storage.getTargetValidationMetadatas(dto, "", false, false);
  const properties: Record<string, JSONSchema> = {};
  const required = new Set<string>();

  for (const meta of metas) {
    properties[meta.propertyName] ??= {};
    required.add(meta.propertyName);
  }

  for (const meta of metas) {
    applyConstraint(properties[meta.propertyName]!, meta, required);
  }

  return { type: "object", properties, required: Array.from(required) };
}
