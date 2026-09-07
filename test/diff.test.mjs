import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadConfig } from "../dist/core/config.js";
import { select } from "../dist/core/select.js";
import { buildPack } from "../dist/core/pack.js";

function git(cwd, args) {
  const res = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (res.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${res.stderr || res.stdout}`);
  }
  return res.stdout;
}

/**
 * A real git repo (not a mock) built commit by commit, so `--diff-filter=d`
 * and `--find-renames` run against actual git plumbing rather than a
 * hand-rolled stand-in of it.
 */
function makeGitRepo(commits) {
  const root = mkdtempSync(join(tmpdir(), "ctxkit-diff-test-"));
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "Test"]);
  for (const commit of commits) {
    for (const [rel, content] of Object.entries(commit.write ?? {})) {
      mkdirSync(join(root, rel, ".."), { recursive: true });
      writeFileSync(join(root, rel), content);
    }
    for (const rel of commit.remove ?? []) {
      rmSync(join(root, rel));
    }
    git(root, ["add", "-A"]);
    git(root, ["commit", "-q", "-m", commit.message ?? "commit"]);
  }
  return { root, config: loadConfig(root) };
}

test("diff: deleted files are excluded, and referencing files are picked up as expansion", () => {
  const { root, config } = makeGitRepo([
    {
      write: {
        "src/core.py": "def compute_price(x):\n    return x * 1.1\n",
        "src/app.py":
          "from core import compute_price\n\ndef total(x):\n    return compute_price(x)\n",
        "src/old.py": "def stale():\n    return 1\n",
      },
      message: "initial",
    },
    {
      write: {
        // compute_price changes shape — app.py still references the symbol.
        "src/core.py": "def compute_price(x):\n    return x * 1.15\n",
        "src/new.py": "def unrelated():\n    return 2\n",
      },
      remove: ["src/old.py"],
      message: "change price, drop stale file",
    },
  ]);

  const sel = select(config, { diff: "HEAD~1" });
  assert.deepEqual(sel.seeds.sort(), ["src/core.py", "src/new.py"].sort());
  assert.ok(!sel.seeds.includes("src/old.py"), "a deleted file must not be a seed");
  assert.equal(sel.label, "diff:HEAD~1");
  // app.py references compute_price (defined in the changed src/core.py)
  // and was not itself changed, so it must show up as expansion.
  assert.ok(sel.files.includes("src/app.py"), "a caller of the changed symbol should be pulled in");

  rmSync(root, { recursive: true, force: true });
});

test("diff: seeds survive the budget — an oversized changed file degrades to a path list, not a drop", () => {
  const bigContent = `def handler():\n${"    # padding\n".repeat(4000)}    return 1\n`;
  const { root, config } = makeGitRepo([
    { write: { "src/core.py": "def compute_price(x):\n    return x\n" }, message: "initial" },
    { write: { "src/huge.py": bigContent }, message: "add a huge changed file" },
  ]);

  const profiles = { ...config.profiles, light: { inject: ["target-files"], budget: 500 } };
  const pack = buildPack({ ...config, profiles }, { profile: "light", diff: "HEAD~1" });

  // The seed path must appear even though its content could not fit.
  assert.match(pack.content, /src\/huge\.py/);
  assert.match(pack.content, /exceed the 500-token budget/);
  assert.ok(
    !pack.content.includes("```\ndef handler"),
    "an over-budget seed's full body must not silently blow the budget",
  );

  rmSync(root, { recursive: true, force: true });
});

test("diff: a non-repository and an invalid range both raise clear errors (plan §6-C)", () => {
  const plainRoot = mkdtempSync(join(tmpdir(), "ctxkit-diff-test-"));
  writeFileSync(join(plainRoot, "src.py"), "x = 1\n");
  const plainConfig = loadConfig(plainRoot);
  assert.throws(() => select(plainConfig, { diff: "HEAD~1" }), /requires a git repository/);
  rmSync(plainRoot, { recursive: true, force: true });

  const { root, config } = makeGitRepo([{ write: { "a.py": "x = 1\n" }, message: "only commit" }]);
  assert.throws(() => select(config, { diff: "HEAD~5" }), /invalid or unreachable range/);
  rmSync(root, { recursive: true, force: true });
});
