---
title: "crewrota docs for AI agents and LLMs: llms.txt, Markdown pages and context7"
description: "Where an agent fetches the crewrota docs as plain Markdown: /llms.txt, /docs/llms.txt, /docs/llms-full.txt, a .md copy of every page, Accept: text/markdown, and the repo's docs folder for context7."
sidebar:
  order: 4
  label: "Docs for machines"
---

Every crewrota docs page has a Markdown copy: replace the trailing slash with `.md`, so `https://crewrota.pasindug.com/docs/commands/` is also `https://crewrota.pasindug.com/docs/commands.md`.
All of the docs in one file are at `https://crewrota.pasindug.com/docs/llms-full.txt`, and the index for agents is `https://crewrota.pasindug.com/llms.txt`.
The same Markdown is the `docs/` folder of the GitHub repo, which is what context7 and similar indexes read.

## What to fetch

| Address | What it is | Use it when |
|---|---|---|
| `https://crewrota.pasindug.com/llms.txt` | The site's index for agents ([llmstxt.org](https://llmstxt.org) format): a summary, the install commands, the main commands and links to the key docs pages as Markdown | You start from nothing |
| `https://crewrota.pasindug.com/docs/llms.txt` | The docs section's own index, pointing at the full and the short set | You want the docs only |
| `https://crewrota.pasindug.com/docs/llms-full.txt` | Every docs page as Markdown, in one file | You want everything in one request |
| `https://crewrota.pasindug.com/docs/llms-small.txt` | A shorter set, with non-essential content left out | Context is tight |
| `https://crewrota.pasindug.com/docs/<page>.md` | One page as Markdown | You need one topic |

## A Markdown copy of every page

- The address is the page's address with `.md` in place of the trailing slash: `/docs/agents/` is `/docs/agents.md`, `/docs/reference/ship/` is `/docs/reference/ship.md`.
- The docs home is `/docs/index.md`.
- Each copy starts with the page title as a heading, then the page body as written; links point at full site addresses.
- Each HTML page names its copy in its head, `<link rel="alternate" type="text/markdown" href="...">`, and points at `/llms.txt` with `<link rel="describedby">`.
- At the top of every page, "Copy page" copies the Markdown, and "View as Markdown" opens it.
- The copies are served as `text/markdown` with a `Link` header naming the HTML page as canonical, and are kept out of search engines with `X-Robots-Tag: noindex`.

## Ask for Markdown by header

A request for a docs page with `Accept: text/markdown` gets its Markdown copy instead of the HTML:

```sh
curl -H "Accept: text/markdown" https://crewrota.pasindug.com/docs/commands/
```

Docs pages answer with `Vary: Accept`, so caches keep the two apart.

## From inside Claude Code

Claude Code can read a page with its web fetch, and a `.md` address keeps the result short.
For the agent rules, point it at the [agent guide](index.md):

```text
Read https://crewrota.pasindug.com/docs/agents.md and follow it while you use crewrota.
```

## In the repo

The docs are plain Markdown in the `docs/` folder of `https://github.com/pasindu-premachandra/crewrota`; the site is built from the same files.

| File | What it is for |
|---|---|
| `docs/` | Every docs page, readable on GitHub as it is |
| `context7.json` | Settings for context7: the project title, a one-line description, `docs` as the only folder to index, images left out, and a few rules for agents, such as "Claude flags go after `--`" |
| `AGENTS.md` | For agents that work on crewrota's own code: build, test and the rules |
| `CLAUDE.md` | The full guide for contributors, which Claude Code reads in the repo |

context7 indexes Markdown from a public GitHub repo; with `context7.json` it reads only the `docs/` folder and shows the rules to agents next to the docs.

## Related

- [AI agent guide](index.md)
- [Developer docs](../developers/architecture.md)
