// @ts-check
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, mkdir, readFile, readdir, rename, rmdir, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { bundledFile } from "./sync-provider-usage.mjs";

const exec = promisify(execFile);
const layout = "minimalist-compact";
const sharedSource = "herdr-mods/provider-usage/mods/provider-usage";

/** @typedef {{ source: string, relative: string, content: Buffer, bundle: string | null }} SourceFile */
/** @typedef {{ repo: string, home: string, state: string, once: boolean, signal: AbortSignal, log: (message: string) => void }} Options */

/** @param {unknown} error @param {string} code */
function hasCode(error, code) {
  return error instanceof Error && "code" in error && error.code === code;
}

/** Missing files are distinct from unreadable files. @param {string} path */
async function readOptional(path) {
  try {
    return await readFile(path);
  } catch (error) {
    if (hasCode(error, "ENOENT")) return null;
    throw error;
  }
}

/** Refuse symlinked parents too: a managed path must not redirect writes.
 * @param {string} path */
async function safePath(path) {
  const parent = dirname(path);
  if (parent !== path) await safePath(parent);
  try {
    if ((await lstat(path)).isSymbolicLink()) throw new Error(`Symlink refused: ${path}`);
  } catch (error) {
    if (!hasCode(error, "ENOENT")) throw error;
  }
}

