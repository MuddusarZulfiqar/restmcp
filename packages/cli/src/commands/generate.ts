import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildManifest, generateTools, routesToOpenAPI } from "@restmcp/core";
import { loadAppHandle, readCliConfig } from "../config.js";

/**
 * Regenerates every derived artifact (mcp-tools.json + openapi.generated.json)
 * from the live app metadata. `export` (see export.ts) only writes
 * mcp-tools.json, matching requirement.md §14's dedicated export command.
 */
export async function runGenerate(cwd: string, entryOverride?: string): Promise<void> {
  const entry = entryOverride ?? (await readCliConfig(cwd)).entry;
  const handle = await loadAppHandle(entry);

  const { tools } = generateTools(handle.routes, handle.config);
  const manifest = buildManifest(tools, handle.config);
  const openapi = routesToOpenAPI(handle.routes, { title: handle.config.name, version: handle.config.version });

  await writeFile(resolve(cwd, "mcp-tools.json"), JSON.stringify(manifest, null, 2) + "\n", "utf-8");
  await writeFile(resolve(cwd, "openapi.generated.json"), JSON.stringify(openapi, null, 2) + "\n", "utf-8");

  console.log(`Generated mcp-tools.json (${tools.length} tools) and openapi.generated.json`);
}
