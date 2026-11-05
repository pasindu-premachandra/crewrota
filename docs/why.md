---
title: "Why crewrota, and what it is not"
description: "When crewrota fits, when plain Claude Code is enough, and what crewrota is not: not a way around usage limits, not account sharing, and it copies no login."
sidebar:
  order: 1
  label: "Why crewrota"
---

crewrota is for one person who has more than one Claude login and wants to use them without signing out and in again.
It keeps each login in its own folder, lets them share history through a ship, and shows every member's usage on one screen.

## When it fits

- You have a work login and a login for your own projects, and you switch between them every day.
- One plan runs out before your work does, and you pay for a second one.
- You want a session started on one login to be picked up on another (members on the same ship share history).
- You want your skills, agents, plugins and `CLAUDE.md` in every login without copying them by hand.
- You want to move all of it to a new machine in one zip.

## When plain Claude Code is enough

- You have one Claude login. Run `claude`; crewrota adds nothing.
- You switch accounts once in a while. `claude auth logout` and `claude auth login` do that.

## What crewrota is not

- **Not a way around usage limits.** Each member is a login you pay for, with its own limits. crewrota shows how much each one has used; it does not raise, pool or reset anything.
- **Not account sharing.** It is for your own logins on your own machine. A backup never holds a login, so restoring one does not hand anyone your accounts.
- **Not a login proxy.** crewrota runs the real Claude Code. Each member signs in through Claude Code's own login in your browser, and the login stays in that member's folder. crewrota never copies or moves a login; to read usage, quota-axi uses each member's own sign-in on your machine.
- **Not something that works your accounts behind your back.** Only `crew warmup` sends a message: one short Haiku message per member, when you run it. Every other command only reads.
- **Not a hosted service.** It is a command-line tool on your machine, MIT licensed, with no crewrota server.
- **Not the judge of what your plan allows.** Anthropic's terms decide that. Read [Your accounts and Anthropic's terms](concepts/accounts-and-terms.md) before you use several accounts.

## Related

- [Install crewrota](install.md)
- [Your first crew in five minutes](first-crew.md)
- [FAQ](faq.md)
