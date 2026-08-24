"""pywebview GUI front-end for the Dent2025 Blackboard Sync Bot.

Bridge design (D5/D14/D24 of the plan):
  - Worker thread pushes events into a queue.Queue via GuiSink.
  - JS polls Api.get_events() every 300ms — no cross-thread evaluate_js races.
  - All js_api methods marshal to BotController methods (thread-safe).
  - Tray/toasts are OPTIONAL: guarded imports, feature-flagged, silently
    absent when the libs are missing. Core never depends on them.
"""
import ctypes
import json
import os
import queue
import subprocess
import sys
import threading

_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _PROJECT_ROOT not in sys.path:
    sys.path.insert(0, _PROJECT_ROOT)

from src.config_loader import load_config, save_config, CONFIG_DIR, PROJECT_ROOT
from src.state_manager import StateManager, calculate_file_hash  # noqa: F401
from src.bb_harvester import STORAGE_STATE_PATH

GUI_DIR = os.path.join(PROJECT_ROOT, "gui")
RUN_KEY_PATH = r"Software\Microsoft\Windows\CurrentVersion\Run"
RUN_VALUE_NAME = "Dent2025BBot"

VALID_EVENT_TYPES = {"log", "review_new", "review_update", "status",
                     "scan_started", "scan_done", "session_lost",
                     "session_restored", "request_otp", "doctor_result"}


def validate_event(evt):
    """Event-bus schema guard: every event is a dict with a known type."""
    if not isinstance(evt, dict):
        return False
    return evt.get("type") in VALID_EVENT_TYPES


def autostart_command():
    """Command string written to the HKCU Run key (pure; testable)."""
    py = (sys.executable or "pythonw.exe").replace("python.exe", "pythonw.exe")
    script = os.path.join(PROJECT_ROOT, "src", "main.py")
    return '"%s" "%s"' % (py, script)


def set_autostart(enabled):
    """HKCU Run-key toggle (stdlib winreg). Returns (ok, detail)."""
    try:
        import winreg
        key = winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER, RUN_KEY_PATH, 0,
                                 winreg.KEY_SET_VALUE)
        try:
            if enabled:
                winreg.SetValueEx(key, RUN_VALUE_NAME, 0, winreg.REG_SZ,
                                  autostart_command())
            else:
                try:
                    winreg.DeleteValue(key, RUN_VALUE_NAME)
                except FileNotFoundError:
                    pass
        finally:
            key.Close()
        return True, "ok"
    except Exception as exc:
        return False, "%s: %s" % (exc.__class__.__name__, exc)


def get_autostart():
    try:
        import winreg
        key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY_PATH)
        try:
            winreg.QueryValueEx(key, RUN_VALUE_NAME)
            return True
        except FileNotFoundError:
            return False
        finally:
            key.Close()
    except Exception:
        return False


# ---------------- First-Run Doctor checks ----------------

def check_env(config_dir=None):
    cfg = load_config(config_dir or CONFIG_DIR)
    problems = []
    if not cfg.get("BB_USERNAME"):
        problems.append("BB_USERNAME empty")
    if not cfg.get("BB_PASSWORD"):
        problems.append("BB_PASSWORD empty")
    if not cfg.get("GAS_WEBHOOK_URL"):
        problems.append("GAS_WEBHOOK_URL empty")
    return {"key": "env", "label": ".env credentials present",
            "ok": not problems,
            "detail": "; ".join(problems) if problems else "all keys set"}


def check_mapping(classifier):
    n = len(getattr(classifier, "subjects", []))
    return {"key": "mapping", "label": "subjects mapping loaded",
            "ok": n == 9, "detail": "%d subjects" % n}


def _chromium_installed():
    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as pw:
            path = pw.chromium.executable_path
            return bool(path and os.path.exists(path))
    except Exception:
        return False


def check_chromium(probe=None):
    ok = (_chromium_installed if probe is None else probe)()
    return {"key": "chromium", "label": "Playwright chromium installed",
            "ok": ok,
            "detail": "ready" if ok else "run: playwright install chromium"}


