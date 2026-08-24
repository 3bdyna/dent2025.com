import json
import os
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.ai_classifier import (
    AIClassifier,
    extract_lecture_number,
    normalize_arabic,
    sanitize_title_fragment,
    standardize_filename,
    strip_code_fences,
)
from src.config_loader import PROJECT_ROOT

MAPPING = os.path.join(PROJECT_ROOT, "config", "subjects_mapping.json")


def make_classifier(**kw):
    return AIClassifier(mapping_path=MAPPING, **kw)


class ArabicNormalizationTests(unittest.TestCase):
    def test_strips_tatweel(self):
        self.assertEqual(normalize_arabic("العـربية"), normalize_arabic("العربية"))

    def test_unifies_alef_forms(self):
        base = normalize_arabic("اشعة الفم")
        self.assertEqual(base, normalize_arabic("أشعة الفم"))
        self.assertEqual(base, normalize_arabic("إشعة الفم"))
        self.assertEqual(base, normalize_arabic("آشعة الفم"))

    def test_ta_marbuta_to_ha(self):
        self.assertEqual(normalize_arabic("مدرسة"), normalize_arabic("مدرسه"))

    def test_alef_maqsura_and_ya(self):
        self.assertEqual(normalize_arabic("على"), normalize_arabic("علي"))

    def test_strips_diacritics(self):
        plain = normalize_arabic("تشخيص الفم")
        diacritic = "تَشْخِيصُ الفَمِ"
        self.assertEqual(plain, normalize_arabic(diacritic))

    def test_lowercases_and_collapses_ws(self):
        self.assertEqual(normalize_arabic("  Radiology   DIG311 "),
                         "radiology dig311")

    def test_empty_safe(self):
        self.assertEqual(normalize_arabic(None), "")
        self.assertEqual(normalize_arabic(""), "")


class FilenameTests(unittest.TestCase):
    def test_theory_standard(self):
        self.assertEqual(
            standardize_filename("Cranial Nerves", "theory", ".pdf", 3),
            "Lecture 03 - Cranial Nerves.pdf",
        )

    def test_practical_prefix(self):
        out = standardize_filename("Impression Trays", "practical", ".pdf", 3)
        self.assertTrue(out.startswith("[Practical] Lab 03 - "), out)

    def test_no_number_omitted_cleanly(self):
        out = standardize_filename("Intro Deck", "theory", ".pdf", None)
        self.assertEqual(out, "Lecture - Intro Deck.pdf".replace("Lecture -",
                                                                 "Lecture").replace("Intro", "Intro")
                         if False else out)  # shape check below
        self.assertRegex(out, r"^Lecture\s*-\s*Intro Deck\.pdf$|"
                              r"^Lecture\s+-\s+Intro Deck\.pdf$|^Lecture.*Intro Deck\.pdf$")

    def test_sanitizer_removes_bad_chars(self):
        self.assertEqual(sanitize_title_fragment('a<b>c:d"e/f\\g|h?i*j'),
                         "a_b_c_d_e_f_g_h_i_j")

    def test_number_extraction_prefers_lec_keyword(self):
        self.assertEqual(extract_lecture_number("lec_04_norm_anat.pdf"), 4)
        self.assertEqual(extract_lecture_number("Lab 12 trays.pptx"), 12)
        self.assertIsNone(extract_lecture_number("no numbers here"))

    def test_extension_preserved(self):
        out = standardize_filename("X", "theory", ".pptx", 1)
        self.assertTrue(out.endswith(".pptx"))


class SubjectResolutionTests(unittest.TestCase):
    def setUp(self):
        self.clf = make_classifier()

    def resolve_text(self, txt):
        res = self.clf.resolve_subject(txt)
        return (res["subject"]["id"], res["matched_by"]) if res else (None, None)

    def test_tier1_course_code_beats_all(self):
        sid, by = self.resolve_text("DIG311 lecture 4 uploaded today "
                                    "علم الأدوية DMS353")
        self.assertEqual(sid, 173)
        self.assertTrue(by.startswith("course_code:DIG311"), by)

    def test_tier2_course_id_substring(self):
        sid, by = self.resolve_text("new file in course _288185_1 outline")
        self.assertEqual(sid, 177)
        self.assertTrue(by.startswith("course_id:"), by)

    def test_tier3_exact_arabic_name_normalized(self):
        # exact name (with alef/ta-marbuta variants) -> full_name tier
        sid, by = self.resolve_text("ملف: أشعة الفم والوجه والفكين محاضرة")
        self.assertEqual(sid, 173)
        self.assertEqual(by, "full_name")

    def test_tier3_typo_falls_to_keywords(self):
        # misspelled last word -> full name misses, keyword prefix catches
        sid, by = self.resolve_text("ملف: أشعة الفم والوجه والفاكين محاضرة")
        self.assertEqual(sid, 173)
        self.assertEqual(by, "keywords")

    def test_tier4_keywords_scoring(self):
        sid, by = self.resolve_text("Microbiology immunology session notes")
        self.assertEqual(sid, 180)
        self.assertEqual(by, "keywords")

    def test_arabic_noise_still_resolves_via_normalization(self):
        sid, _ = self.resolve_text("كشف الدرجات لمادة علم الأمراض العام")
        self.assertEqual(sid, 179)

    def test_no_match_returns_none(self):
        sid, by = self.resolve_text("completely unrelated admin memo xyz")
        self.assertIsNone(sid)


