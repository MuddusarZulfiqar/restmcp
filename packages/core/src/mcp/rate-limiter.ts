import type { RateLimitConfig } from "../types/config.js";

interface Window {
  count: number;
  resetAt: number;
}

const MAX_TRACKED_KEYS = 10_000;

/**
 * Fixed-window in-memory rate limiter keyed by caller (IP by default).
 * Deliberately simple and dependency-free: this is a safety net for a
 * single-process deployment, not a distributed rate limiter — if you're
 * running multiple instances behind a load balancer, put a real limiter
 * (your gateway, Redis-backed middleware, etc.) in front instead, and
 * config.middleware ahead of /mcp if you need it per-adapter.
 *
 * Returns a no-op "always allow" checker when no config is given, so
 * callers don't need to branch on whether rate limiting is configured.
 */
export function createRateLimiter(config?: RateLimitConfig): (key: string) => boolean {
  if (!config || config.requests <= 0 || config.windowMs <= 0) {
    return () => true;
  }

  const windows = new Map<string, Window>();

  return (key: string): boolean => {
    const now = Date.now();

    // Bound memory: if we're tracking too many distinct keys, drop expired
    // ones first. Opportunistic, not precise — fine for a safety net.
    if (windows.size >= MAX_TRACKED_KEYS) {
      for (const [k, w] of windows) {
        if (w.resetAt <= now) windows.delete(k);
      }
    }

    const existing = windows.get(key);
    if (!existing || existing.resetAt <= now) {
      windows.set(key, { count: 1, resetAt: now + config.windowMs });
      return true;
    }

    existing.count += 1;
    return existing.count <= config.requests;
  };
}
