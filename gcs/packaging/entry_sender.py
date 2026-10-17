"""PyInstaller entry of ``vtol-gcs-sender.exe`` (console): the RC sender process (always ``--headless``),
or the video fan-out helper (``--video-fanout``).  The UI starts both; they never run inside the UI."""

import sys

from vtolgcs.__main__ import main

if __name__ == "__main__":
    argv = sys.argv[1:]
    if argv[:1] != ["--video-fanout"] and "--headless" not in argv:
        argv = ["--headless", *argv]
    sys.exit(main(argv))
