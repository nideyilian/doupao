# DOUPAO V2 v0.8.01 one-click publish script
# Usage: first set GH_TOKEN, then run this script
#   [Environment]::SetEnvironmentVariable("GH_TOKEN", "<your-token>", "User")  (persistent, new terminal)
#   or in current terminal:  $env:GH_TOKEN = "<your-token>"
#
# Steps:
#   1. Validate GH_TOKEN is set
#   2. Run full test suite
#   3. Build and publish to GitHub Releases (nideyilian/doupao, tag v0.8.01)
#   4. Set release body from repo/RELEASE.md
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

$token = if ($env:GH_TOKEN) { $env:GH_TOKEN } else { $env:GITHUB_TOKEN }
if (-not $token) {
  Write-Error "GH_TOKEN is not set. First run: setx GH_TOKEN `<your-token>`  (then open a new terminal), or in current terminal: `$env:GH_TOKEN = '<your-token>'"
  exit 1
}

Write-Host "[1/3] Running tests..." -ForegroundColor Cyan
npm test
if ($LASTEXITCODE -ne 0) {
  Write-Error "Tests failed; aborting publish."
  exit 1
}

Write-Host "[2/3] Building and publishing to GitHub (--publish always)..." -ForegroundColor Cyan
npx electron-builder --publish always --win
if ($LASTEXITCODE -ne 0) {
  Write-Error "Build/publish failed."
  exit 1
}

Write-Host "[3/3] Setting release body from repo/RELEASE.md..." -ForegroundColor Cyan
$bodyFile = Join-Path $PSScriptRoot '..\repo\RELEASE.md'
if (-not (Test-Path $bodyFile)) {
  Write-Warning "repo/RELEASE.md not found; skipping release body update."
  exit 0
}
gh release edit v0.8.01 --repo nideyilian/doupao --notes-file $bodyFile
if ($LASTEXITCODE -ne 0) {
  Write-Warning "Failed to set release body automatically; please edit the v0.8.01 release body manually on GitHub."
}

Write-Host "[DONE] v0.8.01 published!" -ForegroundColor Green
