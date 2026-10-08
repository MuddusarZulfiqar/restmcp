import { writeFile, access } from "node:fs/promises";
import { resolve } from "node:path";
import { CONFIG_FILE_NAME } from "../config.js";

const ENTRY_STUB = `// restmcp.entry.js
// Point restmcp.config.json's "entry" at this file (after it's built, if you
// write it in TypeScript). It must default-export a function returning an
// AppHandle: { framework, config, routes }.
//
// Express example:
//
// import express from "express";
// import { MCPExpress, discoverExpressRoutes } from "@restmcp/express";
//
// const config = { name: "My API", version: "1.0.0" };
// const app = express();
// // ...your routes...
// MCPExpress.setup(app, config);
//
// export default function getApiMcpApp() {
//   return { framework: "express", config, routes: discoverExpressRoutes(app) };
// }
//
// NestJS example:
//
// import { NestFactory } from "@nestjs/core";
// import { ModulesContainer } from "@nestjs/core";
// import { discoverNestRoutes } from "@restmcp/nestjs";
// import { AppModule } from "./app.module.js";
//
// const config = { name: "My API", version: "1.0.0" };
//
// export default async function getApiMcpApp() {
//   const app = await NestFactory.create(AppModule);
//   await app.init();
//   const routes = discoverNestRoutes(app.get(ModulesContainer));
//   return { framework: "nestjs", config, routes };
// }
`;

export async function runInit(cwd: string): Promise<void> {
  const configPath = resolve(cwd, CONFIG_FILE_NAME);
  const entryPath = resolve(cwd, "restmcp.entry.js");

  const configExists = await exists(configPath);
  if (!configExists) {
    await writeFile(configPath, JSON.stringify({ entry: "./restmcp.entry.js" }, null, 2) + "\n", "utf-8");
    console.log(`Created ${CONFIG_FILE_NAME}`);
  } else {
    console.log(`${CONFIG_FILE_NAME} already exists, leaving it as-is.`);
  }

  const entryExists = await exists(entryPath);
  if (!entryExists) {
    await writeFile(entryPath, ENTRY_STUB, "utf-8");
    console.log("Created restmcp.entry.js (edit this to point at your actual app)");
  } else {
    console.log("restmcp.entry.js already exists, leaving it as-is.");
  }

  console.log("\nNext: edit restmcp.entry.js, then run `npx restmcp inspect`.");
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
