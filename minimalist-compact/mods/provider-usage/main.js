import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, exec, appHome, nextCommand } from "herdr";
import { parseUsage, resetLabel } from "./model.js";

export default class ProviderUsage extends View {
  init(_props, cx) {
    this.rows = [];
    this.width = 320;
    this.refresh(cx);
    cx.timer.every(300000, (cx) => this.refresh(cx));
    cx.spawn(async (cx) => {
      for (;;) {
        if (await nextCommand() === "refresh") this.refresh(cx, true);
      }
    });
  }

  refresh(cx, fresh = false) {
    if (this.busy) return;
    this.busy = true;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const args = [`${appHome()}/mods/provider-usage/usage.py`];
        if (fresh) args.push("--refresh");
        const result = await exec("python3", args);
        if (result.code !== 0) throw new Error("Usage unavailable");
        const data = parseUsage(JSON.parse(result.stdout));
        if (!data) throw new Error("Invalid usage response");
        this.rows = data.providers;
        this.updated = data.updated;
        this.error = null;
      } catch { this.error = "Usage unavailable"; }
      this.busy = false;
      cx.notify();
    });
  }

  meter(window, t) {
    const color = window.used >= 90 ? t.blocked : t.muted;
    const reset = resetLabel(window.reset);
    return h_flex().h(17).gap(5).items_center().text_size(11.5).text_color(t.dim)
      .tooltip(`${window.used}% used${reset ? `; resets in ${reset}` : ""}`)
      .child(div().w(18).flex_none().child(window.label))
      .child(div().flex_1().h(3).rounded_full().bg(t.border)
        .child(div().w(`${window.used}%`).h(3).rounded_full().bg(color)))
      .child(div().w(31).flex_none().text_right().text_color(t.muted).child(`${Math.round(window.used)}%`))
      .child(div().w(24).flex_none().text_right().child(reset));
  }

  provider(row, t) {
    const name = row.provider === "openai" ? "Codex" : "Claude";
    return h_flex().gap(8).items_start()
      .child(h_flex().w(64).h(17).flex_none().gap(6).items_center().text_size(12.5).text_color(t.muted)
        .child(svg(`mods/provider-usage/${row.provider}.svg`).size(13).flex_none())
        .child(name))
      .when(row.state === "ready", (el) => el.child(v_flex().flex_1().min_w(0).children(row.windows.map((window) => this.meter(window, t)))))
      .when(row.state !== "ready", (el) => el.child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).tooltip(row.message).child(row.message)));
  }

  render() {
    const t = theme();
    if (this.width < 160) return div().id("usage-rail").size_full()
      .on_size_change((size, cx) => { this.width = size.width; cx.notify(); });
    return v_flex().id("provider-usage").size_full().px(16).pt(6).pb(8).gap(6).bg(t.chrome)
      .border_t(1).border_color(t.border)
      .on_size_change((size, cx) => { this.width = size.width; cx.notify(); })
      .child(h_flex().justify_between().items_center().text_size(11.5).text_color(t.dim)
        .child("Subscription usage")
        .child(this.busy ? "Checking…" : "% used"))
      .children(this.rows.map((row) => this.provider(row, t)))
      .when(Boolean(this.error), (el) => el.child(div().text_size(12).text_color(t.dim).child(this.error)));
  }
}
