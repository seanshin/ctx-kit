/**
 * Stream E ("co-change") tests — git co-change ranking (docs/plan-v2.md
 * §4.7). Test plan: §6-D lists 3 cases — history too short disables it
 * silently, bulk commits are excluded, and only seed columns are
 * accumulated. A caching test is added since §6-B requires caching the
 * parsed history under docs/generated/, keyed by HEAD.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadConfig } from "../dist/core/config.js";
import { rankFiles } from "../dist/core/repomap.js";
import {
  coChangeAvailable,
  makeCoChangeScorer,
} from "../dist/scorers/cochange.js";

function git(cwd, args) {
  const res = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (res.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${res.stderr || res.stdout}`);
  }
  return res.stdout;
}

/**
 * A real git repo (not a mock), built commit by commit, so `--no-merges`
 * and `--name-only` run against actual git plumbing. `commitFn(i)` returns
 * `{ write, remove, message }` for commit index `i` (0-based).
 */
function makeGitRepo(count, commitFn) {
  const root = mkdtempSync(join(tmpdir(), "ctxkit-cochange-test-"));
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "Test"]);
  for (let i = 0; i < count; i++) {
    const commit = commitFn(i);
    for (const [rel, content] of Object.entries(commit.write ?? {})) {
      mkdirSync(join(root, rel, ".."), { recursive: true });
      writeFileSync(join(root, rel), content);
    }
    for (const rel of commit.remove ?? []) {
      rmSync(join(root, rel), { force: true });
    }
    git(root, ["add", "-A"]);
    git(root, ["commit", "-q", "-m", commit.message ?? `commit ${i}`]);
  }
  const config = loadConfig(root);
  config.ranking = { ...config.ranking, cochange: true };
  return { root, config };
}

/** Build the `RankedFile[]` shape a `Scorer` expects, without symbol extraction cost mattering here. */
function entriesFor(config, files) {
  return rankFiles(config, { files });
}

test("co-change: fewer than 50 commits of history disables it silently (plan §6-C)", () => {
  // 10 commits, well under the 50-commit floor. seed.py and pair.py change
  // together in every single commit — a maximally strong signal that must
  // still be ignored purely because the history is too shallow.
  const { root, config } = makeGitRepo(10, (i) => ({
    write: {
      "seed.py": `x = ${i}\n`,
      "pair.py": `y = ${i}\n`,
    },
    message: `commit ${i}`,
  }));

  assert.equal(coChangeAvailable(root), false, "under 50 commits must report unavailable");

  const scorer = makeCoChangeScorer(["seed.py"]);
  const entries = entriesFor(config, ["seed.py", "pair.py"]);
  const contribution = scorer(entries, config);
  assert.equal(contribution.size, 0, "no error, just a silently empty contribution (plan §6-C)");

  rmSync(root, { recursive: true, force: true });
});

test("co-change: commits touching more than 50 files are excluded from the counts", () => {
  // 50 ordinary commits establish co-change strongly between seed.py and
  // pair.py (well past the 50-commit floor). One extra bulk commit touches
  // seed.py plus 55 unrelated files, including bulk-only.py — if the bulk
  // exclusion works, bulk-only.py must get zero contribution despite
  // co-occurring with the seed in that commit.
  const { root, config } = makeGitRepo(51, (i) => {
    if (i < 50) {
      return {
        write: { "seed.py": `x = ${i}\n`, "pair.py": `y = ${i}\n` },
        message: `pair change ${i}`,
      };
    }
    const write = { "seed.py": "x = 999\n" };
    for (let j = 0; j < 55; j++) write[`bulk/file${j}.py`] = `z = ${j}\n`;
    return { write, message: "bulk refactor" };
  });

  assert.ok(coChangeAvailable(root), "51 commits should clear the 50-commit floor");

  const scorer = makeCoChangeScorer(["seed.py"]);
  const files = ["seed.py", "pair.py", "bulk/file0.py"];
  const entries = entriesFor(config, files);
  const contribution = scorer(entries, config);

  assert.ok((contribution.get("pair.py") ?? 0) > 0, "pair.py co-changed with the seed 50 times, outside any bulk commit");
  assert.equal(
    contribution.get("bulk/file0.py") ?? 0,
    0,
    "bulk/file0.py only ever co-occurred with the seed in the >50-file bulk commit, which must be excluded",
  );

  rmSync(root, { recursive: true, force: true });
});

