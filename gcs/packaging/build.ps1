<#
.SYNOPSIS
    Build vtol-gcs with PyInstaller into one folder: gcs\dist\vtol-gcs\ (brief R8).

.DESCRIPTION
    Produces vtol-gcs.exe (windowed UI) and vtol-gcs-sender.exe (console RC sender and video
    fan-out) in gcs\dist\vtol-gcs\.  gcs\dist and gcs\build are git-ignored: never commit them.
    Release binaries are attached to GitHub Releases (plan section 7).

.PARAMETER Python
    The Python 3.12 interpreter to build with (default: python on PATH, or a venv's python.exe).

.PARAMETER SkipInstall
    Do not pip-install PyInstaller and pygame-ce first.

.PARAMETER Clean
    Delete gcs\build and gcs\dist\vtol-gcs before building.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File gcs\packaging\build.ps1 -Python .venv\Scripts\python.exe
#>
param(
    [string]$Python = "python",
    [switch]$SkipInstall,
    [switch]$Clean
)
$ErrorActionPreference = "Stop"
$Gcs = Split-Path -Parent $PSScriptRoot
$Dist = Join-Path $Gcs "dist"
$Work = Join-Path $Gcs "build"
$Out = Join-Path $Dist "vtol-gcs"

& $Python -c "import sys; assert sys.version_info >= (3, 12), sys.version"
if ($LASTEXITCODE -ne 0) { throw "Python 3.12 or newer is required ($Python)" }

if (-not $SkipInstall) {
    & $Python -m pip install --upgrade "pyinstaller>=6" "pygame-ce"
    if ($LASTEXITCODE -ne 0) { throw "pip install failed" }
}
if ($Clean) {
    Remove-Item -Recurse -Force $Work, $Out -ErrorAction SilentlyContinue
}

Push-Location $Gcs
try {
    & $Python -m PyInstaller --noconfirm --clean --distpath $Dist --workpath $Work (Join-Path $PSScriptRoot "vtol-gcs.spec")
    if ($LASTEXITCODE -ne 0) { throw "PyInstaller failed" }
} finally {
    Pop-Location
}

$Sender = Join-Path $Out "vtol-gcs-sender.exe"
$Ui = Join-Path $Out "vtol-gcs.exe"
foreach ($exe in @($Sender, $Ui)) {
    if (-not (Test-Path $exe)) { throw "missing $exe" }
}
# Smoke check: the sender starts and prints its usage (no window, no network).
& $Sender --help | Out-Null
if ($LASTEXITCODE -ne 0) { throw "the built vtol-gcs-sender.exe does not start" }

Write-Host "Built $Out"
Write-Host "  vtol-gcs.exe         UI (starts the sender in its own console window)"
Write-Host "  vtol-gcs-sender.exe  RC sender (--headless) / video fan-out"
Write-Host "Next: run scripts\firewall.ps1 as administrator (see README 'Firewall')."
