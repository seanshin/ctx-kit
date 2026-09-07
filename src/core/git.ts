/**
 * Git access, shared by `--diff` (plan §4.5) and co-change ranking (§4.7).
 *
 * Every call goes through spawnSync with an argument array — never a shell —
 * so a revision range coming from the command line cannot inject commands
 * (docs/plan-v2.md §10).
 */
import { spawnSync } from "node:child_process";

function git(root: string, args: string[]): { ok: boolean; stdout: string } {
  const res = spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  return { ok: res.status === 0, stdout: res.stdout ?? "" };
}

export function isRepo(root: string): boolean {
  return git(root, ["rev-parse", "--is-inside-work-tree"]).stdout.trim() === "true";
}

/**
 * Files changed in a range, or staged when `range` is "--staged".
 *
 * `--diff-filter=d` drops deletions (they cannot be read back) and
 * `--find-renames` keeps a renamed file from appearing as an add plus a
 * delete.
 */
export function diffFiles(root: string, range: string): string[] {
  const base = ["diff", "--name-only", "--diff-filter=d", "--find-renames"];
  const args = range === "--staged" || range === "--cached" ? [...base, "--cached"] : [...base, range];
  const res = git(root, args);
  if (!res.ok) throw new Error(`git diff failed for range "${range}"`);
  return res.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
}

/**
 * Recent commits as file sets, newest first. Merge commits are excluded:
 * they either contribute nothing or, depending on options, dump every file
 * and swamp the co-change counts.
 */
export function logCommits(root: string, limit = 500): string[][] {
  const res = git(root, ["log", "--no-merges", `-n${limit}`, "--format=%x00%H", "--name-only"]);
  if (!res.ok) return [];
  return res.stdout
    .split("\0")
    .slice(1)
    .map((block) =>
      block
        .split("\n")
        .slice(1)
        .map((s) => s.trim())
        .filter(Boolean),
    )
    .filter((files) => files.length > 0);
}
