# @restmcp/core

Framework-agnostic pipeline that turns REST routes into [MCP](https://modelcontextprotocol.io)
tools: `RouteDescriptor[] → OpenAPI → JSON Schema → naming/permissions → MCP tool
definitions → MCP server`.

**You probably don't need to install this directly.** It's the shared engine
behind [`@restmcp/express`](https://www.npmjs.com/package/@restmcp/express)
and [`@restmcp/nestjs`](https://www.npmjs.com/package/@restmcp/nestjs), pulled
in automatically as their dependency. Install one of those instead:

```bash
npm install @restmcp/express   # for Express apps
npm install @restmcp/nestjs    # for NestJS apps
```

## What's in here

- Route discovery → OpenAPI conversion (`openapi/`)
- OpenAPI → JSON Schema generation, with `class-validator`-style constraints
  (`schema/`)
- Deterministic tool naming + collision resolution (`naming/`)
- Route/tool filtering — `include`/`exclude` globs, `allowMutations` (`permissions/`)
- Auth strategies — `apiKey` / `bearer` / `oauth2` / `custom` (`authentication/`)
- The actual MCP transport, wrapping the official `@modelcontextprotocol/sdk`,
  plus rate limiting, request-size limits, and a loopback HTTP invoker used to
  safely call your route handlers from a tool call (`mcp/`)

Building a new framework adapter (Fastify, Koa, ...)? This is the package you
depend on — implement route discovery and an `invoke(route, args)` function
for your framework, hand `core` a `RouteDescriptor[]`, and the rest of the
pipeline (naming, schema, MCP transport) is reused unchanged.

## Documentation

Full docs — configuration, authentication, tool filtering, security, the
CLI — live in the [project README](https://github.com/MuddusarZulfiqar/restmcp#readme).
Architecture details (data flow, type contracts, invocation lifecycle) are in
[`architecture.md`](https://github.com/MuddusarZulfiqar/restmcp/blob/main/architecture.md).

## License

MIT
