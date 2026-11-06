// @ts-check
/** @typedef {"workspace" | "worktree" | "branch" | "session"} NameKind */
/** @typedef {{id: string, name: string, folder: string, branch: string | null | undefined, worktree: boolean}} WorkspaceLabel */

const samples = {
  workspace: ["web-app", "api-service", "docs", "design-system", "mobile-app", "herdr-app-layout"],
  worktree: ["feature/search", "fix/login", "feature/settings"],
  branch: ["main", "develop", "feature/navigation"],
  session: ["Polish navigation", "Review sign-in flow", "Build search filters", "Update documentation", "Refine the layout"],
};

/** Display-only aliases. IDs stay private in memory; assignments survive reordering. */
export class ScreenshotNames {
  constructor() {
    /** @type {Record<NameKind, Map<string, string>>} */
    this.names = { workspace: new Map(), worktree: new Map(), branch: new Map(), session: new Map() };
  }

  /** @param {NameKind} kind @param {string} id */
  name(kind, id) {
    const names = this.names[kind];
    const existing = names.get(id);
    if (existing !== undefined) return existing;
    const options = samples[kind];
    const index = names.size;
    const base = options[index % options.length] ?? kind;
    const cycle = Math.floor(index / options.length);
    const value = cycle === 0 ? base : `${base} ${cycle + 1}`;
    names.set(id, value);
    return value;
  }

  /** Preserve absent/duplicate branches and row geometry; never mutate source data.
   * @param {WorkspaceLabel} source @param {boolean} enabled */
  workspace(source, enabled) {
    if (!enabled) return { name: source.name, folder: source.folder, branch: source.branch };
    const name = this.name(source.worktree ? "worktree" : "workspace", source.id);
    return { name, folder: `/projects/${name}`, branch: this.branch(source, name) };
  }

  /** @param {WorkspaceLabel} source @param {string} name */
  branch(source, name) {
    if (!source.branch) return source.branch;
    if (source.branch === source.name) return name;
    return this.name("branch", source.id);
  }
}

/** @param {string} command @param {boolean} enabled */
export function screenshotMode(command, enabled) {
  if (command === "screenshot-on") return true;
  if (command === "screenshot-off") return false;
  return command === "screenshot-toggle" ? !enabled : enabled;
}
