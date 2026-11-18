import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { exec, nextCommand, panes, run, shared, spaces, theme } from "herdr";
import { inspect, remove } from "./git.js";

/** @typedef {{ space: string, machine: string | null, name: string, snapshot: import("./git.js").Snapshot }} Target */
/** @typedef {{ kind: "idle" } | { kind: "loading" } | { kind: "failed", message: string } |
 * { kind: "ready", target: Target, error: string } | { kind: "removing", target: Target }} State */

/** @param {string | null} machine @returns {import("./git.js").Git} */
function gitOn(machine) {
  return async (cwd, args, timeout) => {
    const result = await exec("git", args, { cwd, on: machine, ...(timeout === undefined ? {} : { timeout }) });
    return { ok: result.code === 0, out: result.stdout.trim(), err: result.stderr.trim() };
  };
}

/** @param {import("./git.js").Risk} risk */
function warning(risk) {
  if (risk.dirty && risk.unpushed.length) return "Changes and unpushed submodule commits will be lost.";
  if (risk.unpushed.length) return "Unpushed submodule commits will be lost.";
  if (risk.dirty) return "Uncommitted changes will be lost.";
  return "";
}

/** Validate the app's string-valued theme at the native element boundary.
 * @param {string} value @returns {import("gpui-kit").Color} */
function color(value) {
  return /^#[\da-f]{6}([\da-f]{2})?$/i.test(value) ? `#${value.slice(1)}` : "#808080";
}

function colors() {
  const t = theme();
  return { foreground: color(t.foreground), muted: color(t.muted), blocked: color(t.blocked), hover: color(t.hover) };
}

export default class CompactWorktreeRemoval extends View {
  /** @param {unknown} _props @param {import("gpui-kit").Context} cx */
  init(_props, cx) {
    /** @type {State} */
    this.state = { kind: "idle" };
    this.handle = cx.focus_handle();
    cx.spawn(async (cx) => {
      for (;;) {
        if (await nextCommand() === "start") await this.start(cx);
      }
    });
  }

  /** @param {import("gpui-kit").Context} cx */
  async start(cx) {
    if (this.state.kind === "removing" || this.state.kind === "loading") return;
    const space = spaces().find((space) => space.id === shared("minimalist-compact.remove-worktree"));
    if (!space) return;
    const tabs = new Set(space.tabs.map((tab) => tab.id));
    const folder = panes().find((pane) => tabs.has(pane.tab) && pane.cwd)?.cwd || space.folder;
    this.state = { kind: "loading" };
    cx.notify();
    try {
      const snapshot = await inspect(gitOn(space.machine), folder);
      const name = snapshot.checkout.top.replace(/\\/g, "/").split("/").pop() || "worktree";
      this.state = { kind: "ready", target: { space: space.id, machine: space.machine, name, snapshot }, error: "" };
      this.handle.focus();
    } catch (error) { this.state = { kind: "failed", message: String(error) }; }
    cx.notify();
  }

  /** @param {import("gpui-kit").Context} cx */
  dismiss(cx) {
    if (this.state.kind === "removing" || this.state.kind === "loading") return;
    this.state = { kind: "idle" };
    cx.notify();
  }

  /** @param {import("gpui-kit").Context} cx */
  confirm(cx) {
    if (this.state.kind !== "ready") return;
    const target = this.state.target;
    this.state = { kind: "removing", target };
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const result = await remove(gitOn(target.machine), target.snapshot,
          () => run("space.close", { id: target.space, confirmed: true }));
        this.state = result.kind === "removed" ? { kind: "idle" } :
          { kind: "ready", target: { ...target, snapshot: result.snapshot }, error: "Changed since confirmation. Remove anyway?" };
      } catch (error) { this.state = { kind: "ready", target, error: String(error) }; }
      cx.notify();
    });
  }

  /** @param {string} label @param {(cx: import("gpui-kit").Context) => void} action @param {ReturnType<typeof colors>} t */
  button(label, action, t) {
    return div().id(`removal-${label}`).px(7).py(2).rounded(7).text_color(t.muted)
      .hover((el) => el.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", (_event, cx) => cx.stop_propagation())
      .on_click((_event, cx) => action(cx)).child(label);
  }

  /** @param {ReturnType<typeof colors>} t */
  content(t) {
    const state = this.state;
    if (state.kind === "loading") return div().child("Checking worktree…");
    if (state.kind === "removing") return div().truncate().tooltip(state.target.snapshot.checkout.top).child(`Removing ${state.target.name}…`);
    if (state.kind === "failed") return h_flex().items_center()
      .child(div().flex_1().min_w(0).truncate().text_color(t.blocked).tooltip(state.message).child(state.message))
      .child(this.button("Close", (cx) => this.dismiss(cx), t));
    if (state.kind !== "ready") return div();
    const detail = state.error || warning(state.target.snapshot.risk);
    return v_flex().gap(2)
      .child(h_flex().items_center().gap(4)
        .child(div().flex_1().min_w(0).truncate().tooltip(state.target.snapshot.checkout.top).child(`Remove ${state.target.name}?`))
        .child(this.button("Cancel", (cx) => this.dismiss(cx), t))
        .child(this.button("Remove", (cx) => this.confirm(cx), t)))
      .when(Boolean(detail), (el) => el.child(div().text_size(11).text_color(t.blocked).truncate().tooltip(detail).child(detail)));
  }

  render() {
    if (this.state.kind === "idle") return div().id("compact-worktree-removal").track_focus(this.handle);
    const t = colors();
    return v_flex().id("compact-worktree-removal").w(360).px(10).py(5).text_size(12).text_color(t.foreground)
      .track_focus(this.handle)
      .on_key_down((event, cx) => {
        if (event.key === "escape") this.dismiss(cx);
        else if (event.key === "enter") this.confirm(cx);
        else return;
        cx.stop_propagation();
      })
      .child(this.content(t));
  }
}
