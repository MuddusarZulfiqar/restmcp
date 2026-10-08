import { Body, Controller, Delete, Get, Param, Post, Put, Query } from "@nestjs/common";
import { McpExclude, McpTool } from "@api-mcp/nestjs";
import { CreateUserDto } from "./create-user.dto.js";

export interface User {
  id: string;
  name: string;
  email: string;
}

const users: User[] = [
  { id: "1", name: "Ada Lovelace", email: "ada@example.com" },
  { id: "2", name: "Grace Hopper", email: "grace@example.com" },
];

@Controller("users")
export class UsersController {
  @Get()
  findAll(@Query("search") search?: string, @Query("page") page?: string) {
    const results = search ? users.filter((u) => u.name.toLowerCase().includes(search.toLowerCase())) : users;
    return { page: page ? Number(page) : 1, results };
  }

  @Get(":id")
  @McpTool({ description: "Retrieve a single user by their id" })
  findOne(@Param("id") id: string) {
    return users.find((u) => u.id === id) ?? { error: "not found" };
  }

  @Post()
  create(@Body() dto: CreateUserDto) {
    const user: User = { id: String(users.length + 1), name: dto.name, email: dto.email };
    users.push(user);
    return user;
  }

  @Put(":id")
  update(@Param("id") id: string, @Body() dto: CreateUserDto) {
    const user = users.find((u) => u.id === id);
    if (!user) return { error: "not found" };
    Object.assign(user, { name: dto.name ?? user.name, email: dto.email ?? user.email });
    return user;
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    const index = users.findIndex((u) => u.id === id);
    if (index === -1) return { error: "not found" };
    const [removed] = users.splice(index, 1);
    return removed;
  }

  // Internal-only — never exposed as an MCP tool.
  @Get(":id/internal-audit-log")
  @McpExclude()
  auditLog(@Param("id") id: string) {
    return { id, events: [] };
  }
}
