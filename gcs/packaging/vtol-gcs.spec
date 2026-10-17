# -*- mode: python ; coding: utf-8 -*-
# PyInstaller spec for vtol-gcs (brief R8): ONE folder, gcs/dist/vtol-gcs/, with two programs:
#   vtol-gcs.exe         windowed UI process (status bar, tabs, MP output, ELRS menu, test tools)
#   vtol-gcs-sender.exe  console RC sender process (--headless) and the video fan-out helper
# Two processes on purpose (brief R0): the UI must never share an interpreter with the RC sender.
# Build with gcs/packaging/build.ps1 (never commit gcs/dist or gcs/build).
import os

HERE = os.path.dirname(os.path.abspath(SPEC))          # noqa: F821 - SPEC is set by PyInstaller
GCS = os.path.dirname(HERE)

HIDDEN = ["pygame", "vtolgcs.ui.app", "vtolgcs.ui.link", "vtolgcs.ui.view", "vtolgcs.ui.profiles",
          "vtolgcs.ui.mapping", "vtolgcs.ui.hotkey", "vtolgcs.video", "vtolgcs.control", "vtolgcs.mp_output",
          "vtolgcs.crsf_menu", "vtolgcs.testtools"]
EXCLUDES = ["pytest", "_pytest", "numpy", "PIL"]
DATAS = [(os.path.join(GCS, "README.md"), "."), (os.path.join(GCS, "scripts", "firewall.ps1"), "scripts")]

a_ui = Analysis([os.path.join(HERE, "entry_ui.py")], pathex=[GCS], hiddenimports=HIDDEN, excludes=EXCLUDES,
                datas=DATAS, noarchive=False)
a_tx = Analysis([os.path.join(HERE, "entry_sender.py")], pathex=[GCS], hiddenimports=HIDDEN, excludes=EXCLUDES,
                noarchive=False)
pyz_ui = PYZ(a_ui.pure)
pyz_tx = PYZ(a_tx.pure)

exe_ui = EXE(pyz_ui, a_ui.scripts, [], exclude_binaries=True, name="vtol-gcs", console=False,
             upx=False, debug=False)
exe_tx = EXE(pyz_tx, a_tx.scripts, [], exclude_binaries=True, name="vtol-gcs-sender", console=True,
             upx=False, debug=False)

coll = COLLECT(exe_ui, exe_tx, a_ui.binaries, a_ui.datas, a_tx.binaries, a_tx.datas,
               strip=False, upx=False, name="vtol-gcs")
