// @ts-check
/** @typedef {{ kind: "space", id: string } | { kind: "tab", id: string, space: string }} Target */
/** @typedef {"main" | "linked" | null} Checkout */
/** @typedef {{ id: string, tabs: { id: string }[] }} Space */
/** @typedef {{ label: string, icon: string } & ({ kind: "command", command: string, args: Record<string, unknown> } | { kind: "worktree", space: string, action: "new" | "open" | "remove" })} MenuItem */

/** @param {unknown} value */
function popup(value) {
  if (!value || typeof value !== "object" || !("target" in value) || !("tab" in value)) return null;
  const target = value.target;
  if (!target || typeof target !== "object" || !("id" in target) || typeof target.id !== "string") return null;
  return { kind: value.tab, id: target.id };
}

/** Resolve only live targets; malformed/stale popups must not act on the focused tab.
 * @param {unknown} value @param {Space[]} spaces @returns {Target | null} */
export function menuTarget(value, spaces) {
  const target = popup(value);
  if (!target) return null;
  const id = target.id;
  if (target.kind === "space") return spaces.some((space) => space.id === id) ? { kind: "space", id } : null;
  if (target.kind !== "tab") return null;
  const space = spaces.find((space) => space.tabs.some((tab) => tab.id === id));
  return space ? { kind: "tab", id, space: space.id } : null;
}

/** @param {string} label @param {string} icon @param {string} command @param {Record<string, unknown>} args @returns {MenuItem} */
function command(label, icon, command, args) {
  return { kind: "command", label, icon, command, args };
}

/** Keep native tab/worktree actions, deliberately excluding naming controls.
 * @param {Target | null} target @param {Checkout} checkout @returns {MenuItem[]} */
export function menuItems(target, checkout) {
  if (!target) return [];
  if (target.kind === "tab") return [
    command("New tab", "plus", "tab.new", { space: target.space }),
    command("Close", "x", "tab.close", { id: target.id }),
  ];
  /** @type {MenuItem[]} */
  const items = [];
  if (checkout) {
    items.push({ kind: "worktree", label: "New worktree", icon: "git-branch", space: target.id, action: "new" });
    items.push({ kind: "worktree", label: "Open worktree", icon: "git-branch", space: target.id, action: "open" });
  }
  if (checkout === "linked") items.push({ kind: "worktree", label: "Remove worktree", icon: "git-branch", space: target.id, action: "remove" });
  items.push(command("Close", "x", "space.close", { id: target.id }));
  return items;
}
