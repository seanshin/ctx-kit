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
import { buildPack } from "../dist/core/pack.js";
import {
  coChangeAvailable,
  coChangeOutsideModule,
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

test("co-change: coChangeOutsideModule surfaces a file the module never references, and respects own/exclude/existence boundaries", () => {
  // The canonical case from the stream-E report: models/user.py and
  // migrations/0001_create_user.py share no text at all, but change
  // together in every commit. gone.py co-changes just as strongly but was
  // deleted from the working tree — nothing to read, so it must not be
  // surfaced. excluded.py co-changes strongly too, but matches
  // config.exclude — a user's explicit instruction, never overridden.
  const { root, config } = makeGitRepo(55, (i) => {
    if (i < 52) {
      return {
        write: {
          "models/user.py": `class User: pass  # ${i}\n`,
          "migrations/0001_create_user.py": `def up(): pass  # ${i}\n`,
          "gone.py": `x = ${i}\n`,
          "excluded.py": `x = ${i}\n`,
        },
        message: `user model + migration ${i}`,
      };
    }
    if (i === 52) {
      // Remove gone.py so it no longer exists in the working tree.
      return { remove: ["gone.py"], message: "drop gone.py" };
    }
    return { write: { "models/user.py": `class User: pass  # final ${i}\n` }, message: `touch up ${i}` };
  });
  config.exclude = ["excluded.py"];

  const own = new Set(["models/user.py"]);
  const results = coChangeOutsideModule(config, own, [...own], 5);
  const rels = results.map((r) => r.rel);

  assert.ok(rels.includes("migrations/0001_create_user.py"), "the co-changing outside file must be surfaced");
  assert.ok(!rels.includes("models/user.py"), "the module's own file must not appear in its own reach list");
  assert.ok(!rels.includes("gone.py"), "a co-changing file no longer in the working tree must not be surfaced");
  assert.ok(!rels.includes("excluded.py"), "config.exclude is a user instruction and must never be overridden");

  rmSync(root, { recursive: true, force: true });
});

test("co-change: coChangeOutsideModule returns nothing when unavailable or seedless (plan §6-C)", () => {
  const { root, config } = makeGitRepo(10, (i) => ({
    write: { "models/user.py": `${i}`, "migrations/0001.py": `${i}` },
    message: `commit ${i}`,
  }));
  // Under the 50-commit floor: must come back empty, not error.
  assert.deepEqual(coChangeOutsideModule(config, new Set(), ["models/user.py"], 5), []);
  // No seeds at all: nothing to look up.
  assert.deepEqual(coChangeOutsideModule(config, new Set(), [], 5), []);
  rmSync(root, { recursive: true, force: true });
});

test("pack: a module pack surfaces co-changing files outside the module, labeled and capped, only when co-change is on", () => {
  const root = mkdtempSync(join(tmpdir(), "ctxkit-cochange-pack-"));
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "Test"]);
  writeFileSync(
    join(root, "context.config.yaml"),
    'version: 1\nmodules:\n  models:\n    - "models/**"\nranking:\n  cochange: true\n  commits: 500\n',
  );
  mkdirSync(join(root, "models"), { recursive: true });
  mkdirSync(join(root, "migrations"), { recursive: true });
  writeFileSync(join(root, "models/user.py"), "class User:\n    pass\n");
  writeFileSync(join(root, "migrations/0001_create_user.py"), "def up():\n    pass\n");
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", "init"]);
  // 52 commits where the model and the migration (which reference each
  // other's names nowhere) change together — well past the 50-commit floor.
  for (let i = 0; i < 52; i++) {
    writeFileSync(join(root, "models/user.py"), `class User:\n    x = ${i}\n`);
    writeFileSync(join(root, "migrations/0001_create_user.py"), `def up():\n    y = ${i}\n`);
    git(root, ["add", "-A"]);
    git(root, ["commit", "-q", "-m", `change ${i}`]);
  }

  const configOn = loadConfig(root);
  const packOn = buildPack(configOn, { profile: "light", module: "models" });
  const mapOn = packOn.content.split("## Repository Map")[1].split("## Target Files")[0];
  assert.match(
    mapOn,
    /### Changes together with this module/,
    "co-change on: the section must appear",
  );
  assert.match(mapOn, /migrations\/0001_create_user\.py/, "the co-changing migration must be listed");

  const configOff = loadConfig(root);
  configOff.ranking = { ...configOff.ranking, cochange: false };
  const packOff = buildPack(configOff, { profile: "light", module: "models" });
  const mapOff = packOff.content.split("## Repository Map")[1].split("## Target Files")[0];
  assert.ok(
    !mapOff.includes("### Changes together with this module"),
    "co-change off: the section must be omitted entirely, not printed empty",
  );

  rmSync(root, { recursive: true, force: true });
});
