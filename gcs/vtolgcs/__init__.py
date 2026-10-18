"""vtolgcs — Windows GCS companion app for the vtol-manual relay.

Shared protocol layer (WP03):

* :mod:`vtolgcs.protocol` — relay UDP protocol v1 (``rc_up``, ``status``,
  ``crsf_fwd``, ``crsf_pass``), CRC-16/CCITT-FALSE, CRSF channel packing.
* :mod:`vtolgcs.crsf` — CRSF stream parser, frame builders and telemetry /
  parameter decoders.

Headless runtime (WP08a): :mod:`vtolgcs.runtime` wires the controller, the RC
sender with its safety interlocks, the bridge receiver, client telemetry,
alarms, the read-only MAVLink input, the local API (contract C2) and the
session log.  Run it with ``python -m vtolgcs --headless [--sim]``; see
``gcs/README.md``.

UI and tools (WP08b), in a separate process from the RC sender: :mod:`vtolgcs.ui`
(``python -m vtolgcs``), :mod:`vtolgcs.control` (local control channel),
:mod:`vtolgcs.video`, :mod:`vtolgcs.mp_output`, :mod:`vtolgcs.crsf_menu`, :mod:`vtolgcs.testtools`.

The protocol is a **PROPOSAL v1** that must be agreed with the G0 bridge
firmware before flight; see ``protocol/README.md`` in the repository.
"""

__version__ = "2.0.0"
