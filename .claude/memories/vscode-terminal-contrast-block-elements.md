---
name: vscode-terminal-contrast-block-elements
description: VS Code's terminal lightens dark foreground glyphs to meet terminal.integrated.minimumContrastRatio (4.5 by default) but leaves block elements U+2580 to U+259F alone; why the usage bars use ▖.
type: reference
---

Seen 26 Oct 2026 on the `crew` menu and `crew quota` bars, in Git Bash inside VS Code on Windows.

- With `▮` (U+25AE, geometric shapes) the empty cells, drawn in `#2f333c`, showed as light grey: VS Code lifts any foreground below its minimum contrast ratio (`terminal.integrated.minimumContrastRatio`, default 4.5) against the background.
- Block elements (U+2580 to U+259F) kept their exact colour, which fits xterm.js leaving block and box-drawing glyphs out of the contrast rule (from memory of its source; the behaviour is what was seen).
- Node reports 24-bit colour on Windows for every terminal tried, so colour depth was not the cause.
- Block elements are anchored to a cell edge, so none can be centred vertically: `▌` touches the rows above and below, `▖` (half width, half height) leaves a gap but sits low. The owner chose `▖`.
- A dim attribute on `▮` in VS Code only was tried and reverted on his word.
- A user who wants exact colours for every glyph sets `"terminal.integrated.minimumContrastRatio": 1` in VS Code.
