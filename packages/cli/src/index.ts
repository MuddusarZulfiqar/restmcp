import { Command } from "commander";
import { runInit } from "./commands/init.js";
import { runInspect } from "./commands/inspect.js";
import { runExport } from "./commands/export.js";
import { runGenerate } from "./commands/generate.js";

export function buildProgram(): Command {
  const program = new Command();
  program.name("api-mcp").description("Convert an existing Express/NestJS REST API into MCP tools").version("0.1.0");

  program
    .command("init")
    .description("Scaffold api-mcp.config.json and an entry-point stub in the current directory")
    .action(async () => {
      await runInit(process.cwd());
    });

  program
    .command("inspect")
    .description("Print a summary of discovered routes and generated MCP tools")
    .option("--entry <path>", "override the entry module from api-mcp.config.json")
    .action(async (opts: { entry?: string }) => {
      await runInspect(process.cwd(), opts.entry);
    });

  program
    .command("generate")
    .description("Write mcp-tools.json and openapi.generated.json from the live app metadata")
    .option("--entry <path>", "override the entry module from api-mcp.config.json")
    .action(async (opts: { entry?: string }) => {
      await runGenerate(process.cwd(), opts.entry);
    });

  program
    .command("export")
    .description("Write mcp-tools.json from the live app metadata")
    .option("--entry <path>", "override the entry module from api-mcp.config.json")
    .option("-o, --out <file>", "output file path", "mcp-tools.json")
    .action(async (opts: { entry?: string; out: string }) => {
      await runExport(process.cwd(), opts.out, opts.entry);
    });

  return program;
}
