import "reflect-metadata";
import { Body, Controller, Delete, Get, Param, Post, Put, Query } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { ModulesContainer } from "@nestjs/core";
import { IsEmail, IsOptional, IsString } from "class-validator";
import { describe, expect, it } from "vitest";
import { discoverNestRoutes } from "./scanner.js";
import { McpExclude, McpTool } from "./decorators.js";

class CreateUserDto {
  @IsString()
  name!: string;

  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  nickname?: string;
}

@Controller("users")
class UsersController {
  @Get()
  findAll(@Query("search") _search: string, @Query("page") _page: string) {
    return [];
  }

  @Get(":id")
  findOne(@Param("id") _id: string) {
    return {};
  }

  @Post()
  create(@Body() _dto: CreateUserDto) {
    return {};
  }

  @Put(":id")
  update(@Param("id") _id: string, @Body() _dto: CreateUserDto) {
    return {};
  }

  @Delete(":id")
  remove(@Param("id") _id: string) {
    return {};
  }

  @Get(":id/secret")
  @McpExclude()
  secret(@Param("id") _id: string) {
    return {};
  }

  @Get(":id/profile")
  @McpTool({ name: "get_customer_profile", description: "Fetch a customer's profile" })
  profile(@Param("id") _id: string) {
    return {};
  }
}

async function buildModulesContainer() {
  const moduleRef = await Test.createTestingModule({ controllers: [UsersController] }).compile();
  return moduleRef.get(ModulesContainer);
}

describe("discoverNestRoutes", () => {
  it("discovers GET/POST/PUT/DELETE routes with controller + method paths joined", async () => {
    const container = await buildModulesContainer();
    const routes = discoverNestRoutes(container);
    const keys = routes.map((r) => `${r.method} ${r.path}`).sort();

    expect(keys).toEqual(
      [
        "GET /users",
        "GET /users/:id",
        "GET /users/:id/profile",
        "GET /users/:id/secret",
        "POST /users",
        "PUT /users/:id",
        "DELETE /users/:id",
      ].sort(),
    );
  });

  it("extracts query params from @Query() decorators", async () => {
    const container = await buildModulesContainer();
    const routes = discoverNestRoutes(container);
    const list = routes.find((r) => r.method === "GET" && r.path === "/users");
    expect(list?.params.filter((p) => p.in === "query").map((p) => p.name).sort()).toEqual(["page", "search"]);
  });

  it("extracts path params from @Param() decorators", async () => {
    const container = await buildModulesContainer();
    const routes = discoverNestRoutes(container);
    const one = routes.find((r) => r.method === "GET" && r.path === "/users/:id");
    expect(one?.params).toEqual([{ name: "id", in: "path", type: "string", required: true }]);
  });

  it("builds a request body schema from the DTO's class-validator decorators", async () => {
    const container = await buildModulesContainer();
    const routes = discoverNestRoutes(container);
    const create = routes.find((r) => r.method === "POST" && r.path === "/users");
    expect(create?.body?.schema.properties?.name).toEqual({ type: "string" });
    expect(create?.body?.schema.properties?.email).toEqual({ type: "string", format: "email" });
    expect(create?.body?.schema.required).toEqual(expect.arrayContaining(["name", "email"]));
    expect(create?.body?.schema.required).not.toContain("nickname");
  });

  it("respects @McpExclude()", async () => {
    const container = await buildModulesContainer();
    const routes = discoverNestRoutes(container);
    const secret = routes.find((r) => r.path === "/users/:id/secret");
    expect(secret?.mcp?.enabled).toBe(false);
  });

  it("respects @McpTool() name/description overrides", async () => {
    const container = await buildModulesContainer();
    const routes = discoverNestRoutes(container);
    const profile = routes.find((r) => r.path === "/users/:id/profile");
    expect(profile?.mcp).toEqual({ name: "get_customer_profile", description: "Fetch a customer's profile" });
  });
});
