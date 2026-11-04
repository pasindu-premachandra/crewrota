---
title: "crewrota CI, the secret scan and the private scan"
description: "What crewrota's GitHub Actions run on Windows, macOS and Ubuntu, the gitleaks secret scan, and the private denylist scan behind npm run check:private and the pre-push hook."
sidebar:
  order: 5
  label: "CI and private scan"
---

Every push to `main` and every pull request runs `.github/workflows/ci.yml`: the typecheck and the tests on Windows, macOS 15 and Ubuntu with Node 22, and a gitleaks secret scan of the whole history.
Before a push, `npm run check:private` scans the files against a private denylist kept outside the repo, and `scripts/hooks/pre-push` runs that scan for you.

## The CI jobs

| Job | Runs on | Steps |
|---|---|---|
| `test` | `windows-latest`, `macos-15`, `ubuntu-latest` (one fails without stopping the others) | Checkout, Node 22 with the npm cache, on Linux `sudo apt-get install -y libarchive-tools` for bsdtar, `npm ci`, `npm run typecheck`, `npm test` |
| `secret-scan` | `ubuntu-latest` | Checkout with the full history, then `gitleaks/gitleaks-action@v3` |

The tests passing on macOS and Ubuntu is the basis for calling those platforms beta; they have not yet been tested thoroughly by hand.
See [Platforms and versions](../platforms.md).

## The private scan

```sh
npm run check:private
```

`scripts/check-private.mjs` reads a denylist file that is not in the repo: `CREWROTA_DENYLIST`, else `~/.config/crewrota-private/denylist.txt`.

- One term per line; blank lines and lines starting with `#` are skipped.
- A term of letters and digits only matches as a whole word; anything else matches as written. Case is ignored.
- It scans every tracked file and every new file git does not ignore (`git ls-files --cached --others --exclude-standard`).
- On a hit it prints only `file:line` for each hit, never the term, and exits with 1.
- With no hits it prints `clean`. With no denylist file it prints `check-private: no denylist at <path>, nothing to check.` and exits with 0, so the scan is a no-op for anyone without one.

Never copy a denylist term into the repo, an issue or a commit message.

## The pre-push hook

`scripts/hooks/pre-push` runs `node scripts/check-private.mjs`, so a push stops when a file holds a denylisted term.
Git runs hooks from `.git/hooks` unless told otherwise; to use the repo's hook folder:

```sh
git config core.hooksPath scripts/hooks
```

## Related

- [Build and test](build-and-test.md)
- [Releasing](releasing.md)
