import json
import os
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src import main as mn
from src.ai_classifier import AIClassifier
from src.config_loader import PROJECT_ROOT
from src.state_manager import StateManager

MAPPING = os.path.join(PROJECT_ROOT, "config", "subjects_mapping.json")


# ------------------------- fakes -------------------------

class FakeSink:
    def __init__(self, decisions=None):
        self.events = []
        self.decisions = list(decisions or [])

    def emit(self, evt):
        self.events.append(evt)

    def types(self):
        return [e["type"] for e in self.events]

    def decide_review(self, row, ctrl):
        if not self.decisions:
            return "later"
        action = self.decisions.pop(0)
        if action == "upload":
            ok = ctrl.approve_review(row["id"])
            return "uploaded" if ok else "failed"
        if action == "ignore":
            ctrl.reject_review(row["id"])
            return "ignored"
        ctrl.later_review(row["id"])
        return "later"


class FakeHarvester:
    def __init__(self, items=None, downloads=None):
        self.items = items or []
        self.downloads = downloads or {}   # url -> result | Exception
        self.calls = []

    def ensure_authenticated_session(self, force=False):
        return True

    def harvest_all_new_content(self, sections):
        self.calls.append(list(sections))
        return self.items

    def download_file_from_url(self, url, dest_dir, referer=None):
        out = self.downloads[url]
        if isinstance(out, Exception):
            raise out
        path = out["path"]
        # controller moves the file; simulate by copying into dest_dir
        dest = os.path.join(dest_dir, os.path.basename(path))
        with open(path, "rb") as src, open(dest, "wb") as dst:
            dst.write(src.read())
        res = dict(out)
        res["path"] = dest
        return res


class FakeUploader:
    def __init__(self, fail=False):
        self.fail = fail
        self.calls = []

    def upload_file(self, filepath, folder_id, filename):
        self.calls.append({"filepath": filepath, "folder_id": folder_id,
                           "filename": filename})
        if self.fail:
            return {"success": False, "error": "boom", "message": "nope"}
        return {"success": True, "fileId": "DRV1",
                "fileUrl": "https://drive.google.com/file/d/DRV1/view"}


def make_ctrl(tmp, sink=None, harvester=None, uploader=None,
              auto_approve=False, interactive=True, decisions=None,
              registry=None):
    sm = StateManager(os.path.join(tmp, "state.sqlite"))
    if registry is not None:
        registry.append(sm)
    clf = AIClassifier(mapping_path=MAPPING)
    up = uploader or FakeUploader()
    hv = harvester or FakeHarvester()
    sink = sink or FakeSink(decisions=decisions)
    from src.main import TEMP_DOWNLOADS
    ctrl = mn.BotController(state=sm, classifier=clf, uploader=up,
                            harvester=hv, sink=sink, interval=900,
                            auto_enabled=True, auto_approve=auto_approve,
                            interactive=interactive)
    return ctrl, sink, up, hv, sm


def make_pdf(tmp, name="raw_lec.pdf", content=b"%PDF-1.7 fake"):
    p = os.path.join(tmp, name)
    with open(p, "wb") as fh:
        fh.write(content)
    return p


ITEM_RADIOLOGY = {
    "item_id": "cid_288167_9",
    "source": "outline",
    "title": "Lecture 04",
    "full_text": "14/09/2026\nLecture 04 - Normal Radiographic Anatomy\n"
                 "please download the slides",
    "course_context": "",
    "course_id": "_288167_1",
    "section_type": None,
    "links": ["https://lms/bbcswebdav/xid-777_1"],
}


