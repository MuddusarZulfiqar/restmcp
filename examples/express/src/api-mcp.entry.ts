import { discoverExpressRoutes } from "@api-mcp/express";
import { createApp, mcpConfig } from "./app.js";

export default function getApiMcpApp() {
  const app = createApp();
  return { framework: "express" as const, config: mcpConfig, routes: discoverExpressRoutes(app) };
}
