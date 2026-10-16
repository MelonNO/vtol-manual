# ============================================================
# git-setup.ps1  -  ONE-TIME setup. Run this ONCE to initialise the repo.
# ============================================================
# The repo is already set up on GitHub; you normally never need this
# script again. Re-running it is safe: it only appends missing
# .gitignore lines, updates the remote, and makes the initial commit
# only if the repo has no commits yet.
#
# Before running, edit the two lines below:

$GITHUB_USERNAME = "MelonNO"
$REPO_NAME       = "vtol-Manual"

# ============================================================

# Operate on the repo root (the parent of scripts\).
$folder = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $folder

Write-Host ""
Write-Host "=== VTOL Manual - Git Setup (one-time) ===" -ForegroundColor Cyan
Write-Host "Repo root: $folder" -ForegroundColor Green
Write-Host ""

# Check git is installed
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: git is not installed." -ForegroundColor Red
    Write-Host "Download it from https://git-scm.com and re-run this script." -ForegroundColor Yellow
    pause
    exit 1
}

# Initialise repo if not already done
if (-not (Test-Path ".git")) {
    Write-Host "Initialising git repository..." -ForegroundColor Green
    git init
    git branch -M main
} else {
    Write-Host "Git repo already initialised." -ForegroundColor Green
}

# .gitignore: append missing lines, never overwrite
$ignoreLines = @(
    "*.ps1~",
    "Thumbs.db",
    ".DS_Store",
    "relay/__pycache__/",
    "relay/*.pyc",
    "relay/.env",
    "token.txt",
    "*.token",
    ".claude/settings.local.json",
    "node_modules/",
    "__pycache__/",
    "*.pyc",
    ".venv/",
    "venv/",
    "gcs/build/",
    "gcs/dist/",
    ".pytest_cache/"
)
$existingIgnore = @()
if (Test-Path ".gitignore") {
    $existingIgnore = @(Get-Content ".gitignore" | ForEach-Object { $_.Trim().TrimStart([char]0xFEFF) })
}
$missing = @($ignoreLines | Where-Object { $existingIgnore -notcontains $_ })
if ($missing.Count -gt 0) {
    Write-Host "Adding to .gitignore: $($missing -join ', ')" -ForegroundColor Green
    $needsNewline = (Test-Path ".gitignore") -and ((Get-Content ".gitignore" -Raw) -notmatch "(\r?\n)$") -and ((Get-Item ".gitignore").Length -gt 0)
    if ($needsNewline) { Add-Content ".gitignore" "" -Encoding UTF8 }
    Add-Content ".gitignore" $missing -Encoding UTF8
} else {
    Write-Host ".gitignore already complete." -ForegroundColor Green
}

# Set remote
$remoteUrl = "https://github.com/$GITHUB_USERNAME/$REPO_NAME.git"
$existing = git remote get-url origin 2>$null
if ($existing) {
    Write-Host "Updating remote to $remoteUrl" -ForegroundColor Green
    git remote set-url origin $remoteUrl
} else {
    Write-Host "Adding remote: $remoteUrl" -ForegroundColor Green
    git remote add origin $remoteUrl
}

# Initial upload only for a brand-new repo (no commits yet)
git rev-parse --verify --quiet HEAD > $null
if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "Repo already has commits - skipping the initial upload." -ForegroundColor Yellow
    Write-Host "Commit your changes deliberately: git add -- <files>; git commit; git push" -ForegroundColor Yellow
} else {
    Write-Host ""
    Write-Host "Pushing files to GitHub..." -ForegroundColor Green
    git add .
    git commit -m "initial upload"
    git push -u origin main
}

Write-Host ""
Write-Host "=== Done! ===" -ForegroundColor Cyan
Write-Host "Prefer deliberate commits; watch-push.ps1 is optional for quick edits." -ForegroundColor Green
Write-Host ""
pause
