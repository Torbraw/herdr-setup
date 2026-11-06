import { mkdir } from "fs/promises";
import { appHome, readTextFile, writeTextFile, watchFolder } from "herdr";
import { snapshot } from "./model.js";

/** Optional metadata reader. No plugin, no snapshot: native agent rows still work. */
export class OpenCodeBridge {
  constructor() {
    this.directory = `${appHome()}/data/herdr-app-bridge`;
    this.frontends = new Map();
    this.snapshots = new Map();
    this.signature = "[]";
  }

  start(cx) {
    cx.spawn(async (cx) => {
      try {
        await mkdir(this.directory, { recursive: true });
        let changed = watchFolder(this.directory);
        this.refresh(cx);
        for (;;) {
          const paths = await changed;
          changed = watchFolder(this.directory);
          if (this.relevant(paths)) this.refresh(cx);
        }
      } catch { this.watchUnavailable = true; }
    });
    // Only platforms that cannot watch this directory use a slow fallback.
    cx.timer.every(30000, (cx) => { if (this.watchUnavailable) this.refresh(cx); });
  }

  relevant(paths) {
    const names = new Set([...this.frontends.values()].map((live) => `${live.pid}.json`));
    return paths.some((path) => path === this.directory || names.has(path.split(/[\\/]/).pop()));
  }

  update(frontends, cx) {
    const local = [...frontends].filter(([, live]) => live.harness === "opencode" && !live.address.includes("/"));
    const signature = JSON.stringify(local);
    if (signature === this.signature) return;
    this.signature = signature;
    this.frontends = new Map(local);
    this.refresh(cx);
  }

  refresh(cx) {
    if (this.reading) { this.again = true; return; }
    this.reading = true;
    cx.spawn(async (cx) => {
      do {
        this.again = false;
        const next = new Map();
        await Promise.all([...this.frontends.values()].map(async (live) => {
          try {
            const text = await readTextFile(`${this.directory}/${live.pid}.json`);
            const value = snapshot(JSON.parse(text ?? "null"), live);
            if (value) next.set(live.address, value);
          } catch { /* Optional plugin absent, reloading, or exited. */ }
        }));
        const changed = JSON.stringify([...next]) !== JSON.stringify([...this.snapshots]);
        this.snapshots = next;
        if (changed) cx.notify();
      } while (this.again);
      this.reading = false;
    });
  }

  get(live) {
    const value = this.snapshots.get(live.address);
    return value?.pid === live.pid ? value : null;
  }

  focus(target, cx) {
    const path = `${this.directory}/${target.pid}.command.json`;
    cx.spawn(async () => {
      try {
        const expected = await readTextFile(path);
        const command = { sessionID: target.sessionID, nonce: `${Date.now()}-${Math.random()}`, created: Date.now() };
        await writeTextFile(path, JSON.stringify(command), expected);
      } catch { /* The frontend may have exited between click and delivery. */ }
    });
  }
}
