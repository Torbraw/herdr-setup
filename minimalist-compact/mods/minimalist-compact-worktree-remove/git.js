// @ts-check
// Removal safeguards adapted from Herdr's shipped worktree mod.
/** @typedef {{ ok: boolean, out: string, err: string }} Result */
/** @typedef {(cwd: string, args: string[], timeout?: number) => Promise<Result>} Git */
/** @typedef {{ top: string, main: string }} Checkout */
/** @typedef {{ dirty: boolean, modules: number, unpushed: string[] }} Risk */
/** @typedef {{ checkout: Checkout, risk: Risk }} Snapshot */
/** @typedef {{ name: string, dir: string, pinned: string }} Submodule */

/** Fail closed on unreadable Git state. @param {Result} result */
function checked(result) {
  if (!result.ok) throw new Error(result.err || "Git could not check this worktree.");
  return result.out;
}

/** Include nested and deinitialized submodules: their histories also disappear.
 * @param {Git} git @param {string} dir @param {string[]} config
 * @param {string} parent @returns {Promise<Submodule[]>} */
async function modules(git, dir, config, parent = "") {
  const keys = await git(dir, ["--git-dir", dir, "config", ...config, "-z", "--get-regexp", "^submodule\\..*\\.path$"]);
  if (!keys.ok) {
    if (keys.err) throw new Error(keys.err);
    return [];
  }
  /** @type {Submodule[]} */
  const found = [];
  for (const record of keys.out.split("\0").filter(Boolean)) {
    const at = record.indexOf("\n");
    const name = record.slice("submodule.".length, at - ".path".length);
    const child = `${dir}/modules/${name}`;
    if (!(await git(dir, ["--git-dir", child, "rev-parse", "--git-dir"])).ok) continue;
    const pinned = await git(dir, ["--git-dir", dir, "rev-parse", `HEAD:${record.slice(at + 1)}`]);
    found.push({ name: parent + name, dir: child, pinned: pinned.ok ? pinned.out : "" });
    if ((await git(dir, ["--git-dir", child, "cat-file", "-e", "HEAD:.gitmodules"])).ok)
      found.push(...await modules(git, child, ["--blob", "HEAD:.gitmodules"], `${parent + name}/`));
  }
  return found;
}

/** @param {Git} git @param {Checkout} checkout @returns {Promise<Risk>} */
async function riskOf(git, checkout) {
  const status = checked(await git(checkout.top, ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain"]));
  const dir = checked(await git(checkout.top, ["rev-parse", "--absolute-git-dir"]));
  const children = await modules(git, dir, ["--file", `${checkout.top}/.gitmodules`]);
  const unpushed = [];
  for (const child of children) {
    const local = checked(await git(dir, ["--git-dir", child.dir, "rev-list", "-n1", "--all", "--not", "--remotes", ...(child.pinned ? [child.pinned] : [])]));
    if (local) unpushed.push(child.name);
  }
  return { dirty: status !== "", modules: children.length, unpushed };
}

/** @param {Git} git @param {string} folder @returns {Promise<Snapshot>} */
export async function inspect(git, folder) {
  const top = checked(await git(folder, ["rev-parse", "--show-toplevel"]));
  const common = checked(await git(folder, ["rev-parse", "--path-format=absolute", "--git-common-dir"]));
  const main = common.endsWith("/.git") ? common.slice(0, -5) : common;
  if (main === top) throw new Error("The main checkout cannot be removed.");
  const checkout = { top, main };
  return { checkout, risk: await riskOf(git, checkout) };
}

/** Recheck consent before closing terminals or deleting anything.
 * @param {Git} git @param {Snapshot} snapshot @param {() => void} closeSpace
 * @returns {Promise<{ kind: "removed" } | { kind: "changed", snapshot: Snapshot }>} */
export async function remove(git, snapshot, closeSpace) {
  const risk = await riskOf(git, snapshot.checkout);
  if ((risk.dirty && !snapshot.risk.dirty) || risk.unpushed.some((name) => !snapshot.risk.unpushed.includes(name)))
    return { kind: "changed", snapshot: { checkout: snapshot.checkout, risk } };
  closeSpace(); // Release Windows shells' handles before Git deletes the checkout.
  const force = risk.dirty || risk.modules > 0;
  checked(await git(snapshot.checkout.main,
    ["worktree", "remove", ...(force ? ["--force"] : []), snapshot.checkout.top], 600_000));
  return { kind: "removed" };
}
