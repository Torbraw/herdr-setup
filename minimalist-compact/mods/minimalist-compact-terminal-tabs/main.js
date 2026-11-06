import { View, div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, panes, terminals, run, openOverlay, theme, window, shared, layout, settings } from "herdr";

function liveAgents() {
  return new Set(terminals().filter(t => t.state === "live" &&
    /(?:^|[\\/\s])(?:opencode|claude|codex|pi|cursor-agent|aider|gemini)(?:\.exe)?(?:$|\s)/.test(
      [t.foreground?.name, ...(t.foreground?.argv ?? []).slice(0, 2)].join(" "))).map(t => t.address));
}

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

function lightsPadding(root, sidebar, w) {
  if (w?.platform !== "macos" || w.titlebar !== "none" || w.fullscreen || !root?.traffic_lights) return 10;
  return Math.max(10, (root.traffic_lights[0] + 64) / settings().zoom - sidebarWidth(sidebar));
}

function sidebarWidth(sidebar) {
  return sidebar?.hidden ? 0 : sidebar?.size?.px ?? 0;
}

function tabProgram(tab, currentPanes, live) {
  const activeAgents = currentPanes.filter(p => p.tab === tab.id && live.has(p.terminal));
  const lead = currentPanes.find(p => p.tab === tab.id);
  return { program: activeAgents[0]?.program ?? (lead?.program?.agent ? null : lead?.program),
    status: activeAgents.map(p => p.status) };
}

function tabName(tab, program) {
  return /^tb\d+$/.test(tab.name) ? program?.name ?? "Terminal" : tab.name;
}

export default class MinimalistCompactTerminalTabs extends View {
  init() {
    this.pressed = null;
    this.panels = JSON.parse(localStorage.getItem("panels") ?? "{}");
    // Old saved rails become fully hidden; opening always restores a usable width.
    const sidebar = find(layout(), "sidebar");
    if ((sidebar?.size?.px ?? 330) < 160) {
      run("layout.resize", { id: "sidebar", px: 330 });
      run("layout.hide", { id: "sidebar" });
    }
  }

  // The side panel is remembered per space: switching shows that space's choice
  // (closed if it never had one), and opening or closing it records it.
  syncPanel(space, panel, body, enabled) {
    if (!space || !panel) return;
    const now = panel.hidden ? null : body?.active ?? null;
    if (space.id !== this.space && this.restorePanel(space.id, now, enabled)) return;
    if (this.waitingForPanel(now)) return;
    if (this.panels[space.id] === now) return;
    this.panels[space.id] = now;
    localStorage.setItem("panels", JSON.stringify(this.panels));
  }

  restorePanel(id, now, enabled) {
    const first = this.space === undefined;
    this.space = id; this.pending = null;
    if (first && !(id in this.panels)) return false;
    const stored = this.panels[id] ?? null, want = enabled.includes(stored) ? stored : null;
    if (want === now) return false;
    this.pending = { want, until: Date.now() + 1000 };
    if (want) { run("layout.select", { stack: "panel-body", child: want }); run("layout.show", { id: "panel" }); }
    else run("layout.hide", { id: "panel" });
    return true;
  }

  // Until the restore lands (or something else won), the old state isn't a choice.
  waitingForPanel(now) {
    if (!this.pending) return false;
    if (this.pending.want !== now && Date.now() < this.pending.until) return true;
    this.pending = null;
    return false;
  }

