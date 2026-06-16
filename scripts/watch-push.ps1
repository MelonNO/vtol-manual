# ============================================================
# watch-push.ps1 - Auto-commit and push on file change
# Leave this running in a terminal while you work.
# Press Ctrl+C to stop.
# ============================================================

$folder = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $folder

$env:PATH = [System.Environment]::GetEnvironmentVariable("PATH","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH","User")

$watchExtensions = @("*.html", "*.js", "*.css", "*.json")

Write-Host ""
Write-Host "=== VTOL Manual - Auto Push ===" -ForegroundColor Cyan
Write-Host "Watching: $folder" -ForegroundColor Green
Write-Host "Press Ctrl+C to stop." -ForegroundColor Yellow
Write-Host ""

$lastPush = [datetime]::MinValue
$debounceSeconds = 4

$watcher = New-Object System.IO.FileSystemWatcher
$watcher.Path = $folder
$watcher.IncludeSubdirectories = $false
$watcher.EnableRaisingEvents = $true

function Push-Changes {
    $now = [datetime]::Now
    $script:lastPush = $now
    Start-Sleep -Seconds $script:debounceSeconds

    if ($script:lastPush -ne $now) { return }

    Set-Location $script:folder
    $status = git status --porcelain
    if (-not $status) { return }

    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm"
    git add .
    git commit -m "auto-update $timestamp" --quiet

    git push
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[$timestamp] Pushed to GitHub" -ForegroundColor Green
    } else {
        Write-Host "[$timestamp] Push failed - check internet/credentials." -ForegroundColor Red
    }
}

$action = { Push-Changes }

$handlers = @()
foreach ($ext in $watchExtensions) {
    $watcher.Filter = $ext
    $handlers += Register-ObjectEvent $watcher Changed -Action $action
    $handlers += Register-ObjectEvent $watcher Created -Action $action
}
$watcher.Filter = "*.*"

try {
    while ($true) { Start-Sleep -Seconds 1 }
} finally {
    $handlers | ForEach-Object { Unregister-Event -SourceIdentifier $_.Name }
    $watcher.Dispose()
    Write-Host "Watcher stopped." -ForegroundColor Yellow
}
