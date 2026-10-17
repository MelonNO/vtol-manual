<#
.SYNOPSIS
    Windows Defender Firewall rules for vtol-gcs: inbound UDP on the PRIVATE profile only (brief R8).

.DESCRIPTION
    Adds two inbound allow rules, group "vtol-gcs", for the RC sender program (it also runs the video
    fan-out):
      * bridge status and forwarded CRSF frames (UDP from the bridge, relay protocol C3);
      * client video RTP on UDP 5600 (from the N6 video board, C3).
    Both are limited to the Private profile and to the HM30 subnet (relay design: all relay devices
    are in 192.168.144.x).  Set the HM30 network adapter to Private:
        Get-NetConnectionProfile
        Set-NetConnectionProfile -InterfaceAlias "<HM30 adapter>" -NetworkCategory Private
    Mission Planner's MAVLink mirror (14551), the MP output (14560), the local API (47800), the
    control channel (named pipe) and the fan-out targets (5601/5602) are loopback only: no rule needed.

    Run as administrator.  -Uninstall removes every rule of the group.  Running it again replaces
    the rules (idempotent).

.PARAMETER Program
    The program the rules apply to.  Default: dist\vtol-gcs\vtol-gcs-sender.exe next to this script's
    folder (or gcs\dist\vtol-gcs\ in a source tree).  For source runs pass the python.exe you use.

.PARAMETER RemoteSubnet
    Allowed sender addresses (default 192.168.144.0/24, the HM30 subnet).

.PARAMETER VideoPort
    Client video port (default 5600, contract C3).

.PARAMETER Uninstall
    Remove the vtol-gcs rules.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File firewall.ps1
.EXAMPLE
    powershell -ExecutionPolicy Bypass -File firewall.ps1 -Uninstall
#>
#Requires -RunAsAdministrator
param(
    [string]$Program,
    [string]$RemoteSubnet = "192.168.144.0/24",
    [int]$VideoPort = 5600,
    [switch]$Uninstall
)
$ErrorActionPreference = "Stop"
$Group = "vtol-gcs"

function Remove-VtolRules {
    $rules = Get-NetFirewallRule -Group $Group -ErrorAction SilentlyContinue
    if ($rules) { $rules | Remove-NetFirewallRule }
    return @($rules).Count
}

if ($Uninstall) {
    $n = Remove-VtolRules
    Write-Host "Removed $n vtol-gcs firewall rule(s)."
    return
}

if (-not $Program) {
    $root = Split-Path -Parent $PSScriptRoot
    foreach ($cand in @((Join-Path $root "vtol-gcs-sender.exe"),
                        (Join-Path $root "dist\vtol-gcs\vtol-gcs-sender.exe"))) {
        if (Test-Path $cand) { $Program = $cand; break }
    }
}
if (-not $Program -or -not (Test-Path $Program)) {
    throw "vtol-gcs-sender.exe not found. Build first (packaging\build.ps1) or pass -Program <path>."
}
$Program = (Resolve-Path $Program).Path

[void](Remove-VtolRules)
New-NetFirewallRule -DisplayName "vtol-gcs bridge status / CRSF (UDP in)" -Group $Group -Direction Inbound `
    -Action Allow -Protocol UDP -Program $Program -Profile Private -RemoteAddress $RemoteSubnet | Out-Null
New-NetFirewallRule -DisplayName "vtol-gcs client video (UDP $VideoPort in)" -Group $Group -Direction Inbound `
    -Action Allow -Protocol UDP -LocalPort $VideoPort -Program $Program -Profile Private `
    -RemoteAddress $RemoteSubnet | Out-Null

Write-Host "Added vtol-gcs rules (Private profile, remote $RemoteSubnet) for $Program"
Get-NetFirewallRule -Group $Group | Format-Table DisplayName, Profile, Enabled, Direction, Action -AutoSize
$private = Get-NetConnectionProfile | Where-Object NetworkCategory -eq "Private"
if (-not $private) {
    Write-Warning "No network is Private. Set the HM30 adapter to Private, or the rules never apply."
}
