#!/bin/sh
# <xbar.title>crewrota</xbar.title>
# <xbar.version>v0.1.0</xbar.version>
# <xbar.author>Pasindu Premachandra</xbar.author>
# <xbar.desc>Every crew member's 5-hour and week use, read from crew quota --format menubar. Beta: not yet run on a real Mac.</xbar.desc>
# <xbar.dependencies>node,crewrota</xbar.dependencies>
# <swiftbar.hideRunInTerminal>true</swiftbar.hideRunInTerminal>
# <swiftbar.hideLastUpdated>true</swiftbar.hideLastUpdated>

# Menu bar apps start plugins with a short PATH; add where Homebrew and npm put crew and node.
PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
export PATH

if command -v crew >/dev/null 2>&1; then
  exec crew quota --format menubar
fi
echo "crew"
echo "---"
echo "crew is not on PATH. Install crewrota, then refresh."
echo "Refresh | refresh=true"