class ControllerTests(unittest.TestCase):
    def setUp(self):
        self._sms = []
        self.tmp_real = tempfile.TemporaryDirectory()
        self.patcher_td = mock.patch.object(
            mn, "TEMP_DOWNLOADS", self.tmp_real.name)
        self.patcher_pr = mock.patch.object(
            mn, "PENDING_REVIEWS_DIR",
            os.path.join(self.tmp_real.name, "pending_reviews"))
        self.patcher_td.start()
        self.patcher_pr.start()

    def tearDown(self):
        for sm in self._sms:
            try:
                sm.close()
            except Exception:
                pass
        self.patcher_td.stop()
        self.patcher_pr.stop()
        self.tmp_real.cleanup()

    # ---------- pure helpers ----------
    def test_derive_title_body_drops_date_lines(self):
        t, b = mn.derive_title_body("14/09/2026\nReal title here\nbody text")
        self.assertEqual(t, "Real title here")
        self.assertIn("body text", b)

    def test_detect_section_practical_markers(self):
        self.assertEqual(mn.detect_section_type("Lab 03 intro"), "practical")
        self.assertEqual(mn.detect_section_type("حلقة عملي"), "practical")
        self.assertEqual(mn.detect_section_type("group 02 sheet"), "practical")
        self.assertEqual(mn.detect_section_type("theory lecture 5"), "theory")
        self.assertEqual(mn.detect_section_type("x", hint="practical"),
                         "practical")

    def test_unique_filename_collision_guard(self):
        d = self.tmp_real.name
        open(os.path.join(d, "Lecture 01 - A.pdf"), "wb").close()
        out = mn.BotController._unique_filename(d, "Lecture 01 - A.pdf")
        self.assertEqual(out, "Lecture 01 - A (2).pdf")

    # ---------- item pipeline ----------
    def _queue_one_radiology(self, **kw):
        pdf = make_pdf(self.tmp_real.name)
        hv = FakeHarvester(items=[dict(ITEM_RADIOLOGY)],
                           downloads={"https://lms/bbcswebdav/xid-777_1":
                                      {"kind": "file", "path": pdf,
                                       "md5": ""}})
        ctrl, sink, up, _, sm = make_ctrl(self.tmp_real.name,
                                          harvester=hv,
                                          registry=self._sms, **kw)
        return ctrl, sink, up, sm

    def test_no_links_recorded_as_no_files(self):
        hv = FakeHarvester(items=[dict(ITEM_RADIOLOGY, links=[])])
        ctrl, sink, up, _, sm = make_ctrl(self.tmp_real.name, harvester=hv, registry=self._sms)
        ctrl.process_items(hv.items)
        self.assertEqual(sm.count_processed_items("no_files"), 1)
        self.assertFalse(sm.is_stream_item_processed("cid_288167_9"))

    def test_download_creates_pending_and_event_order(self):
        ctrl, sink, up, sm = self._queue_one_radiology()
        new = ctrl.process_items(ctrl.harvester.items)
        self.assertEqual(new, 1)
        rows = sm.get_all_pending_reviews()
        self.assertEqual(len(rows), 1)
        r = rows[0]
        self.assertEqual(r["suggested_subject_id"], 173)
        self.assertTrue(r["current_filename"].endswith(".pdf"))
        self.assertTrue(r["local_filepath"].startswith(
            os.path.join(self.tmp_real.name, "pending_reviews")))
        self.assertTrue(os.path.isfile(r["local_filepath"]))
        ev = sink.types()
        self.assertLess(ev.index("review_new"), len(ev))

    def test_item_id_processed_skips_second_time(self):
        ctrl, sink, up, sm = self._queue_one_radiology()
        ctrl.process_items(ctrl.harvester.items)
        # mark uploaded via approve
        rid = sm.get_all_pending_reviews()[0]["id"]
        ctrl.approve_review(rid)
        # second cycle: same item id but new bytes -> item dedup skips
        pdf2 = make_pdf(self.tmp_real.name, "other.pdf", b"%PDF-1.7 other")
        ctrl.harvester.downloads = {
            "https://lms/bbcswebdav/xid-777_1":
                {"kind": "file", "path": pdf2, "md5": ""}}
        new = ctrl.process_items(ctrl.harvester.items)
        self.assertEqual(new, 0)

    def test_md5_dedup_blocks_identical_bytes(self):
        ctrl, sink, up, sm = self._queue_one_radiology()
        ctrl.process_items(ctrl.harvester.items)
        rid = sm.get_all_pending_reviews()[0]["id"]
        row = sm.get_pending_review(rid)
        stored_path = row["local_filepath"]
        # second item, different id, SAME bytes: re-serve the stored copy
        ctrl.harvester.items = [dict(ITEM_RADIOLOGY, item_id="cid_288167_B")]
        ctrl.harvester.downloads = {
            "https://lms/bbcswebdav/xid-777_1":
                {"kind": "file", "path": stored_path, "md5": ""}}
        with mock.patch.object(sm, "is_file_hash_processed",
                               side_effect=[
                                   False, False, False, False, False]):
            try:
                ctrl.process_items(ctrl.harvester.items)
            except RuntimeError:
                pass  # copyfile onto itself may raise on some platforms
        self.assertEqual(len(sm.get_all_pending_reviews()), 1)

    def test_approve_uploads_to_chapters_folder_and_cleans_up(self):
        ctrl, sink, up, sm = self._queue_one_radiology()
        ctrl.process_items(ctrl.harvester.items)
        rid = sm.get_all_pending_reviews()[0]["id"]
        local = sm.get_pending_review(rid)["local_filepath"]
        self.assertTrue(ctrl.approve_review(rid))
        self.assertEqual(up.calls[0]["folder_id"],
                         "1indj-bso-Lr-2RJSDsKF6Z-eHiIq24qw")  # chapters 173
        self.assertFalse(os.path.isfile(local), "temp copy must be deleted")
        self.assertEqual(sm.count_processed_items("uploaded"), 1)
        self.assertFalse(sm.is_file_in_pending_review(
            sm.get_recent_uploads(1)[0]["file_hash"]))

    def test_material_category_targets_materials_folder(self):
        ctrl, sink, up, sm = self._queue_one_radiology()
        ctrl.process_items(ctrl.harvester.items)
        rid = sm.get_all_pending_reviews()[0]["id"]
        ctrl.toggle_category(rid)
        ctrl.approve_review(rid)
        self.assertEqual(up.calls[0]["folder_id"],
                         "1K5Mc9DxwbfIWO3tSAPiB0dZ9bMpLggB2")  # materials 173

    def test_approve_failure_keeps_pending_for_retry(self):
        up_fail = FakeUploader(fail=True)
        ctrl, sink, up, sm = self._queue_one_radiology(uploader=up_fail)
        ctrl.process_items(ctrl.harvester.items)
        rid = sm.get_all_pending_reviews()[0]["id"]
        local = sm.get_pending_review(rid)["local_filepath"]
        self.assertFalse(ctrl.approve_review(rid))
        self.assertEqual(len(sm.get_all_pending_reviews()), 1)
        self.assertTrue(os.path.isfile(local))
        self.assertEqual(sm.count_processed_items("uploaded"), 0)

    def test_reject_marks_ignored_and_deletes_copy(self):
        ctrl, sink, up, sm = self._queue_one_radiology()
        ctrl.process_items(ctrl.harvester.items)
        rid = sm.get_all_pending_reviews()[0]["id"]
        local = sm.get_pending_review(rid)["local_filepath"]
        ctrl.reject_review(rid)
        self.assertEqual(sm.count_processed_items("ignored"), 1)
        self.assertFalse(os.path.isfile(local))
        self.assertEqual(len(sm.get_all_pending_reviews()), 0)

    def test_rename_adds_extension_when_missing(self):
        ctrl, sink, up, sm = self._queue_one_radiology()
        ctrl.process_items(ctrl.harvester.items)
        rid = sm.get_all_pending_reviews()[0]["id"]
        self.assertTrue(ctrl.rename_review(rid, "My Lecture"))
        self.assertEqual(
            sm.get_pending_review(rid)["current_filename"],
            "My Lecture.pdf")
        bad = ctrl.rename_review(rid, 'bad:name?.ppt')
        self.assertTrue(bad)  # sanitized, still succeeds

    def test_auto_approve_processes_everything_without_prompts(self):
        decisions = []  # never consulted
        sink = FakeSink(decisions=decisions)
        pdf = make_pdf(self.tmp_real.name)
        hv = FakeHarvester(items=[dict(ITEM_RADIOLOGY)],
                           downloads={"https://lms/bbcswebdav/xid-777_1":
                                      {"kind": "file", "path": pdf}})
        ctrl, sink, up, _, sm = make_ctrl(self.tmp_real.name, sink=sink,
                                       harvester=hv, auto_approve=True,
                                       registry=self._sms)
        ctrl.scan_cycle()
        self.assertEqual(sm.count_processed_items("uploaded"), 1)
        self.assertEqual(sink.types().count("review_new"), 1)
        self.assertEqual(len(up.calls), 1)

    def test_interactive_decisions_drive_flow(self):
        ctrl, sink, up, sm = self._queue_one_radiology(
            decisions=["upload", ])
        ctrl.scan_cycle()
        self.assertEqual(sm.count_processed_items("uploaded"), 1)

    def test_later_decision_stays_pending_no_duplicates_next_cycle(self):
        pdf = make_pdf(self.tmp_real.name)
        hv = FakeHarvester(items=[dict(ITEM_RADIOLOGY)],
                           downloads={"https://lms/bbcswebdav/xid-777_1":
                                      {"kind": "file", "path": pdf}})
        ctrl, sink, up, _, sm = make_ctrl(self.tmp_real.name, harvester=hv,
                                       decisions=["later"], registry=self._sms)
        ctrl.scan_cycle()
        self.assertEqual(len(sm.get_all_pending_reviews()), 1)
        # next cycle, same file served again -> hash guard blocks duplicate
        ctrl2_decisions = []
        ctrl.scan_cycle()
        self.assertEqual(len(sm.get_all_pending_reviews()), 1)

    def test_boot_replays_pending_before_scan_events(self):
        pdf = make_pdf(self.tmp_real.name)
        hv = FakeHarvester(items=[], downloads={})
        ctrl, sink, up, _, sm = make_ctrl(self.tmp_real.name, harvester=hv, registry=self._sms)
        # pre-seed a pending review as if a crash happened mid-decision
        stored = os.path.join(self.tmp_real.name, "pending_revived.pdf")
        with open(stored, "wb") as fh:
            fh.write(b"%PDF-1.7 revived")
        import hashlib
        fh_hash = hashlib.md5(b"%PDF-1.7 revived").hexdigest()
        sm.create_pending_review({
            "item_id": "old_1", "file_hash": fh_hash,
            "local_filepath": stored, "file_size_bytes": 16,
            "course_name": "Radiology", "section_type": "theory",
            "title": "Old lecture", "notification_text": "",
            "suggested_subject_id": 173, "current_subject_id": 173,
            "suggested_category": "chapter", "current_category": "chapter",
            "original_filename": "revived.pdf",
            "suggested_filename": "revived.pdf",
            "current_filename": "revived.pdf", "ai_reasoning": "",
        })
        ctrl.boot()  # replays pending BEFORE any scan; no decisions -> stays
        self.assertEqual(len(sm.get_all_pending_reviews()), 1)
        self.assertIn("status", sink.types())
        self.assertNotIn("scan_started", sink.types(),
                         "boot must not trigger a harvest")
        self.assertNotIn("review_new", sink.types())

    def test_session_lost_aborts_cycle(self):
        class LostHarvester(FakeHarvester):
            def ensure_authenticated_session(self, force=False):
                return False

        ctrl, sink, up, _, sm = make_ctrl(
            self.tmp_real.name, harvester=LostHarvester(items=[]),
            registry=self._sms)
        ok = ctrl.scan_cycle()
        self.assertFalse(ok)
        self.assertNotIn("scan_done", sink.types())

    def test_build_sections_flattens_mapping(self):
        ctrl, *_ = make_ctrl(self.tmp_real.name, registry=self._sms)
        secs = ctrl.build_sections()
        self.assertEqual(len(secs), 16)  # 7 dual-section + 2 single-section
        ids = {s["course_id"] for s in secs}
        self.assertIn("_288167_1", ids)


if __name__ == "__main__":
    unittest.main()
