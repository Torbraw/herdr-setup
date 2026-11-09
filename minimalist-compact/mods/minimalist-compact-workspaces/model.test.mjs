import { test } from "node:test";
import assert from "node:assert/strict";
import { frontend, snapshot, providerFamily, mostUrgent, sessionStatus } from "./model.js";

test("retained OSC status cannot resurrect OpenCode after its frontend exits", () => {
  const terminal = { address: "t17", state: "live", status: { app: "opencode", state: "working" },
    foreground: { pid: 51051, name: "bash", argv: ["/bin/bash"] } };
  assert.equal(frontend(terminal), null);
  assert.deepEqual(frontend({ ...terminal, foreground: { pid: 123, name: "opencode", argv: ["opencode"] } }),
    { address: "t17", pid: 123, harness: "opencode" });
});

test("a background service is not a coding frontend", () => {
  assert.equal(frontend({ address: "t1", state: "live",
    foreground: { pid: 1, name: "bash", argv: ["/bin/bash", "-i"] },
    records: { old: { app: "opencode", state: "idle" } } }), null);
  assert.equal(frontend({ address: "t1", state: "finished",
    foreground: { pid: 1, name: "opencode", argv: ["opencode"] } }), null);
});

test("provider follows the model, not the OpenCode harness", () => {
  assert.equal(providerFamily("openrouter", "anthropic/claude-opus"), "anthropic");
  assert.equal(providerFamily("azure", "gpt-6.1-sol"), "openai");
  assert.equal(providerFamily("opencode", null), null);
  assert.equal(mostUrgent(["idle", "working", "blocked"]), "blocked");
});

test("optional bridge rejects missing, malformed, and stale-process snapshots", () => {
  const live = { address: "t2", pid: 123, harness: "opencode" };
  const value = { version: 1, terminal: "t2", pid: 123, sessions: [
    { id: "a", title: "Active", active: true, status: "idle", provider: "openai", model: "gpt-6.1-sol" },
    { id: "b", title: "Other tab", active: false, status: "working", provider: "claude-agent", model: "claude-opus" },
  ] };
  assert.equal(snapshot(null, live), null);
  assert.equal(snapshot(value, { ...live, pid: 124 }), null);
  assert.equal(snapshot({ ...value, sessions: [{ id: "broken" }] }, live), null);
  assert.equal(snapshot(value, live)?.sessions[1]?.model, "claude-opus");
  assert.equal(snapshot(value, live)?.sessions[1]?.active, false);
});

test("a single selected session retains Herdr unread completion until viewed", () => {
  const selected = { active: true, status: "idle" };
  assert.equal(sessionStatus(selected, "done", 1), "done");
  assert.equal(sessionStatus(selected, "idle", 1), "idle");
  assert.equal(sessionStatus(selected, undefined, 1), "idle");
});

test("a background tab finishing cannot mark the selected idle tab done", () => {
  const selected = { active: true, status: "idle" };
  const working = { active: false, status: "working" };
  const finished = { ...working, status: "done" };
  const states = (sessions, native) => sessions.map((session) => sessionStatus(session, native, sessions.length));
  assert.deepEqual(states([selected, working], "working"), ["idle", "working"]);
  assert.deepEqual(states([selected, finished], "done"), ["idle", "done"]);
  assert.deepEqual(states([selected, { ...finished, status: "idle" }], "done"), ["idle", "idle"]);
});

test("native completion never replaces a session's working or blocked state", () => {
  assert.equal(sessionStatus({ active: true, status: "working" }, "done", 1), "working");
  assert.equal(sessionStatus({ active: true, status: "blocked" }, "done", 1), "blocked");
  assert.equal(sessionStatus({ active: false, status: "idle" }, "done", 1), "idle");
  assert.equal(sessionStatus({ active: false, status: "done" }, "idle", 2), "done");
});
