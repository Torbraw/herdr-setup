// @ts-check
import { copyFile, mkdir, readdir } from "node:fs/promises";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";

/** Source files only: never credentials, generated typings, caches or docs.
 * @param {string} name */
export function bundledFile(name) {
  if (name.startsWith(".") || name.endsWith(".d.ts")) return false;
  return name === "mod.json" || [".js", ".mjs", ".py", ".svg"].includes(extname(name));
}

/** Manual, one-way copy into the self-contained layout; leaves other files alone.
 * @param {URL} source @param {URL} destination */
export async function syncProviderUsage(source, destination) {
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (!entry.isFile() || !bundledFile(entry.name)) continue;
    await copyFile(new URL(entry.name, source), new URL(entry.name, destination));
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await syncProviderUsage(new URL("../herdr-mods/provider-usage/mods/provider-usage/", import.meta.url),
    new URL("../minimalist-compact/mods/provider-usage/", import.meta.url));
  console.log("Provider usage bundle updated");
}
