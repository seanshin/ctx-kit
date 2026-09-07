/**
 * Repomix adapter (MIT-licensed external tool, invoked as a CLI only —
 * no code reuse, keeping ctxkit's MIT posture clean).
 *
 * The internal packer in core/pack.ts is the default; Repomix is an
 * opt-in upgrade (`ctxkit pack --repomix`) for its token-reduction and
 * secret-scanning features.
 */
import { spawnSync } from "node:child_process";

export function repomixAvailable(): boolean {
  const res = spawnSync("repomix", ["--version"], { encoding: "utf8" });
  return res.status === 0;
}

export function runRepomix(root: string, args: string[]): { ok: boolean; output: string } {
  const res = spawnSync("repomix", args, { cwd: root, encoding: "utf8" });
  return {
    ok: res.status === 0,
    output: (res.stdout ?? "") + (res.stderr ?? ""),
  };
}
