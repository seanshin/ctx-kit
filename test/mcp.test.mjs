/**
 * Integration tests for interface A (the MCP server): spawn `ctxkit serve`
 * and speak JSON-RPC over stdio, exactly as an MCP client would.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE = join(ROOT, "eval/fixture");
const PKG_VERSION = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;

let proc;
let nextId = 1;
const pending = new Map();

function send(method, params) {
  const id = nextId++;
  proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout: ${method}`)), 15000);
    pending.set(id, { resolve, reject, timer });
  });
}

/** Call a tool and return its first text content block. */
async function callTool(name, args = {}) {
  const res = await send("tools/call", { name, arguments: args });
  return res.content[0].text;
}

before(async () => {
  proc = spawn("node", [join(ROOT, "dist/cli.js"), "-C", FIXTURE, "serve"], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  createInterface({ input: proc.stdout }).on("line", (line) => {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    const waiter = pending.get(msg.id);
    if (!waiter) return;
    clearTimeout(waiter.timer);
    pending.delete(msg.id);
    msg.error ? waiter.reject(new Error(JSON.stringify(msg.error))) : waiter.resolve(msg.result);
  });

  const init = await send("initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "ctxkit-test", version: "0" },
  });
  assert.equal(init.serverInfo.name, "ctxkit");
  assert.equal(init.serverInfo.version, PKG_VERSION, "server reports package.json version");
  proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
});

after(() => {
  proc?.kill();
  const pack = join(FIXTURE, "docs/generated/packs/orders-light.md");
  if (existsSync(pack)) rmSync(pack);
});

test("tools/list exposes the five documented tools", async () => {
  const { tools } = await send("tools/list");
  assert.deepEqual(
    tools.map((t) => t.name).sort(),
    ["get_module_context", "get_repomap", "get_rules", "make_pack", "search_symbol"],
  );
  for (const t of tools) {
    assert.ok(t.description?.length > 20, `${t.name} needs a description agents can act on`);
  }
});

test("get_rules returns AGENTS.md", async () => {
  const out = await callTool("get_rules");
  assert.match(out, /# AGENTS\.md/);
  assert.match(out, /pytest/);
});

test("get_repomap ranks files and honors the budget", async () => {
  const out = await callTool("get_repomap", { budget: 2000 });
  assert.match(out, /ctxkit:v1 repomap/);
  assert.match(out, /apply_discount/);
  assert.ok(Math.ceil(out.length / 4) <= 2000, "map exceeded the requested budget");
});

test("get_module_context returns that module's pack", async () => {
  const out = await callTool("get_module_context", { module: "orders" });
  assert.match(out, /ctxkit:v1 pack/);
  assert.match(out, /module=orders/);
  assert.match(out, /apply_discount/);
});

test("get_module_context reports an unknown module instead of crashing", async () => {
  const out = await callTool("get_module_context", { module: "nope" });
  assert.match(out, /unknown module/);
});

test("search_symbol finds definitions and reference sites", async () => {
  const out = await callTool("search_symbol", { name: "apply_discount" });
  assert.match(out, /# Definitions/);
  assert.match(out, /lib\/discount\.py:1/);
  assert.match(out, /# References/);
  assert.match(out, /lib\/orders\.py/, "should cite the caller");

  const none = await callTool("search_symbol", { name: "zzz_missing_symbol" });
  assert.match(none, /No definitions or references/);
});

test("make_pack writes a pack file and reports its path", async () => {
  const out = await callTool("make_pack", { module: "orders", profile: "light" });
  assert.match(out, /docs\/generated\/packs\/orders-light\.md/);
  assert.match(out, /tokens/);
  const written = join(FIXTURE, "docs/generated/packs/orders-light.md");
  assert.ok(existsSync(written), "pack file was not created");
  assert.match(readFileSync(written, "utf8"), /apply_discount/);
});
