# @api-mcp

Automatically convert an existing Express or NestJS REST API into [Model Context
Protocol](https://modelcontextprotocol.io) (MCP) tools, so AI clients (Claude,
other MCP-aware agents) can call your API directly — without you hand-writing a
single MCP tool definition.

> **Status: pre-release, not yet published to npm.** The commands below show
> the intended end-state developer experience once `@api-mcp/express` /
> `@api-mcp/nestjs` / `api-mcp` are published. Until then, see
> [Installation → Using it right now, from source](#installation) for how to
> run this against your own app from a clone of this repo.

```bash
npm install @api-mcp/express express
```

```ts
import express from "express";
import { MCPExpress } from "@api-mcp/express";

const app = express();
// ...your existing routes...
MCPExpress.setup(app, { name: "My API", version: "1.0.0" });
app.listen(3000);
```

That's it — `POST /mcp` is now live and every eligible route is an MCP tool.

## Table of contents

- [What it does](#what-it-does)
- [Why MCP](#why-mcp)
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
interface just so an AI client can use it. `@api-mcp` keeps the MCP surface
generated and in sync with your actual routes, DTOs, and validation rules.

## Installation

Node.js 20+ required for every package below. `@api-mcp/core` is a shared
transitive dependency — you never install it directly.

### Once published to npm

```bash
# Express
npm install @api-mcp/express

# NestJS
npm install @api-mcp/nestjs

# CLI (inspect/export/generate, optional)
npm install -D api-mcp
```

Peer dependencies (`express`, or `@nestjs/common`/`@nestjs/core`) are not
bundled — install them as you normally would if your app doesn't already have
them. For NestJS, `class-validator`/`class-transformer` are optional peers:
installed, their decorators drive DTO schema generation; not installed, DTO
fields still work but fall back to a permissive object schema (see
[NestJS setup](#nestjs-setup)).

### Using it right now, from source

Since these packages aren't on npm yet, point your app at this repo directly
instead of running `npm install @api-mcp/...`:

```bash
git clone <this-repo> api-mcp && cd api-mcp
npm install
npm run build
```

Then, from your own app's project:

```bash
# Use an absolute path. npm installs this as a symlink to the package
# directory — no publishing, no registry involved.
npm install /absolute/path/to/api-mcp/packages/express
# and/or:
npm install /absolute/path/to/api-mcp/packages/nestjs
npm install /absolute/path/to/api-mcp/packages/cli   # for the `api-mcp` CLI
```

This works (verified) even though `@api-mcp/express`/`@api-mcp/nestjs`
depend on `@api-mcp/core` by plain version number, not a `file:`/`workspace:`
reference: npm installs a symlink, so when Node resolves `@api-mcp/core`
*from inside* that symlinked package, it follows the link to its real path
inside this repo first — and finds `@api-mcp/core` there via the monorepo's
own workspace-linked `node_modules`. It relies on that symlink, so it won't
work if you `npm pack` one of these packages into a tarball and install that
instead (that copies files rather than linking them).

Everything else in this README (the Express/NestJS setup, config, CLI usage)
works identically either way — only how the package *got onto disk* differs.
If you're developing *inside* this monorepo (e.g. extending `examples/express`
or `examples/nestjs`), no install step is needed at all — npm workspaces
already link `@api-mcp/*` for you; see [Contributing](#contributing).

## Express setup

```ts
import express from "express";
import { MCPExpress } from "@api-mcp/express";

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
  inputSchema: { type: "object", properties: {}, required: [] },
});
```

The same `tool`/`exclude`/`register` calls are also available as static
`MCPExpress.tool(...)` etc., operating on the most recently set-up app — handy
for the common single-app-per-process case shown in the example above.

**Automatic discovery**: works by walking Express's own router stack
(`app._router`), including routes added through nested `Router()` instances —
no regex/source scanning. If a particular mounting pattern can't be resolved
automatically, use `mcp.register()` as shown above.

## NestJS setup

```ts
import { Module } from "@nestjs/common";
import { MCPModule } from "@api-mcp/nestjs";

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
import { McpExclude, McpTool } from "@api-mcp/nestjs";

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

```bash
npx api-mcp init      # scaffold api-mcp.config.json + an entry-point stub
npx api-mcp inspect    # print discovered routes / generated tools / exclusions
npx api-mcp generate   # write mcp-tools.json + openapi.generated.json
npx api-mcp export     # write mcp-tools.json only
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

The CLI reads `api-mcp.config.json` (`{ "entry": "./dist/api-mcp.entry.js" }`)
and dynamically imports that built entry module, which must default-export a
function returning `{ framework, config, routes }` — see
`examples/express/src/api-mcp.entry.ts` and
`examples/nestjs/src/api-mcp.entry.ts` for working examples. This keeps the
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

- **A route isn't showing up as a tool.** Run `npx api-mcp inspect` — it
  lists every excluded route with a reason (config exclude pattern,
  `allowMutations`, per-route `mcp: false`/`@McpExclude()`). If it's not
  excluded but still missing, Express route discovery couldn't resolve a
  complex mount pattern; use `mcp.register()`.
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
  it does not forward the original MCP client's headers to that internal
  request — the MCP-level `auth` config is the gate for who can call tools at
  all. If a route needs user-specific downstream auth, that's a current
  limitation to design around (e.g. a service-level credential via
  `config.middleware`).
- **`app.setGlobalPrefix()` routes show the wrong path.** Pass the same
  prefix as `globalPrefix` to `MCPModule.forRoot()`.

## Architecture

```
Express/NestJS → Route Discovery → OpenAPI → JSON Schema → Naming →
Permissions → MCP Tool Definitions → MCP Server (POST /mcp) → MCP Client
```

- `@api-mcp/core` — framework-agnostic. Never imports Express or NestJS.
  Owns the OpenAPI conversion, JSON Schema generation, naming/collision
  resolution, permission filtering, auth strategies, and the actual MCP
  transport (wrapping `@modelcontextprotocol/sdk`).
- `@api-mcp/express` / `@api-mcp/nestjs` — adapters. Know their framework,
  nothing about MCP. Produce `RouteDescriptor[]`, hand it to core, and mount
  whatever HTTP handler core's MCP layer returns.
- `packages/cli` — `inspect`/`generate`/`export`/`init`, built on the same
  `@api-mcp/core` functions the adapters use.

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

Not yet published — this repo has no `repository`/`homepage`/`bugs` URLs set
in any `package.json` yet because there's no public git remote to point them
at. Add those once one exists (`packages/core`, `packages/express`,
`packages/nestjs`, `packages/cli`), then:

```bash
# bump versions (keep @api-mcp/* in lockstep; they're pinned to exact
# versions of each other, e.g. @api-mcp/express depends on "@api-mcp/core": "0.1.0")
npm version <new-version> -w packages/core -w packages/express -w packages/nestjs -w packages/cli

npm run build
npx vitest run

npm publish -w packages/core      # publish core first — the others depend on it
npm publish -w packages/express
npm publish -w packages/nestjs
npm publish -w packages/cli
```

`@api-mcp/core`, `@api-mcp/express`, and `@api-mcp/nestjs` are scoped
packages published with `publishConfig.access: "public"` already set, so a
plain `npm publish` won't default to a private publish attempt.

## License

MIT
