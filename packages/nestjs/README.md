# @restmcp/nestjs

Automatically convert an existing NestJS app's controllers into [MCP](https://modelcontextprotocol.io)
tools, so AI clients can call your API directly — no hand-written MCP tool
definitions.

```bash
npm install @restmcp/nestjs
```

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

Controller discovery uses Nest's own DI container and decorator metadata
(`@Get`, `@Post`, `@Param`, `@Query`, `@Body`, ...) — never source scanning.
Request bodies are typed straight from your DTO classes; if `class-validator`
is installed, its decorators (`@IsString`, `@IsEmail`, `@IsNumber`,
`@IsOptional`, `@IsEnum`, `@Min`, `@Max`, `@Length`, ...) become the tool's
JSON Schema directly.

Per-route control uses decorators:

```ts
import { McpExclude, McpTool } from "@restmcp/nestjs";

@Get(":id")
@McpTool({ description: "Look up a customer by id" })
findOne(@Param("id") id: string) { ... }

@Get(":id/internal-audit-log")
@McpExclude()
auditLog(@Param("id") id: string) { ... }
```

## Documentation

Full docs — configuration, authentication, tool filtering, security, the
CLI, troubleshooting — live in the
[project README](https://github.com/MuddusarZulfiqar/restmcp#readme).

## License

MIT
