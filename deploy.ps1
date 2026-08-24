# One-command deploy: push the app to the droplet and rebuild, from your Windows PC.
#
#   .\deploy.ps1
#
# It reads your server details from deploy.local.ps1 (gitignored, so your IP/user never gets
# committed). Create that file once, next to this one:
#
#     # deploy.local.ps1
#     $Server    = "swagino@203.0.113.45"   # the sudo user you made + your droplet IP
#     $RemoteDir = "~/swagino"              # where the project lives on the droplet
#
# Requires the built-in Windows ssh/scp (present on Windows 10/11). Uses your SSH key if set up.

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

$cfg = Join-Path $here "deploy.local.ps1"
if (-not (Test-Path $cfg)) {
    Write-Host "Missing deploy.local.ps1 — create it (see the header of this script)." -ForegroundColor Yellow
    exit 1
}
. $cfg
if (-not $Server)    { Write-Host "deploy.local.ps1 must set `$Server" -ForegroundColor Red; exit 1 }
if (-not $RemoteDir) { $RemoteDir = "~/swagino" }

# Only the files the running server needs. .env stays on the droplet and is never pushed.
$files = @("swagino.html", "proxy.py", "Dockerfile", "docker-compose.yml",
           "c799f001526d973d5e323d94542fe589.ico")

Write-Host "→ Copying app files to $Server`:$RemoteDir" -ForegroundColor Cyan
foreach ($f in $files) {
    $src = Join-Path $here $f
    if (-not (Test-Path $src)) { Write-Host "  ! missing locally: $f" -ForegroundColor Red; exit 1 }
    scp $src "$Server`:$RemoteDir/"
    if ($LASTEXITCODE -ne 0) { Write-Host "  scp failed on $f" -ForegroundColor Red; exit 1 }
}

Write-Host "→ Rebuilding container on the droplet" -ForegroundColor Cyan
ssh $Server "cd $RemoteDir && docker compose up -d --build"
if ($LASTEXITCODE -ne 0) { Write-Host "remote rebuild failed" -ForegroundColor Red; exit 1 }

Write-Host "→ Health check" -ForegroundColor Cyan
ssh $Server "cd $RemoteDir && docker compose ps"

Write-Host "✓ Deployed. Users get the new version on their next refresh (ETag revalidated)." -ForegroundColor Green
