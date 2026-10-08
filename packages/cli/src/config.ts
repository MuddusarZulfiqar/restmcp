import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { MCPConfig, RouteDescriptor } from "@api-mcp/core";

export const CONFIG_FILE_NAME = "api-mcp.config.json";

export interface CliConfigFile {
  /**
   * Path (relative to the config file) to a module whose default export is
   * `getApiMcpApp()` — see AppHandle below. Must point at a built JS entry
   * (the CLI does not transpile TypeScript on the fly).
   */
  entry: string;
}

/**
 * The contract a host app's entry module must satisfy for the CLI to inspect
 * it. Returning the already-resolved `config` (the same MCPConfig object
 * passed to MCPExpress.setup()/MCPModule.forRoot()) means the CLI reflects
 * the exact same include/exclude/allowMutations the running server uses,
 * rather than requiring a second, possibly-drifting copy of that config.
 */
export interface AppHandle {
  framework: "express" | "nestjs";
  config: MCPConfig;
  routes: RouteDescriptor[];
}

export async function readCliConfig(cwd: string): Promise<CliConfigFile> {
  const path = resolve(cwd, CONFIG_FILE_NAME);
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch {
    throw new Error(
      `Could not find ${CONFIG_FILE_NAME} in ${cwd}. Run "npx api-mcp init" first, or pass --entry directly.`,
    );
  }
  return JSON.parse(raw) as CliConfigFile;
}

export async function loadAppHandle(entryPath: string): Promise<AppHandle> {
  const mod = (await import(pathToFileURL(resolve(entryPath)).href)) as {
    default?: () => Promise<AppHandle> | AppHandle;
  };
  if (typeof mod.default !== "function") {
    throw new Error(`Entry module "${entryPath}" must have a default export: a getApiMcpApp() function returning an AppHandle.`);
  }
  return await mod.default();
}
