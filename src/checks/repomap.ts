import { existsSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { GENERATED_DIR } from "../core/config.js";
import { walkFiles } from "../core/fs.js";
import { SOURCE_EXTENSIONS } from "../adapters/symbols.js";
import type { Check, CheckResult } from "./types.js";

/**
 * The generated map must not lag the code. mtime-based, hence warn only:
 * a fresh git checkout does not preserve modification times.
 */
export const repomapCheck: Check = {
  name: "repomap",
  run({ config }): CheckResult[] {
    const mapPath = join(config.root, GENERATED_DIR, "repomap.md");
    if (!existsSync(mapPath)) {
      return [{ level: "warn", name: "repomap", detail: "repomap.md missing — run `ctxkit map`" }];
    }
    const mapTime = statSync(mapPath).mtimeMs;
    const staleSource = walkFiles(config.root, { exclude: config.exclude })
      .filter((f) => SOURCE_EXTENSIONS.has(extname(f)))
      .find((f) => statSync(join(config.root, f)).mtimeMs > mapTime);
    return [
      staleSource
        ? {
            level: "warn",
            name: "repomap",
            detail: `${staleSource} newer than repomap.md — run \`ctxkit map\``,
          }
        : { level: "ok", name: "repomap", detail: "repomap.md newer than all source files" },
    ];
  },
};
