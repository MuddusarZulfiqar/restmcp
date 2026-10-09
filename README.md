# @restmcp

Automatically convert an existing Express or NestJS REST API into [Model Context
Protocol](https://modelcontextprotocol.io) (MCP) tools, so AI clients (Claude,
other MCP-aware agents) can call your API directly — without you hand-writing a
single MCP tool definition.

```bash
npm install @restmcp/express express
```

```ts
import express from "express";
import { MCPExpress } from "@restmcp/express";

const app = express();
// ...your existing routes...
MCPExpress.setup(app, { name: "My API", version: "1.0.0" });
app.listen(3000);
```

That's it — `POST /mcp` is now live and every eligible route is an MCP tool.

## Table of contents

- [What it does](#what-it-does)
- [Why MCP](#why-mcp)
- [Quick start](#quick-start)
- [Installation](#installation)
- [Express setup](#express-setup)
- [NestJS setup](#nestjs-setup)
- [Configuration](#configuration)
- [Authentication](#authentication)
- [Tool filtering](#tool-filtering)
- [Security](#security)
- [CLI](#cli)
- [Generated MCP tools](#generated-mcp-tools)
- [Examples](#examples)
- [Troubleshooting](#troubleshooting)
- [Architecture](#architecture)
- [Contributing](#contributing)
- [License](#license)

## What it does

1. **Discovers** your existing routes using each framework's own runtime
   metadata (Express's router stack; NestJS's DI/reflection metadata) — never
   by scanning your source files.
2. **Converts** each eligible route into an OpenAPI operation, then a JSON
   Schema, then an MCP tool definition (name, description, `inputSchema`).
3. **Serves** those tools over the real MCP protocol (via the official
   `@modelcontextprotocol/sdk`) at `POST /mcp`.
4. **Invokes** your actual route handler when an MCP client calls a tool —
   over a real (internal, loopback-only) HTTP request, so your existing
   middleware, body parsing, and auth all run exactly as they would for a
   normal client.

Nothing about your app changes unless you call `MCPExpress.setup()` /
import `MCPModule`. It is entirely opt-in.

## Why MCP

AI coding assistants and agents increasingly talk to tools over MCP rather
than ad-hoc function-calling schemas. If your API already exists as a REST
service, you shouldn't have to maintain a second, hand-written copy of its
interface just so an AI client can use it. `@restmcp` keeps the MCP surface
generated and in sync with your actual routes, DTOs, and validation rules.

## Quick start

The sections below this one are reference material, organized by topic. This
section is the thing to actually *follow* the first time: install → wire in
→ verify it worked → fix the one thing that confuses almost everyone → add
auth. Five steps, in order, each with something to run.

(This walks through Express. NestJS is the same shape — swap step 2 for
[NestJS setup](#nestjs-setup) — everything else applies identically.)

### 1. Install

```bash
npm install @restmcp/express
```

### 2. Wire it in

Add this *after* your existing routes are registered — order matters, since
discovery walks whatever's already on the router when `setup()` runs:

```ts
import { MCPExpress } from "@restmcp/express";
// const { MCPExpress } = require("@restmcp/express"); // CommonJS

// ...your app.get/post/etc. calls above this line...

const mcp = MCPExpress.setup(app, {
  name: "my-api",
  version: "1.0.0",
});

app.listen(3000);
```

That's the entire wiring step — `POST /mcp` is live.

### 3. Verify it actually worked

Start your server, then from another terminal:

```bash
curl -X POST http://localhost:3000/mcp \
  -H "content-type: application/json" \
  -H "accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

A working setup returns a JSON-RPC response with `result.tools` — one entry
per route it could discover. Nothing there, or a connection error, means
`setup()` isn't wired into the app that's actually listening (check you're
hitting the right port, and that `app.listen()` is the same `app` you called
`MCPExpress.setup()` on).

If you have the CLI installed (`npm install -D @muddusarzulfiqar/restmcp`),
`npx restmcp inspect` gives you the same information as a readable summary
instead of raw JSON — see [CLI](#cli) for its one-time setup file.

Pick a tool name from the response and call it:

```bash
curl -X POST http://localhost:3000/mcp \
  -H "content-type: application/json" \
  -H "accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"<tool name from step 3>","arguments":{}}}'
```

### 4. Fix empty schemas on body and query routes (read this first)

Read this before concluding something's broken. Plain Express has **no
built-in way to know** what fields a route's body or query string expects —
no DTO, no decorator, nothing for us to introspect (NestJS doesn't have this
problem — see the note at the end of this step). So for routes shaped like:

```ts
app.post("/users", (req, res) => { /* reads req.body.name, req.body.email */ });
app.get("/users", (req, res) => { /* reads req.query.search */ });
```

`tools/list` will show `create_user` and `list_users` with an **empty**
`inputSchema` (`"properties": {}`). That's expected, not a bug. Calling them
with no arguments reaches your handler with an empty body/query — which may
quietly do the wrong thing rather than error.

Fix it with `mcp.register()` — it overrides the auto-discovered tool for the
same route (even though discovery already found it):

```ts
mcp.register({
  method: "POST",
  path: "/users",
  name: "create_user",
  description: "Create a user",
  inputSchema: {
    type: "object",
    properties: { name: { type: "string" }, email: { type: "string", format: "email" } },
    required: ["name", "email"],
  },
});

mcp.register({
  method: "GET",
  path: "/users",
  name: "list_users",
  description: "List users",
  inputSchema: { type: "object", properties: { search: { type: "string" } }, required: [] },
  // Required for GET/HEAD: anything in `inputSchema.properties` not listed
  // here as a path/query param is treated as body-destined and never
  // reaches a GET/HEAD request. See mcp.register()'s full docs below.
  params: [{ name: "search", in: "query", type: "string", required: false }],
});
```

If you already validate these routes with Joi, Zod, `express-validator`, or
similar, that validation schema is your source of truth for writing the
`inputSchema` above — translate its fields directly rather than guessing.

**NestJS**: this entire step doesn't apply. `@Query()`/`@Body()` decorators
and DTO classes already tell `@restmcp/nestjs` exactly which fields are
which — see [NestJS setup](#nestjs-setup).

**One more real gap to know about**: routes that accept file uploads
(`multipart/form-data`, e.g. via `multer`) get discovered as tools, but
calling them through MCP will always fail — tool arguments are JSON, and
there's currently no way to send a file through one. Exclude them rather
than leaving a tool that just errors on every call:

```ts
mcp.exclude("/upload-file");
```

### 5. Add auth before you deploy anywhere real

With no `auth` configured, **every discovered tool is callable by anyone who
can reach `/mcp`** — you'll see a startup warning saying exactly this, every
time the process starts. At minimum:

```ts
MCPExpress.setup(app, {
  name: "my-api",
  version: "1.0.0",
  auth: {
    type: "bearer",
    validate: async ({ credential }) => isValidToken(credential), // however your app already verifies tokens
  },
});
```

If your routes have their *own* auth middleware expecting the same
credential (e.g. the MCP caller's bearer token is literally your app's JWT),
also set `forwardCredential: true` — without it, those routes will 401 on
every call even once MCP-level auth passes, since the credential isn't
forwarded by default. See
[Forwarding the credential to your routes](#forwarding-the-credential-to-your-routes)
for why that's opt-in and when it's safe to turn on.

That's the full loop. Everything below is reference material for each piece
in more depth — [Configuration](#configuration) for the complete options
list, [Troubleshooting](#troubleshooting) if something here didn't match
what you saw.

## Installation

Node.js 20+ required for every package below. `@restmcp/core` is a shared
transitive dependency — you never install it directly.

```bash
# Express
npm install @restmcp/express

# NestJS
npm install @restmcp/nestjs

# CLI (inspect/export/generate, optional)
npm install -D @muddusarzulfiqar/restmcp
```

The CLI's package name is scoped (`@muddusarzulfiqar/restmcp`) but its
command stays the short `restmcp` — once installed, `npx restmcp inspect`
(or just `restmcp inspect` with a global install) works as shown throughout
this README.

Peer dependencies (`express`, or `@nestjs/common`/`@nestjs/core`) are not
bundled — install them as you normally would if your app doesn't already have
them. For NestJS, `class-validator`/`class-transformer` are optional peers:
installed, their decorators drive DTO schema generation; not installed, DTO
fields still work but fall back to a permissive object schema (see
[NestJS setup](#nestjs-setup)).

Developing against a local checkout instead (contributing, or trying an
unreleased change)? See [Contributing](#contributing) — npm workspaces link
`@restmcp/*` automatically inside this repo, no install step needed.

## Express setup

```ts
import express from "express";
import { MCPExpress } from "@restmcp/express";

const app = express();
app.use(express.json());

app.get("/users", listUsers);
app.get("/users/:id", getUser);
app.post("/users", createUser);

const mcp = MCPExpress.setup(app, {
  name: "My API",
  version: "1.0.0",
});

app.listen(3000);
```

`MCPExpress.setup()` returns a handle you can use to refine things later:

```ts
// Override a specific route's generated name/description
mcp.tool("/users/:id", { name: "get_customer", description: "Look up a customer by id" }, "GET");

// Exclude a route from MCP entirely
mcp.exclude("/admin/stats");

// Register a route automatic discovery couldn't find
mcp.register({
  method: "GET",
  path: "/legacy/report",
  name: "get_legacy_report",
  description: "Fetch the legacy report",
  inputSchema: {
    type: "object",
    properties: { format: { type: "string" } },
    required: [],
  },
  // Path params (":id" etc.) are inferred from `path` automatically — only
  // declare `params` for query params, or to override a path param's type.
  // Without this, "format" above would be treated as a body field and
  // silently dropped on a GET/HEAD call.
  params: [{ name: "format", in: "query", type: "string", required: false }],
});
```

The same `tool`/`exclude`/`register` calls are also available as static
`MCPExpress.tool(...)` etc., operating on the most recently set-up app — handy
for the common single-app-per-process case shown in the example above.

**Automatic discovery**: works by walking Express's own router stack
(`app._router` on Express 4, `app.router` on Express 5 — both supported) —
no regex/source scanning. Top-level routes (`app.get(...)` etc.) are always
discovered. Routes added through a nested `Router()` instance
(`app.use(path, router)`) are also discovered **on Express 4**; on Express 5,
recovering a nested router's mount prefix isn't currently possible (Express 5
replaced the introspectable compiled regexp Express 4 exposed with an opaque
matcher function with no way to recover the original path pattern), so those
routes are safely skipped rather than registered with a wrong path — use
`mcp.register()` for them on Express 5 in the meantime.

## NestJS setup

```ts
import { Module } from "@nestjs/common";
import { MCPModule } from "@restmcp/nestjs";

@Module({
  imports: [
    MCPModule.forRoot({
      name: "My API",
      version: "1.0.0",
    }),
  ],
})
export class AppModule {}
```

Controller discovery uses Nest's own DI container (`ModulesContainer`) and
decorator metadata (`@Get`, `@Post`, `@Param`, `@Query`, `@Body`, ...) — never
source scanning. Request bodies are typed from your DTO classes:

```ts
import { IsEmail, IsOptional, IsString } from "class-validator";

export class CreateUserDto {
  @IsString() name!: string;
  @IsEmail() email!: string;
  @IsOptional() @IsString() nickname?: string;
}
```

If `class-validator` is installed (it usually already is in a Nest app), its
decorators (`@IsString`, `@IsEmail`, `@IsNumber`, `@IsOptional`, `@IsBoolean`,
`@IsEnum`, `@Min`, `@Max`, `@Length`) become the DTO's JSON Schema directly.
Without it, DTO fields fall back to a permissive object schema.

Per-route control uses decorators instead of the Express handle's methods:

```ts
import { McpExclude, McpTool } from "@restmcp/nestjs";

@Get(":id")
@McpTool({ description: "Look up a customer by id" })
findOne(@Param("id") id: string) { ... }

@Get(":id/internal-audit-log")
@McpExclude()
auditLog(@Param("id") id: string) { ... }
```

If your app calls `app.setGlobalPrefix(...)`, pass the same value as
`globalPrefix` in `MCPModule.forRoot({ ..., globalPrefix: "api/v1" })` so
generated tool paths match what's actually mounted.

## Configuration

Both adapters take the same `MCPConfig` shape:

```ts
interface MCPConfig {
  name: string;
  version: string;
  endpoint?: string; // default "/mcp"

  include?: string[]; // glob, matched against the route path
  exclude?: string[]; // glob, matched against the route path

  allowMutations?: boolean; // default true — false restricts to GET/HEAD

  auth?: {
    type: "none" | "apiKey" | "bearer" | "oauth2" | "custom";
    headerName?: string; // for apiKey, default "x-api-key"
    validate?: (context: { headers: Record<string, string | string[] | undefined>; credential?: string }) => Promise<boolean> | boolean;
    forwardCredential?: boolean; // default false — see "Forwarding the credential to your routes"
  };

  tools?: {
    include?: string[]; // glob, matched against the generated tool *name*
    exclude?: string[];
    overrides?: Record<string, { name?: string; description?: string }>; // keyed "METHOD /path"
  };

  security?: {
    rateLimit?: { requests: number; windowMs: number };
    maxRequestSize?: number;
  };

  logging?: boolean | ((entry: { level: string; message: string; meta?: Record<string, unknown> }) => void);
  middleware?: unknown[]; // framework-native middleware, run before /mcp
}
```

`include`/`exclude` operate on the route's original path (`/admin/*`);
`tools.include`/`tools.exclude` operate on the already-generated tool name
(`delete_*`) — they're separate namespaces because a glob like `delete_*`
wouldn't mean anything against a path, and `/admin/*` wouldn't mean anything
against a tool name.

## Authentication

Every `tools/call` (and `tools/list`) is gated by `config.auth` before it
reaches your route:

```ts
MCPExpress.setup(app, {
  name: "My API",
  version: "1.0.0",
  auth: {
    type: "bearer",
    validate: async ({ credential }) => validateToken(credential),
  },
});
```

- `apiKey` reads a header (`headerName`, default `x-api-key`).
- `bearer` reads `Authorization: Bearer <token>`.
- `oauth2` reads a bearer token or API key — verification is entirely up to
  your `validate()` (token introspection, JWKS, etc).
- `custom` always requires `validate()`; there's no default credential
  extraction.
- Omitting `validate()` falls back to "a credential is present" for
  `apiKey`/`bearer`/`oauth2`; `custom` with no `validate()` denies everything
  (fails closed, never open).
- A throwing `validate()` is treated as unauthorized — it never crashes the
  request.

Secrets, tokens, and config values are never interpolated into any
MCP-visible string (tool names, descriptions, schemas).

### Forwarding the credential to your routes

By default, invoking a tool does **not** forward the original caller's
credential to the underlying route — only the MCP-level `auth` gate sees it.
If a route has its *own* auth middleware (checking the same credential —
e.g. the MCP caller's bearer token is literally your app's JWT), that
middleware will reject the internal call, since it never receives the header.

Set `forwardCredential: true` to forward it:

```ts
MCPExpress.setup(app, {
  name: "My API",
  version: "1.0.0",
  auth: {
    type: "bearer",
    validate: async ({ credential }) => validateYourJWT(credential),
    forwardCredential: true, // forwards the Authorization header as-is
  },
});
```

- `bearer`/`oauth2` forward the original `Authorization` header verbatim.
- `apiKey` forwards the configured `headerName` header verbatim.
- `custom`/`none` forward nothing — there's no single well-defined
  credential header for those, so the flag has no effect.

Only enable this when your MCP-level credential genuinely **is** the
credential your routes expect. If they're different credentials (e.g. MCP
uses an API key but routes expect user sessions), forwarding the API key as
if it were a session won't authenticate anything — use a service-level
credential via `config.middleware` on the route side instead.

## Tool filtering

```ts
MCPExpress.setup(app, {
  name: "My API",
  version: "1.0.0",
  include: ["/users/*", "/products/*"],
  exclude: ["/admin/*", "/internal/*"],
  allowMutations: false, // expose only GET/HEAD
});
```

Per-route overrides win over everything else:

- Express: `mcp.exclude(path, method?)`, or pass `mcp: { enabled: false }` via
  `mcp.register()`.
- NestJS: `@McpExclude()` on a method or controller.

### Tool naming

Names are derived deterministically from method + path:

| Route | Tool name |
| --- | --- |
| `GET /users` | `list_users` |
| `GET /users/:id` | `get_user` |
| `POST /users` | `create_user` |
| `PUT /users/:id` / `PATCH /users/:id` | `update_user` |
| `DELETE /users/:id` | `delete_user` |

Collisions are resolved by folding in a preceding path segment for **every**
route in the colliding group (`GET /admin/users/:id` and `GET /public/users/:id`
become `get_admin_user` / `get_public_user`), then a numeric suffix if that
still isn't enough.

Override any generated name/description via `tools.overrides` in config, or
the adapter-specific mechanisms described above.

## Security

Request handling order for every call to `config.endpoint` (default `/mcp`):
**request size → rate limit → auth → (per tool call) schema validation →
invocation.** Each stage rejects before the next one does any work.

- **`security.maxRequestSize`** is enforced for real — not just documented.
  A declared `Content-Length` over the limit is rejected immediately; for a
  chunked request with no `Content-Length` at all, the body is still capped
  by actual byte count as it streams in (so you can't bypass the limit by
  omitting the header). Even with no `maxRequestSize` configured, the
  underlying `@modelcontextprotocol/sdk` transport applies its own 4 MiB
  default — there's no unconfigured, uncapped path.
- **`security.rateLimit`** is enforced for real — a simple in-memory
  fixed-window limiter keyed by the caller's socket address, checked
  *before* auth (so repeated failed-auth / brute-force attempts get
  rate-limited too, not just successful calls). It's a safety net for a
  single-process deployment, not a distributed limiter — if you're running
  multiple instances behind a load balancer, rate-limit at that layer
  instead.
- **Input validation**: every tool call's `arguments` are validated against
  the tool's `inputSchema` (AJV + ajv-formats, compiled once at generation
  time, cached) before your route handler ever runs.
- **Auth gate**: runs before validation and before invocation — see
  [Authentication](#authentication). **If you don't configure `auth` (or set
  `type: "none"`), a warning is logged at startup** (via `config.logging` if
  you've set it, otherwise `console.warn`) — because unlike a normal REST
  API where routes are spread out, `/mcp` self-describes and makes every
  exposed tool callable from one place, so an unauthenticated setup is worth
  a deliberate decision, not a silent default.
- **No secret leakage**: generated tool metadata is built only from route
  shape (method, path, params, DTOs) — config values never flow into it.
- **Safe invocation**: tool calls are dispatched as real HTTP requests against
  a dedicated, loopback-only (`127.0.0.1`), ephemeral internal server — never
  exposed externally — so your full middleware chain (your own auth, logging,
  rate limiting) runs exactly as it would for a real client request.
- **`allowMutations: false`** restricts generated tools to safe/read-only
  methods when you don't want an AI client performing writes.
- **`logging`** is the one hook that stays a hook — it's a sink for the
  warnings/events above and whatever else you want surfaced, not something
  this package needs to act on itself.

## CLI

After `npm install -D @muddusarzulfiqar/restmcp` (see [Installation](#installation)),
the installed `restmcp` command is what `npx` resolves below — a bare
`npx restmcp ...` with nothing installed first would instead try to fetch an
unrelated package literally named `restmcp` from npm, which isn't this CLI.

```bash
npx restmcp init      # scaffold restmcp.config.json + an entry-point stub
npx restmcp inspect    # print discovered routes / generated tools / exclusions
npx restmcp generate   # write mcp-tools.json + openapi.generated.json
npx restmcp export     # write mcp-tools.json only
```

`inspect` output:

```
MCP API Generator

Detected framework: NestJS

Routes discovered: 27
MCP tools generated: 21
Excluded routes: 6

MCP endpoint:
  POST /mcp  (mount path — host/port depend on where you run the app)
```

The CLI reads `restmcp.config.json` (`{ "entry": "./dist/restmcp.entry.js" }`)
and dynamically imports that built entry module, which must default-export a
function returning `{ framework, config, routes }` — see
`examples/express/src/restmcp.entry.ts` and
`examples/nestjs/src/restmcp.entry.ts` for working examples. This keeps the
CLI reflecting the exact same config your running server uses, rather than a
second copy that can drift.

## Generated MCP tools

`mcp-tools.json` (from `generate`/`export`) is derived entirely from live app
metadata — never hand-maintained:

```json
{
  "name": "My API",
  "version": "1.0.0",
  "tools": [
    {
      "name": "get_user",
      "description": "Get a user by ID",
      "inputSchema": {
        "type": "object",
        "properties": { "id": { "type": "string" } },
        "required": ["id"]
      }
    }
  ]
}
```

## Examples

Runnable sample apps live in `examples/`:

- `examples/express` — a small "Library" API (books CRUD, query search, an
  excluded `/admin` route, API-key auth).
- `examples/nestjs` — a "Users" API (CRUD via a DTO with `class-validator`
  decorators, bearer auth, an `@McpExclude()`'d route).

```bash
npm install
npm run build -w examples/express
npm run start -w examples/express
# in another terminal:
curl -X POST http://localhost:3000/mcp \
  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -H 'x-api-key: demo-key' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Troubleshooting

- **A route isn't showing up as a tool.** Run `npx restmcp inspect` — it
  lists every excluded route with a reason (config exclude pattern,
  `allowMutations`, per-route `mcp: false`/`@McpExclude()`). If it's not
  excluded but still missing, Express route discovery couldn't resolve a
  complex mount pattern; use `mcp.register()`.
- **A POST/PUT/PATCH or GET-with-query tool has an empty `inputSchema` and
  calling it doesn't behave as expected.** This is the single most common
  thing people hit first — see
  [Quick start, step 4](#4-fix-empty-schemas-on-body-and-query-routes-read-this-first)
  for why it happens on Express (not NestJS) and the exact `mcp.register()`
  fix, including the GET/HEAD-specific `params` requirement.
- **A file-upload route's tool always fails when called.** Routes using
  `multer` or any other `multipart/form-data` upload handler get discovered
  like any other route, but MCP tool arguments are JSON — there's no way to
  send a file through a tool call. Exclude these routes
  (`mcp.exclude("/your/upload/route")`) rather than leaving a tool that
  errors on every call.
- **A NestJS DTO field is missing from the schema.** Make sure
  `class-validator` is installed and the field has at least one decorator —
  undecorated fields aren't visible to the schema generator.
- **"Invalid arguments" on a call that looks right.** The generated schema
  coerces common types (numeric strings → numbers) but still enforces
  `required`/`format` — check the error message's field name against the
  tool's `inputSchema` (visible via `tools/list` or `inspect`).
- **401 on every call.** Check `config.auth` — if `validate()` is omitted,
  `apiKey`/`bearer`/`oauth2` only check that *some* credential is present
  (any non-empty header passes); `custom` with no `validate()` always denies.
- **Calling a tool doesn't see my request's auth/headers.** Tool invocation
  goes through your app's real middleware chain on a loopback connection, but
  by default it does not forward the original MCP client's headers to that
  internal request — the MCP-level `auth` config is the gate for who can call
  tools at all. If your routes need to see the *same* credential for their
  own auth (e.g. the MCP caller's bearer token IS the app's JWT), set
  `auth.forwardCredential: true` (see [Authentication](#authentication)) to
  forward it. If downstream auth is a genuinely different credential, use a
  service-level one via `config.middleware` instead.
- **`app.setGlobalPrefix()` routes show the wrong path.** Pass the same
  prefix as `globalPrefix` to `MCPModule.forRoot()`.

## Architecture

```
Express/NestJS → Route Discovery → OpenAPI → JSON Schema → Naming →
Permissions → MCP Tool Definitions → MCP Server (POST /mcp) → MCP Client
```

- `@restmcp/core` — framework-agnostic. Never imports Express or NestJS.
  Owns the OpenAPI conversion, JSON Schema generation, naming/collision
  resolution, permission filtering, auth strategies, and the actual MCP
  transport (wrapping `@modelcontextprotocol/sdk`).
- `@restmcp/express` / `@restmcp/nestjs` — adapters. Know their framework,
  nothing about MCP. Produce `RouteDescriptor[]`, hand it to core, and mount
  whatever HTTP handler core's MCP layer returns.
- `packages/cli` — `inspect`/`generate`/`export`/`init`, built on the same
  `@restmcp/core` functions the adapters use.

This separation is what lets a future Fastify/Koa adapter reuse the entire
pipeline unchanged — it only has to implement route discovery and hand core a
`RouteDescriptor[]`. See [`architecture.md`](./architecture.md) for the full
design (data flow, type contracts, invocation lifecycle, security
boundaries) and [`requirement.md`](./requirement.md) for the complete
functional spec this implementation follows.

MCP Resources and Prompts are not implemented in v1; the generator pipeline
exposes a `ToolSource`-shaped seam so they can be added later as parallel
sources without reworking existing stages.

## Contributing

This is an npm-workspaces monorepo (`packages/*`, `examples/*`), TypeScript
throughout in strict mode, tested with Vitest.

```bash
npm install
npm run build      # builds all packages in dependency order
npx vitest run      # runs the full test suite
```

See [`CLAUDE.md`](./CLAUDE.md) for repo conventions (package boundaries, where
new config fields go, why route discovery never uses regex/source scanning).

### Publishing (for maintainers)

Published: [`@restmcp/core`](https://www.npmjs.com/package/@restmcp/core) `0.1.3`,
[`@restmcp/express`](https://www.npmjs.com/package/@restmcp/express) `0.1.4`,
[`@restmcp/nestjs`](https://www.npmjs.com/package/@restmcp/nestjs) `0.1.2`,
and the CLI as
[`@muddusarzulfiqar/restmcp`](https://www.npmjs.com/package/@muddusarzulfiqar/restmcp)
`0.1.2` (its bin command is still the short `restmcp` — see [CLI](#cli); the
package itself had to be scoped under a personal npm username because the
unscoped name `restmcp` collided with an existing, unrelated package's
name-similarity check). Several real bugs found and fixed along the way —
see `CLAUDE.md` for the full incident history. `@restmcp/express`/`nestjs`/
the CLI depend on `@restmcp/core` via `^0.1.3` (not an exact pin), so future
core patch releases reach them without needing every dependent republished.

For a future release:

```bash
# bump versions (keep @restmcp/* in lockstep; they're pinned to exact
# versions of each other, e.g. @restmcp/express depends on "@restmcp/core": "0.1.0")
npm version <new-version> -w packages/core -w packages/express -w packages/nestjs -w packages/cli

npm run build
npx vitest run

npm publish -w packages/core      # publish core first — the others depend on it
npm publish -w packages/express
npm publish -w packages/nestjs
npm publish -w packages/cli
```

`@restmcp/core`, `@restmcp/express`, `@restmcp/nestjs`, and the CLI
(`@muddusarzulfiqar/restmcp`) all have `publishConfig.access: "public"`
already set, so a plain `npm publish` won't default to a private publish
attempt. Publishing requires either 2FA enabled on the npm account (an OTP
per publish) or a granular access token explicitly created with permission
to bypass 2FA — a token without that flag gets rejected with a 403 even if
it otherwise has write access.

## License

MIT
