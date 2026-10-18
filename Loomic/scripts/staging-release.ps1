[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$ArchivePath,
  [ValidateSet("validate", "rehearse", "deploy")]
  [string]$Mode = "validate",
  [string]$TargetRoot = $env:STAGING_DEPLOY_ROOT,
  [string]$HealthUrl = $env:STAGING_HEALTH_URL,
  [switch]$ConfirmDeploy
)

$ErrorActionPreference = "Stop"

function Assert-File([string]$Path, [string]$Label) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "$Label not found: $Path"
  }
}

function Assert-StaticBundle([string]$Root) {
  Assert-File (Join-Path $Root "apps\web\out\index.html") "web index"
  Assert-File (Join-Path $Root "RELEASE-MANIFEST.json") "release manifest"
  Assert-File (Join-Path $Root "supabase\migrations\20261017000000_automation_lifecycle.sql") "automation migration"
  $static = Join-Path $Root "apps\web\out\_next\static"
  if (-not (Test-Path -LiteralPath $static -PathType Container)) {
    throw "Next static assets directory not found: $static"
  }
}

function Test-Health([string]$Url) {
  if ([string]::IsNullOrWhiteSpace($Url)) {
    throw "HealthUrl is required for deployment verification."
  }
  $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 20
  if ($response.StatusCode -lt 200 -or $response.StatusCode -ge 300) {
    throw "Health check returned HTTP $($response.StatusCode): $Url"
  }
}

function Copy-DirectoryContents([string]$Source, [string]$Destination) {
  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  Get-ChildItem -LiteralPath $Source -Force | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $Destination -Recurse -Force
  }
}

Assert-File (Resolve-Path -LiteralPath $ArchivePath) "release archive"
$archive = (Resolve-Path -LiteralPath $ArchivePath).Path
$archiveHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $archive).Hash
$workRoot = Join-Path ([IO.Path]::GetTempPath()) ("helstera-release-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $workRoot | Out-Null

try {
  Expand-Archive -LiteralPath $archive -DestinationPath $workRoot -Force
  Assert-StaticBundle $workRoot
  $manifest = Get-Content -LiteralPath (Join-Path $workRoot "RELEASE-MANIFEST.json") -Raw | ConvertFrom-Json
  Write-Output "archive=$archive"
  Write-Output "sha256=$archiveHash"
  Write-Output "candidate=$($manifest.candidate)"
  Write-Output "static_bundle=ok"

  if ($Mode -eq "validate") {
    Write-Output "mode=validate"
    exit 0
  }

  if ($Mode -eq "rehearse") {
    $rehearsalRoot = Join-Path (Split-Path -Parent $archive) ("rehearsal-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
    $current = Join-Path $rehearsalRoot "current"
    $backup = Join-Path $rehearsalRoot "backup"
    New-Item -ItemType Directory -Force -Path $current | Out-Null
    Copy-DirectoryContents $workRoot $current
    Copy-DirectoryContents $current $backup
    Assert-StaticBundle $current
    if ($HealthUrl) { Test-Health $HealthUrl }
    Write-Output "mode=rehearse"
    Write-Output "backup=$backup"
    Write-Output "rollback_source=$backup"
    Write-Output "health_check=$([bool]$HealthUrl)"
    exit 0
  }

  if (-not $ConfirmDeploy) {
    throw "Deployment requires -ConfirmDeploy. Use -Mode rehearse for a non-mutating rehearsal."
  }
  if ([string]::IsNullOrWhiteSpace($TargetRoot)) {
    throw "TargetRoot is required for deployment. Set STAGING_DEPLOY_ROOT or pass -TargetRoot."
  }
  if ([string]::IsNullOrWhiteSpace($HealthUrl)) {
    throw "HealthUrl is required for deployment. Set STAGING_HEALTH_URL or pass -HealthUrl."
  }

  $target = [IO.Path]::GetFullPath($TargetRoot)
  New-Item -ItemType Directory -Force -Path $target | Out-Null
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $releaseDir = Join-Path $target "releases\$stamp"
  $backupDir = Join-Path $target "backups\$stamp"
  $currentDir = Join-Path $target "current"
  New-Item -ItemType Directory -Force -Path $releaseDir | Out-Null
  Copy-DirectoryContents $workRoot $releaseDir
  if (Test-Path -LiteralPath $currentDir -PathType Container) {
    Copy-Item -LiteralPath $currentDir -Destination $backupDir -Recurse -Force
  }

  $previousDir = Join-Path $target ("previous-" + $stamp)
  try {
    if (Test-Path -LiteralPath $currentDir) { Move-Item -LiteralPath $currentDir -Destination $previousDir }
    Move-Item -LiteralPath $releaseDir -Destination $currentDir
    Assert-StaticBundle $currentDir
    Test-Health $HealthUrl
    Write-Output "mode=deploy"
    Write-Output "current=$currentDir"
    Write-Output "backup=$backupDir"
    Write-Output "health=ok"
  } catch {
    if (Test-Path -LiteralPath $currentDir) { Remove-Item -LiteralPath $currentDir -Recurse -Force }
    if (Test-Path -LiteralPath $previousDir) { Move-Item -LiteralPath $previousDir -Destination $currentDir }
    throw
  }
} finally {
  if (Test-Path -LiteralPath $workRoot) { Remove-Item -LiteralPath $workRoot -Recurse -Force }
}
