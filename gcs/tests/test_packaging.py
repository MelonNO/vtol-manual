"""Packaging files (brief R8): spec, build script, firewall script - static checks (the build itself is slow).

``gcs/packaging/build.ps1`` was run for the WP08b report; the verifier may run it again.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest

GCS = Path(__file__).resolve().parents[1]
PKG = GCS / "packaging"


def test_spec_builds_two_programs_in_one_folder() -> None:
    spec = (PKG / "vtol-gcs.spec").read_text(encoding="utf-8")
    assert 'name="vtol-gcs", console=False' in spec and 'name="vtol-gcs-sender", console=True' in spec
    assert "COLLECT(" in spec and 'name="vtol-gcs")' in spec
    for entry in ("entry_ui.py", "entry_sender.py"):
        assert entry in spec and (PKG / entry).exists()


def test_build_script_outputs_to_gcs_dist_and_checks_the_result() -> None:
    ps = (PKG / "build.ps1").read_text(encoding="utf-8")
    assert '$Dist = Join-Path $Gcs "dist"' in ps and "--distpath $Dist" in ps and "--workpath $Work" in ps
    assert "$LASTEXITCODE" in ps and "vtol-gcs-sender.exe" in ps and '$ErrorActionPreference = "Stop"' in ps
    ignore = (GCS / ".gitignore").read_text(encoding="utf-8").split()
    assert "dist/" in ignore and "build/" in ignore                     # never committed


def test_firewall_script_private_profile_and_uninstall() -> None:
    ps = (GCS / "scripts" / "firewall.ps1").read_text(encoding="utf-8").replace("
", "
")
    assert "#Requires -RunAsAdministrator" in ps and "[switch]$Uninstall" in ps
    news = [line for line in ps.splitlines() if "New-NetFirewallRule" in line]
    assert len(news) == 2
    body = ps.replace("`\n", " ")
    assert body.count("-Profile Private") == 2 and body.count("-Direction Inbound") == 2
    assert body.count("-Protocol UDP") == 2 and "-LocalPort $VideoPort" in body
    assert '$RemoteSubnet = "192.168.144.0/24"' in ps and "Remove-NetFirewallRule" in ps


def test_sender_entry_forces_headless() -> None:
    code = (f"import sys, runpy; sys.argv = ['x', '--help']; sys.path.insert(0, r'{GCS}'); "
            f"runpy.run_path(r'{PKG / 'entry_sender.py'}', run_name='__main__')")
    out = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, timeout=30,
                         env=dict(os.environ, PYTHONPATH=str(GCS)))
    assert out.returncode == 0 and "--headless" in out.stdout


@pytest.mark.skipif(sys.platform != "win32", reason="PowerShell syntax check on Windows")
@pytest.mark.parametrize("script", [PKG / "build.ps1", GCS / "scripts" / "firewall.ps1"])
def test_powershell_scripts_parse(script: Path) -> None:
    cmd = ("$e = $null; [System.Management.Automation.Language.Parser]::ParseFile("
           f"'{script}', [ref]$null, [ref]$e) | Out-Null; if ($e) {{ $e | ForEach-Object {{ $_.Message }}; exit 1 }}")
    out = subprocess.run(["powershell", "-NoProfile", "-Command", cmd], capture_output=True, text=True, timeout=60)
    assert out.returncode == 0, out.stdout + out.stderr