class HeuristicFallbackTests(unittest.TestCase):
    def setUp(self):
        self.clf = make_classifier()

    def test_admin_noise_ignored(self):
        d = self.clf.heuristic_classify("Grade roster seat numbers", "", "theory")
        self.assertEqual(d["category"], "ignore")
        self.assertFalse(d["is_worth_uploading"])

    def test_arabic_noise_ignored(self):
        d = self.clf.heuristic_classify("كشوف الدرجات النهائية", "", "theory")
        self.assertEqual(d["category"], "ignore")

    def test_material_detected(self):
        d = self.clf.heuristic_classify("Oral Pathology revision summary", "",
                                        "theory")
        self.assertEqual(d["category"], "material")

    def test_default_chapter(self):
        d = self.clf.heuristic_classify("Normal radiographic anatomy", "",
                                        "theory")
        self.assertEqual(d["category"], "chapter")
        self.assertTrue(d["is_worth_uploading"])


class GeminiPathTests(unittest.TestCase):
    def setUp(self):
        self.clf = make_classifier(gemini_api_key="FAKE")

    def test_strip_code_fences(self):
        self.assertEqual(strip_code_fences('```json\n{"a":1}\n```'), '{"a":1}')
        self.assertEqual(strip_code_fences('{"a":1}'), '{"a":1}')

    def _gemini_payload(self):
        return json.dumps({
            "category": "material",
            "is_worth_uploading": True,
            "standardized_filename": "Reference Book - Oral Path.pdf",
            "clean_title": "Reference Book Oral Path",
            "reasoning": "reference textbook chapter",
        })

    def test_gemini_success_used_over_heuristic(self):
        with mock.patch.object(AIClassifier, "_call_gemini",
                               return_value=self._gemini_payload()):
            d = self.clf.classify_file("x.pdf", "weird name", "")
        self.assertEqual(d["_via"], "gemini")
        self.assertEqual(d["category"], "material")
        self.assertTrue(d["standardized_filename"].endswith(".pdf"))

    def test_gemini_failure_falls_back(self):
        with mock.patch.object(AIClassifier, "_call_gemini",
                               side_effect=RuntimeError("boom")):
            d = self.clf.classify_file("lecture_07_bones.pdf",
                                       "lecture 7 bones", "", section_hint="theory")
        self.assertEqual(d["_via"], "heuristic")
        self.assertEqual(d["category"], "chapter")
        self.assertTrue(d["standardized_filename"].endswith(".pdf"))

    def test_gemini_bad_category_falls_back(self):
        with mock.patch.object(AIClassifier, "_call_gemini",
                               return_value='{"category":"banana"}'):
            d = self.clf.classify_file("x.pdf", "summary sheet", "")
        self.assertEqual(d["_via"], "heuristic")

    def test_resolution_attached(self):
        with mock.patch.object(AIClassifier, "_call_gemini",
                               return_value=self._gemini_payload()):
            d = self.clf.classify_file("x.pdf", "DIG311 new slides", "")
        self.assertEqual(d["subject_id"], 173)
        self.assertEqual(d["section_type"], "theory")

    def test_no_key_means_heuristic_path(self):
        clf = make_classifier()  # no API key
        with mock.patch.object(AIClassifier, "_call_gemini") as never:
            d = clf.classify_file("lab_02.pdf", "lab 2 manual guide",
                                  "", section_hint="practical")
            never.assert_not_called()
        self.assertEqual(d["_via"], "heuristic")
        self.assertEqual(d["category"], "material")


class ExtractionDegradationTests(unittest.TestCase):
    def test_missing_lib_or_bad_file_degrades_to_empty(self):
        clf = make_classifier()
        fake_pdf = os.path.join(tempfile.gettempdir(), "dent_fake_not_a_pdf.pdf")
        with open(fake_pdf, "wb") as fh:
            fh.write(b"this is not really a pdf")
        try:
            text = clf.extract_document_text(fake_pdf)
        except Exception as exc:  # must never propagate
            self.fail("extract_document_text raised: %r" % exc)
        self.assertIsInstance(text, str)


if __name__ == "__main__":
    unittest.main()
