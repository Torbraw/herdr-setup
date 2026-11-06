# minimalist-compact

A compact coding workspace for Herdr: worktrees grouped under repositories, OpenCode sessions immediately visible, and small usage meters above Settings.

![minimalist-compact with sample sidebar names](preview.png)

## What you see

- A fixed 330px sidebar: Herdr brand/search/sidebar controls, Workspaces heading with working count and add-space control, a scrolling tree, subscription usage, then Settings/Add machine.
- Workspace headers are 24px tall, use folder icons, and place muted branch names directly beside names. Worktrees use branch icons and an 8px indent. A branch identical to the workspace name is not repeated. Long labels truncate with full tooltips.
- Groups are always expanded; thin theme-border separators divide them. Session rows are 32px tall: title on the first line, harness icon/name plus provider icon and model on the second. Session title text is 13px and metadata is 11px. Workspaces also use 13px labels; branches use 11.5px.
- Only session rows carry activity dots. No workspace/worktree aggregate dots, status labels, new-session buttons or session-close buttons.
- The 148px usage block stacks Codex and Claude windows with percentage bars and reset estimates. It has 8px top padding, 12px bottom padding and 8px section gaps. It stays above the 69px footer.
- The main area has a 42px terminal tab bar, 26px pane headers and a 28px status bar. Pane borders and terminal/outer content padding are zero; splits have 5px gaps and 6px corners. Optional Files/Changes panels sit to the right.
- Colors follow Herdr's theme: chrome/canvas/background surfaces, muted metadata, selected/raised highlights and border separators. Terminal font/zoom remain the person's preferences; this layout sets sidebar text sizes explicitly.

## How it behaves

- Working: static theme-working dot. Waiting for input/blocked: red (`ansi1`). Done/unread: blue (`ansi4`). Idle: hollow subdued dot. Status text is available in tooltips only on session rows.
- An agent finishing while unseen uses Herdr's native unread completion for the active OpenCode tab when plugin metadata reports idle; viewing it lets Herdr clear completion. Background OpenCode tabs retain their own status.
- Clicking a workspace selects its space; right-click opens the normal space menu. Clicking a session focuses its terminal and, with the companion plugin, its specific OpenCode tab. Session right-click opens the containing Herdr tab's menu.
- Worktrees are grouped under their main checkout via Git metadata. Names/branches follow live folders; ordinary shell panes are omitted from session rows. Agent cycling follows the displayed session order.
- OpenCode tab closing uses OpenCode itself: Ctrl+X then W with its default bindings. This layout does not override keys.
- The usage heading can refresh cached data; provider network requests are cached for five minutes. Missing logins or errors show concise unavailable messages.
- Pane and terminal-tab controls use native Herdr commands. The sidebar can become a narrow rail through the brand control; individual workspace groups never collapse.
- Screenshot mode (`minimalist-compact-workspaces.screenshot-on`, `screenshot-off`, `screenshot-toggle`) substitutes sidebar labels and their tooltips with stable sample names. It preserves real IDs, actions, grouping, status and models, and resets on reload. Use a blank OpenCode tab for the capture; terminal content and other panels remain live.

## Built from

The root is a sidebar/work row. The sidebar contains brand, scrolling workspaces, usage and footer. Work contains terminal tabs, the active-tab pane block plus optional Files/Changes stack, and status.

Six custom mods:

- `minimalist-compact-workspace-chrome`: brand and footer, selected by `props.footer`.
- `minimalist-compact-workspaces`: foreground-filtered agent sessions, grouped spaces/worktrees, inline branches, optional bridge reader.
- `provider-usage`: shared provider bars and Python usage reader, also installable independently.
- `minimalist-compact-terminal-tabs`: native Herdr tabs, panel controls and window controls.
- `minimalist-compact-pane-header`: pane titles, folders and split/zoom/close controls using `props.pane`.
- `minimalist-compact-session-status`: native workspace/branch summary and custom session/working counts.

The mods use gpui-kit/gpui-base and Herdr's live `spaces`, `panes`, `agents`, `terminals`, `theme`, `shared`, `run`, overlays, `exec`, `hc`, file APIs and folder watchers. The inherited spaces implementation handles Git grouping and remote machines. Only foreground coding-agent processes qualify, so stale OSC state cannot resurrect exited agents.

Shipped dependencies remain Herdr's: Files, Changes, menus, worktree picker, settings, new-menu, program icons and workspace-chrome SVG assets. The cloned chrome includes its own asset copies. Provider artwork comes from Simple Icons and OpenAI's official brand assets; see [THIRD_PARTY.md](THIRD_PARTY.md) for sources.

The optional `herdr-app-bridge` OpenCode V2 plugin is a separate repository. It publishes version-1 PID/terminal-matched JSON snapshots and watches focus-request mailboxes in `data/herdr-app-bridge`. Reactive, coalesced writes avoid heartbeat polling. Herdr watches that directory; only failed watches use a 30-second fallback.

## Watch out

- Tested primarily on Linux with the Herdr 0.1.13 API. Keep shipped Herdr files intact; edit the custom mods. Modern Herdr supplies the runtime, program icons and built-in dialogs.
- The layout must work without the OpenCode plugin. Native agent rows remain available, though individual OpenCode tabs/models require the plugin. The file bridge is local-machine only.
- Git/`hc` execution, Python execution and usage network access are real functionality. Explain them before installing for another person. Usage reads provider credentials locally; publish only source files, never logins, databases, caches or bridge snapshots.
- Provider usage endpoints, credential formats and OpenCode plugin APIs can change. A missing usage window is omitted, never replaced by fabricated data. Keep the meter block tall enough if providers add windows or typography changes.
- Static dots are intentional: continuous spinner animation caused high CPU with software rendering. Preserve deduplicated metadata publication and event-driven updates.

## Done when

1. All six `herdr-app check` commands pass and `herdr-app status` reports no errors after switching layouts.
2. Live agents appear under their workspace/worktree; shells and exited OpenCode frontends do not. Groups stay expanded with compact headers and separators.
3. With the plugin, multiple OpenCode tabs and models appear and session clicks focus the correct tab. With it disabled, native agent rows still work.
4. Working, blocked, unread done and idle render as distinct session dots, with no duplicate workspace status or inline status labels.
5. Usage bars/reset values or honest unavailable messages appear above Settings, without large blank spacing. Sidebar labels are legible at normal zoom.
6. Idle bridge metadata does not rewrite snapshots. Model/parser/publisher tests pass; the running layout is visually checked after style changes.
