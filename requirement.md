# Requirements — `@restmcp` (REST → MCP Tool Generator)

Source: original product brief from the user (2026-10-09). This document is the
canonical requirements spec. Architecture decisions live in `architecture.md`.
Working conventions for contributors (human or Claude) live in `CLAUDE.md`.

## 1. Goal

Ship a production-ready NPM package (as a monorepo of scoped packages) that lets a
developer drop MCP (Model Context Protocol) support into an **existing** Express or
NestJS REST API with minimal configuration — no hand-written MCP tool JSON per route.

## 2. Target Developer Experience

### Express

```ts
import express from "express";
import { MCPExpress } from "@restmcp/express";

const app = express();
MCPExpress.setup(app, { name: "My API", version: "1.0.0" });
app.listen(3000);
```

### NestJS

```ts
import { MCPModule } from "@restmcp/nestjs";

@Module({
  imports: [MCPModule.forRoot({ name: "My API", version: "1.0.0" })],
})
export class AppModule {}
```

Both must be **opt-in** and must never break the host application if MCP setup
fails (fail safe, log, don't crash the host server unless explicitly configured to).

## 3. Core Architecture (required shape)

```
Express/NestJS  →  Route Discovery  →  OpenAPI Representation  →  JSON Schema
→  MCP Tool Definitions  →  MCP Server  →  POST /mcp  →  AI/MCP Client
```

OpenAPI is the mandatory intermediate representation so new framework adapters can
be added later (Fastify, Koa, etc.) without touching MCP generation code. Framework
adapters only need to produce an `OpenAPIDocument` (or an internal `RouteDescriptor[]`
that core converts to one); everything downstream of that is framework-agnostic.

## 4. Functional Requirements

1. **Automatic route discovery**
   - Express: walk the app's router stack (`app._router` / Express 5 equivalent),
     recursively resolving mounted routers, extracting method + path + param names.
   - NestJS: use Nest's own metadata/reflection (`Reflector`, `ModulesContainer`,
     `MetadataScanner`, route decorators' `PATH_METADATA`/`METHOD_METADATA`) — not
     source scanning.
   - No regex scanning of source files. Framework/runtime metadata or OpenAPI only.
   - If discovery is impossible for a given Express setup, expose a manual
     `mcp.register({ method, path, name, description, inputSchema })` escape hatch.

2. **MCP tool generation** — one MCP tool per eligible route, JSON Schema `inputSchema`
   assembled from path params + query params + request body.

3. **Request body schema**
   - NestJS: derive from DTO classes. Support `class-validator` decorators:
     `@IsString`, `@IsEmail`, `@IsNumber`, `@IsOptional`, `@IsBoolean`, `@IsEnum`,
     `@Min`, `@Max`, `@Length`. Use `class-validator`'s metadata storage when the
     package is installed in the host app; otherwise fall back to TS design-type
     metadata (`reflect-metadata` + `emitDecoratorMetadata`) with primitive types only.
   - Express: no DTX convention exists, so body schema comes from (a) an OpenAPI
     doc supplied by the developer/`swagger-jsdoc`/etc. if present, or (b) explicit
     `mcp.register(...)` / per-route override, or (c) omitted (`additionalProperties: true`
     object) with a warning surfaced via `inspect`.

4. **Query parameters** → flat `{ [name]: { type, description? } }`, inferred `string`
   by default, `number`/`boolean` when a type hint is available (OpenAPI param schema,
   NestJS `@Query() dto` type, or explicit override).

5. **Path parameters** → always present, typed per the same inference rules, always
   `required`.

6. **Authentication** — config-level `auth` block supporting `none | apiKey | bearer |
   oauth2 | custom`, each with a `validate(request) => Promise<boolean>` hook (or
   provider-specific shape). Runs before any tool invocation reaches the underlying
   route handler. Secrets/credentials are never echoed into tool schemas, descriptions,
   or MCP server metadata.

7. **Tool permissions / filtering** — `include`/`exclude` glob lists operating on the
   original route path, plus `mcp: false` per-route opt-out (Express: route-level
   metadata via `mcp.exclude(path)`/registration option; NestJS: `@McpExclude()`
   decorator). `allowMutations: false` restricts generated tools to safe/read-only
   HTTP methods (GET/HEAD).

8. **Tool naming** — deterministic `method + resource` derivation (`get_user`,
   `create_user`, `update_user`, `delete_user`, `list_users`), collision-resolved by
   folding in the next distinguishing path segment (`get_admin_user` vs
   `get_public_user`) and finally a numeric suffix if still colliding.

9. **Tool descriptions** — default from OpenAPI `summary`/`description` when present,
   otherwise a generated sentence from method + path. Developer override via
   per-route config or `MCPExpress.tool(path, { name, description })` /
   `@McpTool({ name, description })` decorator.

10. **HTTP method mapping** — GET→read/list, POST→create/action, PUT/PATCH→update,
    DELETE→delete. `allowMutations` gates POST/PUT/PATCH/DELETE as a group.

11. **Extension points for MCP Resources/Prompts** — v1 implements Tools only, but the
    generator pipeline must expose seams (`ToolSource`, future `ResourceSource`,
    `PromptSource`) so later versions add capabilities without reshaping core.

12. **MCP endpoint** — `POST /mcp` (path configurable), implemented with the official
    `@modelcontextprotocol/sdk` server + its Streamable HTTP transport. No hand-rolled
    JSON-RPC framing.

13. **CLI** (`restmcp`) — `init`, `generate`, `inspect`, `export` subcommands as
    specified in the brief (human-readable `inspect` summary; `export` writes
    `mcp-tools.json` derived from live app metadata, never hand-maintained).

14. **Generated JSON** — `mcp-tools.json` shape:
    ```json
    { "name": "My API", "version": "1.0.0", "tools": [ { "name": "...", "description": "...", "inputSchema": { ... } } ] }
    ```

## 5. Non-functional Requirements

- TypeScript, strict mode, across every package.
- Unit + integration tests (Express app fixtures, NestJS testing module fixtures).
- Node.js LTS support (currently 20.x and 22.x; dev box runs 24.x).
- No framework-specific imports inside `@restmcp/core`.
- Dependency injection where it fits naturally (NestJS adapter uses Nest's DI).
- Safe error handling: a broken tool/schema must not crash the host process; it
  surfaces as a tool-generation warning and the route is skipped.
- Input validation on every MCP tool call (AJV against the generated `inputSchema`)
  before the underlying route handler runs.
- Rate limiting + logging are pluggable hooks, not hard dependencies.
- Custom middleware support on the `/mcp` endpoint (Express: standard middleware
  array; NestJS: standard Nest middleware/guards).
- Semantic versioning across all published packages.
- Zero impact on the host app when MCP is not configured (no global patches).

## 6. Configuration Surface (`MCPConfig`)

```ts
interface MCPConfig {
  name: string;
  version: string;
  endpoint?: string; // default "/mcp"

  include?: string[];
  exclude?: string[];
  allowMutations?: boolean; // default true

  auth?: {
    type: "none" | "apiKey" | "bearer" | "oauth2" | "custom";
    headerName?: string; // for apiKey
    validate?: (context: AuthContext) => Promise<boolean> | boolean;
  };

  tools?: {
    include?: string[];
    exclude?: string[];
    overrides?: Record<string, Partial<{ name: string; description: string }>>;
  };

  security?: {
    rateLimit?: { requests: number; windowMs: number };
    maxRequestSize?: number; // bytes
  };

  logging?: boolean | ((entry: LogEntry) => void);
  middleware?: unknown[]; // framework-native middleware, applied before /mcp
}
```

(Refined from the brief: split route-path filters (`include`/`exclude`) from
tool-name filters (`tools.include`/`tools.exclude`) since they operate on different
namespaces; added `tools.overrides` so name/description overrides live in config
instead of only imperative calls; added `middleware` and a function form for
`logging`.)

## 7. Testing Matrix (must exist, not just be planned)

- **Express**: GET/POST/PUT/DELETE discovery, path params, query params, body
  schema from explicit register/OpenAPI, auth, route exclusion, duplicate-name
  resolution, `/mcp` end-to-end tool call.
- **NestJS**: controller discovery, DTO → schema (with and without
  `class-validator` installed), path/query params, auth, decorators
  (`@McpTool`, `@McpExclude`), route exclusion.
- **Core**: OpenAPI conversion, JSON Schema generation, MCP tool generation,
  naming/collision resolution, permission filtering, AJV input validation.

## 8. Deliverables

- Monorepo (`packages/core`, `packages/express`, `packages/nestjs`, `packages/cli`)
- `examples/express`, `examples/nestjs` runnable sample apps
- Full test suites (vitest) for all packages
- README covering: what/why, install, Express setup, NestJS setup, configuration,
  auth, tool filtering, security, CLI, generated tools, examples, troubleshooting,
  architecture, contributing, license
- Build + publish tooling (per-package `package.json`, root build/test scripts)

## 9. Explicit Non-goals (v1)

- MCP Resources / Prompts implementation (seams only).
- Fastify/Koa/other framework adapters (architecture must not preclude them).
- Regex/AST scanning of source files as a discovery mechanism.
- Custom/non-standard MCP protocol implementation.
