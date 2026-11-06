# herdr-setup

A compact [Herdr](https://herdr.dev) layout and reusable mods.

## Layout

**[minimalist-compact](minimalist-compact/RECIPE.md)** — Compact workspaces/worktrees, inline branches, agent session dots, subscription usage and screenshot mode. Self-contained with all six mods.

![minimalist-compact with sample sidebar names](minimalist-compact/preview.png)

The optional [OpenCode bridge](https://github.com/Torbraw/opencode-herdr-app-bridge) adds individual OpenCode tabs and model details. Native agent rows work without it.

## Mods

- **[provider-usage](herdr-mods/provider-usage/RECIPE.md)** — Codex and Claude subscription meters using existing local logins. Works independently or bundled with minimalist-compact.

See each folder's `RECIPE.md` for setup, behavior and privacy details.

![Provider usage in the Herdr sidebar](herdr-mods/provider-usage/preview.png)

## Local development

Edit shared usage code in `herdr-mods/provider-usage/mods/provider-usage/`; layout-only mods live under `minimalist-compact/mods/`.

```sh
node scripts/sync-provider-usage.mjs
node --test minimalist-compact/mods/minimalist-compact-workspaces/*.test.mjs herdr-mods/provider-usage/tests/*.test.mjs
python3 -m unittest discover -s herdr-mods/provider-usage/tests -p 'test_*.py'
```

The sync script manually copies usage runtime files into the layout bundle. It leaves docs/tests/previews out, never deletes, installs or publishes anything. Review the diff; remove retired files from both copies explicitly.

See [AGENTS.md](AGENTS.md) for the maintenance workflow.
