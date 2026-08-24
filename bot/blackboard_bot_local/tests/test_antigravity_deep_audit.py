"""Antigravity Deep Audit & Stress Test Suite.

Independent verification of edge cases, concurrency stress, Unicode permutations,
corrupted file headers, boundary limits, and state transitions.
"""
import io
import os
import shutil
import sqlite3
import tempfile
import threading
import time
import unittest
import zipfile

from src.ai_classifier import AIClassifier, normalize_arabic
from src.config_loader import load_config, PROJECT_ROOT
from src.bb_harvester import (
    sanitize_filename,
    safe_extract_zip,
    detect_real_extension,
    evaluate_session,
    djb2_hash,
)
from src.gdrive_uploader import GDriveUploader
from src.state_manager import StateManager, calculate_file_hash
from src.main import BotController, derive_title_body, detect_section_type


class AntigravityDeepAuditTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.db_path = os.path.join(self.temp_dir, "test_audit.sqlite")
        self.state = StateManager(db_path=self.db_path)
        self.config = load_config()
        self.classifier = AIClassifier(gemini_api_key=self.config.get("GEMINI_API_KEY", ""))

    def tearDown(self):
        self.state.close()
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    # --------------------------------------------------------------------------
    # 1. ARABIC NLP & TIERED RESOLUTION DEEP EDGE CASES
    # --------------------------------------------------------------------------

    def test_arabic_normalization_extreme_unicode(self):
        # Extreme tashkeel + tatweel + various alif forms
        raw = "أَشِعَّـــــةُ ٱلْفَمِ وَالْوَجْهِ وَالْفَكَّيْنِ!"
        normalized = normalize_arabic(raw)
        self.assertNotIn("ـ", normalized)
        self.assertNotIn("َ", normalized)
        self.assertNotIn("ِ", normalized)
        self.assertNotIn("ّ", normalized)
        self.assertNotIn("ُ", normalized)
        self.assertNotIn("ٱ", normalized)
        self.assertTrue(normalized.startswith("اشعه"))

    def test_cross_subject_ambiguity_resolution(self):
        # Test distinct subjects that share dental keywords
        # 175: Pre-clinical Restorative Dentistry (إصلاح الأسنان)
        res_opt = self.classifier.resolve_subject("محاضرة إصلاح الأسنان ما قبل السريري OPT321")
        self.assertIsNotNone(res_opt)
        self.assertEqual(res_opt["subject"]["id"], 175)

        # 176: Advanced Dental Biomaterials (مواد طب الأسنان الحيوية)
        res_pro = self.classifier.resolve_subject("مواد طب الأسنان الحيوية المتقدمة PRO322")
        self.assertIsNotNone(res_pro)
        self.assertEqual(res_pro["subject"]["id"], 176)

        # 178: Pre-clinical Prosthodontics (الاستعاضة ما قبل السريرية)
        res_prostho = self.classifier.resolve_subject("الاستعاضة ما قبل السريرية PRO341")
        self.assertIsNotNone(res_prostho)
        self.assertEqual(res_prostho["subject"]["id"], 178)

        # 180: Oral Microbiology (علم الأحياء الدقيقة والمناعة)
        res_micro = self.classifier.resolve_subject("الأحياء الدقيقة والمناعة الفموي DMS352")
        self.assertIsNotNone(res_micro)
        self.assertEqual(res_micro["subject"]["id"], 180)

    # --------------------------------------------------------------------------
    # 2. MAGIC BYTES & CORRUPTED ARCHIVE STRESS TESTS
    # --------------------------------------------------------------------------

    def test_magic_byte_edge_cases(self):
        # Zero-byte file
        p_zero = os.path.join(self.temp_dir, "zero.bin")
        with open(p_zero, "wb") as f:
            f.write(b"")
        self.assertIsNone(detect_real_extension(p_zero))

        # Truncated PDF (< 4 bytes)
        p_trunc = os.path.join(self.temp_dir, "trunc.bin")
        with open(p_trunc, "wb") as f:
            f.write(b"%P")
        self.assertIsNone(detect_real_extension(p_trunc))

        # Valid PDF header
        p_pdf = os.path.join(self.temp_dir, "valid.bin")
        with open(p_pdf, "wb") as f:
            f.write(b"%PDF-1.5 test")
        self.assertEqual(detect_real_extension(p_pdf), ".pdf")

    # --------------------------------------------------------------------------
    # 3. 45MB BOUNDARY LIMIT & MEMORY GUARDS
    # --------------------------------------------------------------------------

    def test_45mb_boundary_precision(self):
        uploader = GDriveUploader(webhook_url="https://script.google.com/test_dummy")
        p_exact = os.path.join(self.temp_dir, "exact_45mb.bin")
        p_over = os.path.join(self.temp_dir, "over_45mb.bin")

        # Create sparse file pointers for boundary checks
        # Exact 45MB = 45 * 1024 * 1024 = 47,185,920 bytes
        with open(p_exact, "wb") as f:
            f.seek(45 * 1024 * 1024 - 1)
            f.write(b"\0")
        
        # 45MB + 1 byte = 47,185,921 bytes
        with open(p_over, "wb") as f:
            f.seek(45 * 1024 * 1024)
            f.write(b"\0")

        self.assertEqual(os.path.getsize(p_exact), 45 * 1024 * 1024)
        self.assertEqual(os.path.getsize(p_over), 45 * 1024 * 1024 + 1)

        # Over 45MB must fail immediately before attempting any upload
        res_over = uploader.upload_file(p_over, "test_folder", "over.bin")
        self.assertFalse(res_over["success"])
        self.assertEqual(res_over["error"], "too_large")

    # --------------------------------------------------------------------------
    # 4. MULTI-THREADED SQLITE CONCURRENCY STRESS
    # --------------------------------------------------------------------------

    def test_sqlite_concurrent_multithreaded_writes(self):
        errors = []

        def worker(worker_id):
            try:
                for i in range(20):
                    item_id = f"worker_{worker_id}_item_{i}"
                    file_hash = f"hash_{worker_id}_{i}"
                    self.state.record_processed_item({
                        "item_id": item_id,
                        "file_hash": file_hash,
                        "course_name": "Radiology",
                        "course_code": "DIG311",
                        "section_type": "theory",
                        "title": f"Lecture {i}",
                        "notification_text": "Auto sync",
                        "file_name": f"lec_{i}.pdf",
                        "subject_id": 173,
                        "category": "chapter",
                        "status": "uploaded",
                    })
                    self.assertTrue(self.state.is_stream_item_processed(item_id))
            except Exception as exc:
                errors.append(exc)

        threads = [threading.Thread(target=worker, args=(t,)) for t in range(8)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        self.assertEqual(len(errors), 0, f"Concurrent SQLite errors: {errors}")
        total = self.state.count_processed_items("uploaded")
        self.assertEqual(total, 8 * 20)

    # --------------------------------------------------------------------------
    # 5. CONTROLLER WORKFLOW & REVIEW STATE ENGINE
    # --------------------------------------------------------------------------

    def test_review_card_lifecycle_full_flow(self):
        # Create a pending review file
        test_file = os.path.join(self.temp_dir, "pending_sample.pdf")
        with open(test_file, "wb") as f:
            f.write(b"%PDF-1.4 sample content")
        
        file_hash = calculate_file_hash(test_file)
        review_id = self.state.create_pending_review({
            "item_id": "audit_flow_item_1",
            "file_hash": file_hash,
            "local_filepath": test_file,
            "file_size_bytes": len(b"%PDF-1.4 sample content"),
            "course_name": "Oral Diagnosis",
            "section_type": "theory",
            "title": "Introduction to Oral Diagnosis",
            "notification_text": "Welcome students",
            "suggested_subject_id": 174,
            "current_subject_id": 174,
            "suggested_category": "chapter",
            "current_category": "chapter",
            "original_filename": "intro_diag.pdf",
            "suggested_filename": "Lecture 01 - Intro.pdf",
            "current_filename": "Lecture 01 - Intro.pdf",
            "ai_reasoning": "Official intro lecture",
            "destination_folder_id": "1gEowIsnIvvHaSEPX2sd9dYt13zxz5XS8",
        })

        self.assertTrue(self.state.is_file_in_pending_review(file_hash))
        reviews = self.state.get_all_pending_reviews()
        self.assertEqual(len(reviews), 1)
        self.assertEqual(reviews[0]["id"], review_id)

        # Update category and filename
        self.state.update_pending_review(review_id, {
            "current_category": "material",
            "current_filename": "Course Syllabus - Oral Diagnosis.pdf",
            "destination_folder_id": "1j9x--uJYk1GnBuxVJ6p4te-pu5yzQjOY",
        })

        updated = self.state.get_pending_review(review_id)
        self.assertEqual(updated["current_category"], "material")
        self.assertEqual(updated["current_filename"], "Course Syllabus - Oral Diagnosis.pdf")

        # Mark completed (uploaded) and record audit log as done in controller
        self.state.record_processed_item({
            "item_id": "audit_flow_item_1",
            "file_hash": file_hash,
            "course_name": "Oral Diagnosis",
            "course_code": "DIG313",
            "section_type": "theory",
            "title": "Introduction to Oral Diagnosis",
            "file_name": "Course Syllabus - Oral Diagnosis.pdf",
            "subject_id": 174,
            "category": "material",
            "destination_folder_id": "1j9x--uJYk1GnBuxVJ6p4te-pu5yzQjOY",
            "drive_file_id": "drive_file_abc123",
            "drive_view_url": "https://drive.google.com/file/d/drive_file_abc123/view",
            "status": "uploaded",
        })
        self.state.mark_review_completed(
            review_id=review_id,
            status="uploaded",
            drive_file_id="drive_file_abc123",
            drive_view_url="https://drive.google.com/file/d/drive_file_abc123/view",
        )

        self.assertFalse(self.state.is_file_in_pending_review(file_hash))
        self.assertTrue(self.state.is_file_hash_processed(file_hash))


if __name__ == "__main__":
    unittest.main()
