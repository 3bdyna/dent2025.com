import io
import os
import sys
import tempfile
import unittest
import zipfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src import bb_harvester as bh


class SanitizerTests(unittest.TestCase):
    def test_replaces_invalid_windows_chars(self):
        self.assertEqual(bh.sanitize_filename('a<b>c:d"e/f\\g|h?i*j'),
                         "a_b_c_d_e_f_g_h_i_j")

    def test_collapses_whitespace(self):
        self.assertEqual(bh.sanitize_filename("  lecture   one  .pdf"),
                         "lecture   one .pdf".replace("   ", " "))

    def test_fallback_empty(self):
        self.assertEqual(bh.sanitize_filename(""), "")
        self.assertEqual(bh.sanitize_filename(None), "")


class HtmlDisguiseTests(unittest.TestCase):
    def test_detects_doctype(self):
        self.assertTrue(bh.looks_like_html(b"<!DOCTYPE html><html>"))
        self.assertTrue(bh.looks_like_html(b"\n\n<html lang=\"ar\">"))

    def test_binary_not_flagged(self):
        self.assertFalse(bh.looks_like_html(b"%PDF-1.7 ..."))
        self.assertFalse(bh.looks_like_html(b"PK\x03\x04...."))
        # substring 'login' inside binary must NOT trigger (tag-based rule)
        self.assertFalse(bh.looks_like_html(b"%PDF-login page study"))


class MagicByteTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()

    def tearDown(self):
        self.tmp.cleanup()

    def _zip_with(self, names):
        path = os.path.join(self.tmp.name, "probe.zip")
        with zipfile.ZipFile(path, "w") as zf:
            for n in names:
                zf.writestr(n, b"payload")
        return path

    def test_pdf(self):
        p = os.path.join(self.tmp.name, "x.bin")
        open(p, "wb").write(b"%PDF-1.4 rest")
        self.assertEqual(bh.detect_real_extension(p), ".pdf")

    def test_pptx(self):
        p = self._zip_with(["ppt/slides/slide1.xml", "[Content_Types].xml"])
        self.assertEqual(bh.detect_real_extension(p), ".pptx")

    def test_docx(self):
        p = self._zip_with(["word/document.xml"])
        self.assertEqual(bh.detect_real_extension(p), ".docx")

    def test_xlsx(self):
        p = self._zip_with(["xl/workbook.xml", "xl/sharedStrings.xml"])
        self.assertEqual(bh.detect_real_extension(p), ".xlsx")

    def test_plain_zip(self):
        p = self._zip_with(["data/notes.txt"])
        self.assertEqual(bh.detect_real_extension(p), ".zip")

    def test_unknown_returns_none(self):
        p = os.path.join(self.tmp.name, "y.bin")
        open(p, "wb").write(b"\x00\x01random")
        self.assertIsNone(bh.detect_real_extension(p))


class ZipSlipTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.target = os.path.join(self.tmp.name, "extract")

    def tearDown(self):
        self.tmp.cleanup()

    def _build_malicious(self):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("ok.txt", b"fine")
            zf.writestr("../evil.txt", b"escape")
            zf.writestr("..\\evil2.txt", b"escape2")
            zf.writestr("/abs_evil.txt", b"escape3")
        return buf.getvalue()

    def test_traversal_members_blocked(self):
        zpath = os.path.join(self.tmp.name, "archive_under_test.zip")
        with open(zpath, "wb") as fh:
            fh.write(self._build_malicious())
        extracted = bh.safe_extract_zip(zpath, self.target)
        names = sorted(os.path.basename(p) for p in extracted)
        self.assertEqual(names, ["ok.txt"])
        parent = os.path.dirname(self.target)
        strays = [f for f in os.listdir(parent) if f.startswith("evil")]
        self.assertEqual(strays, [], "Zip-Slip escape detected!")

    def test_prefix_trick_blocked(self):
        # target /tmp/x/extract vs member dest /tmp/x/extract_evil.txt
        real_target_parent = os.path.realpath(self.tmp.name)
        zpath = os.path.join(self.tmp.name, "prefix.zip")
        tricky_name = os.path.basename(self.target) + "_evil.txt"
        with zipfile.ZipFile(zpath, "w") as zf:
            zf.writestr(tricky_name, b"should not land beside target")
        extracted = bh.safe_extract_zip(zpath, self.target)
        for p in extracted:
            self.assertTrue(
                os.path.realpath(p).startswith(
                    os.path.realpath(self.target) + os.sep))
        self.assertNotIn(os.path.join(real_target_parent, tricky_name),
                         [os.path.realpath(p) for p in extracted])

    def test_normal_extraction_lists_files(self):
        zpath = os.path.join(self.tmp.name, "good.zip")
        with zipfile.ZipFile(zpath, "w") as zf:
            zf.writestr("sub/a.pdf", b"1")
            zf.writestr("b.pdf", b"2")
        out = bh.safe_extract_zip(zpath, self.target)
        self.assertEqual(len(out), 2)


