# Architecture — `@restmcp`

Companion to `requirement.md` (what/why) and `CLAUDE.md` (contributor workflow).
This document is the *how*: package boundaries, data flow, and the key types that
cross them.

## 1. Layered pipeline

```
┌─────────────────────────┐   ┌─────────────────────────┐
│   @restmcp/express       │   │   @restmcp/nestjs        │   ← framework adapters
│   (route discovery via   │   │   (route discovery via   │     (know their framework,
│    app._router walk)     │   │    Nest Reflector/        │     nothing about MCP)
│                          │   │    ModulesContainer)      │
└───────────┬──────────────┘   └───────────┬──────────────┘
            │  RouteDescriptor[]            │  RouteDescriptor[]
            └───────────────┬───────────────┘
                             ▼
                   ┌───────────────────┐
                   │   @restmcp/core    │   ← framework-agnostic
                   │                    │
                   │  RouteDescriptor[] │
                   │        ↓           │
                   │  OpenAPI document  │  (openapi/)
                   │        ↓           │
                   │  JSON Schema per   │  (schema/)
                   │  route (params+    │
                   │  body)             │
                   │        ↓           │
                   │  naming/collision  │  (naming/)
                   │  resolution        │
                   │        ↓           │
                   │  permission/filter │  (permissions/)
                   │  pass (include/    │
                   │  exclude, mcp:false,
                   │  allowMutations)   │
                   │        ↓           │
                   │  ToolDefinition[]  │  (generator/)
                   │        ↓           │
                   │  MCP Server        │  (mcp/ — wraps
                   │  (tools/list,      │   @modelcontextprotocol/sdk)
                   │   tools/call with  │
                   │   AJV validation + │
                   │   auth gate)       │
                   └─────────┬──────────┘
                             │  Server instance + handler
                   ┌─────────┴──────────┐
                   │  adapter mounts    │
                   │  POST /mcp using   │
                   │  framework's HTTP  │
                   │  primitives         │
                   └────────────────────┘
```

Adapters never generate `ToolDefinition`s themselves and never talk to the MCP SDK
directly — they produce `RouteDescriptor[]`, hand it to `core`, and mount whatever
HTTP handler `core`'s MCP transport layer returns. This is what lets a future
Fastify/Koa adapter reuse 100% of `core` and `mcp/` untouched.

## 2. Package map

```
restmcp/
├── packages/
│   ├── core/            @restmcp/core        — framework-agnostic pipeline
│   │   └── src/
│   │       ├── types/            shared interfaces (RouteDescriptor, ToolDefinition, MCPConfig, ...)
│   │       ├── openapi/          RouteDescriptor[] -> OpenAPIDocument
│   │       ├── schema/           OpenAPI param/body schema -> JSON Schema; class-validator bridge
│   │       ├── naming/           method+path -> tool name, collision resolution
│   │       ├── permissions/      include/exclude globs, mcp:false, allowMutations
│   │       ├── authentication/   auth strategy interfaces + built-in apiKey/bearer/custom
│   │       ├── generator/        orchestrates the pipeline -> ToolDefinition[] + mcp-tools.json shape
│   │       ├── mcp/               @modelcontextprotocol/sdk Server wiring, transport, AJV call validation
│   │       └── index.ts
│   │
│   ├── express/         @restmcp/express
│   │   └── src/
│   │       ├── route-discovery.ts   walks app._router -> RouteDescriptor[]
│   │       ├── adapter.ts           MCPExpress.setup()/tool()/register()/exclude()
│   │       └── index.ts
│   │
│   ├── nestjs/          @restmcp/nestjs
│   │   └── src/
│   │       ├── scanner.ts           ModulesContainer + MetadataScanner -> RouteDescriptor[]
│   │       ├── dto-schema.ts        DTO class -> JSON Schema (class-validator aware)
│   │       ├── decorators.ts        @McpTool, @McpExclude
│   │       ├── module.ts            MCPModule.forRoot() / forRootAsync()
│   │       └── index.ts
│   │
│   └── cli/             restmcp (bin)
│       └── src/
│           ├── commands/{init,generate,inspect,export}.ts
│           └── index.ts
│
├── examples/
│   ├── express/
│   └── nestjs/
├── tests/                 cross-package integration tests (per-package unit tests live beside their src)
├── package.json            npm workspaces root
├── tsconfig.base.json
└── README.md
```

## 3. Key cross-package types (`@restmcp/core/types`)

