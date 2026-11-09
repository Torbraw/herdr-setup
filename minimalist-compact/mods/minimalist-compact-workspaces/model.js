// @ts-check
/** @typedef {"working" | "blocked" | "done" | "idle"} Status */
/** @typedef {{address: string, pid: number, harness: string}} Frontend */
/** @typedef {{id: string, title: string, active: boolean, status: Status, provider: string | null, model: string | null}} Session */
/** @typedef {{terminal: string, pid: number, sessions: Session[]}} Snapshot */

/** @param {unknown} value @returns {value is Record<string, unknown>} */
export function record(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** @param {unknown} value @returns {value is Status} */
function status(value) {
  return ["working", "blocked", "done", "idle"].includes(String(value));
}

/** @param {unknown} value @returns {Session | null} */
function session(value) {
  if (!record(value)) return null;
  if (typeof value.id !== "string" || typeof value.title !== "string") return null;
  if (typeof value.active !== "boolean" || !status(value.status)) return null;
  return { id: value.id, title: value.title, active: value.active, status: value.status,
    provider: typeof value.provider === "string" ? value.provider : null,
    model: typeof value.model === "string" ? value.model : null };
}

/** Match the live frontend PID instead of expiring idle sessions with heartbeats.
 * @param {unknown} value @param {Frontend} live @returns {Snapshot | null} */
export function snapshot(value, live) {
  if (!record(value) || value.version !== 1) return null;
  if (value.terminal !== live.address || value.pid !== live.pid) return null;
  if (!Array.isArray(value.sessions)) return null;
  const sessions = value.sessions.map(session);
  if (sessions.some((entry) => entry === null)) return null;
  return { terminal: live.address, pid: live.pid, sessions: sessions.filter((entry) => entry !== null) };
}

/** Only the terminal's foreground process counts; retained OSC/server state doesn't.
 * @param {unknown} value @returns {Frontend | null} */
export function frontend(value) {
  if (!record(value) || value.state !== "live") return null;
  if (typeof value.address !== "string" || !record(value.foreground)) return null;
  const process = value.foreground;
  if (typeof process.pid !== "number") return null;
  const argv = Array.isArray(process.argv) ? process.argv.filter((arg) => typeof arg === "string") : [];
  const names = [process.name, ...argv.slice(0, 2)].filter((name) => typeof name === "string");
  const harness = names.map((name) => name.split(/[\\/]/).pop()?.replace(/\.exe$/, ""))
    .find((name) => ["opencode", "claude", "codex", "pi", "cursor-agent", "aider", "gemini"].includes(name ?? ""));
  if (!harness) return null;
  return { address: value.address, pid: process.pid, harness };
}

/** Provider and harness are independent: Claude models can run inside OpenCode.
 * @param {string | null} provider @param {string | null} model
 * @returns {"openai" | "anthropic" | null} */
export function providerFamily(provider, model) {
  const value = `${provider ?? ""} ${model ?? ""}`.toLowerCase();
  if (/anthropic|claude/.test(value)) return "anthropic";
  if (/openai|codex|gpt-|\bo[134][-\s]/.test(value)) return "openai";
  return null;
}

/** @param {Status[]} states @returns {Status | null} */
export function mostUrgent(states) {
  /** @type {Status[]} */
  const priority = ["blocked", "done", "working", "idle"];
  return priority.find((item) => states.includes(item)) ?? null;
}
