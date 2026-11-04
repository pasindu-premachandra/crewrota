---
title: "How a crewrota release is put together"
description: "What the repo shows about a crewrota release: the version in package.json and plugin.json, the test that ties them, what the npm package ships and how the plugin is installed."
sidebar:
  order: 6
  label: "Releasing"
---

A crewrota release carries one version number in two files: `package.json` for the npm package and `plugin/.claude-plugin/plugin.json` for the Claude Code plugin.
A test fails when the two differ.
The npm package ships the built CLI, the templates and the widget; the plugin is installed from the GitHub repo.

## The version

| File | Field | At 1.0.4 |
|---|---|---|
| `package.json` | `version` | `1.0.4` |
| `plugin/.claude-plugin/plugin.json` | `version` | `1.0.4` |

`src/test/plugin.test.ts` reads both and fails when they are not equal, so `npm test` catches a release that bumps only one.
`crew --version` prints the version from `package.json`, and a backup's `manifest.json` records it.

## What the npm package ships

From `files` in `package.json`:

| Path | What it is |
|---|---|
| `dist/` without `dist/test/` | The built CLI |
| `templates/` | What `crew init` writes |
| `widget/` | The quota widget and the SwiftBar and xbar plugin |
| `NOTICE` | Notices |

npm adds `package.json`, `README.md` and `LICENSE` on its own.
`prepack` runs `npm run build`, so `npm pack` and `npm publish` always pack a fresh `dist/`.
The bin names `crewrota`, `crw` and `crew` all point at `dist/cli.js`; `engines` asks for Node 22.19 or newer.

Check what would ship before a release:

```sh
npm pack --dry-run
```

## The plugin

The repo is a Claude Code plugin marketplace: `.claude-plugin/marketplace.json` lists one plugin, `crewrota`, from `./plugin`.
Users install it from GitHub, so a plugin change reaches them from the repo, not from npm:

```sh
claude plugin marketplace add pasindu-premachandra/crewrota
claude plugin install crewrota@crewrota
```

## Checks the repo gives you

- `npm run typecheck` and `npm test`, which include the version check above.
- CI on Windows, macOS and Ubuntu for every push to `main` and every pull request.
- `npm run check:private`, which should print `clean`.
- `npm pack --dry-run`, for the file list.

The repo has no CHANGELOG file and no release checklist.

## Related

- [CI and the private scan](ci-and-private-scan.md)
- [Platforms and versions](../platforms.md)