```ts
type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

interface ParamDescriptor {
  name: string;
  in: "path" | "query";
  type: "string" | "number" | "boolean" | "array";
  required: boolean;
  description?: string;
}

interface BodyDescriptor {
  contentType: "application/json";
  schema: JSONSchema; // already-resolved JSON Schema, framework-specific derivation happens upstream
}

interface RouteDescriptor {
  method: HttpMethod;
  path: string;              // Express-style "/users/:id"
  operationId?: string;      // optional hint from OpenAPI/decorator
  summary?: string;
  description?: string;
  params: ParamDescriptor[]; // path + query, flattened
  body?: BodyDescriptor;
  mcp?: { enabled?: boolean; name?: string; description?: string }; // per-route override/opt-out
  handlerRef?: unknown;      // opaque, framework-side reference used only to invoke the real handler
}

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  route: RouteDescriptor; // retained for invocation + inspect/export output
}

interface MCPConfig { /* see requirement.md §6 */ }
```

`handlerRef` is intentionally opaque to `core`: the Express adapter stores the
Express handler + app reference there and knows how to invoke it with synthesized
`req`/`res`; the NestJS adapter stores the controller instance + method name and
invokes through Nest's own HTTP adapter. `core`'s MCP layer calls a single
adapter-supplied `invoke(route, args) => Promise<unknown>` function — it never
touches `handlerRef` directly. This keeps the invocation boundary, not just
discovery, framework-agnostic.

## 4. Request lifecycle for a `tools/call`

1. MCP client POSTs JSON-RPC `tools/call` to `/mcp`.
2. `core/mcp` Server (from `@modelcontextprotocol/sdk`) parses the envelope.
3. Auth gate runs (`authentication/`) using the config's `auth` strategy against
   the incoming HTTP request (adapters pass through raw headers).
4. AJV validates `arguments` against the tool's `inputSchema`.
5. `core` calls the adapter-supplied `invoke(route, args)`.
   - Express: synthesizes a scoped `req` (merging path/query/body from `args`)
     and calls the matched route handler, capturing the `res` output.
   - NestJS: resolves the controller instance from the module container and
     calls the method directly, passing args per Nest's own param metadata
     (so guards/pipes bound to the method still apply when invoked through
     Nest's `HttpAdapterHost`-based execution context).
6. Result is serialized back as the tool's MCP content response.
7. Errors at any step become an MCP tool error result — never a thrown exception
   that could crash the host process.

## 5. Why OpenAPI as the intermediate layer

- Keeps `core` ignorant of Express/Nest-isms; it only ever reasons about
  `RouteDescriptor` → `OpenAPIDocument` → JSON Schema.
- `OpenAPIDocument` is also directly useful: `inspect`/`export` can optionally
  emit a real `openapi.json` alongside `mcp-tools.json` for free.
- A future adapter (Fastify, Koa, raw `http`) only has to implement route
  discovery + `invoke()`; naming, schema generation, permissions, auth, and the
  MCP transport are reused unchanged.

## 6. Extension seams for Resources/Prompts (v2+)

`generator/` exposes a `ToolSource` interface (`RouteDescriptor[] → ToolDefinition[]`).
v2 adds parallel `ResourceSource` / `PromptSource` interfaces consumed by the same
`core/mcp` Server wiring (`server.setRequestHandler` for `resources/list`,
`resources/read`, `prompts/list`, `prompts/get`), so no existing pipeline stage is
rewritten — only new sources are registered alongside `ToolSource`.

## 7. MCP SDK choice

`@modelcontextprotocol/sdk` (official TypeScript SDK). Use `McpServer` +
`StreamableHTTPServerTransport` for `/mcp` (stateless-friendly, works over plain
HTTP POST, matches the brief's `POST /mcp` requirement without requiring SSE).

## 8. Validation & security boundaries

- AJV compiles each tool's `inputSchema` once at generation time (cached), reused
  per call — no per-call compilation cost.
- `auth.validate` runs before AJV validation and before `invoke()` — unauthenticated
  calls never reach route handlers or leak schema-shaped errors beyond "unauthorized".
- Tool descriptions/schemas are generated from route metadata only; secrets (API
  keys, bearer tokens, config values) are never interpolated into any MCP-visible
  string. A lint-style check in `core` guards against accidentally embedding
  config values into generated descriptions.
- `security.rateLimit` / `maxRequestSize` are hooks the adapters wire into their
  native middleware stacks (`express-rate-limit`-shaped for Express, Nest
  `ThrottlerModule`-shaped for Nest) — `core` only defines the interface, it does
  not implement rate limiting itself (avoids a hard dependency and duplicate
  limiting if the host app already rate-limits).
