import { createRequire } from "node:module";

/** Single source for the version: package.json, read at runtime. */
export const VERSION: string = (
  createRequire(import.meta.url)("../../package.json") as { version: string }
).version;
