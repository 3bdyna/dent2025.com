import json
import os
import shutil
import sys
import tempfile
import threading
import time
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src import gui_app as g
from src.config_loader import load_config, save_config, parse_env_text
from src.ai_classifier import AIClassifier
from src.config_loader import PROJECT_ROOT

MAPPING = os.path.join(PROJECT_ROOT, "config", "subjects_mapping.json")


class EventSchemaTests(unittest.TestCase):
    def test_valid_types_pass(self):
        for t in ("log", "review_new", "review_update", "status",
                  "scan_started", "scan_done", "session_lost",
                  "session_restored", "request_otp", "doctor_result"):
            self.assertTrue(g.validate_event({"type": t, "x": 1}), t)

    def test_unknown_type_rejected(self):
        self.assertFalse(g.validate_event({"type": "banana"}))
        self.assertFalse(g.validate_event("not a dict"))
        self.assertFalse(g.validate_event({}))


class QueueDrainTests(unittest.TestCase):
    def test_fifo_order_and_limit(self):
        s = g.GuiSink()
        for i in range(10):
            s.emit({"type": "log", "level": "info", "msg": "m%d" % i})
        out = s.drain(limit=4)
        self.assertEqual([e["msg"] for e in out], ["m0", "m1", "m2", "m3"])
        rest = s.drain()
        self.assertEqual(len(rest), 6)

    def test_invalid_events_dropped(self):
        s = g.GuiSink()
        s.emit({"type": "nope"})
        s.emit({"type": "log", "msg": "good"})
        self.assertEqual(len(s.drain()), 1)

    def test_full_queue_never_raises(self):
        s = g.GuiSink()
        s.q.maxsize = 2
        for i in range(50):
            s.emit({"type": "log", "level": "info", "msg": "x%d" % i})
        self.assertLessEqual(len(s.drain()), 2)


class OtpRoundTripTests(unittest.TestCase):
    def test_submit_otp_unblocks_waiter(self):
        s = g.GuiSink()
        result = {}

        def waiter():
            result["code"] = s.request_2fa_otp("", timeout=3)

        th = threading.Thread(target=waiter, daemon=True)
        th.start()
        time.sleep(0.2)
        self.assertTrue(any(e["type"] == "request_otp" for e in s.drain()))
        s.submit_otp(" 123456 ")
        th.join(timeout=3)
        self.assertFalse(th.is_alive())
        self.assertEqual(result["code"], "123456")

    def test_timeout_returns_none(self):
        s = g.GuiSink()
        t0 = time.time()
        self.assertIsNone(s.request_2fa_otp("", timeout=1))
        self.assertGreaterEqual(time.time() - t0, 0.9)


class DoctorTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.clf = AIClassifier(mapping_path=MAPPING)

    def tearDown(self):
        self.tmp.cleanup()

    def test_env_check_missing_file(self):
        row = g.check_env(config_dir=os.path.join(self.tmp.name, "empty"))
        self.assertFalse(row["ok"])

    def test_env_check_filled(self):
        cfg_dir = os.path.join(self.tmp.name, "cfg")
        os.makedirs(cfg_dir)
        save_config({"BB_USERNAME": "u@x.sa", "BB_PASSWORD": "p",
                     "GAS_WEBHOOK_URL": "https://script.google.com/x/exec"},
                    config_dir=cfg_dir)
        row = g.check_env(config_dir=cfg_dir)
        self.assertTrue(row["ok"], row)

    def test_mapping_check(self):
        row = g.check_mapping(self.clf)
        self.assertTrue(row["ok"])
        self.assertEqual(row["detail"], "9 subjects")

    def test_session_file_missing(self):
        row = g.check_session_file(os.path.join(self.tmp.name, "none.json"))
        self.assertFalse(row["ok"])

    def test_session_file_valid(self):
        p = os.path.join(self.tmp.name, "ss.json")
        with open(p, "w", encoding="utf-8") as fh:
            json.dump({"cookies": [{"name": "a", "value": "b"}]}, fh)
        self.assertTrue(g.check_session_file(p)["ok"])

    def test_session_file_corrupt(self):
        p = os.path.join(self.tmp.name, "bad.json")
        with open(p, "w", encoding="utf-8") as fh:
            fh.write("{not json")
        self.assertFalse(g.check_session_file(p)["ok"])

    def test_chromium_check_with_probe(self):
        self.assertTrue(g.check_chromium(lambda: True)["ok"])
        self.assertFalse(g.check_chromium(lambda: False)["ok"])

    def test_run_doctor_aggregates(self):
        out = g.run_doctor(self.clf)  # real env may be unfilled; shape check
        self.assertIn("rows", out)
        self.assertIn("ok", out)
        self.assertEqual(len(out["rows"]), 4)


