# CLAUDE.md — working conventions for `restmcp`

Read `requirement.md` (what to build) and `architecture.md` (how it's structured)
before making non-trivial changes. This file is about *how to work in this repo*.

## Repo shape

npm workspaces monorepo. Packages under `packages/*`, examples under `examples/*`.
TypeScript everywhere, strict mode. Build with `tsc` per package (project references),
test with `vitest`.

- `@restmcp/core` — MUST stay framework-agnostic. Never import `express` or
  `@nestjs/*` here, not even as a type-only import. If a core module needs
  framework input, it takes a `RouteDescriptor[]` or the `invoke()` callback, never
  a framework object.
- `@restmcp/express`, `@restmcp/nestjs` — adapters. They depend on `core`, never the
  other way around. They may depend on their own framework's types/runtime freely.
- `packages/cli` — depends on `core` (and optionally the adapters) to implement
  `inspect`/`export`/`generate`/`init`.

## Commands

- `npm install` at repo root (workspaces hoist deps).
- `npm run build` — builds all packages in dependency order.
- `npm test` — runs vitest across all packages.
- `npm run test -w @restmcp/core` — scope to one package.
- `npm run dev -w examples/express` / `-w examples/nestjs` — run an example app.

## Conventions

- No regex/AST scanning of source files for route discovery — use framework
  runtime metadata (Express router stack, Nest `Reflector`/`ModulesContainer`).
  This is a hard requirement from `requirement.md`, not a style preference.
- Don't add a dependency on `@modelcontextprotocol/sdk` outside `@restmcp/core`'s
  `mcp/` module — adapters consume the handler core returns, they don't touch the
  SDK directly.
- Every new config option goes into `MCPConfig` in `@restmcp/core/src/types` first,
  then gets threaded through — config shape is the contract between packages.
- Keep `RouteDescriptor`/`ToolDefinition` as the only data crossing the
  adapter → core boundary. If an adapter needs to invoke a handler, it provides an
  `invoke(route, args)` function; `core` never reaches into adapter internals.
- Tool invocation (`invoke()`) MUST go over a real socket — use
  `createLoopbackInvoker` from `@restmcp/core` (`packages/core/src/mcp/http-invoker.ts`),
  never a test-injection library (`light-my-request`, `supertest`, etc.) or a
  hand-rolled fake `IncomingMessage`/`ServerResponse`. Both were tried; both
  broke in production because the MCP SDK's own Node/Fetch HTTP bridging and
  body-parser's `raw-body` each assume real socket internals that a synthetic
  request nested inside a live one doesn't have — and the reverse (a real
  loopback request nested inside a `light-my-request`-injected outer call)
  breaks too. That's why `adapter.test.ts`/`module.test.ts` start a real
  `app.listen(0)` and use `fetch()` for the outer test call instead of
  injection — keep doing that for any new end-to-end test that exercises
  `tools/call`.
- `packages/express/src/route-discovery.ts` MUST be tested against a real
  Express 5 install, not just Express 4 — see the `express5` devDependency
  alias (`"express5": "npm:express@^5.0.0"` in `packages/express/package.json`)
  and the "Express 5" describe block in `route-discovery.test.ts`. This isn't
  precautionary: a real incident (found post-publish, fixed in 0.1.1) —
  Express 5 renamed `app._router` to `app.router` AND replaced the
  introspectable `Layer.regexp` nested-router mounts relied on with an opaque
  matcher function, so route discovery silently returned `[]` for every
  Express 5 app. Any change to router-stack walking needs both Express
  versions exercised, and must fail safe (skip a route it can't resolve,
  never register one with a guessed/wrong path that would 404 on invocation)
  rather than crash or silently mis-path.
