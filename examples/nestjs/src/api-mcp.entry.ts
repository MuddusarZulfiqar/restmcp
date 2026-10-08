import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ModulesContainer } from "@nestjs/core";
import { discoverNestRoutes } from "@api-mcp/nestjs";
import { AppModule, mcpConfig } from "./app.module.js";

export default async function getApiMcpApp() {
  const app = await NestFactory.create(AppModule, { logger: false });
  await app.init();
  const routes = discoverNestRoutes(app.get(ModulesContainer));
  return { framework: "nestjs" as const, config: mcpConfig, routes };
}
