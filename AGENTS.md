# Maintenance

## Ownership

- `minimalist-compact/` is the complete layout bundle. Keep its recipe, preview, attribution and licenses here.
- `herdr-mods/provider-usage/` is the standalone usage bundle: recipe, preview, attribution, README and `tests/`. Runtime source lives in its `mods/provider-usage/`. Future standalone bundles get sibling folders under `herdr-mods/`.
- Root files cover shared navigation and maintenance only. Install/copy only inner runtime folders; keep standalone docs and tests outside them. Layout bundles carry real source copies, not symlinks.
- Shared mod names stay the same standalone and bundled: `provider-usage` lives at `herdr-mods/provider-usage/mods/provider-usage/` and `minimalist-compact/mods/provider-usage/`. Reserve the `minimalist-compact-` prefix for layout-only mods. Preserve helper paths, SVG paths, cache names and layout references when renaming.

## Updating code

1. Edit provider usage in `herdr-mods/provider-usage/mods/provider-usage/`, then run `node scripts/sync-provider-usage.mjs`. It overwrites runtime source copies in the layout bundle, leaves bundle docs/tests/previews outside the copy and never deletes. Remove retired files from both copies explicitly; review `git diff`.
2. Edit other layout mods directly in `minimalist-compact/mods/`.
   For authorized live testing, `node scripts/dev.mjs` syncs repo → bundle → installed runtime and watches; `--once` applies once. Read root README's local-development section before running either. Keep edits repo-first; stop on installed conflicts and preserve local changes before resolving.
3. Update each affected package's recipe, installation instructions and attribution when behavior, paths or artwork change. Refresh previews deliberately; use fictional sidebar labels and check for private terminal content.
4. Run behavioral tests from the root:

   ```sh
    node --test tests/*.test.mjs minimalist-compact/mods/minimalist-compact-workspaces/*.test.mjs herdr-mods/provider-usage/tests/*.test.mjs
    python3 -m unittest discover -s herdr-mods/provider-usage/tests -p 'test_*.py'
   ```

5. Run `herdr-app check <mod-folder>` for changed mods, including the bundled usage copy when usage changes. When changing visuals, check the actual app render after an explicitly authorized install. Read the installed Herdr `AGENTS.md` before modifying the running setup.

## Guardrails

- Repository edits stay in this repo; installing into `~/.config/herdr-app` requires the person's request. Commit/push only when requested.
- Keep changes surgical. Preserve type safety: no `any`, non-null assertions or type assertions. Changed functions must pass cyclomatic complexity lint with maximum 10.
- Keep tests focused on behavior; no bundle-equality tests or CI/publishing automation.
- Preserve local credential reads, usage-only caches and optional OpenCode bridge behavior. Publish source only; caches, tokens, databases and private screenshots stay out of Git.
