import { test } from "node:test";
import assert from "node:assert/strict";
import { parseUsage, resetLabel } from "../mods/provider-usage/model.js";

test("malformed usage is rejected, over-limit values cannot overflow the meter", () => {
  const result = parseUsage({ updated: 10, providers: [
    { provider: "openai", state: "ready", windows: [{ label: "7d", used: 140, reset: 100 }] },
    { provider: "anthropic", state: "ready", windows: [{ label: "5h", used: "10" }] },
  ] });
  assert.deepEqual(result, { updated: 10, providers: [
    { provider: "openai", state: "ready", windows: [{ label: "7d", used: 100, reset: 100 }] },
  ] });
  assert.equal(parseUsage(null), null);
});

test("both provider reset formats work; absent resets never show a fake date", () => {
  const now = Date.parse("2026-11-05T16:00:00Z");
  assert.equal(resetLabel("2026-11-05T18:00:00Z", now), "2h");
  assert.equal(resetLabel((now + 30 * 60000) / 1000, now), "30m");
  assert.equal(resetLabel(null, now), "");
  assert.equal(resetLabel("invalid", now), "");
});
