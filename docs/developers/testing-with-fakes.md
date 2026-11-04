---
title: "Test crewrota without real accounts: isolate() and the fakes"
description: "How crewrota's tests and demo crews run with no real Claude login: isolate() and the other helpers, the fake claude and fake quota-axi with every knob, and the recipe for a demo crew."
sidebar:
  order: 3
  label: "Testing with the fakes"
---

crewrota's tests never call the real `claude` or the real quota-axi.
`isolate()` in `src/test/helpers.ts` points HOME and every config folder at a fresh temp folder and sets `CREWROTA_CLAUDE` and `CREWROTA_QUOTA_AXI` to the two fakes in `src/test/fixtures/`.
The same fakes run a demo crew for screenshots and docs output.

## isolate()

```ts
import { isolate } from './helpers.js';

const root = isolate();
```

It makes a temp folder named `crewrota-test-*` and sets:

| Variable | Points at |
|---|---|
| `HOME`, `USERPROFILE` | `<root>/home` |
| `APPDATA` | `<root>/appdata` |
| `XDG_CONFIG_HOME` | `<root>/xdg-config` |
| `XDG_DATA_HOME` | `<root>/xdg-data` |
| `CREWROTA_HOME` | `<root>/crew-home` |
| `CREWROTA_CLAUDE` | `src/test/fixtures/fake-claude.mjs` |
| `CREWROTA_QUOTA_AXI` | `src/test/fixtures/fake-quota-axi.mjs` |

It removes `CLAUDE_CONFIG_DIR`, `CREW_MEMBER`, `CREWROTA_DENYLIST`, `QUOTA_AXI_CLAUDE_PROFILES` and every `FAKE_CLAUDE_*` and `FAKE_QUOTA_*` variable, so nothing from your own shell leaks in.
Call it at the top of every test file.

## The other helpers

| Helper | What it does |
|---|---|
| `fakeMember(config, name, { email?, org?, ship? })` | Registers a member with an invented login (`.claude.json` with an `oauthAccount`), without the creation workflow. The email defaults to `<name>@example.com` |
| `scriptedUi(answers)` | A stand-in for the prompts: answers each question in order and records what was asked |
| `readLog(file)` | Reads a fake's log: one `{ args, dir }` per call |
| `snapshot(dir)` | Every file below a folder with its bytes, links not followed, to prove a command changed nothing |
| `fakeClaude`, `fakeQuotaAxi`, `cliPath`, `fixturesDir` | Paths to the fakes, `dist/cli.js` and the fixtures folder |

Commands that need injection take a runner or a `deps` object instead (`MemberDeps`, `LaunchDeps`, `SetupDeps`, a `LinkRunner`), so a test can answer questions and record calls without a terminal.

## The fake claude

`src/test/fixtures/fake-claude.mjs` only writes inside `CLAUDE_CONFIG_DIR` and never touches a real account.

| Call | What it does |
|---|---|
| `--version` | Prints `2.1.310 (Claude Code) (fake)` |
| `auth login [--email <e>]` | Writes an `oauthAccount` into `.claude.json` |
| `auth status` | Prints `{ loggedIn, authMethod, configDirectory }` as JSON; exit 0 when logged in |
| `auth logout` | Removes the `oauthAccount` |
| `-p ... --output-format stream-json` | Prints an init line, a `rate_limit_event` with both windows, then a result |
| no arguments, with no login yet | Plays Claude Code's first-run login: writes an `oauthAccount` |
| anything else | A session launch: exits with `FAKE_CLAUDE_EXIT` |

| Knob | Default | Effect |
|---|---|---|
| `FAKE_CLAUDE_LOG` | none | Append each call's arguments and config folder to this file |
| `FAKE_CLAUDE_EMAIL` | `sam@example.com` | The login's email when `--email` is not given |
| `FAKE_CLAUDE_ORG` | empty | The login's organisation |
| `FAKE_CLAUDE_LOGIN_EXIT` | 0 | Make the login fail with this code |
| `FAKE_CLAUDE_STATUS_EXIT` | unset | Make `auth status` report logged out, with this code |
| `FAKE_CLAUDE_CONFIG_DIRECTORY` | the real folder | The folder `auth status` reports, to test a mismatch |
| `FAKE_CLAUDE_NO_LIMITS` | unset | Leave the `rate_limit_event` out |
| `FAKE_CLAUDE_FIVE`, `FAKE_CLAUDE_WEEK` | 25, 40 | The 5-hour and week percent the warm-up reports |
| `FAKE_CLAUDE_EXIT` | 0 | A session launch's exit code |

## The fake quota-axi

`src/test/fixtures/fake-quota-axi.mjs` prints one schema 5 reading with `five_hour` and `seven_day` windows and reads no credentials.

| Knob | Default | Effect |
|---|---|---|
| `FAKE_QUOTA_LOG` | none | Append each call's arguments, `CLAUDE_CONFIG_DIR` and `QUOTA_AXI_CLAUDE_PROFILES` |
| `FAKE_QUOTA_EXIT` | unset | Fail with this code |
| `FAKE_QUOTA_FIVE`, `FAKE_QUOTA_WEEK` | 30, 55 | Percent used |
| `FAKE_QUOTA_STATUS` | `fresh` | Another status, which crewrota ignores |

## A demo crew

For docs output or screenshots, run the built CLI against the fakes in a scratch folder with a short path, so paths in the output show nothing personal:

```sh
D=/tmp/demo-crew
unset CLAUDE_CONFIG_DIR CREW_MEMBER QUOTA_AXI_CLAUDE_PROFILES
export HOME=$D/home USERPROFILE=$D/home APPDATA=$D/appdata XDG_CONFIG_HOME=$D/xdg CREWROTA_HOME=$D/crew-home
export CREWROTA_CLAUDE=$PWD/src/test/fixtures/fake-claude.mjs
export CREWROTA_QUOTA_AXI=$PWD/src/test/fixtures/fake-quota-axi.mjs
mkdir -p $HOME $APPDATA/crewrota $XDG_CONFIG_HOME $CREWROTA_HOME/members/main
echo '{"oauthAccount":{"emailAddress":"main@example.com","organizationName":"","organizationUuid":""}}' > $CREWROTA_HOME/members/main/.claude.json
echo '{"skipPermissions":null,"current":"main","members":{"main":{"provider":"claude","created":"2026-11-05T00:00:00.000Z"}}}' > $APPDATA/crewrota/config.json
node dist/cli.js list
```

- Unset `CLAUDE_CONFIG_DIR` when your shell is itself a crew member; otherwise `crew statusline` writes that member's real `quota.json`.
- `crew add` needs a terminal, so seed members by hand as `fakeMember` does, or run `crew add` in a real terminal against the fake, which plays the first-run login.
- `FAKE_CLAUDE_FIVE=12 node dist/cli.js warmup main` gives one member its own reading.
- Set `CREWROTA_CODE` and `CREWROTA_PYTHON` to an empty file so `crew shortcut` and `crew widget startup` write their files without opening anything.
- When you are done, remove the scratch folder only after its links are gone: member folders hold junctions or symbolic links to ships.

## Related

- [Build and test](build-and-test.md)
- [Safety rules](safety-rules.md)
- [Environment variables](../reference/environment-variables.md)
