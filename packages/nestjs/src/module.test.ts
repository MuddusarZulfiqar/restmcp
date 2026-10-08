import "reflect-metadata";
import { Body, Controller, Delete, Get, Module, Param, Post, Query } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import { IsEmail, IsString } from "class-validator";
import { afterEach, describe, expect, it } from "vitest";
import { MCPModule } from "./module.js";

class CreateUserDto {
  @IsString()
  name!: string;

  @IsEmail()
  email!: string;
}

const users = [{ id: "1", name: "Ada", email: "ada@example.com" }];

@Controller("users")
class UsersController {
  @Get()
  findAll(@Query("search") search?: string) {
    return search ? users.filter((u) => u.name.includes(search)) : users;
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return users.find((u) => u.id === id) ?? { error: "not found" };
  }

  @Post()
  create(@Body() dto: CreateUserDto) {
    return { id: "2", ...dto };
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return { deleted: id };
  }
}

@Module({
  imports: [MCPModule.forRoot({ name: "Nest Test API", version: "1.0.0" })],
  controllers: [UsersController],
})
class AppModule {}

// Real end-to-end: starts the Nest app on a real ephemeral loopback port and
// calls it with a real fetch(). See http-invoker.ts's comment — the MCP
// endpoint's own tool-invocation dispatch is a real loopback socket round
// trip, so the outer test call needs to be real too rather than injected.
async function startApp(): Promise<{ app: NestExpressApplication; baseUrl: string }> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false });
  await app.listen(0);
  const port = app.getHttpServer().address().port as number;
  return { app, baseUrl: `http://127.0.0.1:${port}` };
}

async function rpc(baseUrl: string, method: string, params?: unknown) {
  const res = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = (await res.json()) as {
    result?: { tools?: Array<{ name: string; inputSchema: { properties: Record<string, unknown>; required: string[] } }>; content?: Array<{ text: string }> };
  };
  return { statusCode: res.status, body };
}

describe("MCPModule", () => {
  let app: NestExpressApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("exposes Nest controller routes as MCP tools", async () => {
    const started = await startApp();
    app = started.app;

    const res = await rpc(started.baseUrl, "tools/list");
    expect(res.statusCode).toBe(200);
    const names = res.body.result!.tools!.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["list_users", "get_user", "create_user", "delete_user"]));
  });

  it("generates a request body schema from the DTO's class-validator decorators", async () => {
    const started = await startApp();
    app = started.app;

    const res = await rpc(started.baseUrl, "tools/list");
    const createTool = res.body.result!.tools!.find((t) => t.name === "create_user")!;
    expect(createTool.inputSchema.properties.name).toEqual({ type: "string" });
    expect(createTool.inputSchema.properties.email).toEqual({ type: "string", format: "email" });
    expect(createTool.inputSchema.required).toEqual(expect.arrayContaining(["name", "email"]));
  });

  it("invokes the underlying Nest controller method through the real HTTP pipeline", async () => {
    const started = await startApp();
    app = started.app;

    const res = await rpc(started.baseUrl, "tools/call", { name: "get_user", arguments: { id: "1" } });
    const content = JSON.parse(res.body.result!.content![0]!.text);
    expect(content).toEqual({ id: "1", name: "Ada", email: "ada@example.com" });
  });
});