class SettingsPersistenceTests(unittest.TestCase):
    def test_save_preserves_unknown_keys_and_comments(self):
        tmp = tempfile.TemporaryDirectory()
        try:
            cfg_dir = os.path.join(tmp.name, "cfg")
            os.makedirs(cfg_dir)
            with open(os.path.join(cfg_dir, ".env"), "w",
                      encoding="utf-8") as fh:
                fh.write('# my comment\nBB_USERNAME="old@x.sa"\n'
                         'MY_CUSTOM_KEY="keep me"\n')
            save_config({"BB_USERNAME": "new@x.sa",
                         "DEFAULT_INTERVAL_SECONDS": "300"},
                        config_dir=cfg_dir)
            raw = open(os.path.join(cfg_dir, ".env"), encoding="utf-8").read()
            parsed = parse_env_text(raw)
            self.assertEqual(parsed["BB_USERNAME"], "new@x.sa")
            self.assertEqual(parsed["MY_CUSTOM_KEY"], "keep me")
            self.assertEqual(parsed["DEFAULT_INTERVAL_SECONDS"], "300")
            self.assertIn("# my comment", raw)
        finally:
            tmp.cleanup()

    def test_masked_password_not_overwritten(self):
        tmp = tempfile.TemporaryDirectory()
        try:
            cfg_dir = os.path.join(tmp.name, "cfg")
            os.makedirs(cfg_dir)
            save_config({"BB_PASSWORD": "secret"}, config_dir=cfg_dir)
            # GUI round-trips '**********'; must not clobber the secret
            updates = {"BB_PASSWORD": "**********"}
            clean = {k: v for k, v in updates.items() if v != "**********"}
            save_config(clean, config_dir=cfg_dir)
            self.assertEqual(
                load_config(cfg_dir).get("BB_PASSWORD"), "secret")
        finally:
            tmp.cleanup()


class AutostartCommandTests(unittest.TestCase):
    def test_command_shape(self):
        cmd = g.autostart_command()
        self.assertIn("main.py", cmd)
        self.assertTrue(cmd.startswith('"'), cmd)
        self.assertIn('" "', cmd)


class ApiMarshalingTests(unittest.TestCase):
    class _Ctrl:
        def __init__(self):
            self.calls = []

        def rename_review(self, rid, name):
            self.calls.append(("rename", rid, name))
            return True

        def set_subject(self, rid, sid):
            self.calls.append(("subject", rid, sid))

        def toggle_pause(self):
            self.calls.append(("pause",))

    def test_api_routes_to_controller(self):
        ctrl = ApiMarshalingTests._Ctrl()
        sink = g.GuiSink()
        api = g.Api(ctrl, sink, {})
        api.rename(7, "New Name.pdf")
        api.set_subject(7, 173)
        api.pause_resume()
        self.assertEqual(ctrl.calls[0], ("rename", 7, "New Name.pdf"))
        self.assertEqual(ctrl.calls[1], ("subject", 7, 173))
        self.assertEqual(ctrl.calls[2], ("pause",))

    def test_ping_webhook_emits_result_event(self):
        class _Up:
            def ping(self):
                return True, "HTTP 200 + JSON"

        class _Ctrl2(ApiMarshalingTests._Ctrl):
            uploader = _Up()

        ctrl = _Ctrl2()
        sink = g.GuiSink()
        api = g.Api(ctrl, sink, {})
        api.ping_webhook()
        deadline = time.time() + 3
        types = []
        while time.time() < deadline:
            types = [e["type"] for e in sink.drain()]
            if "log" in types:
                break
            time.sleep(0.05)
        self.assertIn("log", types)


if __name__ == "__main__":
    unittest.main()