- Two more real incidents, both found by actually wiring a real user's app up
  and testing it (not just the test suite), fixed in core 0.1.2 / express 0.1.3:
  1. `createLoopbackInvoker`'s `hasBody` check used to hard-exclude GET/HEAD
     from ever carrying a body. HTTP doesn't forbid a GET body, and real
     routes (e.g. one that reads `req.body` for historical reasons on a GET)
     rely on it — only HEAD is actually excluded now.
  2. `mcp.register()`'s `ManualRouteRegistration` had no way to mark a field
     as a query param — every non-path field was treated as body-destined,
     which got silently dropped by (1)'s predecessor for any GET route with
     real query params. Fixed by adding `params?: ParamDescriptor[]` to the
     registration shape (see `packages/express/src/adapter.ts`).
  3. (core-only fix, same release) `generate.ts`'s route lookup used
     `eligible.find(...)` (first match) while `routesToOpenAPI` resolves a
     same-`(method, path)` collision last-wins — so a manually `register()`'d
     override for an also-auto-discovered route had its name/schema silently
     discarded. Fixed by building a `Map` with the same overwrite-forward
     semantics instead of `.find()`. Any future dedup/lookup logic touching
     `eligible` must resolve collisions the same direction everywhere it's
     looked up, not just where it's built.
- `auth.forwardCredential` (core 0.1.3) is deliberately opt-in, default off.
  Tool invocation not seeing the caller's original headers was always a
  known, documented tradeoff — but it meant a real user's JWT-protected
  routes (get-all-users, update-profile, etc.) were registered correctly yet
  unusable via MCP, since their own `authenticated` middleware always 401'd
  the internal call. `forwardCredential: true` forwards exactly one
  well-defined header (`Authorization` for bearer/oauth2, the configured
  `headerName` for apiKey) through `RouteInvoker`'s new optional
  `InvokeContext` param — nothing for `custom`/`none`, since there's no
  single header that means "the credential" for those. Keep this
  single-header, type-gated shape if extending it; don't widen to "forward
  all headers," which would reintroduce exactly the blind-forwarding risk
  this was designed to avoid.
- Secrets never flow into anything MCP-visible (tool names/descriptions/schemas).
  When adding a feature that touches config values, double check none of it can
  end up in a generated string sent to an MCP client.
- Prefer small, focused modules matching the directory layout in `architecture.md`
  (`generator/`, `schema/`, `naming/`, `permissions/`, `authentication/`, `mcp/`,
  `openapi/`) over dumping logic into `index.ts`.
- Tests live next to the code they cover (`src/foo.ts` + `src/foo.test.ts`),
  including the full adapter end-to-end tests (`adapter.test.ts`,
  `module.test.ts`). The root `tests/` directory is reserved for future
  cross-package tests that don't belong to one adapter; it's currently empty.
- This is not a git repo yet (as of 2026-10-09) — if/when the user asks to init
  git, do a normal `git init` + initial commit; don't assume version control exists
  until then.
- No `repository`/`homepage`/`bugs` fields in any `package.json` — deliberate,
  not an oversight (confirmed with the user 2026-10-09: no public repo exists
  yet). Add them once a real git remote exists; don't invent a placeholder
  GitHub URL in the meantime. The npm scope is confirmed as `@restmcp` (user
  chose to keep it over renaming) — don't second-guess that either.
- The four publishable packages (`@restmcp/core`, `@restmcp/express`,
  `@restmcp/nestjs`, `restmcp` the CLI) each carry their own `engines`,
  `keywords`, and (for the three `@restmcp/*` scoped ones) `publishConfig.access:
  "public"` — the monorepo root's `engines` field doesn't propagate to what a
  consumer sees when they install one package individually, so these can't
  just live at the root.

## Current status

v1 is implemented and passing (75 tests across `packages/*`): `@restmcp/core`
(generator pipeline + MCP transport + loopback invoker + rate limiting/request
size enforcement), `@restmcp/express`, `@restmcp/nestjs`, the `restmcp` CLI,
and both `examples/*` apps, verified end-to-end over real HTTP (not just
injected requests). Not yet done: MCP Resources/Prompts (seams only, by
design — see architecture.md §6), a Fastify/Koa adapter, and publishing to
npm (see README.md's "Publishing (for maintainers)" section under
Contributing for the steps once there's a repo to publish from). This file
is not updated automatically — treat the code as ground truth for "what
exists", and `requirement.md`/`architecture.md` as ground truth for "what it
should become".
