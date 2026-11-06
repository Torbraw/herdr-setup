// @ts-check
/** @typedef {{label: string, used: number, reset: string | number | null}} UsageWindow */
/** @typedef {"openai" | "anthropic"} ProviderID */
/** @typedef {({state: "ready", windows: UsageWindow[]} | {state: "unavailable", message: string}) & {provider: ProviderID}} Provider */

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function record(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** @param {unknown} value @returns {UsageWindow | null} */
function usageWindow(value) {
  if (!record(value) || typeof value.label !== "string") return null;
  if (typeof value.used !== "number" || !Number.isFinite(value.used)) return null;
  const reset = typeof value.reset === "string" || typeof value.reset === "number" ? value.reset : null;
  return { label: value.label, used: Math.max(0, Math.min(100, value.used)), reset };
}

/** @param {unknown} value @returns {Provider | null} */
function provider(value) {
  if (!record(value) || !["openai", "anthropic"].includes(String(value.provider))) return null;
  const id = value.provider === "openai" ? "openai" : "anthropic";
  if (value.state === "unavailable" && typeof value.message === "string") {
    return { provider: id, state: "unavailable", message: value.message };
  }
  if (value.state !== "ready" || !Array.isArray(value.windows)) return null;
  const windows = value.windows.map(usageWindow).filter((entry) => entry !== null);
  if (!windows.length) return null;
  return { provider: id, state: "ready", windows };
}

/** @param {unknown} value @returns {{providers: Provider[], updated: number} | null} */
export function parseUsage(value) {
  if (!record(value) || typeof value.updated !== "number" || !Array.isArray(value.providers)) return null;
  return { providers: value.providers.map(provider).filter((entry) => entry !== null), updated: value.updated };
}

/** @param {UsageWindow["reset"]} value @param {number} now @returns {string} */
export function resetLabel(value, now = Date.now()) {
  if (value === null) return "";
  const end = typeof value === "number" ? value * 1000 : Date.parse(value);
  const minutes = Math.max(0, Math.ceil((end - now) / 60000));
  if (!Number.isFinite(minutes)) return "";
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.ceil(minutes / 60)}h`;
  return `${Math.ceil(minutes / 1440)}d`;
}
