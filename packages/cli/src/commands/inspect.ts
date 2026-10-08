import { generateTools } from "@restmcp/core";
import { loadAppHandle, readCliConfig } from "../config.js";

const FRAMEWORK_LABEL: Record<string, string> = { express: "Express", nestjs: "NestJS" };

export async function runInspect(cwd: string, entryOverride?: string): Promise<void> {
  const entry = entryOverride ?? (await readCliConfig(cwd)).entry;
  const handle = await loadAppHandle(entry);

  const result = generateTools(handle.routes, handle.config);
  const endpoint = handle.config.endpoint ?? "/mcp";

  console.log("MCP API Generator\n");
  console.log(`Detected framework: ${FRAMEWORK_LABEL[handle.framework] ?? handle.framework}\n`);
  console.log(`Routes discovered: ${handle.routes.length}`);
  console.log(`MCP tools generated: ${result.tools.length}`);
  console.log(`Excluded routes: ${result.excluded.length}`);

  if (result.excluded.length > 0) {
    console.log("\nExcluded:");
    for (const e of result.excluded) {
      console.log(`  ${e.method} ${e.path} — ${e.reason}`);
    }
  }

  if (result.warnings.length > 0) {
    console.log("\nWarnings:");
    for (const w of result.warnings) {
      console.log(`  ${w.message}`);
    }
  }

  console.log(`\nMCP endpoint:\n  POST ${endpoint}  (mount path — host/port depend on where you run the app)`);
}