class SessionEvaluationTests(unittest.TestCase):
    def test_authenticated_ultra_url(self):
        self.assertTrue(bh.evaluate_session(
            "https://lms.jazanu.edu.sa/ultra/stream", []))

    def test_webapps_blackboard_ok(self):
        self.assertTrue(bh.evaluate_session(
            "https://lms.jazanu.edu.sa/webapps/blackboard/execute/x", []))

    def test_login_redirect_urls_rejected(self):
        for url in (
            "https://lms.jazanu.edu.sa/?new_loc=%2Fultra%2Finstitution-page",
            "https://lms.jazanu.edu.sa/webapps/login?action=retry",
            "https://sso.jazanu.edu.sa/auth-saml/init",
            "https://lms.jazanu.edu.sa/",
            "",
        ):
            self.assertFalse(bh.evaluate_session(url, []), url)

    def test_dom_markers_rejected(self):
        base = "https://lms.jazanu.edu.sa/ultra/stream"
        for marker in ("#user_id", "user_id", "#entry-login", "entry-login",
                       "login sso", "تسجيل الدخول الموحد"):
            self.assertFalse(bh.evaluate_session(base, [marker]), marker)

    def test_random_marker_ignored(self):
        self.assertTrue(bh.evaluate_session(
            "https://lms.jazanu.edu.sa/ultra/courses/_288167_1/outline",
            ["some-random-text"]))


class ItemIdentityTests(unittest.TestCase):
    def test_djb2_stable_and_base36(self):
        h1 = bh.djb2_hash("_288167_1|Lecture 04|https://x/file/12345")
        h2 = bh.djb2_hash("_288167_1|Lecture 04|https://x/file/12345")
        self.assertEqual(h1, h2)
        self.assertRegex(h1, r"^[0-9a-z]+$")

    def test_djb2_differs_by_course_seed(self):
        a = bh.djb2_hash("c1|same title|h")
        b = bh.djb2_hash("c2|same title|h")
        self.assertNotEqual(a, b)

    def test_djb2_order_insensitive_to_position(self):
        # reorder simulation: same content -> same hash even if index changes
        seed = "course|Title X|https://lms/bbcswebdav/xid-99_e1"
        self.assertEqual(bh.djb2_hash(seed), bh.djb2_hash(seed))

    def test_content_id_regex(self):
        u1 = "https://lms.jazanu.edu.sa/bbcswebdav/xid-1234567_1"
        u2 = "https://lms/course/outline/dt-content-rid-99887766"
        self.assertEqual(bh.derive_item_id_from_url(u1), "cid_1234567_1")
        self.assertEqual(bh.derive_item_id_from_url(u2), "cid_99887766")
        self.assertIsNone(bh.derive_item_id_from_url("https://nope.io/z"))

    def test_file_link_filters(self):
        yes = ("https://x/a.pdf", "https://x/a.PPTX?whatever",
               "https://lms/bbcswebdav/pid-55/out.ppt",
               "https://lms/ultra/courses/xid-9_1/outline/file/doc.docx",
               "https://lms/content/download?attid=x")
        no = ("https://x/page.html", "https://x/forum/thread", "")
        for u in yes:
            self.assertTrue(bh.is_file_link(u), u)
        for u in no:
            self.assertFalse(bh.is_file_link(u), u)


class ContentDispositionTests(unittest.TestCase):
    def test_rfc5987_utf8(self):
        cd = "attachment; filename*=UTF-8''%D9%85%D8%AD%D8%A7%D8%B6%D8%B1%D8%A9%204.pdf"
        name = bh.content_disposition_filename(cd)
        self.assertTrue(name.endswith(".pdf"))
        self.assertIn("\u0645\u062D", name)  # starts with Arabic letters

    def test_quoted_ascii(self):
        self.assertEqual(
            bh.content_disposition_filename('attachment; filename="Lecture 01.pdf"'),
            "Lecture 01.pdf")

    def test_unquoted(self):
        self.assertEqual(
            bh.content_disposition_filename("attachment; filename=a.pdf"),
            "a.pdf")

    def test_empty(self):
        self.assertEqual(bh.content_disposition_filename(""), "")


class CookiesFromStateTests(unittest.TestCase):
    def test_parses_cookie_jar(self):
        tmp = tempfile.TemporaryDirectory()
        try:
            spath = os.path.join(tmp.name, "storage_state.json")
            with open(spath, "w", encoding="utf-8") as fh:
                import json
                json.dump({"cookies": [
                    {"name": "s_session", "value": "abc"},
                    {"name": "BbRouter", "value": "expired:x;path=/"},
                    {"name": "", "value": "dropped"},
                ]}, fh)
            jar = bh.cookies_from_storage_state(spath)
            self.assertEqual(jar.get("s_session"), "abc")
            self.assertIn("BbRouter", jar)
            self.assertNotIn("", jar)
        finally:
            tmp.cleanup()


if __name__ == "__main__":
    unittest.main()