  tabItem(c, i, space, currentPanes, live, t) {
    const shown = space.tabs;
    const stop = (_e, cx) => cx.stop_propagation();
    const { program, status } = tabProgram(c, currentPanes, live);
    const working = status.includes("working"), blocked = status.includes("blocked"), done = status.includes("done");
    const name = tabName(c, program);
    return h_flex().id(`tab-${c.id}`).h(29).px(10).gap(7).rounded(7).items_center().flex_none().text_size(12.8)
      .border(1).border_color(c.active ? t.border : t.chrome).bg(c.active ? t.raised : t.chrome).text_color(c.active ? t.foreground : t.muted)
      .hover(s => s.bg(t.hover))
      .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.pressed = i; })
      .on_mouse_up("left", () => {
        const from = this.pressed; this.pressed = null;
        if (from !== null && from !== i) run("tab.move", { id: shown[from].id, index: space.tabs.findIndex(x => x.id === c.id) + 1 });
        else run("tab.select", { id: c.id });
      })
      .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "minimalist-compact-menu", kind: "popup", width: 200, props: { tab: "tab", target: { id: c.id } } }); })
      .when(Boolean(program?.icon), el => el.child(program.tint ? svg(program.icon).size(14).text_color(t.muted) : image(program.icon).size(14)))
      .child(div().max_w(170).truncate().child(c.zoomed ? `${name} Z` : name))
      .when(working, el => el.child(div().size(7).flex_none().rounded_full().bg(t.working)))
      .when(blocked || done, el => el.child(div().size(6).rounded(3).bg(blocked ? t.blocked : t.done)))
      .when(c.active, el => el.child(div().id(`close-${c.id}`).text_color(t.dim).on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); run("tab.close", { id: c.id }); }).child(svg("mods/pane/close.svg").size(12))));
  }

  panelButton(id, label, icon, panel, body, t) {
    const stop = (_e, cx) => cx.stop_propagation();
    const on = panel && !panel.hidden && body?.active === id;
    return h_flex().id(`panel-${id}`).h(26).px(8).gap(5).flex_none().items_center().rounded(6)
      .text_size(12).bg(on ? t.selected : t.chrome).text_color(on ? t.foreground : t.muted)
      .hover(s => s.bg(t.hover)).on_mouse_down("left", stop)
      .on_click(() => {
        if (on) run("layout.hide", { id: "panel" });
        else { run("layout.select", { stack: "panel-body", child: id }); run("layout.show", { id: "panel" }); }
      }).child(svg(icon).size(14)).child(label);
  }

  windowButtons(w, button) {
    if (!w?.buttons) return [];
    return [button("minimize", w.platform === "windows" ? svg("mods/minimalist-compact-terminal-tabs/win-min.svg").size(16) : "−", () => run("window.minimize")),
      button("maximize", w.platform === "windows" ? svg(`mods/minimalist-compact-terminal-tabs/${w.maximized ? "win-restore" : "win-max"}.svg`).size(16) : "□", () => run("window.maximize")),
      button("close-window", w.platform === "windows" ? svg("mods/minimalist-compact-terminal-tabs/win-close.svg").size(16) : svg("mods/pane/close.svg").size(13), () => run("window.close"))];
  }

  render() {
    const t = theme(), space = spaces().find(p => p.active);
    const live = liveAgents(), currentPanes = panes(), shown = space?.tabs ?? [];
    const root = layout(), sidebar = find(root, "sidebar"), w = window();
    const panel = find(root, "panel"), body = find(root, "panel-body");
    const enabled = shared("workspace.panels") ?? ["files", "changes"];
    this.syncPanel(space, panel, body, enabled);
    const button = (id, label, action) => div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click(action).child(label);
    return h_flex().size_full().min_w(0).px(10).pl(lightsPadding(root, sidebar, w)).gap(3).items_center().bg(t.chrome).border_b(1).border_color(t.border)
      .on_mouse_up("left", () => { this.pressed = null; })
      .on_scroll_wheel(e => { if (Math.abs(e.delta.y) >= 1) run(e.delta.y > 0 ? "tab.prev" : "tab.next"); })
      .when(sidebar?.hidden, el => el.child(button("sidebar-show", svg("mods/minimalist-compact-workspace-chrome/sidebar.svg").size(15), () => run("layout.show", { id: "sidebar" })).tooltip("Show sidebar")))
      .child(h_flex().id("tab-scroll").flex_1().min_w(0).h_full().items_center().gap(3).overflow_x_scrollbar().children(shown.map((tab, i) => this.tabItem(tab, i, space, currentPanes, live, t))))
      .child(button("tab-new", "+", () => openOverlay({ mod: "new-menu", kind: "popup", width: 250, height: 512 })))
      .when(enabled.includes("files"), el => el.child(this.panelButton("files", "Files", "mods/files/file.svg", panel, body, t)))
      .when(enabled.includes("changes"), el => el.child(this.panelButton("changes", "Changes", "mods/changes/changes.svg", panel, body, t)))
      .children(this.windowButtons(w, button));
  }
}
