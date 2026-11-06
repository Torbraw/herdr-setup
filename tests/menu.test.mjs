import test from "node:test";
import assert from "node:assert/strict";
import { menuTarget, menuItems } from "../minimalist-compact/mods/minimalist-compact-menu/model.js";

const spaces = [{ id: "local", tabs: [{ id: "one" }] }, { id: "remote/work", tabs: [{ id: "remote/two" }] }];

test("tab popup resolves its owning space, not the focused space or supplied parent", () => {
  const target = menuTarget({ tab: "tab", target: { id: "remote/two", space: "local" } }, spaces);
  const items = menuItems(target, null);
  assert.deepEqual(items[0].args, { space: "remote/work" });
  assert.deepEqual(items[1].args, { id: "remote/two" });
});

test("workspace actions preserve checkout-specific worktree operations", () => {
  const target = menuTarget({ tab: "space", target: { id: "remote/work" } }, spaces);
  assert.equal(menuItems(target, null).some((item) => item.kind === "worktree"), false);
  const main = menuItems(target, "main");
  assert.deepEqual(main.filter((item) => item.kind === "worktree").map((item) => item.action), ["new", "open"]);
  const linked = menuItems(target, "linked");
  assert.deepEqual(linked.filter((item) => item.kind === "worktree").map((item) => [item.space, item.action]),
    [["remote/work", "new"], ["remote/work", "open"], ["remote/work", "remove"]]);
  assert.deepEqual(linked.at(-1).args, { id: "remote/work" });
});

test("stale or invalid popup targets never fall back to the current selection", () => {
  for (const input of [null, {}, { tab: "pane", target: { id: "one" } }, { tab: "tab", target: { id: 1 } },
    { tab: "tab", target: { id: "missing" } }, { tab: "space", target: { id: "missing" } }]) {
    assert.deepEqual(menuItems(menuTarget(input, spaces), "linked"), []);
  }
});
