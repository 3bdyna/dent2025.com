import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.state_manager import StateManager, calculate_file_hash


class StateManagerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.sm = StateManager(os.path.join(self.tmp.name, "state", "bot_state.sqlite"))

    def tearDown(self):
        self.sm.close()
        self.tmp.cleanup()

    # ---------- schema / WAL ----------
    def test_wal_mode_enabled(self):
        mode = self.sm._conn.execute("PRAGMA journal_mode").fetchone()[0]
        self.assertEqual(mode.lower(), "wal")

    def test_busy_timeout_set(self):
        val = self.sm._conn.execute("PRAGMA busy_timeout").fetchone()[0]
        self.assertEqual(val, 5000)

    # ---------- calculate_file_hash ----------
    def test_hash_matches_known_md5(self):
        import hashlib
        data = b"hello dent2025"
        p = os.path.join(self.tmp.name, "f.bin")
        with open(p, "wb") as fh:
            fh.write(data)
        self.assertEqual(calculate_file_hash(p), hashlib.md5(data).hexdigest())

    def test_hash_streams_large_file(self):
        p = os.path.join(self.tmp.name, "big.bin")
        with open(p, "wb") as fh:
            fh.write(b"\x00" * (5 * 1024 * 1024))
            fh.write(b"\x01" * 100)
        h1 = calculate_file_hash(p)
        self.assertEqual(len(h1), 32)
        with open(p, "ab") as fh:
            fh.write(b"x")
        self.assertNotEqual(calculate_file_hash(p), h1)

    # ---------- record / dedup semantics ----------
    def _rec(self, **kw):
        base = {
            "item_id": "xid-12345_1",
            "course_name": "Radiology",
            "course_code": "DIG311",
            "section_type": "theory",
            "title": "Lecture 04",
            "notification_text": "nt",
            "file_name": "lec4.pdf",
            "file_hash": "abc123",
            "subject_id": 173,
            "category": "chapter",
            "destination_folder_id": "folderX",
            "drive_file_id": "",
            "drive_view_url": "",
            "status": "uploaded",
            "reasoning": "r",
        }
        base.update(kw)
        return base

    def test_record_and_item_processed_exact(self):
        self.sm.record_processed_item(self._rec())
        self.assertTrue(self.sm.is_stream_item_processed("xid-12345_1"))

    def test_prefix_match_counts_processed(self):
        self.sm.record_processed_item(self._rec(item_id="xid-12345_1"))
        self.assertTrue(self.sm.is_stream_item_processed("xid-12345"))
        self.assertFalse(self.sm.is_stream_item_processed("xid-12"))
        self.assertFalse(self.sm.is_stream_item_processed("xid-9999"))

    def test_no_files_status_does_not_count_as_processed(self):
        self.sm.record_processed_item(self._rec(status="no_files"))
        self.assertFalse(self.sm.is_stream_item_processed("xid-12345_1"))

    def test_hash_dedup_only_uploaded(self):
        self.sm.record_processed_item(self._rec(file_hash="h1", status="ignored"))
        self.assertFalse(self.sm.is_file_hash_processed("h1"))
        self.sm.record_processed_item(
            self._rec(item_id="other_1", file_hash="h2", status="uploaded")
        )
        self.assertTrue(self.sm.is_file_hash_processed("h2"))
        self.assertFalse(self.sm.is_file_hash_processed("h3"))

    def test_like_injection_safety(self):
        self.sm.record_processed_item(self._rec(item_id="a%b_c"))
        self.assertFalse(self.sm.is_stream_item_processed("a"))
        self.assertFalse(
            self.sm.is_stream_item_processed("a%"),
            "'%' in base must not act as a LIKE wildcard",
        )
        self.assertTrue(self.sm.is_stream_item_processed("a%b"),
                        "legit prefix a%b -> a%b_c still matches")

    def test_counts_by_status(self):
        self.sm.record_processed_item(self._rec(status="uploaded"))
        self.sm.record_processed_item(self._rec(item_id="i2", status="ignored"))
        self.sm.record_processed_item(self._rec(item_id="i3", status="no_files"))
        self.assertEqual(self.sm.count_processed_items(), 3)
        self.assertEqual(self.sm.count_processed_items("uploaded"), 1)

    def test_recent_uploads_ordering(self):
        for i in range(5):
            self.sm.record_processed_item(
                self._rec(item_id="it%d" % i, file_hash="fh%d" % i)
            )
        rows = self.sm.get_recent_uploads(3)
        self.assertEqual([r["item_id"] for r in rows], ["it4", "it3", "it2"])

    # ---------- pending review lifecycle ----------
    def test_pending_review_lifecycle(self):
        rid = self.sm.create_pending_review({
            "item_id": "xid-777_1",
            "file_hash": "deadbeef",
            "local_filepath": "/tmp/x.pdf",
            "file_size_bytes": 1024,
            "course_name": "Radiology",
            "section_type": "theory",
            "title": "Lecture 05",
            "suggested_subject_id": 173,
            "current_subject_id": 173,
            "suggested_category": "chapter",
            "current_category": "chapter",
            "original_filename": "raw.pdf",
            "suggested_filename": "Lecture 05 - Topic.pdf",
            "current_filename": "Lecture 05 - Topic.pdf",
            "ai_reasoning": "official slides",
        })
        row = self.sm.get_pending_review(rid)
        self.assertEqual(row["status"], "pending")
        self.assertEqual(row["file_hash"], "deadbeef")

        self.assertTrue(self.sm.is_file_in_pending_review("deadbeef"))
        self.sm.update_pending_review(rid, {"current_filename": "Renamed.pdf"})
        self.assertEqual(self.sm.get_pending_review(rid)["current_filename"], "Renamed.pdf")

        self.sm.mark_review_completed(rid, "uploaded", "drv123", "https://drive")
        row = self.sm.get_pending_review(rid)
        self.assertEqual(row["status"], "uploaded")
        self.assertEqual(row["drive_file_id"], "drv123")
        self.assertFalse(self.sm.is_file_in_pending_review("deadbeef"))

    def test_get_all_pending_orders_by_id_and_filters_status(self):
        a = self.sm.create_pending_review({"file_hash": "hA"})
        b = self.sm.create_pending_review({"file_hash": "hB"})
        self.sm.mark_review_completed(a, "rejected")
        pend = self.sm.get_all_pending_reviews()
        self.assertEqual([r["id"] for r in pend], [b])
        self.assertEqual(pend[0]["status"], "pending")

    def test_update_unknown_columns_ignored(self):
        rid = self.sm.create_pending_review({"file_hash": "hz"})
        self.sm.update_pending_review(rid, {"not_a_column": 1})
        self.assertIsNotNone(self.sm.get_pending_review(rid))


if __name__ == "__main__":
    unittest.main()
