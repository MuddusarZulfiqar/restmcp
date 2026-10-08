import { defineConfig } from "vitest/config";
import swc from "unplugin-swc";

export default defineConfig({
  // NestJS controllers/DTOs rely on TypeScript's emitDecoratorMetadata
  // (design:paramtypes) for param/body reflection — esbuild (vitest/vite's
  // default TS transform) doesn't emit it. SWC does, and is what NestJS's
  // own docs recommend for testing with Vitest for exactly this reason.
  plugins: [swc.vite({ tsconfigFile: "./tsconfig.base.json", module: { type: "es6" } })],
  test: {
    environment: "node",
    include: ["packages/*/src/**/*.test.ts", "tests/**/*.test.ts"],
    reporters: "default",
  },
});
