# ============================================================
# watch-push.ps1  —  Auto-commit and push on file change
# Leave this running in a terminal while you work.
# Press Ctrl+C to stop.
# ============================================================

$folder = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $folder

# Files to watch (add extensions as needed)
$watchExtensions = @("*.html", "*.js", "*.css", "*.json")

Write-Host ""
Write-Host "=== VTOL Manual — Auto Push ===" -ForegroundColor Cyan
Write-Host "Watching: $folder" -ForegroundColor Green
Write-Host "Press Ctrl+C to stop." -ForegroundColor Yellow
Write-Host ""

# Debounce: avoid multiple rapid triggers from one save
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

    # Check nothing else triggered after us (debounce)
    if ($script:lastPush -ne $now) { return }

    Set-Location $folder
    $status = git status --porcelain
    if (-not $status) { return }  # Nothing to commit

    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm"
    git add .
    git commit -m "auto-update $timestamp" --quiet

    $pushResult = git push 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[$timestamp] Pushed to GitHub" -ForegroundColor Green
    } else {
        Write-Host "[$timestamp] Push failed: $pushResult" -ForegroundColor Red
        Write-Host "  Check your internet connection or GitHub credentials." -ForegroundColor Yellow
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

# Keep alive
try {
    while ($true) { Start-Sleep -Seconds 1 }
} finally {
    $handlers | ForEach-Object { Unregister-Event -SourceIdentifier $_.Name }
    $watcher.Dispose()
    Write-Host "Watcher stopped." -ForegroundColor Yellow
}
