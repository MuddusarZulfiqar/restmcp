import "reflect-metadata";
import { SetMetadata } from "@nestjs/common";

export const MCP_TOOL_METADATA = "restmcp:tool";
export const MCP_EXCLUDE_METADATA = "restmcp:exclude";

export interface McpToolOverride {
  name?: string;
  description?: string;
}

/** Overrides the generated tool's name/description for this route handler. */
export const McpTool = (override: McpToolOverride): MethodDecorator => SetMetadata(MCP_TOOL_METADATA, override);

/**
 * Excludes this route handler (or, on a controller, every route in it) from
 * MCP tool generation — the decorator-based equivalent of `mcp: false`.
 */
export const McpExclude = (): MethodDecorator & ClassDecorator => SetMetadata(MCP_EXCLUDE_METADATA, true);
