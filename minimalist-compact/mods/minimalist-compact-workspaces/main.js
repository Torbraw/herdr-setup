import { div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { agents, terminals, panes, spaces, theme, run, openOverlay, setAgentOrder, shared, setShared, nextCommand } from "herdr";
import Spaces from "./spaces-base.js";
import { frontend, providerFamily, sessionStatus } from "./model.js";
import { OpenCodeBridge } from "./opencode-bridge.js";
import { ScreenshotNames, screenshotMode } from "./screenshot.js";

const HARNESS = { opencode: "OpenCode", claude: "Claude Code", codex: "Codex", pi: "Pi" };
const STATUS = { working: "Working", blocked: "Waiting for input", done: "Done", idle: "Idle" };
const cleanTitle = (title) => title.replace(/^OC\s*\|\s*/, "").replace(/^[^\p{L}\p{N}]+/u, "").trim();

function stateColor(status, t) {
  if (status === "blocked") return t.ansi1;
  if (status === "done") return t.ansi4;
  return t[status] ?? t.dim;
}

function stateIcon(status, t, size = 11) {
  if (status === "working") return div().size(size - 3).mx(2).flex_none().rounded_full().bg(t.working);
  return div().size(6).mx(2).flex_none().rounded_full()
    .bg(status === "idle" ? t.chrome : stateColor(status, t))
    .border(1).border_color(stateColor(status, t));
}

export default class MinimalistCompactWorkspaces extends Spaces {
  init(props, cx) {
    super.init(props, cx);
    this.bridge = new OpenCodeBridge();
    this.bridge.start(cx);
    this.screenshot = false;
    this.previewNames = new ScreenshotNames();
    cx.spawn(async (cx) => {
      for (;;) {
        this.screenshot = screenshotMode(await nextCommand(), this.screenshot);
        cx.notify();
      }
    });
  }

  sessionRows(space) {
    return space.tabs.flatMap((tab) => this.tabRows(tab));
  }

  tabRows(tab) {
    const ps = this.panesByTab.get(tab.id) ?? [];
    return ps.flatMap((pane) => this.paneRows(pane, tab));
  }

  paneRows(pane, tab) {
    const live = this.frontends.get(pane.terminal);
    if (!live) return [];
    const value = this.bridge.get(live);
    if (value) return value.sessions.map((session) => ({ ...session, kind: "session", address: live.address,
      status: sessionStatus(session, this.agentsByAddress.get(live.address)?.status),
      harness: live.harness, tab, focused: pane.focused && session.active,
      target: { type: "session", pid: live.pid, sessionID: session.id } }));
    return this.nativeRow(pane, tab, live);
  }

  nativeRow(pane, tab, live) {
    const agent = this.agentsByAddress.get(live.address);
    return [{ kind: "session", id: live.address, address: live.address, pid: live.pid, harness: live.harness,
      title: cleanTitle(agent?.title ?? "") || HARNESS[live.harness] || live.harness,
      status: agent?.status ?? "idle", provider: live.harness, model: null,
      focused: pane.focused, tab, target: { type: "terminal" } }];
  }

  openSession(row, cx) {
    run("pane.focus", { terminal: row.address });
    if (row.target.type === "session") this.bridge.focus(row.target, cx);
  }

  action(id, icon, tooltip, action) {
    const t = theme();
    return div().id(id).size(23).flex_none().flex().items_center().justify_center().rounded(4)
      .text_color(t.dim).hover((el) => el.bg(t.hover).text_color(t.foreground)).tooltip(tooltip)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((e, cx) => { cx.stop_propagation(); action(e, cx); })
      .child(svg(`mods/workspace-chrome/${icon}.svg`).size(12));
  }

  labels({ w, g, tree }) {
    return this.previewNames.workspace({ id: w.id, name: w.name, folder: w.folder,
      branch: g?.branch ?? w.branch, worktree: Boolean(tree) }, this.screenshot);
  }

  spaceHeader(entry, t) {
    const { w, tree } = entry;
    const { name, branch, folder } = this.labels(entry);
    return h_flex().id(`workspace-${w.id}`).h(24).px(5).gap(6).items_center().rounded(4)
      .when(w.active, (el) => el.bg(t.selected)).hover((el) => el.bg(t.hover))
      .on_click(() => run("space.select", { id: w.id })).on_mouse_down("right", () => this.menu(w))
      .child(svg(`mods/workspace-chrome/${tree ? "branch" : "folder"}.svg`).size(12).flex_none().text_color(t.muted))
      .child(div().max_w(150).min_w(0).truncate().font_semibold().text_size(13).text_color(t.foreground)
        .tooltip([folder, branch ? `Branch: ${branch}` : ""].filter(Boolean).join("\n")).child(name))
      .when(Boolean(branch) && branch !== name, (el) => el.child(
        h_flex().flex_1().min_w(0).gap(4).items_center().text_color(t.dim).tooltip(`Branch: ${branch}`)
          .child(svg("mods/workspace-chrome/git-branch.svg").size(10).flex_none())
          .child(div().min_w(0).truncate().text_size(11.5).child(branch))));
  }

  sessionRow(row, indent, t) {
    const title = this.screenshot ? this.previewNames.name("session", `${row.address}:${row.id}`) : row.title;
    const family = providerFamily(row.provider, row.model);
    const harness = HARNESS[row.harness] ?? row.harness;
    const detail = [harness, row.model, STATUS[row.status]].filter(Boolean).join(" / ");
    return h_flex().id(`session-${row.address}-${row.id}`).h(32).pl(indent + 6).pr(4.5).gap(4).items_center().rounded(4)
      .when(row.focused, (el) => el.bg(t.raised)).hover((el) => el.bg(t.hover))
      .tooltip(`${title}\n${detail}`).on_click((_e, cx) => this.openSession(row, cx))
      .on_mouse_down("right", () => openOverlay({ mod: "minimalist-compact-menu", kind: "popup", width: 200,
        props: { tab: "tab", target: { id: row.tab.id } } }))
      .child(div().w(12).flex_none().child(stateIcon(row.status, t)))
      .child(v_flex().flex_1().min_w(0).gap(0)
        .child(div().h(16).min_w(0).truncate().text_size(13).text_color(row.focused ? t.foreground : t.muted).child(title))
        .child(h_flex().h(14).gap(4).items_center().text_size(11).text_color(t.muted)
          .child(svg(`icons/${row.harness === "cursor-agent" ? "cursor" : row.harness}.svg`).size(10).flex_none())
          .child(div().flex_none().child(harness))
          .when(Boolean(family), (el) => el.child(svg(`mods/minimalist-compact-workspaces/${family}.svg`).size(10).ml(2).flex_none().tooltip(family === "openai" ? "OpenAI model" : "Anthropic model")))
          .when(Boolean(row.model), (el) => el.child(div().min_w(0).truncate().child(row.model)))));
  }

  row(entry, t) {
    const rows = this.rowsBySpace.get(entry.w.id) ?? [];
    const indent = entry.tree ? 8 : 0;
    return v_flex().id(`workspace-group-${entry.w.id}`).flex_none().pl(indent)
      .child(this.spaceHeader(entry, t))
      .children(rows.map((row) => this.sessionRow(row, 0, t)))
      .child(div().h(1).flex_none().mx(5).my(3).bg(t.border));
  }

  render(cx) {
    const t = theme();
    this.frontends = new Map(terminals().map(frontend).filter(Boolean).map((item) => [item.address, item]));
    this.bridge.update(this.frontends, cx);
    this.panesByTab = new Map();
    for (const pane of panes()) {
      const group = this.panesByTab.get(pane.tab) ?? [];
      group.push(pane);
      this.panesByTab.set(pane.tab, group);
    }
    this.agentsByAddress = new Map(agents().map((agent) => [agent.address, agent]));
    this.rowsBySpace = new Map(spaces().map((space) => [space.id, this.sessionRows(space)]));
    const sessions = [...this.rowsBySpace.values()].flat();
    const order = [...new Set(sessions.map((row) => row.address))];
    const orderSignature = JSON.stringify(order);
    if (orderSignature !== this.orderSignature) { this.orderSignature = orderSignature; setAgentOrder(order); }
    const counts = { sessions: sessions.length, working: sessions.filter((row) => row.status === "working").length };
    const serialized = JSON.stringify(counts);
    if (shared("minimalist-compact.sessions") !== serialized) setShared("minimalist-compact.sessions", serialized);
    return v_flex().id("minimalist-compact-workspaces").size_full().min_h(0).bg(t.chrome)
      .child(h_flex().h(36).flex_none().pl(16).pr(9).gap(6).items_center()
        .child(div().flex_1().text_size(12.5).text_color(t.muted).child("Workspaces"))
        .child(div().text_size(11.5).text_color(t.dim).child(`${counts.working} working`))
        .child(this.action("workspace-add", "plus", "New space", () => run("space.new"))))
      .child(v_flex().id("workspace-scroll").flex_1().min_h(0).px(8)
        .overflow_y_scrollbar().children(this.grouped(t, false)));
  }
}
