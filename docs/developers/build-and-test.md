---
title: "Build and test crewrota from source"
description: "Clone crewrota, install with npm, build with tsc, run the node:test suite and the typecheck, try the CLI against fakes and install your build globally."
sidebar:
  order: 2
  label: "Build and test"
---

Clone the repo, run `npm install`, then `npm test`: it builds `src/` to `dist/` with TypeScript and runs every test with Node's own test runner.
You need Node.js 22.19 or newer and git; no real Claude Code account is used by the tests.
`npm run typecheck` checks the types without writing anything.

## Get the code

```sh
git clone https://github.com/pasindu-premachandra/crewrota.git
cd crewrota
npm install
```

## The npm scripts

| Script | Runs | What it does |
|---|---|---|
| `npm run build` | `tsc` | Compiles `src/` to `dist/` |
| `npm run typecheck` | `tsc --noEmit` | Checks the types only |
| `npm test` | `npm run build && node --test "dist/test/*.test.js"` | Builds, then runs every test file |
| `npm run check:private` | `node scripts/check-private.mjs` | Scans files against a private denylist; see [CI and the private scan](ci-and-private-scan.md) |
| `prepack` | `npm run build` | Builds before `npm pack` and `npm publish` |

## TypeScript

`tsconfig.json`: target ES2023, `module` and `moduleResolution` NodeNext, `strict`, `rootDir` `src`, `outDir` `dist`.
The package is an ES module (`"type": "module"`), so imports between modules end in `.js`.

## Tests

- One file per area in `src/test/`: backup, check-private, cli, config, doctor, init, launch, members, menu, names, plugin, progress, remove, setup, shared, ships, shortcuts, statusline and widget, plus `helpers.ts`.
- They use `node:test` and `node:assert/strict`; there is no test framework to install.
- They run from `dist/test/`, so change the TypeScript and run `npm test`, which builds first.
- Every test points HOME and the config folders at a temp folder and Claude Code and quota-axi at fakes; see [Testing with the fakes](testing-with-fakes.md).
- `src/test/plugin.test.ts` checks the plugin: one marketplace entry, the plugin's version equal to `package.json`'s, the firstmate files and the hook command.

Run one file after a build:

```sh
npm run build
node --test dist/test/ships.test.js
```

## Try the CLI without accounts

```sh
export CREWROTA_CLAUDE=src/test/fixtures/fake-claude.mjs
export CREWROTA_QUOTA_AXI=src/test/fixtures/fake-quota-axi.mjs
export CREWROTA_HOME=/tmp/crew-try
node dist/cli.js list
```

In a shell that is itself a crew member, also set HOME and the config folders to a scratch folder and unset `CLAUDE_CONFIG_DIR`; the full recipe is in [Testing with the fakes](testing-with-fakes.md#a-demo-crew).

## Install your build

The scripts check Node 22.19, run `npm ci`, build, `npm pack`, install the tarball globally, delete it and print `crew --version`:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1
```

```sh
sh scripts/install.sh
```

Run either again to update.
Remove it with `npm uninstall --global crewrota`.

## Related

- [Architecture](architecture.md)
- [Testing with the fakes](testing-with-fakes.md)
- [CI and the private scan](ci-and-private-scan.md)
