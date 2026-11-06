import { test } from "node:test";
import assert from "node:assert/strict";
import { ScreenshotNames, screenshotMode } from "./screenshot.js";

test("aliases hide names and paths, retain duplicate branch suppression, and restore originals", () => {
  const source = Object.freeze({ id: "space-1", name: "client-private", folder: "/clients/private",
    branch: "client-private", worktree: true });
  const names = new ScreenshotNames();
  const preview = names.workspace(source, true);
  assert.doesNotMatch(JSON.stringify(preview), /client|private/);
  assert.equal(preview.branch, preview.name);
  assert.deepEqual(names.workspace(source, false), {
    name: source.name, folder: source.folder, branch: source.branch,
  });
  assert.deepEqual(names.workspace(source, true), preview);
  assert.equal(names.workspace({ ...source, branch: null }, true).branch, null);
});

test("aliases stay unique beyond sample list and stable across reordering and title changes", () => {
  const names = new ScreenshotNames();
  const ids = Array.from({ length: 30 }, (_, i) => `terminal-${i}:session`);
  const assigned = ids.map(id => names.name("session", id));
  assert.equal(new Set(assigned).size, ids.length);
  assert.deepEqual(ids.toReversed().map(id => names.name("session", id)), assigned.toReversed());
  const source = { id: "space-1", name: "client", folder: "/clients/one", branch: "private", worktree: false };
  assert.deepEqual(names.workspace({ ...source, name: "renamed", folder: "/clients/two" }, true),
    names.workspace(source, true));
});

test("explicit on/off commands are idempotent; unrelated commands cannot change visibility", () => {
  let enabled = screenshotMode("screenshot-on", false);
  enabled = screenshotMode("screenshot-on", enabled);
  assert.equal(screenshotMode("unknown", enabled), true);
  assert.equal(screenshotMode("screenshot-toggle", enabled), false);
  enabled = screenshotMode("screenshot-off", enabled);
  assert.equal(screenshotMode("screenshot-off", enabled), false);
});