def check_session_file(path=STORAGE_STATE_PATH):
    if not os.path.isfile(path):
        return {"key": "session", "label": "Blackboard session file",
                "ok": False, "detail": "missing — run 1-Click Login"}
    try:
        with open(path, "r", encoding="utf-8") as fh:
            state = json.load(fh)
        cookies = state.get("cookies", [])
        return {"key": "session", "label": "Blackboard session file",
                "ok": len(cookies) > 0,
                "detail": "%d cookie(s)" % len(cookies)}
    except Exception as exc:
        return {"key": "session", "label": "Blackboard session file",
                "ok": False, "detail": "corrupt: %s" % exc}


def run_doctor(classifier):
    rows = [check_env(), check_mapping(classifier), check_chromium(),
            check_session_file()]
    critical_ok = all(r["ok"] for r in rows if r["key"] != "chromium") \
        and all(r["ok"] for r in rows)
    return {"rows": rows, "ok": critical_ok}


# ---------------- sinks & bridge ----------------

class GuiSink:
    """Pushes controller events to the GUI thread via queue.Queue."""

    def __init__(self):
        self.q = queue.Queue(maxsize=5000)
        self._otp_event = threading.Event()
        self._otp_code = None
        self.on_new_file = None  # optional callback (sound/flash/toast)

    def emit(self, evt):
        if not validate_event(evt):
            return
        try:
            self.q.put_nowait(evt)
        except queue.Full:
            pass
        if evt.get("type") == "review_new" and self.on_new_file:
            try:
                self.on_new_file()
            except Exception:
                pass

    # OTP round-trip: harvester asks -> GUI dialog answers
    def request_2fa_otp(self, screenshot_path, timeout=180):
        self._otp_code = None
        self._otp_event.clear()
        self.emit({"type": "request_otp", "screenshot": screenshot_path})
        self._otp_event.wait(timeout=timeout)
        return self._otp_code or None

    def submit_otp(self, code):
        self._otp_code = (code or "").strip() or None
        self._otp_event.set()

    def drain(self, limit=200):
        events = []
        while len(events) < limit:
            try:
                events.append(self.q.get_nowait())
            except queue.Empty:
                break
        return events


