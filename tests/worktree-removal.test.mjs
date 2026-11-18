import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { inspect, remove } from "../minimalist-compact/mods/minimalist-compact-worktree-remove/git.js";

const exec = promisify(execFile);
async function git(cwd, args, timeout) {
  try {
    const result = await exec("git", args, { cwd, timeout,
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.invalid",
        GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.invalid" } });
    return { ok: true, out: result.stdout.trim(), err: result.stderr.trim() };
  } catch (error) {
    return { ok: false, out: error.stdout?.trim() ?? "", err: error.stderr?.trim() ?? error.message };
  }
}
async function run(cwd, ...args) {
  const result = await git(cwd, args);
  assert.equal(result.ok, true, result.err);
  return result.out;
}
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "herdr-worktree-removal-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const main = join(root, "main");
  const linked = join(root, "linked");
  await mkdir(main);
  await run(main, "init");
  await run(main, "commit", "--allow-empty", "-m", "Initial");
  await run(main, "worktree", "add", "-b", "retained-branch", linked);
  return { main, linked, root };
}

test("main checkout is rejected before confirmation", async (t) => {
  const { main } = await fixture(t);
  await assert.rejects(inspect(git, main), /main checkout/);
});

test("removal closes the targeted space first, deletes checkout and keeps its branch", async (t) => {
  const { main, linked } = await fixture(t);
  const snapshot = await inspect(git, linked);
  let closed = false;
  const result = await remove(git, snapshot, () => {
    assert.equal(existsSync(linked), true);
    closed = true;
  });
  assert.equal(closed, true);
  assert.equal(result.kind, "removed");
  await assert.rejects(access(linked), { code: "ENOENT" });
  await run(main, "show-ref", "--verify", "refs/heads/retained-branch");
});

test("new uncommitted data requires confirmation again, without closing the space", async (t) => {
  const { linked } = await fixture(t);
  const snapshot = await inspect(git, linked);
  await writeFile(join(linked, "new.txt"), "unsaved work");
  const result = await remove(git, snapshot, () => assert.fail("closed before renewed consent"));
  assert.equal(result.kind, "changed");
  assert.equal(result.snapshot.risk.dirty, true);
  await access(join(linked, "new.txt"));
  await remove(git, result.snapshot, () => {});
  await assert.rejects(access(linked), { code: "ENOENT" });
});

test("Git status failure never closes a space or deletes data", async (t) => {
  const { linked } = await fixture(t);
  const snapshot = await inspect(git, linked);
  await writeFile(join(linked, ".git"), "broken git metadata");
  await assert.rejects(remove(git, snapshot, () => assert.fail("closed on failed status")));
  await access(linked);
});

test("new unpushed submodule commits require renewed consent even when already dirty", async (t) => {
  const { root, linked } = await fixture(t);
  const source = join(root, "submodule");
  await mkdir(source);
  await run(source, "init");
  await run(source, "commit", "--allow-empty", "-m", "Submodule initial");
  await run(linked, "-c", "protocol.file.allow=always", "submodule", "add", source, "child");
  await run(linked, "commit", "-am", "Add child");
  await writeFile(join(linked, "dirty.txt"), "existing change");
  const snapshot = await inspect(git, linked);
  assert.deepEqual(snapshot.risk.unpushed, []);
  await run(join(linked, "child"), "commit", "--allow-empty", "-m", "Unpushed child change");
  const result = await remove(git, snapshot, () => assert.fail("closed before submodule warning"));
  assert.equal(result.kind, "changed");
  assert.deepEqual(result.snapshot.risk.unpushed, ["child"]);
  await access(join(linked, "child"));
});