test("co-change: only seed columns are accumulated — files unrelated to any seed score zero, related ones combine across seeds", () => {
  // 60 commits total (comfortably over the floor):
  //  - 20 commits: seedA.py + shared.py change together
  //  - 20 commits: seedB.py + shared.py change together
  //  - 20 commits: onlyA.py + seedA.py change together (never touches seedB or shared)
  //  - noise.py never appears alongside either seed.
  const { root, config } = makeGitRepo(60, (i) => {
    if (i < 20) return { write: { "seedA.py": `${i}`, "shared.py": `${i}` }, message: `a-shared ${i}` };
    if (i < 40) return { write: { "seedB.py": `${i}`, "shared.py": `${i}` }, message: `b-shared ${i}` };
    if (i < 60) return { write: { "seedA.py": `${i}`, "onlyA.py": `${i}` }, message: `a-only ${i}` };
    return { write: { "noise.py": `${i}` }, message: `noise ${i}` };
  });

  const scorer = makeCoChangeScorer(["seedA.py", "seedB.py"]);
  const files = ["seedA.py", "seedB.py", "shared.py", "onlyA.py", "noise.py"];
  const entries = entriesFor(config, files);
  const contribution = scorer(entries, config);

  // shared.py co-changed with BOTH seeds (20 + 20 = 40 raw, /2 seeds = 20)
  // while onlyA.py co-changed with only ONE seed (20 raw, /2 seeds = 10) —
  // shared.py must therefore be the max-normalized top (1.0) and strictly
  // ahead of onlyA.py.
  assert.equal(contribution.get("shared.py"), 1, "the file combining both seed columns normalizes to the max, 1.0");
  const onlyAScore = contribution.get("onlyA.py") ?? 0;
  assert.ok(onlyAScore > 0 && onlyAScore < 1, "a single-seed co-change gets a positive but lower score");
  assert.ok(!contribution.has("noise.py"), "noise.py never appears in any commit with a seed — no accumulated column at all");

  rmSync(root, { recursive: true, force: true });
});

test("co-change: the parsed history is cached under docs/generated/, keyed by HEAD", () => {
  const { root, config } = makeGitRepo(55, (i) => ({
    write: { "seed.py": `${i}`, "pair.py": `${i}` },
    message: `commit ${i}`,
  }));

  const cachePath = join(root, "docs/generated/cochange-cache.json");
  assert.ok(!existsSync(cachePath), "no cache before the first scan");

  const scorer = makeCoChangeScorer(["seed.py"]);
  scorer(entriesFor(config, ["seed.py", "pair.py"]), config);

  assert.ok(existsSync(cachePath), "a scan writes a cache file under docs/generated/");
  const cached = JSON.parse(readFileSync(cachePath, "utf8"));
  const head = git(root, ["rev-parse", "HEAD"]).trim();
  assert.equal(cached.head, head, "cache is keyed by the current HEAD");

  // Move HEAD by committing again — the old cache entry must not be reused
  // for the new HEAD (the co-change literature is over, but the write path
  // must at least update the key rather than silently going stale).
  git(root, ["commit", "--allow-empty", "-q", "-m", "advance head"]);
  scorer(entriesFor(config, ["seed.py", "pair.py"]), config);
  const cachedAfter = JSON.parse(readFileSync(cachePath, "utf8"));
  const headAfter = git(root, ["rev-parse", "HEAD"]).trim();
  assert.equal(cachedAfter.head, headAfter, "cache is rewritten for the new HEAD");
  assert.notEqual(headAfter, head, "HEAD actually moved");

  rmSync(root, { recursive: true, force: true });
});
