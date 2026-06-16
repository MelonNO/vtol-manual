# ============================================================
# git-setup.ps1  —  Run this ONCE to initialise the repo
# ============================================================
# Before running, edit the two lines below:

$GITHUB_USERNAME = "MelonNO"
$REPO_NAME       = "vtol-Manual"

# ============================================================

$folder = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $folder

Write-Host ""
Write-Host "=== VTOL Manual — Git Setup ===" -ForegroundColor Cyan
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

# Create .gitignore
@"
*.ps1~
Thumbs.db
.DS_Store
"@ | Set-Content ".gitignore"

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

# Stage and push everything
Write-Host ""
Write-Host "Pushing files to GitHub..." -ForegroundColor Green
git add .
git commit -m "initial upload"
git push -u origin main

Write-Host ""
Write-Host "=== Done! ===" -ForegroundColor Cyan
Write-Host "Your files are live. Now run watch-push.ps1 for auto-sync." -ForegroundColor Green
Write-Host ""
pause
