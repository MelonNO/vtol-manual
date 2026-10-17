"""The windowed UI (tkinter, standard library) - brief R1, running in its own process (R0).

``python -m vtolgcs [--sim] [--config F]`` starts this UI.  It attaches to a running RC sender (the
control file next to the config) or starts one in its own console window
(``python -m vtolgcs --headless ...``).  The UI only *asks*: every start, stop, camera and ELRS
request goes through the control channel, and the RC sender applies all of its interlocks.  Typed
confirmations (RESUME, THROTTLE, NOCLIENT, LANDED, STOP) are collected here and forwarded verbatim.

Windows: an always-on-top compact status bar, and the main window with the tabs Flight, Controller,
Client, Video, Mission Planner, ELRS and Tests.  The Tk thread never waits for the network: requests
run in worker threads and results come back through a queue polled every 100 ms.
"""

from __future__ import annotations

import json
import logging
import os
import queue
import sys
import threading
import time
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, ttk
from typing import Any, Callable

from .. import __version__, config as config_mod, crsf
from ..control import (ControlError, ControlInfo, ControlClient, WORD_LANDED, WORD_NOCLIENT, WORD_RESUME, WORD_STOP,
                       WORD_THROTTLE, default_control_file)
from ..crsf_menu import (NOT_SUPPORTED, CrsfMenu, MenuError, NotSupported, VrxFollow, VtxAdmin, control_send,
                         display_value, editable)
from ..mp_output import MpOutput
from ..testtools import (FAILSAFE_CAUSES, CameraTest, CameraTestIO, FailsafeTimer, InterfaceCounter, Results,
                         RttTest, g2g_text)
from ..video import (GST_INSTALL_HELP, FanoutProcess, choose_standard, find_gst, launch_viewer, mp_hud_pipeline,
                     viewer_pipeline, write_sdp)
from . import view
from .hotkey import GlobalHotkey
from .link import (RuntimeLink, child_env, fanout_command, frozen, package_root, passthrough_args, sender_command,
                   spawn_sender)
from .mapping import Calibration, apply_assignment, detect_moved, save_channel_map, update_config
from .profiles import ClientChoice, ProfileError, load_profiles

log = logging.getLogger("vtolgcs.ui")

POLL_MS = 100
CRIT_REPEAT_S = 5.0
FONT = ("Consolas", 10)
FONT_BIG = ("Consolas", 14, "bold")


def _sound(kind: str) -> None:
    try:
        import winsound
        alias = "SystemHand" if kind == "crit" else "SystemExclamation"
        winsound.PlaySound(alias, winsound.SND_ALIAS | winsound.SND_ASYNC)
    except Exception:
        pass


class TypedDialog(tk.Toplevel):
    """Modal: shows ``text`` and asks the operator to type ``word``. ``result`` = what was typed
    (verbatim, the RC sender checks it) or None when cancelled."""

    def __init__(self, parent: tk.Misc, title: str, text: str, word: str) -> None:
        super().__init__(parent)
        self.title(title)
        self.configure(bg=view.SURFACE)
        self.transient(parent)
        self.attributes("-topmost", True)
        self.result: str | None = None
        tk.Label(self, text=text, wraplength=560, justify="left", bg=view.SURFACE, fg=view.TEXT,
                 font=FONT).pack(padx=16, pady=(16, 8), anchor="w")
        tk.Label(self, text=f"Type {word} and press Enter (anything else cancels):", bg=view.SURFACE,
                 fg=view.AMBER, font=FONT_BIG).pack(padx=16, anchor="w")
        self.entry = tk.Entry(self, font=FONT_BIG, width=16)
        self.entry.pack(padx=16, pady=8, anchor="w")
        row = tk.Frame(self, bg=view.SURFACE)
        row.pack(padx=16, pady=(0, 16), anchor="e")
        ttk.Button(row, text="Confirm", command=self._ok).pack(side="left", padx=4)
        ttk.Button(row, text="Cancel", command=self.destroy).pack(side="left", padx=4)
        self.entry.bind("<Return>", lambda e: self._ok())
        self.bind("<Escape>", lambda e: self.destroy())
        self.entry.focus_set()
        self.grab_set()

    def _ok(self) -> None:
        self.result = self.entry.get()
        self.destroy()

    @classmethod
    def ask(cls, parent: tk.Misc, title: str, text: str, word: str) -> str | None:
        d = cls(parent, title, text, word)
        parent.wait_window(d)
        return d.result


