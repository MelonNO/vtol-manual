"""Windowed UI of the GCS companion app (WP08b, brief R0/R1). It runs in its own process.

* :mod:`vtolgcs.ui.app` - tkinter main window and always-on-top status bar
* :mod:`vtolgcs.ui.link` - control channel + C2 status feed + RC sender process management
* :mod:`vtolgcs.ui.view` - status-bar fields and colours (pure)
* :mod:`vtolgcs.ui.profiles` - client profiles from the Tools page export (pure)
* :mod:`vtolgcs.ui.mapping` - mapping / calibration wizard logic (pure)
* :mod:`vtolgcs.ui.hotkey` - system-wide camera hotkey (Windows)

Importing this package opens no window; only :func:`vtolgcs.ui.app.main` does.
"""
