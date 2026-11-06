// @ts-check
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { runDev } from "../scripts/dev.mjs";

const exec = promisify(execFile);
const usage = "mods/provider-usage/main.js";
const sidebar = "mods/minimalist-compact-workspaces/main.js";
const shared = "herdr-mods/provider-usage/mods/provider-usage/main.js";

/** @param {string} root @param {string} path @param {string} content */
async function put(root, path, content) {
  const target = join(root, path);
  await mkdir(join(target, ".."), { recursive: true });
  await writeFile(target, content);
}

/** @param {import("node:test").TestContext} t */
async function fixture(t) {
  const root = await mkdtemp("/tmp/opencode/herdr-dev-test-");
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = join(root, "repo");
  const home = join(root, "app");
  const state = join(root, "state");
  for (const [path, content] of [
    [shared, "usage-v1"],
    [`minimalist-compact/${usage}`, "usage-v1"],
    [`minimalist-compact/${sidebar}`, "sidebar-v1"],
    ["minimalist-compact/layouts/minimalist-compact.json", '{"name":"compact"}'],
    ["minimalist-compact/layouts/minimalist-compact.png", "preview"],
  ]) await put(repo, path, content);
  await exec("git", ["init", "--quiet"], { cwd: repo });
  await exec("git", ["add", "."], { cwd: repo });
  await exec("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
    "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "fixture"], { cwd: repo });
  const controller = new AbortController();
  /** @type {string[]} */
  const logs = [];
  const options = { repo, home, state, once: true, signal: controller.signal,
    log: (/** @type {string} */ message) => { logs.push(message); } };
  return { repo, home, state, controller, logs, options };
}

test("once deploys repo edits, backs up the installed HEAD version and skips non-runtime files", async (t) => {
  const f = await fixture(t);
  await put(f.home, usage, "usage-v1");
  await put(f.repo, shared, "usage-v2");
  for (const name of ["model.test.mjs", "model.test.js", "model.spec.js", "test_usage.py", "gpui-kit.d.ts", "jsconfig.json", ".secret.js", "README.md"]) {
    await put(f.repo, `minimalist-compact/mods/minimalist-compact-workspaces/${name}`, "exclude");
  }
  await put(f.home, "settings.json", "personal settings");
  await put(f.home, "view.json", "sessions");
  await put(f.home, "data/provider-usage.json", "cache");
  await put(f.home, "mods/unrelated/main.js", "unrelated");
  await runDev(f.options);
  assert.equal(await readFile(join(f.home, usage), "utf8"), "usage-v2");
  assert.equal(await readFile(join(f.repo, "minimalist-compact", usage), "utf8"), "usage-v2");
  assert.deepEqual(await readdir(join(f.home, "mods/minimalist-compact-workspaces")), ["main.js"]);
  for (const [path, content] of [["settings.json", "personal settings"], ["view.json", "sessions"],
    ["data/provider-usage.json", "cache"], ["mods/unrelated/main.js", "unrelated"]]) {
    assert.equal(await readFile(join(f.home, path), "utf8"), content);
  }
  const backups = await readdir(join(f.state, "backups"));
  assert.equal(backups.length, 1);
  assert.equal(await readFile(join(f.state, "backups", backups[0], usage), "utf8"), "usage-v1");
  const before = await stat(join(f.home, usage));
  await runDev(f.options);
  assert.equal((await stat(join(f.home, usage))).mtimeMs, before.mtimeMs);
});

test("unknown installed edits fail preflight before any bundle or installed write", async (t) => {
  const f = await fixture(t);
  await put(f.repo, shared, "usage-v2");
  await put(f.home, sidebar, "local-sidebar-experiment");
  await assert.rejects(runDev(f.options), /Installed edit conflicts/);
  assert.equal(await readFile(join(f.home, sidebar), "utf8"), "local-sidebar-experiment");
  assert.equal(await readFile(join(f.repo, "minimalist-compact", usage), "utf8"), "usage-v1");
  await assert.rejects(readFile(join(f.home, usage)), { code: "ENOENT" });
  await assert.rejects(stat(join(f.state, "lock")), { code: "ENOENT" });
});

test("persistent baselines detect local edits across restarts and allow recovery", async (t) => {
  const f = await fixture(t);
  await put(f.repo, shared, "uncommitted-v2");
  await runDev(f.options);
  await put(f.home, usage, "local-edit");
  await put(f.repo, shared, "uncommitted-v3");
  await assert.rejects(runDev(f.options), /Installed edit conflicts/);
  assert.equal(await readFile(join(f.home, usage), "utf8"), "local-edit");
  await put(f.home, usage, "uncommitted-v2");
  await runDev(f.options);
  assert.equal(await readFile(join(f.home, usage), "utf8"), "uncommitted-v3");
});

test("source removals leave installed and bundled files intact; installed deletions conflict", async (t) => {
  const f = await fixture(t);
  await put(f.repo, "herdr-mods/provider-usage/mods/provider-usage/obsolete.js", "old helper");
  await runDev(f.options);
  await unlink(join(f.repo, "herdr-mods/provider-usage/mods/provider-usage/obsolete.js"));
  await runDev(f.options);
  for (const root of [f.home, join(f.repo, "minimalist-compact")]) {
    assert.equal(await readFile(join(root, "mods/provider-usage/obsolete.js"), "utf8"), "old helper");
  }
  await unlink(join(f.home, usage));
  await assert.rejects(runDev(f.options), /Installed edit conflicts/);
});

test("symlinked target directories cannot redirect installs", async (t) => {
  const f = await fixture(t);
  const outside = join(f.repo, "outside");
  await mkdir(outside);
  await mkdir(f.home);
  await symlink(outside, join(f.home, "mods"));
  await assert.rejects(runDev(f.options), /Symlink refused/);
  assert.deepEqual(await readdir(outside), []);
});

test("symlinked runtime sources fail without touching the installation", async (t) => {
  const f = await fixture(t);
  await unlink(join(f.repo, shared));
  await symlink(join(f.repo, "minimalist-compact", usage), join(f.repo, shared));
  await assert.rejects(runDev(f.options), /Symlink refused/);
  await assert.rejects(stat(f.home), { code: "ENOENT" });
});

test("watch deploys saves and new files, rejects concurrent commands and stops cleanly", { timeout: 10000 }, async (t) => {
  const f = await fixture(t);
  /** @type {PromiseWithResolvers<void>} */
  const watching = Promise.withResolvers();
  /** @type {PromiseWithResolvers<void>} */
  const updated = Promise.withResolvers();
  const options = { ...f.options, once: false, log(/** @type {string} */ message) {
    f.logs.push(message);
    if (message.startsWith("Watching")) watching.resolve();
    if (message === "Updated mods/provider-usage/new.js") updated.resolve();
  } };
  const running = runDev(options);
  // Attach rejection handling immediately; cleanup must also run if an assertion fails.
  const result = running.then(() => null, (/** @type {unknown} */ error) => error);
  t.after(async () => { f.controller.abort(); await result; });
  await watching.promise;
  await assert.rejects(runDev(f.options), /Dev sync locked/);
  await put(f.repo, shared, "watch-edit");
  await put(f.repo, "herdr-mods/provider-usage/mods/provider-usage/new.js", "new helper");
  await updated.promise;
  f.controller.abort();
  assert.equal(await result, null);
  assert.equal(await readFile(join(f.home, usage), "utf8"), "watch-edit");
  assert.equal(await readFile(join(f.home, "mods/provider-usage/new.js"), "utf8"), "new helper");
  assert.equal(await readFile(join(f.repo, "minimalist-compact/mods/provider-usage/new.js"), "utf8"), "new helper");
  await runDev(f.options);
});
