import type { JSONSchema } from "./json-schema.js";
import type { RouteDescriptor } from "./route.js";

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  /** Retained for invocation and for CLI inspect/export output. Not sent to MCP clients directly. */
  route: RouteDescriptor;
}

/** Public-facing shape (what actually goes over MCP / into mcp-tools.json). */
export interface McpToolManifestEntry {
  name: string;
  description: string;
  inputSchema: JSONSchema;
}

export interface McpToolsManifest {
  name: string;
  version: string;
  tools: McpToolManifestEntry[];
}

export function toManifestEntry(tool: ToolDefinition): McpToolManifestEntry {
  return { name: tool.name, description: tool.description, inputSchema: tool.inputSchema };
}
