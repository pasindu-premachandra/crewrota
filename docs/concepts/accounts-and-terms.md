---
title: "Your accounts and Anthropic's terms"
description: "crewrota is for one person running their own Claude subscriptions; each member signs in through Claude Code's own login. Read Anthropic's terms before you use several accounts."
sidebar:
  order: 4
---

crewrota is for one person running their own Claude subscriptions.
Each member logs in through Claude Code's own login, and the login stays in that member's folder.
crewrota never copies or moves a login; to read usage, quota-axi uses each member's own sign-in on your machine.
Read Anthropic's terms for your plan before you use several accounts.

## Anthropic's terms

- Consumer Terms: https://www.anthropic.com/legal/consumer-terms
- Claude Code legal and compliance: https://code.claude.com/docs/en/legal-and-compliance

crewrota does not decide what your plan allows; those terms do.

## How logins are handled

- **Signing in.** `crew add` and `crew login` start Claude Code in the member's folder and let Claude Code's own login run. You sign in in your browser; crewrota never sees your password.
- **Where a login lives.** In the member's folder, where Claude Code writes it. crewrota never copies or moves a login.
- **Reading usage.** To read usage, quota-axi uses each member's own sign-in on your machine. It runs on your machine and sends no message.
- **Backups.** A backup never holds a login or a member folder. After a restore, each member signs in again with `crew login <member>`.
- **Your main login.** Your main `~/.claude` login is never touched.

## Messages crewrota sends

Only `crew warmup` sends a message: one short Haiku message per member, when you run it or press the widget's bolt.
Every other command, including the usage check when the menu opens, sends none.
See [Where usage readings come from](usage-readings.md).

## Related

- [Add and manage crew members](../guides/members.md)
- [Members, ships and your main setup](members-and-ships.md)
