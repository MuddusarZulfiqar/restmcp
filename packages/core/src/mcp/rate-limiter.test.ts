import { describe, expect, it, vi } from "vitest";
import { createRateLimiter } from "./rate-limiter.js";

describe("createRateLimiter", () => {
  it("allows everything when no config is given", () => {
    const check = createRateLimiter();
    for (let i = 0; i < 1000; i++) expect(check("same-key")).toBe(true);
  });

  it("allows up to the configured request count within the window", () => {
    const check = createRateLimiter({ requests: 3, windowMs: 10_000 });
    expect(check("a")).toBe(true);
    expect(check("a")).toBe(true);
    expect(check("a")).toBe(true);
    expect(check("a")).toBe(false);
  });

  it("tracks separate keys independently", () => {
    const check = createRateLimiter({ requests: 1, windowMs: 10_000 });
    expect(check("a")).toBe(true);
    expect(check("b")).toBe(true);
    expect(check("a")).toBe(false);
    expect(check("b")).toBe(false);
  });

  it("resets the count once the window elapses", () => {
    vi.useFakeTimers();
    const check = createRateLimiter({ requests: 1, windowMs: 1000 });
    expect(check("a")).toBe(true);
    expect(check("a")).toBe(false);
    vi.advanceTimersByTime(1001);
    expect(check("a")).toBe(true);
    vi.useRealTimers();
  });
});
