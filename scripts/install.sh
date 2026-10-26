#!/usr/bin/env sh
# Installs crewrota from this folder as global commands: crewrota, crw and crew. Run it again to update.
set -eu
cd "$(dirname "$0")/.."

major=$(node --version | sed 's/^v\([0-9]*\).*/\1/')
[ "$major" -ge 22 ] || { echo "crewrota needs Node 22 or newer; this machine has $(node --version)." >&2; exit 1; }

npm ci
npm run build
tarball=$(npm pack --silent | tail -n 1)
npm install --global "./$tarball"
rm "./$tarball"

crew --version
echo "Installed. Next: crew doctor, then crew add <member>. Remove it with: npm uninstall --global crewrota"
