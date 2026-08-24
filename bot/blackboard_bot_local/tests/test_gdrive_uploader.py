import http.server
import json
import os
import sys
import tempfile
import threading
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src import gdrive_uploader as gdu


class _Handler(http.server.BaseHTTPRequestHandler):
    behavior = {"mode": "ok", "redirect": False}

    def log_message(self, *a):  # silence test output
        pass

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length)
        HandlerHolder.last_body = body
        mode = self.behavior["mode"]
        if self.behavior["redirect"]:
            self.send_response(302)
            self.send_header("Location", "/final")
            self.end_headers()
            return
        self._serve_json(mode)

    def do_GET(self):
        # urllib turns a redirected POST into a GET at the target —
        # same as Google's script.googleusercontent.com hop.
        self._serve_json(self.behavior["mode"])

    def _serve_json(self, mode):
        if mode == "ok":
            resp = {"success": True, "fileId": "DRV123",
                    "fileUrl": "https://drive.google.com/file/d/DRV123/view"}
        elif mode == "fail":
            resp = {"success": False, "message": "quota exceeded"}
        elif mode == "garbage":
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"<html>not json</html>")
            return
        elif mode == "unknown_action":
            resp = {"success": False, "message": "unknown action ping"}
        else:
            resp = {}
        data = json.dumps(resp).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET_unused(self):
        pass


class HandlerHolder:
    last_body = None


class UploaderTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
        cls.port = cls.server.server_address[1]
        cls.thread = threading.Thread(target=cls.server.serve_forever,
                                      daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def setUp(self):
        _Handler.behavior = {"mode": "ok", "redirect": False}
        self.tmp = tempfile.TemporaryDirectory()
        self.pdf = os.path.join(self.tmp.name, "Lecture 01 - Bones.pdf")
        with open(self.pdf, "wb") as fh:
            fh.write(b"%PDF-1.7 fake pdf bytes")

    def tearDown(self):
        self.tmp.cleanup()

    def url(self):
        return "http://127.0.0.1:%d/exec" % self.port

    # ---------- MIME ----------
    def test_mime_map(self):
        self.assertEqual(gdu.resolve_mime("a.PDF"), "application/pdf")
        self.assertEqual(gdu.resolve_mime("a.pptx"),
                         "application/vnd.openxmlformats-officedocument."
                         "presentationml.presentation")
        self.assertEqual(gdu.resolve_mime("a.doc"), "application/msword")
        self.assertEqual(gdu.resolve_mime("a.jpg"), "image/jpeg")
        self.assertEqual(gdu.resolve_mime("a.jpeg"), "image/jpeg")
        self.assertEqual(gdu.resolve_mime("a.zip"), "application/zip")

    def test_mime_fallback_octet_stream(self):
        self.assertEqual(gdu.resolve_mime("a.weird"), "application/octet-stream")

    # ---------- success / payload shape ----------
    def test_upload_success_normalized(self):
        out = gdu.upload_file(self.pdf, "folderX", "Lecture 01 - Bones.pdf",
                              self.url())
        self.assertTrue(out["success"])
        self.assertEqual(out["fileId"], "DRV123")
        self.assertIn("drive.google.com", out["fileUrl"])

    def test_payload_shape(self):
        gdu.upload_file(self.pdf, "folderX", "n.pdf", self.url())
        sent = json.loads(HandlerHolder.last_body.decode())
        for key in ("action", "folderId", "filename", "fileContent",
                    "mimeType"):
            self.assertIn(key, sent)
        self.assertEqual(sent["action"], "upload_file")
        self.assertEqual(sent["folderId"], "folderX")
        self.assertEqual(sent["mimeType"], "application/pdf")
        import base64
        raw = base64.b64decode(sent["fileContent"])
        self.assertTrue(raw.startswith(b"%PDF"))

    def test_redirect_followed(self):
        _Handler.behavior = {"mode": "ok", "redirect": True}
        out = gdu.upload_file(self.pdf, "fX", "n.pdf", self.url())
        self.assertTrue(out["success"], out)

    # ---------- failure modes ----------
    def test_gas_failure_json(self):
        _Handler.behavior = {"mode": "fail", "redirect": False}
        out = gdu.upload_file(self.pdf, "fX", "n.pdf", self.url())
        self.assertFalse(out["success"])
        self.assertTrue(out["error"] or out["message"])

    def test_non_json_response(self):
        _Handler.behavior = {"mode": "garbage", "redirect": False}
        out = gdu.upload_file(self.pdf, "fX", "n.pdf", self.url())
        self.assertFalse(out["success"])
        self.assertEqual(out["error"], "bad_json")

    def test_oversize_rejected_before_read(self):
        big = os.path.join(self.tmp.name, "big.bin")
        with open(big, "wb") as fh:
            fh.seek(gdu.MAX_UPLOAD_BYTES + 1)
            fh.write(b"\0")
        out = gdu.upload_file(big, "fX", "big.bin", self.url())
        self.assertFalse(out["success"])
        self.assertEqual(out["error"], "too_large")
        self.assertIn("cap", out["message"])

    def test_missing_file_and_config(self):
        out = gdu.upload_file(r"Z:\nope.pdf", "f", "x.pdf", self.url())
        self.assertFalse(out["success"])
        self.assertEqual(out["error"], "file_not_found")
        out = gdu.upload_file(self.pdf, "", "x.pdf", self.url())
        self.assertEqual(out["error"], "no_folder")
        out = gdu.upload_file(self.pdf, "f", "x.pdf", "")
        self.assertEqual(out["error"], "no_webhook")

    def test_unreachable_server_never_raises(self):
        out = gdu.upload_file(self.pdf, "f", "x.pdf",
                              "http://127.0.0.1:9/exec", timeout=1)
        self.assertFalse(out["success"])
        self.assertTrue(out["error"])

    # ---------- ping semantics ----------
    def test_ping_ok_on_unknown_action_json(self):
        _Handler.behavior = {"mode": "unknown_action", "redirect": False}
        ok, detail = gdu.ping_webhook(self.url())
        self.assertTrue(ok, detail)

    def test_ping_unreachable(self):
        ok, _ = gdu.ping_webhook("http://127.0.0.1:9/exec", timeout=1)
        self.assertFalse(ok)
        ok, detail = gdu.ping_webhook("")
        self.assertFalse(ok)


if __name__ == "__main__":
    unittest.main()
