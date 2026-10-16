# ============================================================
# watch-push.ps1 - Auto-commit and push on file change
#
# PREFER DELIBERATE COMMITS. Review your changes and commit them
# yourself with a clear message (git add -- <files>; git commit).
# This watcher is a convenience for quick content edits only.
#
# What it does:
#   - watches the REPO ROOT (parent of scripts\) recursively,
#     with one FileSystemWatcher;
#   - only reacts to *.html *.js *.css *.json *.md *.svg *.webp
#     *.jpg *.png *.webmanifest;
#   - ignores .git\, node_modules\, venv\, .venv\, gcs\build\, gcs\dist\;
#   - never stages anything matching *token*, *.env, *secret*;
#   - waits until no change has been seen for a few seconds
#     (debounce timer), then stages ONLY the changed paths
#     (git add -- <paths>), commits only those paths and pushes.
#     It never runs "git add .".
#
# Leave it running in a terminal. Press Ctrl+C to stop.
# Windows PowerShell 5.1 compatible.
# ============================================================

$repoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $repoRoot

$env:PATH = [System.Environment]::GetEnvironmentVariable("PATH","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH","User")

$debounceMs  = 4000
$timerSource = "WatchPush.Debounce"

# Shared with the event handler (handlers cannot see script variables or functions).
$state = [hashtable]::Synchronized(@{
    Root         = $repoRoot.TrimEnd('\')
    IncludeExt   = @(".html", ".js", ".css", ".json", ".md", ".svg", ".webp", ".jpg", ".png", ".webmanifest")
    ExcludeRegex = '(^|/)(\.git|node_modules|venv|\.venv)(/|$)|^gcs/(build|dist)(/|$)'
    Deny         = @("*token*", "*.env", "*secret*")
    Pending      = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
    Timer        = $null
})

function Test-Denied([string]$relPath) {
    foreach ($pattern in $state.Deny) {
        if ($relPath -like $pattern) { return $true }
    }
    return $false
}

# Debounce: a one-shot timer that every relevant change restarts.
$timer = New-Object System.Timers.Timer
$timer.Interval = $debounceMs
$timer.AutoReset = $false
$state.Timer = $timer

$watcher = New-Object System.IO.FileSystemWatcher
$watcher.Path = $repoRoot
$watcher.Filter = "*"
$watcher.IncludeSubdirectories = $true
$watcher.NotifyFilter = [System.IO.NotifyFilters]::FileName -bor [System.IO.NotifyFilters]::LastWrite

# Event handler: filter the path, remember it, restart the timer. No sleeping, no git here.
$onChange = {
    $s = $Event.MessageData
    $full = @($EventArgs.FullPath)
    if ($EventArgs -is [System.IO.RenamedEventArgs]) { $full += $EventArgs.OldFullPath }
    $added = $false
    foreach ($f in $full) {
        if (-not $f.StartsWith($s.Root, [System.StringComparison]::OrdinalIgnoreCase)) { continue }
        $rel = $f.Substring($s.Root.Length).TrimStart('\', '/') -replace '\\', '/'
        if ($rel -match $s.ExcludeRegex) { continue }
        $ext = [System.IO.Path]::GetExtension($rel).ToLowerInvariant()
        if ($s.IncludeExt -notcontains $ext) { continue }
        $denied = $false
        foreach ($pattern in $s.Deny) { if ($rel -like $pattern) { $denied = $true } }
        if ($denied) {
            Write-Host "Refusing to stage $rel (matches deny list)" -ForegroundColor Red
            continue
        }
        [System.Threading.Monitor]::Enter($s.Pending)
        try { [void]$s.Pending.Add($rel) } finally { [System.Threading.Monitor]::Exit($s.Pending) }
        $added = $true
    }
    if ($added) { $s.Timer.Stop(); $s.Timer.Start() }
}

function Push-Pending {
    [System.Threading.Monitor]::Enter($state.Pending)
    try {
        $paths = @($state.Pending)
        $state.Pending.Clear()
    } finally {
        [System.Threading.Monitor]::Exit($state.Pending)
    }

    # Keep paths that exist or are tracked (a deleted tracked file stages its removal),
    # are not git-ignored and pass the deny list again (defence in depth).
    $stage = @()
    foreach ($p in $paths) {
        if (Test-Denied $p) { continue }
        $tracked = git ls-files -- "$p"
        if (-not (Test-Path -LiteralPath $p) -and -not $tracked) { continue }
        git check-ignore -q -- "$p"
        if ($LASTEXITCODE -eq 0) { continue }
        $stage += $p
    }
    if ($stage.Count -eq 0) { return }

    git add -- $stage
    $changed = git diff --cached --name-only --no-renames -- $stage
    if (-not $changed) { return }

    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm"
    # Commit only these paths, even if something else is staged by hand.
    git commit --quiet -m "auto-update $timestamp" -- $stage
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[$timestamp] Commit failed." -ForegroundColor Red
        return
    }
    Write-Host "[$timestamp] Committed: $($changed -join ', ')" -ForegroundColor Green

    git push
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[$timestamp] Pushed to GitHub" -ForegroundColor Green
    } else {
        Write-Host "[$timestamp] Push failed - check internet/credentials." -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "=== VTOL Manual - Auto Push ===" -ForegroundColor Cyan
Write-Host "Watching: $repoRoot (recursive)" -ForegroundColor Green
Write-Host "Deliberate commits are preferred; use this for quick edits only." -ForegroundColor Yellow
Write-Host "Press Ctrl+C to stop." -ForegroundColor Yellow
Write-Host ""

$subscriptions = @()
foreach ($evt in @("Changed", "Created", "Deleted", "Renamed")) {
    $subscriptions += Register-ObjectEvent -InputObject $watcher -EventName $evt -Action $onChange -MessageData $state
}
# The timer has no action: its Elapsed event is queued and handled by the loop below.
Register-ObjectEvent -InputObject $timer -EventName Elapsed -SourceIdentifier $timerSource | Out-Null
$watcher.EnableRaisingEvents = $true

try {
    while ($true) {
        $ev = Wait-Event -SourceIdentifier $timerSource -Timeout 1
        if ($ev) {
            Remove-Event -SourceIdentifier $timerSource
            Push-Pending
        }
    }
} finally {
    $watcher.EnableRaisingEvents = $false
    $subscriptions | ForEach-Object { Unregister-Event -SourceIdentifier $_.Name }
    Unregister-Event -SourceIdentifier $timerSource -ErrorAction SilentlyContinue
    $timer.Dispose()
    $watcher.Dispose()
    Write-Host "Watcher stopped." -ForegroundColor Yellow
}