class Api:
    """pywebview js_api bridge — every method callable from gui/index.html."""

    def __init__(self, ctrl, sink, window_holder):
        self.ctrl = ctrl
        self.sink = sink
        self.window_holder = window_holder  # dict with 'window' when ready

    # ---- event pump ----
    def get_events(self):
        return self.sink.drain()

    # ---- controls ----
    def scan_now(self):
        threading.Thread(target=self.ctrl.scan_cycle, daemon=True).start()

    def pause_resume(self):
        self.ctrl.toggle_pause()

    def set_interval(self, seconds):
        self.ctrl.set_interval(seconds)

    # ---- review actions ----
    def approve(self, rid):
        threading.Thread(target=self.ctrl.approve_review, args=(rid,),
                         daemon=True).start()

    def reject(self, rid):
        self.ctrl.reject_review(rid)

    def later(self, rid):
        self.ctrl.later_review(rid)

    def rename(self, rid, name):
        return self.ctrl.rename_review(rid, name)

    def set_subject(self, rid, subject_id):
        self.ctrl.set_subject(rid, int(subject_id))

    def toggle_category(self, rid):
        self.ctrl.toggle_category(rid)

    def open_folder(self, local_filepath):
        folder = os.path.dirname(local_filepath or "") \
            if os.path.isfile(local_filepath or "") else local_filepath
        try:
            os.startfile(folder or PROJECT_ROOT)
            return True
        except Exception:
            return False

    def preview_file(self, local_filepath):
        try:
            if os.path.isfile(local_filepath):
                os.startfile(local_filepath)
                return True
        except Exception:
            pass
        return False

    def open_drive(self, url):
        try:
            import webbrowser
            webbrowser.open(url)
            return True
        except Exception:
            return False

    def batch_approve_all(self):
        threading.Thread(target=self._batch_approve_worker,
                         daemon=True).start()

    def _batch_approve_worker(self):
        for row in self.ctrl.state.get_all_pending_reviews():
            if row.get("current_subject_id"):
                self.ctrl.approve_review(row["id"])

    def batch_ignore_noise(self):
        for row in self.ctrl.state.get_all_pending_reviews():
            if row.get("current_category") == "ignore":
                self.ctrl.reject_review(row["id"])

    # ---- data views ----
    def get_pending(self):
        """Everything awaiting a decision — rendered at GUI startup so files
        queued while the window was closed are NEVER invisible."""
        return self.ctrl.state.get_all_pending_reviews()

    def get_subjects(self):
        return [{"id": s["id"], "name_en": s["name_en"],
                 "name_ar": s["name_ar"]}
                for s in self.ctrl.classifier.subjects]

    def get_history(self, query=""):
        """Full audit trail (every status) with subject names resolved."""
        q = (query or "").strip().lower()
        sname = {s["id"]: s["name_en"]
                 for s in self.ctrl.classifier.subjects}
        rows = self.ctrl.state.get_history(200)
        out = []
        for r in rows:
            d = dict(r)
            d["subject_name"] = sname.get(r.get("subject_id") or -1, "")
            if q:
                hay = json.dumps({k: str(v) for k, v in d.items()},
                                 ensure_ascii=False).lower()
                if q not in hay:
                    continue
            out.append(d)
        return out

    def reupload(self, history_id):
        row = next((r for r in self.ctrl.state.get_recent_uploads(100)
                    if r["id"] == history_id), None)
        pending_hash = row and row.get("file_hash")
        if not pending_hash:
            return False
        match = next((r for r in self.ctrl.state.get_all_pending_reviews()
                      if r.get("file_hash") == pending_hash), None)
        if not match or not os.path.isfile(match["local_filepath"]):
            return False  # honest scoping: needs the local copy
        return self.ctrl.approve_review(match["id"])

    # ---- doctor ----
    def doctor_status(self):
        result = run_doctor(self.ctrl.classifier)
        self.sink.emit({"type": "doctor_result", **result})
        return result

    def fix_install_chromium(self):
        def worker():
            try:
                subprocess.run([sys.executable, "-m", "playwright",
                                "install", "chromium"], timeout=600)
            except Exception:
                pass
            self.doctor_status()
        threading.Thread(target=worker, daemon=True).start()
        return True

    def fix_login(self):
        def worker():
            login_script = os.path.join(PROJECT_ROOT, "login_local.py")
            try:
                subprocess.Popen([sys.executable, login_script],
                                 cwd=PROJECT_ROOT)
            except Exception as exc:
                self.sink.emit({"type": "log", "level": "error",
                                "msg": "Could not launch login helper: %s"
                                       % exc})
        threading.Thread(target=worker, daemon=True).start()
        return True

    def ping_webhook(self):
        def worker():
            ok, detail = self.ctrl.uploader.ping()
            self.sink.emit({"type": "log",
                            "level": "ok" if ok else "error",
                            "msg": "Webhook ping: %s" % detail})
            try:
                self.doctor_status()
            except Exception:
                pass  # never let diagnostics crash the uploader probe
        threading.Thread(target=worker, daemon=True).start()
        return True

    # ---- settings ----
    def get_settings(self):
        cfg = load_config()
        return {
            "BB_USERNAME": cfg.get("BB_USERNAME", ""),
            "BB_PASSWORD": "**********" if cfg.get("BB_PASSWORD") else "",
            "GEMINI_API_KEY": cfg.get("GEMINI_API_KEY", ""),
            "GAS_WEBHOOK_URL": cfg.get("GAS_WEBHOOK_URL", ""),
            "DEFAULT_INTERVAL_SECONDS": cfg.get("DEFAULT_INTERVAL_SECONDS",
                                                900),
            "AUTO_SYNC_ENABLED": bool(cfg.get("AUTO_SYNC_ENABLED", True)),
            "autostart": get_autostart(),
        }

    def save_settings(self, updates):
        updates = updates or {}
        clean = {}
        for k in ("BB_USERNAME", "BB_PASSWORD", "GEMINI_API_KEY",
                  "GAS_WEBHOOK_URL"):
            v = updates.get(k)
            if v is not None and v != "**********":
                clean[k] = str(v)
        if updates.get("DEFAULT_INTERVAL_SECONDS") is not None:
            clean["DEFAULT_INTERVAL_SECONDS"] = str(int(
                updates["DEFAULT_INTERVAL_SECONDS"]))
        if updates.get("AUTO_SYNC_ENABLED") is not None:
            clean["AUTO_SYNC_ENABLED"] = ("true" if updates[
                "AUTO_SYNC_ENABLED"] in (True, "true", 1, "1") else "false")
        save_config(clean)
        # live-apply
        cfg = load_config()
        self.ctrl.config = cfg
        self.ctrl.interval = max(60, int(cfg.get(
            "DEFAULT_INTERVAL_SECONDS", 900)))
        self.ctrl.auto_enabled = bool(cfg.get("AUTO_SYNC_ENABLED", True))
        self.sink.emit({"type": "log", "level": "ok",
                        "msg": "Settings saved."})
        return True

    def set_autostart(self, enabled):
        ok, detail = set_autostart(bool(enabled))
        self.sink.emit({"type": "log",
                        "level": "ok" if ok else "error",
                        "msg": "Autostart %s (%s)"
                               % ("enabled" if enabled else "disabled",
                                  detail)})
        return ok

    # ---- otp ----
    def submit_otp(self, code):
        self.sink.submit_otp(code)
        return True

    # ---- window lifecycle ----
    def ui_close(self):
        window = self.window_holder.get("window")
        if window is None:
            return True
        if getattr(self.ctrl, "_close_to_tray_enabled", lambda: False)():
            window.hide()
            return True
        window.destroy()
        return True

    def ui_minimize(self):
        window = self.window_holder.get("window")
        if window is not None:
            window.minimize()


