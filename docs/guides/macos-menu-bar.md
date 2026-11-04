---
title: "Show usage in the macOS menu bar"
description: "Put every member's 5-hour and week use in the macOS menu bar with SwiftBar or xbar and crewrota's plugin file. Beta."
sidebar:
  order: 6
---

> **Beta:** the menu bar plugin is beta, like crewrota on macOS. It has not yet been tested thoroughly by hand.

crewrota ships a SwiftBar and xbar plugin, `crewrota.1m.sh`, that shows the current member's 5-hour use in the menu bar and every member's use in its dropdown.
Install SwiftBar, copy the file from `"$(npm root --global)/crewrota/widget/crewrota.1m.sh"` into its plugin folder, and make it executable.
It runs `crew quota --format menubar` every minute, which only reads saved readings and never sends a message.

## Install it

Install SwiftBar (macOS 12 or newer) and open it once; it asks you to pick its plugin folder:

```sh
brew install swiftbar
```

Copy the plugin into that folder and make it executable (here the folder is `~/SwiftBar`):

```sh
cp "$(npm root --global)/crewrota/widget/crewrota.1m.sh" ~/SwiftBar/
chmod +x ~/SwiftBar/crewrota.1m.sh
```

The `1m` in the file name tells SwiftBar and xbar to run it every minute.
xbar reads the same file from its own plugin folder.

## What it shows

The menu bar shows `crew` and the current member's 5-hour use, for example `crew 30%`.
Click it for each member's 5-hour and week use with their reset times, green under 60%, amber from 60% and red from 80%, then **Open the crew menu** and **Refresh**.
The current member's name is bold.
**Open the crew menu** opens a terminal running `crew`.

This is the text the plugin turns into the menu, from a demo crew:

```sh
crew quota --format menubar
```

```text
crew 30%
---
main | font=Helvetica-Bold
5h 30%  resets 09:03 | color=#3fb68b
week 55%  resets Wed 09:03 | color=#3fb68b
side
5h 30%  resets 09:03 | color=#3fb68b
week 55%  resets Wed 09:03 | color=#3fb68b
team
5h 30%  resets 09:03 | color=#3fb68b
week 55%  resets Wed 09:03 | color=#3fb68b
---
```

The output goes on with two more lines, left out here because they hold the paths of the machine that made the sample: `Open the crew menu | shell="<your node>" param1="<crewrota's cli.js>" terminal=true` and `Refresh | refresh=true`.

## Where the numbers come from

`crew quota --format menubar` reads each member's saved `quota.json` and never checks usage itself, since it runs every minute.
The readings come from the crew menu, `crew quota`, a running session's status line and `crew warmup`.
So the menu bar is only as fresh as your last reading; run `crew quota` to take new ones.
See [Where usage readings come from](../concepts/usage-readings.md).

## If crew is not found

Menu bar apps start plugins with a short PATH.
The plugin adds `/opt/homebrew/bin` and `/usr/local/bin`, where Homebrew and npm usually put `crew` and `node`.
If `crew` is still not on that PATH, the menu bar shows `crew` with `crew is not on PATH. Install crewrota, then refresh.` in its dropdown.

## Related

- [Check every member's usage](usage-and-quota.md)
- [Keep usage on your desktop with the widget](widget.md)
- [macOS quickstart (beta)](../macos/quickstart.md)
- [Usage commands, in full](../reference/usage.md)
