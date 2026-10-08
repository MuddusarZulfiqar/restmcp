import "reflect-metadata";
import type { ModulesContainer } from "@nestjs/core";
import { PATH_METADATA, METHOD_METADATA, ROUTE_ARGS_METADATA } from "@nestjs/common/constants.js";
import type { HttpMethod, ParamDescriptor, ParamType, RouteDescriptor } from "@restmcp/core";
import { dtoToJsonSchema } from "./dto-schema.js";
import { MCP_EXCLUDE_METADATA, MCP_TOOL_METADATA, type McpToolOverride } from "./decorators.js";

const PARAMTYPES_METADATA = "design:paramtypes";

/**
 * Nest's RouteParamtypes enum (@nestjs/common/enums/route-paramtypes.enum) —
 * not part of the public API surface, but these numeric values are part of
 * Nest's stable decorator metadata contract (the same values @nestjs/swagger's
 * own reflection-based scanner relies on) and have been unchanged since Nest 6.
 */
const ROUTE_PARAMTYPE = { BODY: 3, QUERY: 4, PARAM: 5 } as const;

/** Nest's RequestMethod enum, same stability note as ROUTE_PARAMTYPE above. */
const REQUEST_METHOD_TO_HTTP: Record<number, HttpMethod | undefined> = {
  0: "GET",
  1: "POST",
  2: "PUT",
  3: "DELETE",
  4: "PATCH",
  6: "OPTIONS",
  7: "HEAD",
};

interface RouteArgMetadataEntry {
  index: number;
  data?: string;
}

function designTypeParamType(type: unknown): ParamType {
  const name = typeof type === "function" ? (type as { name?: string }).name : undefined;
  return name === "Number" ? "number" : name === "Boolean" ? "boolean" : "string";
}

function isPlainConstructor(type: unknown): type is new () => object {
  if (typeof type !== "function") return false;
  const name = (type as { name?: string }).name;
  return !["String", "Number", "Boolean", "Array", "Object", "Date"].includes(name ?? "");
}

function joinPaths(...segments: Array<string | undefined>): string {
  const cleaned = segments
    .filter((s): s is string => Boolean(s))
    .flatMap((s) => s.split("/"))
    .filter(Boolean);
  return `/${cleaned.join("/")}`;
}

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [""] as unknown as T[];
  return Array.isArray(value) ? value : [value];
}

interface ScanOptions {
  /** Prepended to every discovered path — set this if the host app calls app.setGlobalPrefix(). */
  globalPrefix?: string;
}

interface ControllerLike {
  metatype: (new (...args: unknown[]) => object) | null;
}

/**
 * Walks every controller registered in the Nest DI container (via
 * ModulesContainer) and reads route metadata directly through Nest's own
 * reflection mechanisms (Reflector-style `Reflect.getMetadata` against the
 * constants Nest's own `@Get`/`@Post`/... decorators and param decorators
 * write) — no source scanning, per requirement.md §4.1.
 */
export function discoverNestRoutes(modulesContainer: ModulesContainer, options: ScanOptions = {}): RouteDescriptor[] {
  const routes: RouteDescriptor[] = [];

  for (const module of modulesContainer.values()) {
    for (const wrapper of module.controllers.values() as IterableIterator<ControllerLike>) {
      const metatype = wrapper.metatype;
      if (!metatype) continue;

      const prototype = metatype.prototype as Record<string, (...args: unknown[]) => unknown>;
      const controllerPaths = toArray(Reflect.getMetadata(PATH_METADATA, metatype) as string | string[] | undefined);
      const controllerExcluded = Reflect.getMetadata(MCP_EXCLUDE_METADATA, metatype) === true;

      for (const methodName of Object.getOwnPropertyNames(prototype)) {
        if (methodName === "constructor" || typeof prototype[methodName] !== "function") continue;
        const handler = prototype[methodName];

        const methodPaths = Reflect.getMetadata(PATH_METADATA, handler) as string | string[] | undefined;
        const requestMethod = Reflect.getMetadata(METHOD_METADATA, handler) as number | undefined;
        if (methodPaths === undefined || requestMethod === undefined) continue; // not an HTTP route handler

        const method = REQUEST_METHOD_TO_HTTP[requestMethod];
        if (!method) continue;

        const routeArgs = (Reflect.getMetadata(ROUTE_ARGS_METADATA, metatype, methodName) ?? {}) as Record<
          string,
          RouteArgMetadataEntry
        >;
        const designParamTypes = (Reflect.getMetadata(PARAMTYPES_METADATA, prototype, methodName) ?? []) as unknown[];

        const explicitParams: ParamDescriptor[] = [];
        let bodySchema: ReturnType<typeof dtoToJsonSchema> | undefined;

        for (const [key, entry] of Object.entries(routeArgs)) {
          const paramType = Number(key.split(":")[0]);
          const designType = designParamTypes[entry.index];

          if (paramType === ROUTE_PARAMTYPE.PARAM && entry.data) {
            explicitParams.push({ name: entry.data, in: "path", type: "string", required: true });
          } else if (paramType === ROUTE_PARAMTYPE.QUERY && entry.data) {
            explicitParams.push({ name: entry.data, in: "query", type: designTypeParamType(designType), required: false });
          } else if (paramType === ROUTE_PARAMTYPE.BODY && isPlainConstructor(designType)) {
            bodySchema = dtoToJsonSchema(designType as new () => object);
          }
        }

        const mcpOverride = Reflect.getMetadata(MCP_TOOL_METADATA, handler) as McpToolOverride | undefined;
        const methodExcluded = Reflect.getMetadata(MCP_EXCLUDE_METADATA, handler) === true;
        const excluded = controllerExcluded || methodExcluded;

        for (const controllerPath of controllerPaths) {
          for (const methodPath of toArray(methodPaths)) {
            const fullPath = joinPaths(options.globalPrefix, controllerPath, methodPath);

            const pathParamNames = (fullPath.match(/:[A-Za-z0-9_]+/g) ?? []).map((p) => p.slice(1));
            const params = [...explicitParams];
            for (const name of pathParamNames) {
              if (!params.some((p) => p.in === "path" && p.name === name)) {
                params.push({ name, in: "path", type: "string", required: true });
              }
            }

            routes.push({
              method,
              path: fullPath,
              params,
              body: bodySchema ? { contentType: "application/json", schema: bodySchema } : undefined,
              mcp: excluded ? { enabled: false } : mcpOverride,
            });
          }
        }
      }
    }
  }

  return routes;
}
