# Installs crewrota from this folder as global commands: crewrota, crw and crew. Run it again to update.
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot

$major = [int]((node --version) -replace '^v(\d+).*', '$1')
if ($major -lt 22) { throw "crewrota needs Node 22 or newer; this machine has $(node --version)." }

Push-Location $repo
try {
  npm ci
  if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' }
  npm run build
  if ($LASTEXITCODE -ne 0) { throw 'npm run build failed' }
  $tarball = npm pack --silent | Select-Object -Last 1
  if ($LASTEXITCODE -ne 0) { throw 'npm pack failed' }
  npm install --global ".\$tarball"
  if ($LASTEXITCODE -ne 0) { throw 'npm install --global failed' }
  Remove-Item ".\$tarball"
} finally {
  Pop-Location
}

crew --version
Write-Host 'Installed. Next: crew doctor, then crew add <member>. Remove it with: npm uninstall --global crewrota'