# ---------------- alerts (optional layer) ----------------

def flash_taskbar(hwnd=None):
    """FlashWindowEx fallback alert — stdlib only."""
    try:
        class FLASHW(ctypes.Structure):
            _fields_ = [("UINT", ctypes.c_uint), ("hWnd", ctypes.c_void_p),
                        ("dwFlags", ctypes.c_uint), ("uCount", ctypes.c_uint),
                        ("dwTimeout", ctypes.c_uint)]

        user32 = ctypes.windll.user32
        hwnd = hwnd or user32.GetForegroundWindow()
        FLASHW_ALL, FLASHW_TIMERNOFG = 0x3, 0xC
        info = FLASHW(0, hwnd, FLASHW_ALL | FLASHW_TIMERNOFG, 5, 0)
        info.UINT = ctypes.sizeof(info)
        user32.FlashWindowEx(ctypes.byref(info))
    except Exception:
        pass


def play_alert_sound():
    try:
        import winsound
        winsound.MessageBeep(winsound.MB_ICONASTERISK)
    except Exception:
        pass


def toast_new_files(count, title="Dent2025 Sync Bot"):
    try:
        from winotify import Notification, audio  # optional
        n = Notification(app_id=title,
                         title="New lecture files ready for review",
                         msg="%d new file(s) queued for your approval."
                             % count)
        n.set_audio(audio.Default, loop=False)
        n.show()
    except Exception:
        return False
    return True


# ---------------- entry point ----------------

def run_gui(ctrl, minimize=False, width=1180, height=760):
    """Launch the pywebview window. Returns 'gui_ok' | 'no_gui'."""
    try:
        import webview
    except ImportError:
        return "no_gui"

    sink = GuiSink()
    ctrl.sink = sink
    ctrl.harvester.sink = sink
    window_holder = {}
    api = Api(ctrl, sink, window_holder)

    # optional tray + close-to-tray behaviour
    tray_available = False
    try:
        import pystray  # noqa: F401
        import PIL  # noqa: F401
        tray_available = True
    except ImportError:
        tray_available = False
    ctrl._close_to_tray_enabled = (
        lambda: tray_available and bool(load_config().get(
            "TRAY_ON_CLOSE", False)))

    def on_new_file():
        play_alert_sound()
        flash_taskbar()
        pending = len(ctrl.state.get_all_pending_reviews())
        toast_new_files(pending)  # no-op when winotify is absent

    sink.on_new_file = on_new_file

    html_path = os.path.join(GUI_DIR, "index.html")

    def on_loaded():
        window = window_holder.get("window")
        if window is not None and minimize:
            try:
                window.minimize()
            except Exception:
                pass

    window = webview.create_window(
        "Dent2025 Blackboard Sync Bot",
        url="file:///%s" % html_path.replace("\\", "/"),
        js_api=api, width=width, height=height,
        background_color="#121212", text_select=False)
    window_holder["window"] = window
    window.events.loaded += on_loaded

    def worker():
        try:
            ctrl.boot()
        except Exception as exc:
            sink.emit({"type": "log", "level": "error",
                       "msg": "boot error: %s" % exc})
        ctrl.run()

    threading.Thread(target=worker, daemon=True).start()
    webview.start(debug=False)
    ctrl.shutdown()
    return "gui_ok"
