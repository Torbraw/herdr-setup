// Layout-only workspace/tab menus. Shipped terminal menus remain untouched.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { run, props, closeOverlay, openOverlay, theme, spaces, panes, exec, keys } from "herdr";
import { menuTarget, menuItems } from "./model.js";

function place(space) {
  const tabs = new Set(space.tabs.map((tab) => tab.id));
  return panes().find((pane) => tabs.has(pane.tab) && pane.cwd)?.cwd || space.folder;
}

async function checkout(folder, on) {
  const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd: folder, on });
  const common = await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: folder, on });
  if (top.code !== 0 || common.code !== 0) return null;
  return common.stdout.trim() === `${top.stdout.trim()}/.git` ? "main" : "linked";
}

function shortcut(item) {
  if (item.kind !== "command") return "";
  const binding = keys().find((binding) => binding.section === "global" && binding.action === item.command);
  return binding?.keys ?? "";
}

export default class MinimalistCompactMenu extends View {
  init(_props, cx) {
    this.at = 0;
    this.git = null;
    this.target = menuTarget(props(), spaces());
    this.handle = cx.focus_handle();
    this.handle.focus();
    const target = this.target;
    const space = target?.kind === "space" && spaces().find((space) => space.id === target.id);
    const folder = space && place(space);
    if (folder) cx.spawn(async (cx) => {
      this.git = await checkout(folder, space.machine).catch(() => null);
      cx.notify();
    });
  }

  choose(index) {
    const item = menuItems(this.target, this.git)[index];
    if (!item) return;
    closeOverlay(props()?.overlay);
    if (item.kind === "command") run(item.command, item.args);
    else openOverlay({ mod: "worktree", kind: "dialog",
      ...(item.action === "open" ? { width: 560, height: 480 } : { width: 440, height: 260 }),
      props: { space: item.space, action: item.action } });
  }

  key(e, cx, count) {
    if (e.key === "escape") closeOverlay(props()?.overlay);
    else if (!count) return;
    else if (e.key === "down") this.at = (this.at + 1) % count;
    else if (e.key === "up") this.at = (this.at + count - 1) % count;
    else if (e.key === "enter") this.choose(this.at);
    else return;
    cx.notify();
  }

  render() {
    const t = theme();
    const list = menuItems(this.target, this.git);
    return v_flex().id("minimalist-compact-menu").track_focus(this.handle).w_full().min_h(0).p(5).bg(t.popover).text_size(12.8)
      .on_key_down((e, cx) => this.key(e, cx, list.length))
      .children(list.map((item, index) => v_flex()
        .when(index > 0 && item.icon === "x", (el) => el.child(div().mx(7).my(4).h(1).bg(t.border)))
        .child(h_flex().id(`mi-${index}`).h(31).px(8).gap(9).rounded(7).items_center()
          .text_color(t.foreground).when(index === this.at, (el) => el.bg(t.selected)).hover((el) => el.bg(t.hover))
          .on_click(() => this.choose(index))
          .child(svg(`mods/workspace-chrome/${item.icon}.svg`).size(14).flex_none().text_color(t.muted))
          .child(div().flex_1().child(item.label))
          .child(div().text_size(11).text_color(t.dim).child(shortcut(item))))));
  }
}
