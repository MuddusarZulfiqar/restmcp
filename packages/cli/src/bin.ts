#!/usr/bin/env node
import { buildProgram } from "./index.js";

buildProgram()
  .parseAsync(process.argv)
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