class App:
    def __init__(self, root: tk.Tk, args: Any, argv: list[str]) -> None:
        self.root = root
        self.args = args
        self.config_path = Path(args.config) if args.config else config_mod.default_config_path()
        self.control_file = Path(args.control_file) if args.control_file else default_control_file(args.config)
        self.cfg = config_mod.load_config(self.config_path)
        self.passthrough = passthrough_args(argv)
        self.q: queue.Queue = queue.Queue()
        self.status: dict | None = None
        self.link_state, self.link_detail = "connecting", ""
        self.spawned: Any = None
        self.muted = False
        self._last_crit_sound = 0.0
        self.profiles: list[ClientChoice] = []
        self.profile: ClientChoice | None = None
        self.std_override: str | None = None
        self.fanout: FanoutProcess | None = None
        self.mp: MpOutput | None = None
        self.mp_error: str | None = None
        self.results = Results()
        self.failsafe = FailsafeTimer()
        self.follow = VrxFollow(self.cfg.crsf_menu.vrx_lock_timeout_s)
        self.events_log: list[str] = []
        self.smoke: dict[str, Any] = {"bridge_states": [], "camera_reported_on": False, "link_states": []}
        self._inputs_busy = False

        self.link = RuntimeLink(self.control_file, self._on_status_thread, self._on_event_thread,
                                lambda st, d: self.q.put(("state", (st, d))))
        self.menu = CrsfMenu(control_send(self.link), timeout_s=self.cfg.crsf_menu.timeout_ms / 1000,
                             retries=self.cfg.crsf_menu.retries)
        self.vtx = VtxAdmin(self.menu)
        self._restart_mp()

        self._style()
        self._build_main()
        self.bar = self._build_status_bar() if self.cfg.ui.status_bar else None
        self.hotkey = GlobalHotkey(self.cfg.ui.camera_hotkey, lambda: self.q.put(("call", self.toggle_camera)))
        if not (self.cfg.ui.global_hotkey and self.hotkey.start()):
            root.bind_all(f"<{self.cfg.ui.camera_hotkey}>", lambda e: self.toggle_camera())
        self._load_profiles_file(remembered=True)
        self.link.start()
        root.protocol("WM_DELETE_WINDOW", self.close)
        root.after(POLL_MS, self._poll)

    # ------------------------------------------------------------------ threads -> Tk
    def _on_status_thread(self, s: dict) -> None:
        self.status = s                                    # latest only; the Tk poll renders it
        if self.mp is not None:
            try:
                self.mp.on_status(s)
            except Exception as exc:                       # the MP output must never stop the UI
                self.mp_error = str(exc)

    def _on_event_thread(self, ev: dict) -> None:
        if ev.get("event") == "crsf":
            self.menu.feed(bytes.fromhex(ev["data"]["frame"]))
            return
        row = self.failsafe.on_event(ev)
        if row is not None:
            self.q.put(("result", row))
        self.q.put(("event", ev))

    def bg(self, fn: Callable[[], Any], done: Callable[[Any], None] | None = None) -> None:
        """Run ``fn`` in a worker thread; ``done(result_or_exception)`` runs on the Tk thread."""
        def run() -> None:
            try:
                res: Any = fn()
            except Exception as exc:                       # delivered to done()
                res = exc
            if done is not None:
                self.q.put(("call", lambda: done(res)))
        threading.Thread(target=run, daemon=True).start()

    def _poll(self) -> None:
        try:
            while True:
                kind, payload = self.q.get_nowait()
                if kind == "state":
                    self.link_state, self.link_detail = payload
                    self.smoke["link_states"].append(payload[0])
                elif kind == "event":
                    self._on_event(payload)
                elif kind == "result":
                    self._add_result(payload)
                elif kind == "call":
                    payload()
        except queue.Empty:
            pass
        self._render()
        self.root.after(POLL_MS, self._poll)

    # ------------------------------------------------------------------ style / layout
    def _style(self) -> None:
        self.root.title(f"vtol-gcs {__version__}")
        self.root.configure(bg=view.BG)
        st = ttk.Style(self.root)
        try:
            st.theme_use("clam")
        except tk.TclError:
            pass
        for name in ("TFrame", "TLabelframe", "TNotebook"):
            st.configure(name, background=view.BG)
        st.configure("TLabelframe.Label", background=view.BG, foreground=view.ACCENT, font=FONT)
        st.configure("TLabel", background=view.BG, foreground=view.TEXT, font=FONT)
        st.configure("TButton", font=FONT, padding=6)
        st.configure("TCheckbutton", background=view.BG, foreground=view.TEXT, font=FONT)
        st.configure("TRadiobutton", background=view.BG, foreground=view.TEXT, font=FONT)
        st.configure("TNotebook.Tab", font=FONT, padding=(10, 4))
        st.configure("Treeview", font=FONT, rowheight=22)

    def _lbl(self, parent: tk.Misc, text: str = "", big: bool = False, **kw: Any) -> tk.Label:
        return tk.Label(parent, text=text, bg=view.BG, fg=kw.pop("fg", view.TEXT), font=FONT_BIG if big else FONT,
                        anchor="w", justify="left", **kw)

    def _build_main(self) -> None:
        top = tk.Frame(self.root, bg=view.BG)
        top.pack(fill="x", padx=8, pady=(8, 0))
        self.banner = tk.Label(top, text="", bg=view.BG, fg=view.RED, font=("Consolas", 18, "bold"), anchor="w")
        self.banner.pack(fill="x")
        self.nb = ttk.Notebook(self.root)
        self.nb.pack(fill="both", expand=True, padx=8, pady=8)
        for name, builder in (("Flight", self._tab_flight), ("Controller", self._tab_controller),
                              ("Client", self._tab_client), ("Video", self._tab_video),
                              ("Mission Planner", self._tab_mp), ("ELRS", self._tab_elrs), ("Tests", self._tab_tests)):
            frame = ttk.Frame(self.nb)
            self.nb.add(frame, text=name)
            builder(frame)
        self.root.geometry("1100x760")

    def _build_status_bar(self) -> tk.Toplevel:
        bar = tk.Toplevel(self.root)
        bar.title("vtol-gcs status")
        bar.attributes("-topmost", True)
        bar.configure(bg=view.SURFACE)
        bar.resizable(True, False)
        self.bar_labels: dict[str, tk.Label] = {}
        self.bar_frame = tk.Frame(bar, bg=view.SURFACE)
        self.bar_frame.pack(side="left", fill="x", expand=True)
        self.bar_cam = ttk.Button(bar, text=f"CAM ({self.cfg.ui.camera_hotkey})", command=self.toggle_camera)
        self.bar_cam.pack(side="right", padx=4, pady=2)
        bar.geometry("+10+10")
        bar.protocol("WM_DELETE_WINDOW", bar.withdraw)
        return bar

    # ------------------------------------------------------------------ Flight tab
    def _tab_flight(self, f: ttk.Frame) -> None:
        modes = ttk.LabelFrame(f, text="RC stream (the RC sender applies every interlock)")
        modes.pack(fill="x", padx=8, pady=6)
        for text, cmd in (("IDLE (stop)", self.go_idle), ("FPV - normal start", self.start_fpv),
                          ("RESUME (client airborne)", self.resume), ("CARRIER-ONLY (sends DISARM)", self.carrier_only),
                          ("Camera ON/OFF", self.toggle_camera)):
            ttk.Button(modes, text=text, command=cmd).pack(side="left", padx=6, pady=6)
        proc = ttk.LabelFrame(f, text="RC sender process")
        proc.pack(fill="x", padx=8, pady=6)
        self.lbl_sender = self._lbl(proc)
        self.lbl_sender.pack(side="left", padx=6)
        ttk.Button(proc, text="Stop sender", command=self.stop_sender).pack(side="right", padx=4, pady=4)
        ttk.Button(proc, text="Start sender", command=self.start_sender).pack(side="right", padx=4, pady=4)
        ttk.Button(proc, text="Open log folder", command=self.open_logs).pack(side="right", padx=4, pady=4)
        grid = ttk.LabelFrame(f, text="Status")
        grid.pack(fill="x", padx=8, pady=6)
        self.lbl_status = self._lbl(grid)
        self.lbl_status.pack(fill="x", padx=6, pady=4)
        al = ttk.LabelFrame(f, text="Alarms")
        al.pack(fill="both", expand=True, padx=8, pady=6)
        row = tk.Frame(al, bg=view.BG)
        row.pack(fill="x")
        self.btn_mute = ttk.Button(row, text="Mute sound", command=self.toggle_mute)
        self.btn_mute.pack(side="left", padx=4, pady=4)
        self.alarm_tree = ttk.Treeview(al, columns=("sev", "text", "since"), show="headings", height=8)
        for col, w in (("sev", 60), ("text", 320), ("since", 220)):
            self.alarm_tree.heading(col, text=col)
            self.alarm_tree.column(col, width=w)
        self.alarm_tree.pack(fill="both", expand=True, padx=4, pady=4)
        self.alarm_tree.tag_configure("crit", foreground=view.RED)
        self.alarm_tree.tag_configure("warn", foreground=view.AMBER)
        ev = ttk.LabelFrame(f, text="Events")
        ev.pack(fill="both", expand=True, padx=8, pady=6)
        self.txt_events = tk.Text(ev, height=7, bg=view.SURFACE, fg=view.TEXT, font=FONT)
        self.txt_events.pack(fill="both", expand=True)

    # ------------------------------------------------------------------ Controller tab
    def _tab_controller(self, f: ttk.Frame) -> None:
        self.lbl_ctl = self._lbl(f)
        self.lbl_ctl.pack(fill="x", padx=8, pady=6)
        mon = ttk.LabelFrame(f, text="Channel monitor (what the sender would send)")
        mon.pack(fill="x", padx=8)
        self.ch_bars, self.ch_vals = [], []
        for i in range(16):
            r, c = i % 8, (i // 8) * 3
            tk.Label(mon, text=f"CH{i + 1}", bg=view.BG, fg=view.TEXT, font=FONT, width=6).grid(row=r, column=c)
            bar = ttk.Progressbar(mon, length=260, maximum=2012 - 988)
            bar.grid(row=r, column=c + 1, padx=4, pady=2)
            val = tk.Label(mon, text="--", bg=view.BG, fg=view.TEXT, font=FONT, width=16, anchor="w")
            val.grid(row=r, column=c + 2)
            self.ch_bars.append(bar)
            self.ch_vals.append(val)
        ttk.Button(f, text="Mapping / calibration wizard...", command=self.open_wizard).pack(anchor="w", padx=8, pady=8)

    def _refresh_inputs(self) -> None:
        if self._inputs_busy or not self.link.up or self.nb.index(self.nb.select()) != 1:
            return
        self._inputs_busy = True

        def done(res: Any) -> None:
            self._inputs_busy = False
            if isinstance(res, Exception) or not res.get("ok"):
                return
            inp = res["result"]
            self.lbl_ctl.config(text=f"Controller: {inp.get('name') or 'NOT CONNECTED'} | arm switch "
                                     f"{'SAFE' if inp.get('arm_switch_safe') else 'ARMED / unknown'} | throttle "
                                     f"{'low' if inp.get('throttle_low') else 'NOT low / unknown'} | devices: "
                                     f"{', '.join(inp.get('devices') or []) or '--'}")
            for i, us in enumerate(inp["channels_us"]):
                tag = " ARM" if i + 1 == inp["arm_channel"] else (" THR" if i + 1 == inp["throttle_channel"] else "")
                mapped = inp["mapped"][i]
                self.ch_bars[i]["value"] = max(0, min(1024, us - 988))
                self.ch_vals[i].config(text=f"{us} us{tag}" if mapped else f"(unmapped){tag}",
                                       fg=view.TEXT if mapped else view.MUTED)
        self.bg(lambda: self.link.request("inputs"), done)

    # ------------------------------------------------------------------ Client tab
    def _tab_client(self, f: ttk.Frame) -> None:
        row = tk.Frame(f, bg=view.BG)
        row.pack(fill="x", padx=8, pady=6)
        ttk.Button(row, text="Open profiles file (Tools page export)...", command=self.pick_profiles).pack(side="left")
        self.lbl_pfile = self._lbl(row)
        self.lbl_pfile.pack(side="left", padx=8)
        self.lst_profiles = tk.Listbox(f, height=8, bg=view.SURFACE, fg=view.TEXT, font=FONT)
        self.lst_profiles.pack(fill="x", padx=8)
        ttk.Button(f, text="Use this client", command=self.use_profile).pack(anchor="w", padx=8, pady=6)
        self.lbl_profile = self._lbl(f)
        self.lbl_profile.pack(fill="x", padx=8)

    def pick_profiles(self) -> None:
        path = filedialog.askopenfilename(title="Profiles JSON from the Tools page",
                                          filetypes=[("JSON", "*.json"), ("All files", "*.*")])
        if path:
            update_config(self.config_path, lambda c: setattr(c.ui, "profiles_file", path))
            self.cfg.ui.profiles_file = path
            self._load_profiles_file()

    def _load_profiles_file(self, remembered: bool = False) -> None:
        path = self.cfg.ui.profiles_file
        if not path:
            return
        try:
            self.profiles = load_profiles(Path(path))
        except ProfileError as exc:
            if not remembered:
                messagebox.showerror("Profiles", str(exc))
            return
        self.lbl_pfile.config(text=path)
        self.lst_profiles.delete(0, "end")
        for p in self.profiles:
            self.lst_profiles.insert("end", p.summary())
        current = next((p for p in self.profiles if p.id == self.cfg.client.profile_id), None)
        if current is not None:
            self.profile = current
            self.lbl_profile.config(text="Active: " + current.summary())

    def use_profile(self) -> None:
        sel = self.lst_profiles.curselection()
        if not sel:
            return
        p = self.profiles[sel[0]]
        self.profile = p

        def apply(c: config_mod.Config) -> None:
            c.client.profile_id = p.id
            if p.cells:
                c.client.cells = p.cells
        errors = update_config(self.config_path, apply)
        self.lbl_profile.config(text="Active: " + p.summary() + (f"  (config: {'; '.join(errors)})" if errors else ""))
        self.bg(lambda: self.link.request("set_client_profile", profile_id=p.id, cells=p.cells),
                lambda r: self._show_reply("Client profile", r))

    # ------------------------------------------------------------------ Video tab
    def _tab_video(self, f: ttk.Frame) -> None:
        fan = ttk.LabelFrame(f, text="UDP fan-out 5600 -> 127.0.0.1:5601 (viewer) / :5602 (MP HUD), own process")
        fan.pack(fill="x", padx=8, pady=6)
        ttk.Button(fan, text="Start fan-out", command=self.start_fanout).pack(side="left", padx=4, pady=4)
        ttk.Button(fan, text="Stop fan-out", command=self.stop_fanout).pack(side="left", padx=4, pady=4)
        self.lbl_fan = self._lbl(fan)
        self.lbl_fan.pack(side="left", padx=8)
        std = ttk.LabelFrame(f, text="Video standard")
        std.pack(fill="x", padx=8, pady=6)
        self.lbl_std = self._lbl(std)
        self.lbl_std.pack(side="left", padx=4)
        for s in ("PAL", "NTSC"):
            ttk.Button(std, text=f"Use {s}", command=lambda s=s: self._set_std(s)).pack(side="left", padx=4)
        ttk.Button(std, text="Auto", command=lambda: self._set_std(None)).pack(side="left", padx=4)
        self.txt_pipes: dict[str, tk.Text] = {}
        for key, title in (("viewer", "Standalone viewer (gst-launch-1.0)"),
                           ("mp", "Mission Planner HUD source (right-click HUD -> Video -> Set GStreamer Source)")):
            lf = ttk.LabelFrame(f, text=title)
            lf.pack(fill="x", padx=8, pady=4)
            t = tk.Text(lf, height=3, wrap="word", bg=view.SURFACE, fg=view.TEXT, font=FONT)
            t.pack(side="left", fill="x", expand=True, padx=4, pady=4)
            ttk.Button(lf, text="Copy", command=lambda t=t: self._copy(t.get("1.0", "end").strip())).pack(side="right", padx=4)
            self.txt_pipes[key] = t
        row = tk.Frame(f, bg=view.BG)
        row.pack(fill="x", padx=8, pady=6)
        ttk.Button(row, text="Launch viewer", command=self.launch_viewer).pack(side="left", padx=4)
        ttk.Button(row, text="Write client-video.sdp (mpv)", command=self.write_sdp).pack(side="left", padx=4)
        self.lbl_gst = self._lbl(f)
        self.lbl_gst.pack(fill="x", padx=8)

    def _standard(self) -> tuple[str | None, str]:
        if self.std_override:
            return self.std_override, "operator"
        return choose_standard(self.status, self.profile.video_standard if self.profile else None)

    def _set_std(self, s: str | None) -> None:
        self.std_override = s
        self._render_video(force=True)

    def _render_video(self, force: bool = False) -> None:
        std, src = self._standard()
        if std is None:
            self.lbl_std.config(text="UNKNOWN - no bridge flag, no client profile: choose PAL or NTSC", fg=view.AMBER)
        else:
            mismatch = (self.profile and self.profile.video_standard and src == "bridge"
                        and self.profile.video_standard != std)
            self.lbl_std.config(text=f"{std} (from {src})" + ("  WARNING: profile says " + self.profile.video_standard
                                                               if mismatch else ""),
                                fg=view.AMBER if mismatch else view.TEXT)
        key = (std, self.cfg.video.decoder)
        if force or getattr(self, "_pipe_key", None) != key:
            self._pipe_key = key
            ports = self.cfg.video.fanout_ports
            for name, fn, port in (("viewer", viewer_pipeline, ports[0]), ("mp", mp_hud_pipeline, ports[-1])):
                t = self.txt_pipes[name]
                t.delete("1.0", "end")
                t.insert("1.0", fn(std, port, self.cfg.video.decoder) if std else "(choose the video standard)")
        gst = find_gst(self.cfg.video.gst_launch_path)
        self.lbl_gst.config(text=f"GStreamer: {gst}" if gst else "GStreamer: NOT FOUND - see 'Launch viewer' for help",
                            fg=view.TEXT if gst else view.AMBER)
        if self.fanout is not None:
            st = self.fanout.latest or {}
            if self.fanout.error:
                txt = "ERROR: " + self.fanout.error
            elif not self.fanout.running:
                txt = "stopped"
            else:
                txt = (f"running: {st.get('rx_kbps', 0):.0f} kbps, {st.get('pps', 0):.0f} pkt/s, max gap "
                       f"{st.get('max_gap_ms') or 0:.0f} ms, from {st.get('source') or '--'}")
            self.lbl_fan.config(text=txt)

    def start_fanout(self) -> None:
        if self.fanout is not None and self.fanout.running:
            return
        v = self.cfg.video
        self.fanout = FanoutProcess(fanout_command(v.listen_port, v.fanout_ports, self.control_file), env=child_env(),
                                    cwd=None if frozen() else str(package_root())).start()

    def stop_fanout(self) -> None:
        if self.fanout is not None:
            self.fanout.stop()

    def launch_viewer(self) -> None:
        gst = find_gst(self.cfg.video.gst_launch_path)
        std, _ = self._standard()
        if gst is None:
            messagebox.showinfo("GStreamer", GST_INSTALL_HELP)
            return
        if std is None:
            messagebox.showwarning("Video", "Choose PAL or NTSC first.")
            return
        launch_viewer(gst, viewer_pipeline(std, self.cfg.video.fanout_ports[0], self.cfg.video.decoder))

    def write_sdp(self) -> None:
        path = write_sdp(self.config_path.parent, self.cfg.video.fanout_ports[0])
        messagebox.showinfo("SDP", f"Written: {path}\nOpen it with mpv. Verify its latency against GStreamer first.")

    def _copy(self, text: str) -> None:
        self.root.clipboard_clear()
        self.root.clipboard_append(text)

    # ------------------------------------------------------------------ Mission Planner tab
    def _tab_mp(self, f: ttk.Frame) -> None:
        mp = self.cfg.mp_output
        self.var_mp_on = tk.BooleanVar(value=mp.enabled)
        self.var_mp_mode = tk.StringVar(value=mp.mode)
        self.var_mp_sysid = tk.StringVar(value=str(mp.sysid))
        self.var_mp_port = tk.StringVar(value=str(mp.port))
        box = ttk.LabelFrame(f, text="Client vehicle in Mission Planner (second link, display only)")
        box.pack(fill="x", padx=8, pady=6)
        ttk.Checkbutton(box, text="Send client telemetry to Mission Planner", variable=self.var_mp_on).grid(
            row=0, column=0, columnspan=3, sticky="w", padx=4, pady=4)
        ttk.Radiobutton(box, text="Vehicle (HEARTBEAT, position, attitude, battery)", value="vehicle",
                        variable=self.var_mp_mode).grid(row=1, column=0, sticky="w", padx=4)
        ttk.Radiobutton(box, text="ADS-B traffic icon", value="adsb", variable=self.var_mp_mode).grid(
            row=1, column=1, sticky="w", padx=4)
        ttk.Label(box, text="sysid (2-254; never 1 or 255)").grid(row=2, column=0, sticky="w", padx=4)
        tk.Entry(box, textvariable=self.var_mp_sysid, width=6, font=FONT).grid(row=2, column=1, sticky="w")
        ttk.Label(box, text="UDP port on 127.0.0.1").grid(row=3, column=0, sticky="w", padx=4)
        tk.Entry(box, textvariable=self.var_mp_port, width=8, font=FONT).grid(row=3, column=1, sticky="w")
        ttk.Button(box, text="Apply and save", command=self.apply_mp).grid(row=4, column=0, sticky="w", padx=4, pady=6)
        self.lbl_mp = self._lbl(f)
        self.lbl_mp.pack(fill="x", padx=8)
        self._lbl(f, "Mission Planner: CONNECT drop-down -> UDP, port as above (a second connection). Inbound "
                     "packets from Mission Planner are dropped; nothing is forwarded to the bridge or the carrier.",
                  wraplength=900).pack(fill="x", padx=8, pady=8)

    def apply_mp(self) -> None:
        try:
            sysid, port = int(self.var_mp_sysid.get()), int(self.var_mp_port.get())
        except ValueError:
            messagebox.showerror("Mission Planner", "sysid and port must be numbers")
            return
        mode, on = self.var_mp_mode.get(), self.var_mp_on.get()

        def change(c: config_mod.Config) -> None:
            c.mp_output.sysid, c.mp_output.port, c.mp_output.mode, c.mp_output.enabled = sysid, port, mode, on
        errors = update_config(self.config_path, change)
        if errors:
            messagebox.showerror("Mission Planner", "\n".join(errors))          # e.g. sysid 1 or 255 (S-02b)
            return
        self.cfg = config_mod.load_config(self.config_path)
        self._restart_mp()

    def _restart_mp(self) -> None:
        if self.mp is not None:
            self.mp.close()
            self.mp = None
        self.mp_error = None
        if self.cfg.mp_output.enabled:
            try:
                self.mp = MpOutput(self.cfg.mp_output)
            except (ValueError, OSError) as exc:
                self.mp_error = str(exc)

    # ------------------------------------------------------------------ ELRS tab
    def _tab_elrs(self, f: ttk.Frame) -> None:
        row = tk.Frame(f, bg=view.BG)
        row.pack(fill="x", padx=8, pady=6)
        ttk.Button(row, text="Load ELRS menu", command=self.load_menu).pack(side="left")
        self.lbl_menu = self._lbl(row, "crsf_pass is a future bridge firmware feature (Q7a); the menu needs a "
                                       "running RC stream. Writes are refused while the client may be armed.")
        self.lbl_menu.pack(side="left", padx=8)
        body = tk.Frame(f, bg=view.BG)
        body.pack(fill="both", expand=True, padx=8)
        self.menu_tree = ttk.Treeview(body, columns=("value",), height=14)
        self.menu_tree.heading("#0", text="parameter")
        self.menu_tree.heading("value", text="value")
        self.menu_tree.column("#0", width=320)
        self.menu_tree.column("value", width=300)
        self.menu_tree.pack(side="left", fill="both", expand=True)
        self.menu_tree.bind("<<TreeviewSelect>>", lambda e: self._menu_select())
        ed = ttk.LabelFrame(body, text="Edit")
        ed.pack(side="left", fill="y", padx=8)
        self.lbl_edit = self._lbl(ed, "select a parameter", wraplength=260)
        self.lbl_edit.pack(fill="x", padx=4, pady=4)
        self.var_edit = tk.StringVar()
        self.cmb_edit = ttk.Combobox(ed, textvariable=self.var_edit, width=28, font=FONT)
        self.cmb_edit.pack(padx=4, pady=4)
        ttk.Button(ed, text="Write", command=self.write_param).pack(padx=4, pady=4, fill="x")
        ttk.Button(ed, text="Run command", command=self.run_command).pack(padx=4, pady=4, fill="x")
        vtx = ttk.LabelFrame(f, text="VTX Admin (client VTX via the ELRS link, plan §14.3)")
        vtx.pack(fill="x", padx=8, pady=6)
        self.vtx_vars = {k: tk.StringVar() for k in ("band", "channel", "power")}
        self.vtx_cmbs = {}
        for i, k in enumerate(("band", "channel", "power")):
            ttk.Label(vtx, text=k).grid(row=0, column=2 * i, padx=4)
            cmb = ttk.Combobox(vtx, textvariable=self.vtx_vars[k], width=8, font=FONT, state="readonly")
            cmb.grid(row=0, column=2 * i + 1, padx=4, pady=4)
            self.vtx_cmbs[k] = cmb
        ttk.Button(vtx, text="Apply + Send VTx", command=self.apply_vtx).grid(row=0, column=6, padx=8)
        self.btn_revert = ttk.Button(vtx, text="Revert", command=self.revert_vtx, state="disabled")
        self.btn_revert.grid(row=0, column=7, padx=4)
        self.lbl_follow = self._lbl(vtx, self.follow.text())
        self.lbl_follow.grid(row=1, column=0, columnspan=8, sticky="w", padx=4, pady=4)
        self._menu_items: dict[str, int] = {}

    def load_menu(self) -> None:
        self.lbl_menu.config(text="loading...", fg=view.TEXT)

        def done(res: Any) -> None:
            if isinstance(res, NotSupported):
                self.lbl_menu.config(text=NOT_SUPPORTED, fg=view.AMBER)
                return
            if isinstance(res, Exception):
                self.lbl_menu.config(text=f"menu: {res}", fg=view.RED)
                return
            self._fill_menu()
            dev = res.device
            self.lbl_menu.config(text=f"{dev.name} (software {dev.software_version_str}, {dev.field_count} fields"
                                      + (f", missing {res.missing}" if res.missing else "") + ")", fg=view.TEXT)
        self.bg(self.menu.load_tree, done)

    def _fill_menu(self) -> None:
        tree = self.menu.tree
        self.menu_tree.delete(*self.menu_tree.get_children())
        self._menu_items = {}
        if tree is None:
            return
        parents: dict[int, str] = {0: ""}
        for depth, parent, e in tree.rows():
            iid = self.menu_tree.insert(parents.get(parent, ""), "end", text=e.name, values=(display_value(e),), open=True)
            self._menu_items[iid] = e.number
            parents[e.number] = iid
        f = self.vtx.fields()
        if f is not None:
            for k in ("band", "channel", "power"):
                entry = getattr(f, k)
                if entry is not None:
                    self.vtx_cmbs[k]["values"] = entry.options
                    if isinstance(entry.value, int) and entry.value < len(entry.options):
                        self.vtx_vars[k].set(entry.options[entry.value])

    def _menu_entry(self) -> crsf.ParameterEntry | None:
        sel = self.menu_tree.selection()
        if not sel or self.menu.tree is None:
            return None
        return self.menu.tree.params.get(self._menu_items.get(sel[0], -1))

    def _menu_select(self) -> None:
        e = self._menu_entry()
        if e is None:
            return
        self.lbl_edit.config(text=f"{e.name} ({e.type_name}) = {display_value(e)}"
                                  + ("" if editable(e) else "  [read-only]"))
        if e.type == crsf.ParamType.TEXT_SELECTION:
            self.cmb_edit["values"] = e.options
            self.var_edit.set(e.value_label.removesuffix(e.units) if e.value_label else "")
        else:
            self.cmb_edit["values"] = ()
            self.var_edit.set("" if e.value is None else str(e.value))

    def write_param(self) -> None:
        e = self._menu_entry()
        if e is None or not editable(e) or e.type == crsf.ParamType.COMMAND:
            return
        try:
            value = e.options.index(self.var_edit.get()) if e.type == crsf.ParamType.TEXT_SELECTION \
                else int(self.var_edit.get())
        except ValueError:
            messagebox.showerror("ELRS", "not a valid value")
            return
        self.bg(lambda: self.menu.write(e.number, value), lambda r: self._menu_done("write", r))

    def run_command(self) -> None:
        e = self._menu_entry()
        if e is None or e.type != crsf.ParamType.COMMAND:
            return
        if not messagebox.askokcancel("ELRS command", f"Run '{e.name}' on the TX module?"):
            return

        def done(res: Any) -> None:
            if not isinstance(res, Exception) and res.value == crsf.CommandStep.ASK_CONFIRM:
                if messagebox.askyesno("ELRS", f"The module asks: {res.info or e.name}. Confirm?"):
                    self.bg(lambda: self.menu.command(e.number, crsf.CommandStep.CONFIRMED),
                            lambda r: self._menu_done("command", r))
                else:
                    self.bg(lambda: self.menu.command(e.number, crsf.CommandStep.CANCEL),
                            lambda r: self._menu_done("command", r))
                return
            self._menu_done("command", res)
        self.bg(lambda: self.menu.command(e.number), done)

    def _menu_done(self, what: str, res: Any) -> None:
        if isinstance(res, Exception):
            messagebox.showerror("ELRS", f"{what} failed: {res}")
        self._fill_menu()

    def apply_vtx(self) -> None:
        f = self.vtx.fields()
        if f is None:
            messagebox.showinfo("VTX Admin", "Load the ELRS menu first (no VTX Administrator folder yet).")
            return
        vals = {}
        for k in ("band", "channel", "power"):
            entry = getattr(f, k)
            if entry is not None and self.vtx_vars[k].get() in entry.options:
                vals[k] = entry.options.index(self.vtx_vars[k].get())
        if not messagebox.askokcancel("VTX Admin", f"Change the client VTX to {self.vtx_vars['band'].get()}"
                                                   f"{self.vtx_vars['channel'].get()}? The picture is lost until "
                                                   "the VRX follows."):
            return

        def done(res: Any) -> None:
            if isinstance(res, Exception):
                messagebox.showerror("VTX Admin", str(res))
            else:
                self.follow = VrxFollow(self.cfg.crsf_menu.vrx_lock_timeout_s)
                self.follow.start(res)
            self._fill_menu()
        self.bg(lambda: self.vtx.apply(vals.get("band"), vals.get("channel"), vals.get("power")), done)

    def revert_vtx(self) -> None:
        prev = self.follow.previous or {}
        self.follow.state = "reverted"
        self.bg(lambda: self.vtx.apply(prev.get("band"), prev.get("channel"), prev.get("power")),
                lambda r: self._menu_done("revert", r))

    # ------------------------------------------------------------------ Tests tab
    def _tab_tests(self, f: ttk.Frame) -> None:
        rtt = ttk.LabelFrame(f, text="UDP RTT test (relay design: video off, then full bitrate)")
        rtt.pack(fill="x", padx=8, pady=4)
        self.var_video_note = tk.StringVar(value="video off")
        ttk.Combobox(rtt, textvariable=self.var_video_note, values=("video off", "video full bitrate", "camera on"),
                     width=20, font=FONT).pack(side="left", padx=4, pady=4)
        self.var_rtt_s = tk.StringVar(value="10")
        tk.Entry(rtt, textvariable=self.var_rtt_s, width=4, font=FONT).pack(side="left")
        ttk.Label(rtt, text="s").pack(side="left")
        ttk.Button(rtt, text="Run RTT test", command=self.run_rtt).pack(side="left", padx=8)
        fs = ttk.LabelFrame(f, text="Failsafe timer (relay-design test 6, one record per cause)")
        fs.pack(fill="x", padx=8, pady=4)
        self.var_cause = tk.StringVar(value=FAILSAFE_CAUSES[1])
        ttk.Button(fs, text="Stop stream now + time", command=self.failsafe_stop_stream).pack(side="left", padx=4, pady=4)
        ttk.Combobox(fs, textvariable=self.var_cause, values=FAILSAFE_CAUSES[1:], width=18, font=FONT).pack(side="left")
        ttk.Button(fs, text="Start timer (other cause)", command=self.failsafe_start).pack(side="left", padx=4)
        ttk.Button(fs, text="STOP key (client in failsafe)  [F8]", command=self.failsafe_manual).pack(side="left", padx=4)
        self.root.bind_all("<F8>", lambda e: self.failsafe_manual())
        self.lbl_fs = self._lbl(fs)
        self.lbl_fs.pack(side="left", padx=8)
        cam = ttk.LabelFrame(f, text="Camera on/off test (relay-design test 9)")
        cam.pack(fill="x", padx=8, pady=4)
        ttk.Button(cam, text="Run camera test", command=self.run_camera_test).pack(side="left", padx=4, pady=4)
        ttk.Button(cam, text="Glass-to-glass clock window", command=self.open_g2g).pack(side="left", padx=4)
        res = ttk.LabelFrame(f, text="Results (also in the session log)")
        res.pack(fill="both", expand=True, padx=8, pady=4)
        ttk.Button(res, text="Export CSV...", command=self.export_csv).pack(anchor="w", padx=4, pady=4)
        self.txt_results = tk.Text(res, height=12, bg=view.SURFACE, fg=view.TEXT, font=FONT)
        self.txt_results.pack(fill="both", expand=True)

    def _add_result(self, row: dict) -> None:
        self.results.add(row)
        self.txt_results.insert("end", json.dumps(row) + "\n")
        self.txt_results.see("end")
        self.bg(lambda: self.link.request("log", type=f"test_{row.get('test', 'result')}",
                                          fields={k: v for k, v in row.items() if k != "test"}))

    def _rtt_source(self, since: float | None) -> tuple[float, list[tuple[float, float]]]:
        r = self.link.request("rtt_samples", since=since)["result"]
        return r["t"], [tuple(x) for x in r["samples"]]

    def run_rtt(self) -> None:
        try:
            dur = float(self.var_rtt_s.get())
        except ValueError:
            dur = 10.0
        test = RttTest(self._rtt_source, self.var_video_note.get(), dur,
                       video_kbps=lambda: ((self.status or {}).get("video") or {}).get("rx_kbps"))
        self.bg(test.run, lambda r: self._add_result(r) if isinstance(r, dict) else messagebox.showerror("RTT", str(r)))

    def failsafe_stop_stream(self) -> None:
        if not messagebox.askokcancel("Failsafe timer", "Stop the RC stream now? The client goes to failsafe "
                                                        "after T_hold. Only do this in a safe test set-up."):
            return
        self.failsafe.arm_stop()
        self.bg(lambda: self.link.request("request_mode", mode="idle"))

    def failsafe_start(self) -> None:
        cause = self.var_cause.get()
        self.bg(lambda: self.link.request("ping")["result"]["t"],
                lambda t: self.failsafe.start(cause, t) if not isinstance(t, Exception) else None)

    def failsafe_manual(self) -> None:
        def done(t: Any) -> None:
            if not isinstance(t, Exception):
                row = self.failsafe.manual_stop(t)
                if row:
                    self._add_result(row)
        self.bg(lambda: self.link.request("ping")["result"]["t"], done)

    def run_camera_test(self) -> None:
        counter = InterfaceCounter(self.cfg.bridge.ip)

        def set_camera(on: bool) -> tuple[bool, list[str]]:
            r = self.link.request("set_camera", on=on)
            return bool(r.get("ok")), list(r.get("reasons") or [])
        io_ = CameraTestIO(set_camera=set_camera,
                           camera_reported=lambda: (((self.status or {}).get("bridge") or {}).get("camera") or {}).get("reported"),
                           rtt_samples=self._rtt_source, iface_bytes=counter.read,
                           video_stats=lambda: self.fanout.latest if self.fanout else None)
        self.bg(CameraTest(io_).run,
                lambda r: self._add_result(r) if isinstance(r, dict) else messagebox.showerror("Camera test", str(r)))

    def open_g2g(self) -> None:
        w = tk.Toplevel(self.root)
        w.title("glass-to-glass clock")
        w.configure(bg="black")
        lbl = tk.Label(w, bg="black", fg="white", font=("Consolas", 96, "bold"))
        lbl.pack(padx=20, pady=20)

        def tick() -> None:
            if lbl.winfo_exists():
                lbl.config(text=g2g_text())
                w.after(1, tick)
        tick()

    def export_csv(self) -> None:
        path = filedialog.asksaveasfilename(defaultextension=".csv", filetypes=[("CSV", "*.csv")])
        if path:
            self.results.export_csv(Path(path))

    # ------------------------------------------------------------------ commands (Flight)
    def _show_reply(self, title: str, res: Any) -> None:
        if isinstance(res, Exception):
            messagebox.showerror(title, f"RC sender not reachable: {res}")
        elif not res.get("ok"):
            messagebox.showwarning(title, "REFUSED:\n" + "\n".join(res.get("reasons") or [res.get("error") or "?"]))

    def _request(self, title: str, cmd: str, **params: Any) -> None:
        self.bg(lambda: self.link.request(cmd, **params), lambda r: self._show_reply(title, r))

    def start_fpv(self) -> None:
        if messagebox.askokcancel("FPV - normal start", "Start sending the controller's channels? The arm switch "
                                                        "must be SAFE and the throttle low (the sender checks)."):
            self._request("FPV start", "request_mode", mode="fpv")

    def go_idle(self) -> None:
        if messagebox.askokcancel("IDLE", "Stop the RC stream? The bridge goes to FAILSAFE after T_hold and a "
                                          "flying client goes to its own failsafe."):
            self._request("IDLE", "request_mode", mode="idle")

    def resume(self) -> None:
        def got(res: Any) -> None:
            if isinstance(res, Exception) or not res.get("ok"):
                self._show_reply("RESUME", res)
                return
            p = res["result"]
            if not p["ok"]:
                messagebox.showwarning("RESUME", "RESUME not possible:\n" + "\n".join(p["problems"]) +
                                       f"\n\nLive values: {p['text']}")
                return
            typed = TypedDialog.ask(self.root, "RESUME (client airborne)",
                                    f"Live values: {p['text']}\n\nThe client gets these values at once "
                                    "(arm switch ARMED). Use this only when the client may be flying.", WORD_RESUME)
            if typed is None:
                return
            thr = None
            if p["needs_throttle_confirm"]:
                thr = TypedDialog.ask(self.root, "THROTTLE AT MINIMUM",
                                      f"THROTTLE AT MINIMUM ({p['throttle_us']} us): an airborne client would get "
                                      "minimum throttle.", WORD_THROTTLE)
                if thr is None:
                    return
            self._request("RESUME", "confirm_resume", token=p["token"], typed=typed, throttle_typed=thr)
        self.bg(lambda: self.link.request("prepare_resume"), got)

    def carrier_only(self) -> None:
        def got(res: Any) -> None:
            if isinstance(res, Exception) or not res.get("ok"):
                self._show_reply("CARRIER-ONLY", res)
                return
            p = res["result"]
            if not p["ok"]:
                messagebox.showwarning("CARRIER-ONLY", p["text"] + "\n\nNOT POSSIBLE:\n" + "\n".join(p["problems"]))
                return
            typed = TypedDialog.ask(self.root, "CARRIER-ONLY sends DISARM",
                                    p["text"] + "\n\nConfirm that NO client drone is powered or bound to this TX "
                                                "module.", WORD_NOCLIENT)
            if typed is None:
                return
            landed = None
            if p["needs_landed_confirm"]:
                landed = TypedDialog.ask(self.root, "FPV streamed in this session",
                                         "Confirm the client is LANDED and DISARMED.", WORD_LANDED)
                if landed is None:
                    return
            self._request("CARRIER-ONLY", "confirm_carrier_only", token=p["token"], typed=typed, landed_typed=landed)
        self.bg(lambda: self.link.request("prepare_carrier_only"), got)

    def toggle_camera(self) -> None:
        req = bool((((self.status or {}).get("bridge") or {}).get("camera") or {}).get("requested"))
        self._request("Camera", "set_camera", on=not req)

    def stop_sender(self) -> None:
        streaming = bool(((self.status or {}).get("app") or {}).get("streaming"))
        typed = None
        if streaming:
            typed = TypedDialog.ask(self.root, "Stop the RC sender",
                                    "The RC stream is running. Stopping the sender ends it: the client goes to "
                                    "failsafe.", WORD_STOP)
            if typed is None:
                return
        elif not messagebox.askokcancel("Stop the RC sender", "Stop the RC sender process?"):
            return
        self._request("Stop sender", "stop", typed=typed)

    def start_sender(self) -> None:
        if self.link.up:
            messagebox.showinfo("RC sender", "The RC sender is already running.")
            return
        self.spawned = spawn_sender(sender_command(self.passthrough))

    def open_logs(self) -> None:
        path = config_mod.log_dir(self.cfg)
        path.mkdir(parents=True, exist_ok=True)
        if hasattr(os, "startfile"):
            os.startfile(path)                                    # noqa: S606 - opens Explorer on the folder
        else:
            messagebox.showinfo("Logs", str(path))

    def toggle_mute(self) -> None:
        self.muted = not self.muted
        self.btn_mute.config(text="Unmute sound" if self.muted else "Mute sound")

    def open_wizard(self) -> None:
        MappingWizard(self)

    # ------------------------------------------------------------------ events and rendering
    def _on_event(self, ev: dict) -> None:
        kind, data = ev.get("event"), ev.get("data") or {}
        if kind == "alarm" and data.get("active") and self.cfg.ui.sound and not self.muted:
            _sound(data.get("severity", "warn"))
        if kind == "bridge_state":
            self.smoke["bridge_states"].append(data.get("to"))
        if kind in ("alarm", "mode", "interlock_refused", "suspended", "camera_refused", "bridge_state",
                    "failsafe_timing", "start_timing", "client_flight_mode", "error"):
            line = time.strftime("%H:%M:%S ") + f"{kind}: {json.dumps(data)[:200]}"
            self.txt_events.insert("end", line + "\n")
            self.txt_events.see("end")

    def _render(self) -> None:
        s = self.status if self.link_state == "up" else None
        fields = view.status_fields(s, self.link_state)
        down = self.link_state == "down"
        self.banner.config(text=(view.SENDER_DOWN + " - " + self.link_detail) if down else "")
        self.lbl_sender.config(text=f"{self.link_state.upper()} {self.link_detail}",
                               fg=view.RED if down else view.TEXT)
        if self.bar is not None:
            keys = [k for k, _, _ in fields]
            if list(self.bar_labels) != keys:
                for w in self.bar_frame.winfo_children():
                    w.destroy()
                self.bar_labels = {}
                for k in keys:
                    big = k == "sender"
                    lbl = tk.Label(self.bar_frame, bg=view.SURFACE, font=("Consolas", 16 if big else 10, "bold"))
                    lbl.pack(side="left", padx=6, pady=2)
                    self.bar_labels[k] = lbl
            for k, text, colour in fields:
                self.bar_labels[k].config(text=text, fg=colour)
        if s is not None:
            if s["bridge"]["camera"]["reported"]:
                self.smoke["camera_reported_on"] = True
            self.smoke["last_bridge_state"] = s["bridge"]["state"]
            b, c = s["bridge"], s["client"]
            self.lbl_status.config(text=(
                f"{view.mode_text(s)} | bridge {b['state']} fw {b['fw_version'] or '--'} | RTT {b['rtt_ms']} ms | "
                f"loss {b['uplink_loss_pct']}% | jitter p99 {b['send_jitter_ms_p99']} ms | "
                f"{view.camera_text(s)[0]}\n"
                f"controller {s['controller']['name'] or 'NOT CONNECTED'} | client {c['profile_id'] or '--'}: "
                f"mode {c['flight_mode']['raw'] or '--'}, LQ {c['link']['lq_pct']}%, batt {c['battery']['voltage_v']} V, "
                f"sats {c['gps']['sats']} | carrier {s['carrier']['source'] or 'no MAVLink mirror'}"))
            self._render_alarms(s["alarms"])
            lock = (s.get("video") or {}).get("decoder_lock")
            self.follow.update(lock)
        self.lbl_follow.config(text=self.follow.text())
        self.btn_revert.config(state="normal" if self.follow.offer_revert else "disabled")
        mp = self.mp
        self.lbl_mp.config(text=("MAVLink output OFF" if mp is None else
                                 f"sent {mp.stats.frames_sent} frames as sysid {mp.cfg.sysid} to "
                                 f"{mp.sock.dest[0]}:{mp.sock.dest[1]}; inbound ignored {mp.stats.inbound_ignored}")
                           + (f"  ERROR: {self.mp_error}" if self.mp_error else ""))
        self._render_video()
        self._refresh_inputs()
        if self.failsafe.running:
            self.lbl_fs.config(text=f"RUNNING ({self.failsafe.cause})", fg=view.AMBER)
        else:
            self.lbl_fs.config(text="", fg=view.TEXT)

    def _render_alarms(self, alarms: list[dict]) -> None:
        key = [(a["id"], a["since"]) for a in alarms]
        if getattr(self, "_alarm_key", None) != key:
            self._alarm_key = key
            self.alarm_tree.delete(*self.alarm_tree.get_children())
            for a in alarms:
                self.alarm_tree.insert("", "end", values=(a["severity"].upper(), a["text"], a["since"]),
                                       tags=(a["severity"],))
        crit = any(a["severity"] == "crit" for a in alarms)
        if crit and self.cfg.ui.sound and not self.muted and time.monotonic() - self._last_crit_sound > CRIT_REPEAT_S:
            self._last_crit_sound = time.monotonic()
            _sound("crit")

    def close(self) -> None:
        if self.fanout is not None and self.fanout.running:
            if messagebox.askyesno("Close", "Stop the video fan-out too? (No = it keeps forwarding video.)"):
                self.fanout.stop()
        self.shutdown()

    def shutdown(self) -> None:
        self.hotkey.stop()
        self.link.stop()
        if self.mp is not None:
            self.mp.close()
        self.root.destroy()


class MappingWizard:
    """Mapping / calibration wizard: assign channels by moving one control at a time; record travel."""

    def __init__(self, app: App) -> None:
        self.app = app
        self.win = tk.Toplevel(app.root)
        self.win.title("Mapping / calibration wizard")
        self.win.configure(bg=view.BG)
        self.cal = Calibration()
        self.map = [config_mod.ChannelSource(c.src, c.index, c.reverse, c.min, c.max)
                    for c in app.cfg.controller.channel_map]
        self.raw: dict | None = None
        self.calibrating = False
        tk.Label(self.win, text="1. Calibrate: press Start, move every stick and switch to both ends, press Stop.\n"
                                "2. Assign: choose a channel, press Detect, then move that control.\n"
                                "3. Save. The RC sender uses the new map after its next start (stop it while idle).\n"
                                "EdgeTX Classic joystick: CH1-8 = axes 0-7, CH9-16 = buttons 0-7 (the default map).",
                 bg=view.BG, fg=view.TEXT, font=FONT, justify="left").pack(padx=8, pady=8, anchor="w")
        self.lbl_raw = tk.Label(self.win, text="", bg=view.SURFACE, fg=view.TEXT, font=FONT, justify="left", anchor="w")
        self.lbl_raw.pack(fill="x", padx=8)
        row = tk.Frame(self.win, bg=view.BG)
        row.pack(fill="x", padx=8, pady=6)
        ttk.Button(row, text="Start calibration", command=lambda: setattr(self, "calibrating", True)).pack(side="left")
        ttk.Button(row, text="Stop calibration", command=lambda: setattr(self, "calibrating", False)).pack(side="left", padx=4)
        self.var_ch = tk.StringVar(value="1")
        ttk.Combobox(row, textvariable=self.var_ch, values=[str(i) for i in range(1, 17)], width=4).pack(side="left", padx=8)
        self.var_rev = tk.BooleanVar(value=False)
        ttk.Checkbutton(row, text="reverse", variable=self.var_rev).pack(side="left")
        ttk.Button(row, text="Detect", command=self.detect).pack(side="left", padx=4)
        ttk.Button(row, text="Save", command=self.save).pack(side="left", padx=12)
        self.lbl_map = tk.Label(self.win, text="", bg=view.BG, fg=view.TEXT, font=FONT, justify="left", anchor="w")
        self.lbl_map.pack(fill="x", padx=8, pady=6)
        self._show_map()
        self._tick()

    def _read(self) -> dict | None:
        try:
            r = self.app.link.request("inputs")
            return r["result"] if r.get("ok") else None
        except ControlError:
            return None

    def _tick(self) -> None:
        if not self.win.winfo_exists():
            return

        def done(res: Any) -> None:
            if isinstance(res, dict):
                self.raw = res
                axes = res.get("raw_axes")
                if axes is None:
                    self.lbl_raw.config(text="no raw input (controller not connected, or the simulated controller)")
                else:
                    if self.calibrating:
                        self.cal.add(axes)
                    self.lbl_raw.config(text="axes: " + " ".join(f"{i}:{v:+.2f}" for i, v in enumerate(axes)) +
                                             "\nbuttons: " + "".join("1" if b else "0" for b in res.get("raw_buttons") or []))
            if self.win.winfo_exists():
                self.win.after(100, self._tick)
        self.app.bg(self._read, done)

    def detect(self) -> None:
        before = self.raw
        if not before or before.get("raw_axes") is None:
            messagebox.showwarning("Wizard", "No raw input from the controller.")
            return
        end = time.monotonic() + 5

        def wait() -> Any:
            while time.monotonic() < end:
                cur = self._read()
                if cur and cur.get("raw_axes") is not None:
                    hit = detect_moved(before["raw_axes"], cur["raw_axes"], before.get("raw_buttons") or [],
                                       cur.get("raw_buttons") or [])
                    if hit:
                        return hit
                time.sleep(0.05)
            return None

        def done(hit: Any) -> None:
            if not hit or isinstance(hit, Exception):
                messagebox.showinfo("Wizard", "Nothing moved within 5 s.")
                return
            apply_assignment(self.map, int(self.var_ch.get()), hit[0], hit[1], self.var_rev.get(), self.cal)
            self._show_map()
        self.app.bg(wait, done)

    def _show_map(self) -> None:
        self.lbl_map.config(text="\n".join(
            f"CH{i + 1}: {c.src} {c.index if c.src != 'none' else ''}{' rev' if c.reverse else ''}"
            f"{f' [{c.min:+.2f}..{c.max:+.2f}]' if c.src == 'axis' else ''}" for i, c in enumerate(self.map)))

    def save(self) -> None:
        errors = save_channel_map(self.app.config_path, self.map)
        if errors:
            messagebox.showerror("Wizard", "Not saved:\n" + "\n".join(errors))
        else:
            messagebox.showinfo("Wizard", "Saved. Stop and start the RC sender (while idle) to use the new map.")


def _sender_reachable(control_file: Path) -> bool:
    try:
        ControlClient(ControlInfo.load(control_file), timeout=1.5).call("ping")
        return True
    except ControlError:
        return False


def main(args: Any, argv: list[str]) -> int:
    """UI process entry (``python -m vtolgcs`` without ``--headless``)."""
    control_file = Path(args.control_file) if args.control_file else default_control_file(args.config)
    try:
        root = tk.Tk()
    except tk.TclError as exc:
        print(f"cannot open a window ({exc}); use --headless", file=sys.stderr)
        return 5
    try:
        app = App(root, args, argv)
    except config_mod.ConfigError as exc:
        root.destroy()
        print(f"CONFIG ERROR: {exc}", file=sys.stderr)
        return 2
    if not args.attach_only and not _sender_reachable(control_file):
        app.spawned = spawn_sender(sender_command(app.passthrough))       # its own console window
    if getattr(args, "run_seconds", None):
        _smoke(app, args.run_seconds, getattr(args, "ui_smoke_out", None))
    root.mainloop()
    return 0


def _smoke(app: App, seconds: float, out: str | None) -> None:
    """Test hook (hidden ``--run-seconds``): toggle the camera once streaming, write a summary, stop the
    sender this UI started, close."""
    def camera() -> None:
        if app.status and app.status["app"]["streaming"]:
            app.toggle_camera()
        else:
            app.root.after(300, camera)

    def finish() -> None:
        if out:
            Path(out).write_text(json.dumps({**app.smoke, "link_state": app.link_state}), encoding="utf-8")
        if app.spawned is not None:
            try:
                app.link.request("stop", typed=WORD_STOP)
            except ControlError:
                pass
        app.shutdown()
    app.root.after(int(seconds * 400), camera)
    app.root.after(int(seconds * 1000), finish)


__all__ = ["App", "MappingWizard", "TypedDialog", "main"]
