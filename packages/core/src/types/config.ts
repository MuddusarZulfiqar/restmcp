export type AuthType = "none" | "apiKey" | "bearer" | "oauth2" | "custom";

/** Context handed to an auth strategy's validate() — only what's needed, nothing framework-specific. */
export interface AuthContext {
  headers: Record<string, string | string[] | undefined>;
  /** Raw token/key extracted per auth.type, when applicable. */
  credential?: string;
}

export interface AuthConfig {
  type: AuthType;
  /** Header to read the API key from, for type: "apiKey". Default: "x-api-key". */
  headerName?: string;
  /** For type "oauth2": the OAuth2 issuer's token introspection/verification is delegated to validate(). */
  validate?: (context: AuthContext) => Promise<boolean> | boolean;
}

export interface ToolOverrideConfig {
  name?: string;
  description?: string;
}

export interface ToolsConfig {
  /** Glob patterns matched against generated tool *names*. */
  include?: string[];
  exclude?: string[];
  /** Per-route overrides, keyed by "METHOD /path" e.g. "GET /users/:id". */
  overrides?: Record<string, ToolOverrideConfig>;
}

export interface RateLimitConfig {
  requests: number;
  windowMs: number;
}

export interface SecurityConfig {
  rateLimit?: RateLimitConfig;
  maxRequestSize?: number;
}

export interface LogEntry {
  level: "debug" | "info" | "warn" | "error";
  message: string;
  meta?: Record<string, unknown>;
}

export type LoggingConfig = boolean | ((entry: LogEntry) => void);

export interface MCPConfig {
  name: string;
  version: string;
  /** Mount path for the MCP endpoint. Default "/mcp". */
  endpoint?: string;

  /** Glob patterns matched against the original route *path* (e.g. "/users/*"). */
  include?: string[];
  exclude?: string[];

  /** When false, only safe/read-only methods (GET, HEAD) are exposed as tools. Default true. */
  allowMutations?: boolean;

  auth?: AuthConfig;
  tools?: ToolsConfig;
  security?: SecurityConfig;
  logging?: LoggingConfig;

  /** Framework-native middleware to run before the /mcp handler. Adapter-interpreted. */
  middleware?: unknown[];
}

export const DEFAULT_ENDPOINT = "/mcp";
