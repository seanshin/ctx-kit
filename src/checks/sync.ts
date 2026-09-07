import { checkSync } from "../core/sync.js";
import type { Check, CheckResult } from "./types.js";

/** Per-tool rule files must still match the single source. */
export const syncCheck: Check = {
  name: "sync",
  run({ config }): CheckResult[] {
    return checkSync(config).map((s): CheckResult =>
      s.status === "ok"
        ? { level: "ok", name: "sync", detail: `${s.path} up to date` }
        : s.status === "missing"
          ? { level: "warn", name: "sync", detail: `${s.path} missing — run \`ctxkit sync\`` }
          : {
              level: "fail",
              name: "sync",
              detail: `${s.path} differs from AGENTS.md — run \`ctxkit sync\``,
            },
    );
  },
};
