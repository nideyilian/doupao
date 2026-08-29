param(
  [ValidateSet('patch', 'minor', 'major', 'none')]
  [string]$Bump = 'patch',
  [switch]$SkipTests
)

$ErrorActionPreference = 'Stop'

$token = $env:GH_TOKEN
if (-not $token) {
  $token = $env:GITHUB_TOKEN
}

if (-not $token) {
  Write-Error 'GH_TOKEN is not set. Set it once with: [Environment]::SetEnvironmentVariable("GH_TOKEN", "<token>", "User")'
}

if ($Bump -ne 'none') {
  npm version $Bump --no-git-tag-version
}

if (-not $SkipTests) {
  npm test
}

npm run build
npm run release
