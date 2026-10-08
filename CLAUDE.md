# CLAUDE.md — working conventions for `api-mcp`

Read `requirement.md` (what to build) and `architecture.md` (how it's structured)
before making non-trivial changes. This file is about *how to work in this repo*.

## Repo shape

npm workspaces monorepo. Packages under `packages/*`, examples under `examples/*`.
TypeScript everywhere, strict mode. Build with `tsc` per package (project references),
test with `vitest`.

- `@api-mcp/core` — MUST stay framework-agnostic. Never import `express` or
  `@nestjs/*` here, not even as a type-only import. If a core module needs
  framework input, it takes a `RouteDescriptor[]` or the `invoke()` callback, never
  a framework object.
- `@api-mcp/express`, `@api-mcp/nestjs` — adapters. They depend on `core`, never the
  other way around. They may depend on their own framework's types/runtime freely.
- `packages/cli` — depends on `core` (and optionally the adapters) to implement
  `inspect`/`export`/`generate`/`init`.

## Commands

- `npm install` at repo root (workspaces hoist deps).
- `npm run build` — builds all packages in dependency order.
- `npm test` — runs vitest across all packages.
- `npm run test -w @api-mcp/core` — scope to one package.
- `npm run dev -w examples/express` / `-w examples/nestjs` — run an example app.

## Conventions

- No regex/AST scanning of source files for route discovery — use framework
  runtime metadata (Express router stack, Nest `Reflector`/`ModulesContainer`).
  This is a hard requirement from `requirement.md`, not a style preference.
- Don't add a dependency on `@modelcontextprotocol/sdk` outside `@api-mcp/core`'s
  `mcp/` module — adapters consume the handler core returns, they don't touch the
  SDK directly.
- Every new config option goes into `MCPConfig` in `@api-mcp/core/src/types` first,
  then gets threaded through — config shape is the contract between packages.
- Keep `RouteDescriptor`/`ToolDefinition` as the only data crossing the
  adapter → core boundary. If an adapter needs to invoke a handler, it provides an
  `invoke(route, args)` function; `core` never reaches into adapter internals.
- Tool invocation (`invoke()`) MUST go over a real socket — use
  `createLoopbackInvoker` from `@api-mcp/core` (`packages/core/src/mcp/http-invoker.ts`),
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
  GitHub URL in the meantime. The npm scope is confirmed as `@api-mcp` (user
  chose to keep it over renaming) — don't second-guess that either.
- The four publishable packages (`@api-mcp/core`, `@api-mcp/express`,
  `@api-mcp/nestjs`, `api-mcp` the CLI) each carry their own `engines`,
  `keywords`, and (for the three `@api-mcp/*` scoped ones) `publishConfig.access:
  "public"` — the monorepo root's `engines` field doesn't propagate to what a
  consumer sees when they install one package individually, so these can't
  just live at the root.

## Current status

v1 is implemented and passing (75 tests across `packages/*`): `@api-mcp/core`
(generator pipeline + MCP transport + loopback invoker + rate limiting/request
size enforcement), `@api-mcp/express`, `@api-mcp/nestjs`, the `api-mcp` CLI,
and both `examples/*` apps, verified end-to-end over real HTTP (not just
injected requests). Not yet done: MCP Resources/Prompts (seams only, by
design — see architecture.md §6), a Fastify/Koa adapter, and publishing to
npm (see README.md's "Publishing (for maintainers)" section under
Contributing for the steps once there's a repo to publish from). This file
is not updated automatically — treat the code as ground truth for "what
exists", and `requirement.md`/`architecture.md` as ground truth for "what it
should become".
