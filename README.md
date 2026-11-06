# herdr-setup

A compact [Herdr](https://herdr.dev) layout and reusable mods.

## Layout: minimalist-compact

Compact workspaces/worktrees, inline branches, agent session dots, subscription usage and screenshot mode.

![minimalist-compact with sample sidebar names](minimalist-compact/preview.png)

Ask your agent:

```text
Read ~/.config/herdr-app/AGENTS.md, then add this layout: https://github.com/Torbraw/herdr-setup/tree/main/minimalist-compact
```

The [`minimalist-compact/`](minimalist-compact/) folder is self-contained: its layout, all six mods, recipe and previews. See its [installation instructions](minimalist-compact/README.md).

The optional [OpenCode bridge](https://github.com/Torbraw/opencode-herdr-app-bridge) adds individual OpenCode tabs and model details. Native agent rows work without it.

## Mod: provider usage

Codex and Claude subscription meters, using existing local logins. Install it without the layout:

```text
Read ~/.config/herdr-app/AGENTS.md, then add this mod: https://github.com/Torbraw/herdr-setup/tree/main/herdr-mods/provider-usage
```

![Provider usage in the Herdr sidebar](herdr-mods/provider-usage/preview.png)

Copy only [`herdr-mods/provider-usage/mods/provider-usage/`](herdr-mods/provider-usage/mods/provider-usage/) to `${HERDR_APP_HOME:-~/.config/herdr-app}/mods/provider-usage/`, then check it:

```sh
herdr-app check "${HERDR_APP_HOME:-$HOME/.config/herdr-app}/mods/provider-usage"
herdr-app do pane.split '{"direction":"down","mod":"provider-usage"}'
```

Both the standalone mod and layout use the name `provider-usage`. If already installed with the layout, use that copy; review changes before overwriting. See the mod's [README](herdr-mods/provider-usage/README.md) and [recipe](herdr-mods/provider-usage/RECIPE.md) for details. No layout or OpenCode plugin is required.

Usage invokes Python 3, reads provider credentials locally, and contacts OpenAI/Anthropic usage endpoints every five minutes at most. It never refreshes or rewrites logins. See its [recipe](herdr-mods/provider-usage/RECIPE.md) for paths, privacy and limits.

## Development

`herdr-mods/provider-usage/mods/provider-usage/` is the authoritative usage source. Its docs, preview and tests live alongside the outer `mods/` directory. Edit source, then explicitly update the layout's bundled copy:

```sh
node scripts/sync-provider-usage.mjs
node --test minimalist-compact/mods/minimalist-compact-workspaces/*.test.mjs herdr-mods/provider-usage/tests/*.test.mjs
python3 -m unittest discover -s herdr-mods/provider-usage/tests -p 'test_*.py'
```

The script copies regular `.js`, `.mjs`, `.py`, `.svg` files and `mod.json` from the inner runtime directory to `minimalist-compact/mods/provider-usage/`, overwriting matching files. Tests and docs live outside that source directory; hidden files, generated typings, caches and symlinks are skipped. It never deletes destination files: remove obsolete files from both copies yourself. Nothing runs in the background, installs files, commits or pushes. Review the diff after syncing.

Other layout mods are maintained directly under `minimalist-compact/mods/`. See [AGENTS.md](AGENTS.md) for the maintenance workflow.

## Discovery

`minimalist-compact/` and `herdr-mods/provider-usage/` each contain a recipe, preview and installable source tree, matching Herdr's documented bundle format. The repository's `herdr-layout` topic enables layout discovery; add `herdr-mod` when publishing the standalone bundle. Indexing and preview screening are handled by Herdr.
