import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildManifest, generateTools } from "@api-mcp/core";
import { loadAppHandle, readCliConfig } from "../config.js";

export async function runExport(cwd: string, outFile = "mcp-tools.json", entryOverride?: string): Promise<void> {
  const entry = entryOverride ?? (await readCliConfig(cwd)).entry;
  const handle = await loadAppHandle(entry);

  const { tools } = generateTools(handle.routes, handle.config);
  const manifest = buildManifest(tools, handle.config);

  const outPath = resolve(cwd, outFile);
  await writeFile(outPath, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
  console.log(`Wrote ${tools.length} tools to ${outPath}`);
}
