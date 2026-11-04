# AGENTS.md

crewrota is a Node/TypeScript CLI (`crew`, `crw`, `crewrota`) that runs Claude Code as one of the user's crew members: each Claude login in its own config folder (`CLAUDE_CONFIG_DIR`), with shared history on ships.
This repo also holds the Claude Code plugin (`plugin/`: the `/firstmate` skill and the Lavish rule hook) and the docs (`docs/`).
MIT licence; Node 22.19 or newer.

Read `CLAUDE.md` for the full guide: the module map, how crewrota uses Claude Code, and the rules.

## Build and test

```sh
npm install
npm run build        # tsc, src/ to dist/
npm run typecheck
npm test             # build, then node --test over dist/test
```

Try the CLI without real accounts: set `CREWROTA_CLAUDE=src/test/fixtures/fake-claude.mjs`, `CREWROTA_QUOTA_AXI=src/test/fixtures/fake-quota-axi.mjs` and `CREWROTA_HOME` to a temp folder, then `node dist/cli.js list`.

## Rules

- Never read, copy or print a credential file: any `.credentials.json`, any `.env*`, or the values in a ship's `mcp.json`.
- Never write to the main `~/.claude` or `~/.claude.json`; they are read only. The one exception is `crew restore`, which adds skills, agents, commands and `CLAUDE.md` to `~/.claude` without overwriting.
- Tests never call the real `claude` or the real quota-axi: use the fakes or an injected runner, and call `isolate()` from `src/test/helpers.ts`.
- Never a recursive delete through a link. Members and ships are moved to `removed/` after their links are unlinked.
- Only `src/claude.ts` runs `claude` and quota-axi.
- No em dash and no en dash anywhere; plain hyphens.
- Comments only where the code is not obvious, one short line.
- Do not commit unless asked; no commit trailers.
- `npm run check:private` scans files against a private denylist kept outside the repo; never copy its terms into a file.

## More

- Developer docs: [docs/developers/architecture.md](docs/developers/architecture.md), [build and test](docs/developers/build-and-test.md), [testing with the fakes](docs/developers/testing-with-fakes.md), [safety rules](docs/developers/safety-rules.md), [CI and the private scan](docs/developers/ci-and-private-scan.md), [releasing](docs/developers/releasing.md).
- Using crewrota from an agent (not working on its code): [docs/agents/index.md](docs/agents/index.md).
