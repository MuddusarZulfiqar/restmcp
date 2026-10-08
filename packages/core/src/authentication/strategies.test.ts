import { describe, expect, it } from "vitest";
import { createAuthChecker } from "./strategies.js";

describe("createAuthChecker", () => {
  it("allows everything when auth is undefined or type: none", async () => {
    const check = createAuthChecker(undefined);
    expect(await check({})).toBe(true);
  });

  it("validates bearer tokens via validate()", async () => {
    const check = createAuthChecker({
      type: "bearer",
      validate: async (ctx) => ctx.credential === "secret-token",
    });
    expect(await check({ authorization: "Bearer secret-token" })).toBe(true);
    expect(await check({ authorization: "Bearer wrong" })).toBe(false);
    expect(await check({})).toBe(false);
  });

  it("validates apiKey from the configured header", async () => {
    const check = createAuthChecker({
      type: "apiKey",
      headerName: "x-api-key",
      validate: async (ctx) => ctx.credential === "abc123",
    });
    expect(await check({ "x-api-key": "abc123" })).toBe(true);
    expect(await check({ "x-api-key": "wrong" })).toBe(false);
  });

  it("denies custom auth with no validate() by default", async () => {
    const check = createAuthChecker({ type: "custom" });
    expect(await check({})).toBe(false);
  });

  it("treats a throwing validate() as unauthorized, never crashes", async () => {
    const check = createAuthChecker({
      type: "bearer",
      validate: async () => {
        throw new Error("boom");
      },
    });
    expect(await check({ authorization: "Bearer x" })).toBe(false);
  });

  it("degrades to presence-check when no validate() given for bearer/apiKey", async () => {
    const check = createAuthChecker({ type: "bearer" });
    expect(await check({ authorization: "Bearer anything" })).toBe(true);
    expect(await check({})).toBe(false);
  });
});
