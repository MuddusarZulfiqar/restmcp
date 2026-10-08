import type { AuthConfig, AuthContext } from "../types/config.js";

function headerValue(headers: AuthContext["headers"], name: string): string | undefined {
  const value = headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function extractBearer(headers: AuthContext["headers"]): string | undefined {
  const raw = headerValue(headers, "authorization");
  if (!raw) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(raw);
  return match?.[1];
}

/**
 * Resolves an AuthConfig into a single async check: (headers) -> boolean.
 * Never throws — a misconfigured/failing check is treated as "unauthorized",
 * never as a crash that could take down the host process.
 */
export function createAuthChecker(auth: AuthConfig | undefined): (headers: AuthContext["headers"]) => Promise<boolean> {
  if (!auth || auth.type === "none") {
    return async () => true;
  }

  return async (headers: AuthContext["headers"]) => {
    try {
      let credential: string | undefined;

      switch (auth.type) {
        case "apiKey":
          credential = headerValue(headers, auth.headerName ?? "x-api-key");
          break;
        case "bearer":
          credential = extractBearer(headers);
          break;
        case "oauth2":
          credential = extractBearer(headers) ?? headerValue(headers, "x-api-key");
          break;
        case "custom":
          credential = undefined;
          break;
      }

      if (!auth.validate) {
        // No validate() provided: apiKey/bearer/oauth2 degrade to "credential present".
        // custom with no validate() is a misconfiguration -> deny by default.
        return auth.type === "custom" ? false : Boolean(credential);
      }

      const context: AuthContext = { headers, credential };
      return await auth.validate(context);
    } catch {
      return false;
    }
  };
}
