import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, exec, appHome } from "herdr";
import { parseUsage, resetLabel } from "./model.js";

export default class MinimalistCompactProviderUsage extends View {
  init(_props, cx) {
    this.rows = [];
    this.width = 320;
    this.refresh(cx);
    cx.timer.every(300000, (cx) => this.refresh(cx));
  }

  refresh(cx) {
    if (this.busy) return;
    this.busy = true;
    cx.spawn(async (cx) => {
      try {
        const result = await exec("python3", [`${appHome()}/mods/minimalist-compact-provider-usage/usage.py`]);
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
    return h_flex().h(19).gap(7).items_center().text_size(11.5).text_color(t.dim)
      .tooltip(`${window.used}% used${reset ? `; resets in ${reset}` : ""}`)
      .child(div().w(18).flex_none().child(window.label))
      .child(div().flex_1().h(3).rounded_full().bg(t.border)
        .child(div().w(`${window.used}%`).h(3).rounded_full().bg(color)))
      .child(div().w(31).flex_none().text_right().text_color(t.muted).child(`${Math.round(window.used)}%`))
      .child(div().w(24).flex_none().text_right().child(reset));
  }

  provider(row, t) {
    const name = row.provider === "openai" ? "Codex" : "Claude";
    return v_flex().gap(2)
      .child(h_flex().gap(7).items_center().text_size(12.5).text_color(t.muted)
        .child(svg(`mods/minimalist-compact-workspaces/${row.provider}.svg`).size(13).flex_none())
        .child(name))
      .when(row.state === "ready", (el) => el.children(row.windows.map((window) => this.meter(window, t))))
      .when(row.state !== "ready", (el) => el.child(div().pl(20).text_size(11.5).text_color(t.dim).child(row.message)));
  }

  render() {
    const t = theme();
    if (this.width < 160) return div().id("usage-rail").size_full()
      .on_size_change((size, cx) => { this.width = size.width; cx.notify(); });
    return v_flex().id("minimalist-compact-provider-usage").size_full().px(16).pt(8).pb(12).gap(8).bg(t.chrome)
      .border_t(1).border_color(t.border)
      .on_size_change((size, cx) => { this.width = size.width; cx.notify(); })
      .child(h_flex().justify_between().items_center().text_size(11.5).text_color(t.dim)
        .child("Subscription usage")
        .child(div().id("usage-refresh").tooltip("Refresh cached usage (provider checks every 5 minutes)")
          .on_click((_e, cx) => this.refresh(cx)).child(this.busy ? "Checking…" : "% used")))
      .children(this.rows.map((row) => this.provider(row, t)))
      .when(Boolean(this.error), (el) => el.child(div().text_size(12).text_color(t.dim).child(this.error)));
  }
}