/** @param {string} path @param {Buffer} content */
async function atomicWrite(path, content) {
  await safePath(path);
  await mkdir(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.herdr-dev-${randomUUID()}`);
  try {
    await writeFile(temporary, content, { flag: "wx", mode: 0o600 });
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch((error) => {
      if (!hasCode(error, "ENOENT")) throw error;
    });
  }
}

/** @param {string} name */
function runtimeFile(name) {
  return bundledFile(name) && !/\.(test|spec)\.[cm]?js$/.test(name) && !name.startsWith("test_");
}

/** Only flat runtime files; never traverse docs, caches or generated directories.
 * @param {string} repo @param {string} name */
async function modFiles(repo, name) {
  const bundle = join(repo, layout, "mods", name);
  const source = name === "provider-usage" ? join(repo, sharedSource) : bundle;
  await safePath(source);
  /** @type {SourceFile[]} */
  const files = [];
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (!runtimeFile(entry.name)) continue;
    if (entry.isSymbolicLink()) throw new Error(`Symlink refused: ${join(source, entry.name)}`);
    if (!entry.isFile()) continue;
    files.push({ source: join(source, entry.name), relative: join("mods", name, entry.name),
      content: await readFile(join(source, entry.name)),
      bundle: source === bundle ? null : join(bundle, entry.name) });
  }
  return files;
}

/** Layout files go last, so new mod files exist before the layout references them.
 * @param {string} repo */
async function sourceFiles(repo) {
  const mods = join(repo, layout, "mods");
  await safePath(mods);
  /** @type {SourceFile[]} */
  const files = [];
  for (const entry of await readdir(mods, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error(`Symlink refused: ${join(mods, entry.name)}`);
    if (entry.isDirectory()) files.push(...await modFiles(repo, entry.name));
  }
  for (const extension of ["png", "json"]) {
    const path = join("layouts", `${layout}.${extension}`);
    const source = join(repo, layout, path);
    await safePath(source);
    files.push({ source, relative: path, content: await readFile(source), bundle: null });
  }
  return files;
}

/** On first use, accept an installed file only if it matches the repo's HEAD.
 * @param {string} repo @param {string} source */
async function committedContent(repo, source) {
  try {
    const result = await exec("git", ["show", `HEAD:${relative(repo, source)}`],
      { cwd: repo, encoding: "buffer", maxBuffer: 16 * 1024 * 1024 });
    return result.stdout;
  } catch (error) {
    if (hasCode(error, "ENOENT")) throw error;
    return null;
  }
}

/** Preflight the entire batch before changing either the bundle or installation.
 * @param {Options} options @param {SourceFile} file */
async function prepare(options, file) {
  const target = join(options.home, file.relative);
  await safePath(target);
  const current = await readOptional(target);
  const previous = await readOptional(join(options.state, "last", file.relative));
  if (current?.equals(file.content)) return { file, target, current };
  if (current === null && previous === null) return { file, target, current };
  const baseline = previous ?? await committedContent(options.repo, file.source);
  if (!current || !baseline?.equals(current)) {
    throw new Error(`Installed edit conflicts: ${target}\nCompare it with ${file.source}; preserve or resolve the local edit, then rerun.`);
  }
  return { file, target, current };
}

/** @param {Options} options @param {string} backup */
async function sync(options, backup) {
  const files = await sourceFiles(options.repo);
  const changes = [];
  for (const file of files) {
    if (file.bundle) await safePath(file.bundle);
    changes.push(await prepare(options, file));
  }
  for (const { file, target, current } of changes) {
    await updateBundle(file);
    if (!current?.equals(file.content)) {
      await backupOriginal(join(backup, file.relative), current);
      // Recheck after preflight: don't knowingly overwrite a concurrent local edit.
      const latest = await readOptional(target);
      if (!sameContent(latest, current)) throw new Error(`Installed file changed during sync: ${target}`);
      await atomicWrite(target, file.content);
      options.log(`Updated ${file.relative}`);
    }
    const baseline = join(options.state, "last", file.relative);
    if (!(await readOptional(baseline))?.equals(file.content)) await atomicWrite(baseline, file.content);
  }
}

/** @param {Buffer | null} left @param {Buffer | null} right */
function sameContent(left, right) {
  return left === null ? right === null : right !== null && left.equals(right);
}

/** Keep the pre-run version, not a backup for every keystroke.
 * @param {string} path @param {Buffer | null} content */
async function backupOriginal(path, content) {
  if (content === null || await readOptional(path) !== null) return;
  await atomicWrite(path, content);
}

/** @param {SourceFile} file */
async function updateBundle(file) {
  if (file.bundle === null) return;
  if ((await readOptional(file.bundle))?.equals(file.content)) return;
  await atomicWrite(file.bundle, file.content);
}

/** One writer per target home, including --once. SIGINT/SIGTERM release the lock.
 * @param {Options} options */
export async function runDev(options) {
  await safePath(options.state);
  await mkdir(options.state, { recursive: true, mode: 0o700 });
  const lock = join(options.state, "lock");
  try {
    await mkdir(lock);
  } catch (error) {
    if (!hasCode(error, "EEXIST")) throw error;
    throw new Error(`Dev sync locked: ${lock}\nStop the other dev command first. After a crash, remove this empty lock directory only if no dev command is running.`);
  }
  const backup = join(options.state, "backups", randomUUID());
  try {
    options.log(`Target: ${options.home}\nBackups (on overwrite): ${backup}`);
    await sync(options, backup);
    if (options.once) return;
    options.log("Watching repo every 300ms. Ctrl+C to stop. Removed files are kept; remove retired files manually.");
    while (!options.signal.aborted) {
      await setTimeout(300, undefined, { signal: options.signal });
      await sync(options, backup);
    }
  } catch (error) {
    if (!(error instanceof Error && error.name === "AbortError" && options.signal.aborted)) throw error;
  } finally {
    await rmdir(lock);
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || args.some((arg) => !["--once", "--help"].includes(arg))) {
    throw new Error("Usage: node scripts/dev.mjs [--once | --help]");
  }
  if (args.includes("--help")) {
    console.log("Usage: node scripts/dev.mjs [--once]\nRepo → bundle → Herdr; default watches, --once applies once.\nHERDR_APP_HOME selects the target; XDG_STATE_HOME selects baseline/backup storage.\nNo deletions, settings/session changes, commits or pushes. See README.md for conflict recovery.");
    return;
  }
  const home = resolve(process.env.HERDR_APP_HOME || join(homedir(), ".config/herdr-app"));
  const stateRoot = process.env.XDG_STATE_HOME || join(homedir(), ".local/state");
  const id = createHash("sha256").update(home).digest("hex").slice(0, 16);
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  try {
    await runDev({ repo: fileURLToPath(new URL("../", import.meta.url)), home,
      state: join(stateRoot, "herdr-setup", id), once: args.includes("--once"),
      signal: controller.signal, log: console.log });
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
