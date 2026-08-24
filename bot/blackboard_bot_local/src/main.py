"""BotController — UI-agnostic orchestrator + ConsoleSink front-end.

The controller NEVER talks to a UI directly: it pushes structured events into
a `sink` (ConsoleSink for --cli / terminal default, GuiSink for pywebview).
Interactive decisions are requested FROM the sink (decide_review,
request_2fa_otp), keeping one state machine with two skins.

CLI: --once --interval N --manual --yes --no-input --cli --selftest --minimize
"""
import argparse
import copy
import os
import re
import shutil
import sys
import threading
import time

if sys.stdout is None:
    try:
        sys.stdout = open(os.devnull, "w", encoding="utf-8")
    except Exception:
        pass
if sys.stderr is None:
    try:
        sys.stderr = open(os.devnull, "w", encoding="utf-8")
    except Exception:
        pass

if sys.stdout and hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _PROJECT_ROOT not in sys.path:
    sys.path.insert(0, _PROJECT_ROOT)

from src.ai_classifier import AIClassifier, normalize_arabic
from src.config_loader import load_config, PROJECT_ROOT
from src.bb_harvester import (
    BbHarvester, DownloadSkipped, SessionExpiredError, STORAGE_STATE_PATH,
)
from src.gdrive_uploader import GDriveUploader
from src.state_manager import StateManager, calculate_file_hash

TEMP_DOWNLOADS = os.path.join(PROJECT_ROOT, "temp_downloads")
PENDING_REVIEWS_DIR = os.path.join(TEMP_DOWNLOADS, "pending_reviews")
ORPHAN_MAX_AGE_S = 7 * 24 * 3600
MIN_INTERVAL_S = 60

DATE_LINE_RE = re.compile(
    r"^\s*(?:mon|tue|wed|thu|fri|sat|sun|sun|jan|feb|mar|apr|may|jun|jul|aug"
    r"|sep|oct|nov|dec)[a-z]*[\s.,]+\d{1,4}([^\w]|$)"
    r"|^\s*\d{1,2}[/-]\d{1,2}([/-]\d{2,4})?\s*$", re.I)
PRACTICAL_RE = re.compile(
    r"lab|practical|عملي|معمل|_02_|\(02\)|sec(?:tion)?\s*0?2|group\s*0?2",
    re.I)


def derive_title_body(full_text):
    """Drop date-like leading lines; return (title, body)."""
    lines = [ln.strip() for ln in (full_text or "").splitlines()
             if ln.strip()]
    while lines and DATE_LINE_RE.match(lines[0]):
        lines.pop(0)
    if not lines:
        return "", ""
    title = lines[0][:120]
    body = " ".join(lines[1:])[:2000]
    return title, body


def detect_section_type(text, hint=None):
    if hint in ("theory", "practical"):
        return hint
    return "practical" if PRACTICAL_RE.search(normalize_arabic(text)) \
        else "theory"


class BotController:
    def __init__(self, config=None, state=None, classifier=None,
                 uploader=None, harvester=None, sink=None,
                 interval=900, auto_enabled=True, auto_approve=False,
                 interactive=True):
        self.config = config or load_config()
        self.state = state
        self.classifier = classifier
        self.uploader = uploader
        self.harvester = harvester
        self.sink = sink
        self.interval = max(MIN_INTERVAL_S, int(interval))
        self.auto_enabled = bool(auto_enabled)
        self.auto_approve = bool(auto_approve)
        self.interactive = bool(interactive)

        self.stop_event = threading.Event()
        self.wake_event = threading.Event()
        self.scan_lock = threading.Lock()
        self._last_scan_ts = None
        self._session_ok = None
        self.session = {"ok": False}

    # ---------------- sink plumbing ----------------

    def emit(self, etype, **kw):
        if self.sink:
            evt = {"type": etype}
            evt.update(kw)
            self.sink.emit(evt)

    def log(self, msg, level="info"):
        self.emit("log", level=level, msg=msg)

    # ---------------- lifecycle ----------------

    def build_sections(self):
        sections = []
        for subj in self.classifier.subjects:
            for sec in subj.get("blackboard_sections", []):
                sections.append({
                    "subject_id": subj["id"],
                    "subject_name_en": subj["name_en"],
                    "type": sec.get("type"),
                    "course_id": sec.get("course_id"),
                })
        return sections

    def sweep_orphan_temp(self):
        now = time.time()
        removed = 0
        for entry in os.listdir(TEMP_DOWNLOADS) \
                if os.path.isdir(TEMP_DOWNLOADS) else []:
            if entry == "pending_reviews":
                continue
            full = os.path.join(TEMP_DOWNLOADS, entry)
            try:
                age = now - os.path.getmtime(full)
                if age > ORPHAN_MAX_AGE_S:
                    if os.path.isdir(full):
                        shutil.rmtree(full, ignore_errors=True)
                    else:
                        os.remove(full)
                    removed += 1
            except OSError:
                continue
        if removed:
            self.log("Temp sweep removed %d orphaned item(s)." % removed)

    def session_ok(self):
        self._session_ok = self.harvester.ensure_authenticated_session()
        self.session["ok"] = bool(self._session_ok)
        return self._session_ok

    def boot(self):
        self.log("Dent2025 Blackboard Auto-Sync Bot booting… "
                 "(context dentistry Y3 S1, %d subjects)"
                 % len(self.classifier.subjects))
        self.sweep_orphan_temp()
        self.emit("status",
                  auto=self.auto_enabled, interval=self.interval,
                  last_scan=self._last_scan_ts,
                  uploaded_total=self.state.count_processed_items("uploaded"),
                  pending_count=len(self.state.get_all_pending_reviews()),
                  session_ok=os.path.isfile(STORAGE_STATE_PATH))
        # crash-safe: leftover pending reviews are replayed BEFORE any scan
        self.process_pending_reviews()

    def run(self):
        self.boot()
        while not self.stop_event.is_set():
            if self.auto_enabled:
                try:
                    self.scan_cycle()
                except Exception as exc:
                    self.log("Scan cycle crashed (%s): %s"
                             % (exc.__class__.__name__, exc), level="error")
            self.wake_event.wait(timeout=self.interval)
            self.wake_event.clear()

    def scan_now(self):
        self.wake_event.set()

    def toggle_pause(self):
        self.auto_enabled = not self.auto_enabled
        self.emit("status", auto=self.auto_enabled, interval=self.interval,
                  last_scan=self._last_scan_ts,
                  uploaded_total=self.state.count_processed_items("uploaded"),
                  pending_count=len(self.state.get_all_pending_reviews()),
                  session_ok=self.session.get("ok", False))
        self.log("Auto-sync %s." % ("RESUMED" if self.auto_enabled else "PAUSED"))
        if self.auto_enabled:
            self.scan_now()

    def set_interval(self, seconds):
        seconds = max(MIN_INTERVAL_S, int(seconds))
        self.interval = seconds
        self.scan_now()
        self.log("Interval set to %ds (min %ds)." % (seconds, MIN_INTERVAL_S))

    def shutdown(self):
        self.stop_event.set()
        self.wake_event.set()

    # ---------------- sync cycle ----------------

    def scan_cycle(self):
        with self.scan_lock:
            self.log("[Scan] Checking Blackboard session...")
            if not self.session_ok():
                self.log("[Scan] Session check failed — please run 1-Click Login.", level="warn")
                return False
            self.log("[Scan] Session verified. Starting scan across all subjects...", level="ok")
            self.emit("scan_started")
            sections = self.build_sections()
            if not bool(self.config.get("HARVEST_OUTLINE_SECTIONS", False)):
                # Activity Stream already carries every newly-added file;
                # outline crawling is slow and redundant by default.
                sections = []
                self.log("[Scan] Querying Activity Stream (outline crawl disabled)...")
            else:
                self.log(f"[Scan] Querying Activity Stream and {len(sections)} course outlines...")
            items = self.harvester.harvest_all_new_content(sections)
            self.log(f"[Scan] Harvest completed. Found {len(items)} candidate items. Evaluating...", level="info")
            new_files = self.process_items(items)
            self._last_scan_ts = time.time()
            self.emit("status", auto=self.auto_enabled,
                      interval=self.interval, last_scan=self._last_scan_ts,
                      uploaded_total=self.state.count_processed_items(
                          "uploaded"),
                      pending_count=len(self.state.get_all_pending_reviews()),
                      session_ok=True)
            self.emit("scan_done", found=len(items), new_files=new_files)
            self.log(f"[Scan] Cycle complete! {new_files} new file(s) queued for review.", level="ok" if new_files else "info")
            # end-of-cycle pass over everything still pending
            self.process_pending_reviews()
            return True

    @staticmethod
    def _unique_filename(dest_dir, filename):
        """Batch-internal collision guard: append ' (2)' before extension."""
        base, ext = os.path.splitext(filename)
        candidate = filename
        n = 2
        while os.path.exists(os.path.join(dest_dir, candidate)):
            candidate = "%s (%d)%s" % (base, n, ext)
            n += 1
        return candidate

    def process_items(self, items):
        new_files = 0
        seen_ids = set()
        for idx, item in enumerate(items):
            try:
                iid = item.get("item_id") or ""
                if not iid or iid in seen_ids:
                    continue
                seen_ids.add(iid)
                if self.state.is_stream_item_processed(iid):
                    self.log("Skipped (already processed): %s"
                             % ((item.get("title")
                                 or item.get("course_context")
                                 or iid)[:70]))
                    continue
                # TRUTH ORDER: harvester's "Added:" title (the REAL BB
                # filename) beats text-derived guesses like timestamps.
                derived_title, body = derive_title_body(
                    item.get("full_text", ""))
                title = (item.get("title") or "").strip() or derived_title
                course_name = (item.get("course_context")
                               or "").strip() or ""
                blob_for_section = "%s %s %s" % (title, body,
                                                 item.get("course_id", ""))
                section_hint = item.get("section_type")
                links = [lnk for lnk in item.get("links", [])]
                if not links:
                    self.log("No file links (text-only item) -> no_files: %s"
                             % ((title or iid)[:70]))
                    self.state.record_processed_item({
                        "item_id": iid,
                        "course_name": course_name,
                        "course_code": "",
                        "section_type": detect_section_type(
                            blob_for_section, section_hint),
                        "title": title, "notification_text": body,
                        "file_name": "", "file_hash": "", "subject_id": "",
                        "category": "", "destination_folder_id": "",
                        "drive_file_id": "", "drive_view_url": "",
                        "status": "no_files",
                        "reasoning": "No downloadable file link in item.",
                    })
                    continue

                resolved = self.classifier.resolve_subject(
                    "%s %s %s %s" % (title, body, course_name,
                                     item.get("course_id", "")))
                subject = resolved["subject"] if resolved else None
                section_type = detect_section_type(blob_for_section,
                                                   section_hint)

                for link in links:
                    self.log("Downloading & evaluating: %s"
                             % ((title or item.get("title")
                                 or os.path.basename(link) or iid)[:60]))
                    if self._download_and_queue(link, iid, title, body,
                                                course_name, subject,
                                                section_type):
                        new_files += 1
            except SessionExpiredError:
                self.emit("session_lost",
                          msg="Download hit a login redirect — run "
                              "1-Click Login.bat.")
                break
            except DownloadSkipped as exc:
                # dead viewer links / undownloadable entries: record ONCE so
                # future cycles skip them instantly instead of re-failing
                self.state.record_processed_item({
                    "item_id": iid, "course_name": course_name,
                    "course_code": "", "section_type": "",
                    "title": title or "", "notification_text": "",
                    "file_name": "", "file_hash": "", "subject_id": "",
                    "category": "", "destination_folder_id": "",
                    "drive_file_id": "", "drive_view_url": "",
                    "status": "ignored",
                    "reasoning": str(exc)[:300],
                })
                self.log("Skipped permanently: %s (%s)"
                         % ((title or iid)[:60], exc), level="warn")
            except Exception as exc:
                self.log("Item %s failed (%s): %s"
                         % (item.get("item_id"), exc.__class__.__name__,
                            exc), level="warn")
        return new_files

    def _download_and_queue(self, link, iid, title, body, course_name,
                            subject, section_type):
        result = self.harvester.download_file_from_url(link, TEMP_DOWNLOADS)
        paths = result.get("paths") or ([result["path"]]
                                        if result.get("path") else [])
        parent_md5 = result.get("md5", "")
        created_any = False
        for p in paths:
            file_hash = calculate_file_hash(p)
            if self.state.is_file_hash_processed(file_hash) or \
                    self.state.is_file_in_pending_review(file_hash):
                self.log("Duplicate skipped by MD5: %s"
                         % os.path.basename(p), level="info")
                try:
                    os.remove(p)
                except OSError:
                    pass
                continue
            size = os.path.getsize(p)
            if size > 45 * 1024 * 1024:
                self.log("Skipped (>45 MB GAS cap): %s"
                         % os.path.basename(p), level="warn")
                self.state.record_processed_item({
                    "item_id": iid, "course_name": course_name,
                    "course_code": "", "section_type": section_type,
                    "title": title, "notification_text": body,
                    "file_name": os.path.basename(p),
                    "file_hash": file_hash,
                    "subject_id": subject["id"] if subject else "",
                    "category": "", "destination_folder_id": "",
                    "drive_file_id": "", "drive_view_url": "",
                    "status": "ignored",
                    "reasoning": "Exceeds 45MB GAS hard cap.",
                })
                continue
            decision = self.classifier.classify_file(
                p, title or os.path.basename(p), body, course_name,
                section_type)
            # Manual-sorting mode: AI/Gemini is OFF. Heuristic only nudges
            # material-vs-chapter as a STARTING point; the user flips it in
            # the GUI. Nothing is ever auto-ignored here.
            category = "material" \
                if decision.get("category") == "material" else "chapter"
            fname = os.path.basename(p)  # keep the REAL Blackboard filename
            if not fname.lower().endswith(
                    (".pdf", ".pptx", ".ppt", ".docx", ".doc", ".zip")):
                fname = decision.get("standardized_filename") or fname
            os.makedirs(PENDING_REVIEWS_DIR, exist_ok=True)
            stored = self._unique_filename(
                PENDING_REVIEWS_DIR,
                "%s_%s" % (file_hash[:8], fname))
            stored_path = os.path.join(PENDING_REVIEWS_DIR, stored)
            shutil.copyfile(p, stored_path)
            try:
                os.remove(p)
            except OSError:
                pass

            suggested_subject = subject["id"] if subject else None
            rid = self.state.create_pending_review({
                "item_id": iid,
                "file_hash": file_hash,
                "local_filepath": stored_path,
                "file_size_bytes": size,
                "course_name": course_name,
                "section_type": section_type,
                "title": title,
                "notification_text": body,
                "suggested_subject_id": suggested_subject,
                "current_subject_id": suggested_subject,
                "suggested_category": category,
                "current_category": category,
                "original_filename": os.path.basename(p),
                "suggested_filename": fname,
                "current_filename": fname,
                "ai_reasoning": decision.get("reasoning", ""),
            })
            row = self.state.get_pending_review(rid)
            self.emit("review_new", review=row)
            self.log(f"Queued Review #{rid}: [{category.upper()}] {fname}", level="ok")
            created_any = True
        return created_any

    # ---------------- review processing ----------------

    def folder_for(self, subject_id, category):
        for subj in self.classifier.subjects:
            if subj["id"] == subject_id:
                key = "chapters_folder_id" \
                    if category != "material" else "materials_folder_id"
                return subj.get(key, "")
        return ""

    def process_pending_reviews(self):
        rows = self.state.get_all_pending_reviews()
        for row in rows:
            if self.stop_event.is_set():
                return
            if self.auto_approve:
                self.approve_review(row["id"])
                continue
            if not self.interactive or self.sink is None \
                    or not hasattr(self.sink, "decide_review"):
                continue  # --no-input: stays pending for later
            self.sink.decide_review(copy.deepcopy(row), self)

    def approve_review(self, review_id):
        row = self.state.get_pending_review(review_id)
        if not row or row["status"] != "pending":
            return False
        subject_id = row.get("current_subject_id")
        category = row.get("current_category") or "chapter"
        folder_id = self.folder_for(subject_id, category)
        if not folder_id:
            self.log("Cannot upload #%s: unknown subject/folder."
                     % review_id, level="error")
            return False
        out = self.uploader.upload_file(row["local_filepath"], folder_id,
                                        row["current_filename"])
        if out.get("success"):
            self.state.mark_review_completed(
                review_id, "uploaded", out.get("fileId", ""),
                out.get("fileUrl", ""))
            self.state.record_processed_item({
                "item_id": row.get("item_id"),
                "course_name": row.get("course_name"),
                "course_code": "",
                "section_type": row.get("section_type"),
                "title": row.get("title"),
                "notification_text": row.get("notification_text"),
                "file_name": row["current_filename"],
                "file_hash": row.get("file_hash"),
                "subject_id": subject_id,
                "category": category,
                "destination_folder_id": folder_id,
                "drive_file_id": out.get("fileId", ""),
                "drive_view_url": out.get("fileUrl", ""),
                "status": "uploaded",
                "reasoning": row.get("ai_reasoning"),
            })
            self._delete_local_copy(row["local_filepath"])
            self.log("Uploaded #%s -> Drive: %s"
                     % (review_id, out.get("fileUrl", "")), level="ok")
            self.emit("review_update", id=review_id,
                      fields={"status": "uploaded"})
            self.emit("status", auto=self.auto_enabled,
                      interval=self.interval, last_scan=self._last_scan_ts,
                      uploaded_total=self.state.count_processed_items(
                          "uploaded"),
                      pending_count=len(self.state.get_all_pending_reviews()),
                      session_ok=self.session.get("ok", True))
            return True
        self.log("Upload FAILED for #%s: %s %s"
                 % (review_id, out.get("error"), out.get("message")),
                 level="error")
        return False

    def reject_review(self, review_id):
        row = self.state.get_pending_review(review_id)
        if not row or row["status"] != "pending":
            return
        self.state.mark_review_completed(review_id, "rejected")
        self.state.record_processed_item({
            "item_id": row.get("item_id"),
            "course_name": row.get("course_name"),
            "course_code": "",
            "section_type": row.get("section_type"),
            "title": row.get("title"),
            "notification_text": row.get("notification_text"),
            "file_name": row.get("current_filename"),
            "file_hash": row.get("file_hash"),
            "subject_id": row.get("current_subject_id") or "",
            "category": row.get("current_category") or "",
            "destination_folder_id": "",
            "drive_file_id": "", "drive_view_url": "",
            "status": "ignored",
            "reasoning": "Rejected by user.",
        })
        self._delete_local_copy(row["local_filepath"])
        self.emit("review_update", id=review_id,
                  fields={"status": "rejected"})

    def later_review(self, review_id):
        # hash guard already prevents duplicate queuing meanwhile
        self.log("#%s left pending for next cycle." % review_id)

    def rename_review(self, review_id, new_filename):
        safe = re.sub(r'[\\/*?:"<>|]+', "_", new_filename or "").strip()
        if not safe:
            return False
        if not os.path.splitext(safe)[1]:
            old = self.state.get_pending_review(review_id) or {}
            ext = os.path.splitext(old.get("current_filename") or "")[1]
            safe += ext
        self.state.update_pending_review(review_id,
                                         {"current_filename": safe})
        self.emit("review_update", id=review_id,
                  fields={"current_filename": safe})
        return True

    def set_subject(self, review_id, subject_id):
        self.state.update_pending_review(review_id,
                                         {"current_subject_id": subject_id})

    def toggle_category(self, review_id):
        row = self.state.get_pending_review(review_id)
        if not row:
            return
        new_cat = "material" if row.get("current_category") == "chapter" \
            else "chapter"
        self.state.update_pending_review(review_id,
                                         {"current_category": new_cat})
        self.emit("review_update", id=review_id,
                  fields={"current_category": new_cat})

    @staticmethod
    def _delete_local_copy(path):
        try:
            if path and os.path.isfile(path):
                os.remove(path)
        except OSError:
            pass


# ====================================================================
# Console front-end
# ====================================================================

class ConsoleSink:
    def __init__(self):
        self.input_lock = threading.Lock()

    LEVEL_TAG = {"ok": "[OK]", "warn": "[WARN]", "error": "[ERROR]",
                 "info": "[INFO]"}

    def emit(self, evt):
        t = evt.get("type")
        if t == "log":
            tag = self.LEVEL_TAG.get(evt.get("level"), "[INFO]")
            print("%s %s" % (tag, evt.get("msg", "")))
        elif t == "session_lost":
            print("\n" + "=" * 60)
            print("SESSION EXPIRED — run 1-Click Login.bat")
            print("=" * 60 + "\n")
        elif t == "session_restored":
            print("[OK] Session restored.")
        elif t == "review_new":
            r = evt.get("review") or {}
            print("[NEW FILE] #%s %s" % (r.get("id"), r.get("title")))
        elif t == "status":
            pass  # console shows status via 'st' command
        elif t == "scan_started":
            print("---- scan started ----")
        elif t == "scan_done":
            print("---- scan done ----")

    def request_2fa_otp(self, screenshot_path, timeout=180):
        with self.input_lock:
            try:
                if screenshot_path and os.path.isfile(screenshot_path) \
                        and hasattr(os, "startfile"):
                    os.startfile(screenshot_path)
            except Exception:
                pass
            print(">>> 2FA required. Check the screenshot / your phone.")
            try:
                code = input("Enter 6-digit code> ").strip()
                return code or None
            except EOFError:
                return None

    def _prompt(self, text):
        with self.input_lock:
            try:
                return input(text).strip().lower()
            except EOFError:
                return ""

    def decide_review(self, row, ctrl):
        subjects = ctrl.classifier.subjects
        while True:
            print()
            print("════════ NEW FILE FOR REVIEW #%s ════════"
                  % row["id"])
            print("  Course   : %s" % (row.get("course_name") or "-"))
            print("  Title    : %s" % (row.get("title") or "-"))
            subj_name = "-"
            sid = row.get("current_subject_id")
            for s in subjects:
                if s["id"] == sid:
                    subj_name = s["name_en"]
                    break
            print("  Subject  : [%s] %s" % (sid, subj_name))
            cat = row.get("current_category")
            print("  Category : %s" % cat)
            print("  Filename : %s" % row.get("current_filename"))
            size_mb = (row.get("file_size_bytes") or 0) / (1024 * 1024)
            print("  Size     : %.1f MB" % size_mb)
            print("  AI       : %s" % row.get("ai_reasoning"))
            print("  [Enter]=Upload | s=subject | c=category | r=rename | "
                  "i=ignore | l=later | o=open folder")
            choice = self._prompt("> ")
            if choice in ("", "y", "yes"):
                return ctrl.approve_review(row["id"]) and "uploaded" \
                    or "failed"
            if choice == "s":
                for i, s in enumerate(subjects, 1):
                    print("   %2d. [%d] %s / %s"
                          % (i, s["id"], s["name_en"], s["name_ar"]))
                pick = self._prompt("number> ")
                if pick.isdigit() and 1 <= int(pick) <= len(subjects):
                    ctrl.set_subject(row["id"], subjects[int(pick) - 1]["id"])
                    row = ctrl.state.get_pending_review(row["id"])
            elif choice == "c":
                ctrl.toggle_category(row["id"])
                row = ctrl.state.get_pending_review(row["id"])
            elif choice == "r":
                with self.input_lock:
                    try:
                        new_name = input("new filename> ").strip()
                    except EOFError:
                        new_name = ""
                if new_name:
                    ctrl.rename_review(row["id"], new_name)
                    row = ctrl.state.get_pending_review(row["id"])
            elif choice == "i":
                ctrl.reject_review(row["id"])
                return "ignored"
            elif choice == "l":
                ctrl.later_review(row["id"])
                return "later"
            elif choice == "o":
                try:
                    os.startfile(os.path.dirname(row["local_filepath"]))
                except Exception:
                    pass


def _command_listener(ctrl, sink):
    help_line = ("Commands: Enter/scan = scan now | a = pause/resume | "
                 "i <min> = interval | st = status | q = quit")
    print(help_line)
    while not ctrl.stop_event.is_set():
        try:
            with sink.input_lock:
                raw = input("cmd> ").strip().lower()
        except (EOFError, OSError):
            return
        if raw in ("", "scan"):
            ctrl.scan_now()
        elif raw == "a":
            ctrl.toggle_pause()
        elif raw.startswith("i"):
            parts = raw.split()
            if len(parts) == 2 and parts[1].isdigit():
                ctrl.set_interval(int(parts[1]) * 60)
            else:
                print("usage: i <minutes>")
        elif raw == "st":
            uploads = ctrl.state.count_processed_items("uploaded")
            pending = len(ctrl.state.get_all_pending_reviews())
            age = "-" if not ctrl._last_scan_ts else time.strftime(
                "%Y-%m-%d %H:%M:%S", time.localtime(ctrl._last_scan_ts))
            print("mode=%s interval=%ss last_scan=%s uploads=%d pending=%d "
                  "session_file=%s"
                  % ("auto" if ctrl.auto_enabled else "paused",
                     ctrl.interval, age, uploads, pending,
                     "present" if os.path.isfile(STORAGE_STATE_PATH)
                     else "MISSING"))
        elif raw == "q":
            ctrl.shutdown()
            return
        else:
            print(help_line)


def _selftest():
    """Live probe: login state + one outline fetch. Run manually."""
    cfg = load_config()
    sm = StateManager(os.path.join(PROJECT_ROOT, "state", "bot_state.sqlite"))
    clf = AIClassifier(gemini_api_key=cfg.get("GEMINI_API_KEY", ""))
    hv = BbHarvester(sink=ConsoleSink())
    ok = hv.ensure_authenticated_session()
    print("Authenticated:", ok)
    if ok:
        items = hv.harvest_all_new_content([
            {"subject_name_en": "Oral and Maxillofacial Radiology",
             "type": "theory", "course_id": "_288167_1"}])
        print("Items:", len(items))
        for it in items[:10]:
            print(" -", it["item_id"], "|", it["title"][:60], "|",
                  len(it["links"]), "link(s)")
    sm.close()


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Dent2025 Blackboard Auto-Sync Bot (Local Edition)")
    parser.add_argument("--once", action="store_true",
                        help="single scan then exit")
    parser.add_argument("--interval", type=int, default=None,
                        help="scan interval seconds (min 60)")
    parser.add_argument("--manual", action="store_true",
                        help="start paused (loop mode)")
    parser.add_argument("--yes", action="store_true",
                        help="auto-approve all reviews using AI decision")
    parser.add_argument("--no-input", action="store_true",
                        help="never block on prompts; keep items pending")
    parser.add_argument("--cli", action="store_true",
                        help="force console mode (default tries GUI)")
    parser.add_argument("--minimize", action="store_true",
                        help="start minimized (GUI mode)")
    parser.add_argument("--selftest", action="store_true",
                        help="live login + single-course harvest probe")
    parser.add_argument("--dump", action="store_true",
                        help="diagnostic: dump HTML/screenshots/links of "
                             "stream + sample course pages, then exit")
    args = parser.parse_args(argv)

    if getattr(args, "selftest", False):
        _selftest()
        return 0

    cfg = load_config()
    interval = args.interval or cfg.get("DEFAULT_INTERVAL_SECONDS", 900)
    auto = cfg.get("AUTO_SYNC_ENABLED", True) and not args.manual
    interactive = not (args.no_input or args.yes)

    sm = StateManager(os.path.join(PROJECT_ROOT, "state", "bot_state.sqlite"))
    # Manual-sorting mode (default): Gemini stays OFF unless the user opts
    # in with USE_GEMINI_AI=true in config/.env.
    use_ai = bool(cfg.get("USE_GEMINI_AI", False))
    clf = AIClassifier(
        gemini_api_key=cfg.get("GEMINI_API_KEY", "") if use_ai else "")
    up = GDriveUploader(cfg.get("GAS_WEBHOOK_URL", ""))
    sink = ConsoleSink()
    hv = BbHarvester(sink=sink)
    ctrl = BotController(config=cfg, state=sm, classifier=clf, uploader=up,
                         harvester=hv, sink=sink, interval=interval,
                         auto_enabled=auto, auto_approve=args.yes,
                         interactive=interactive)

    if getattr(args, "dump", False):
        if not hv.ensure_authenticated_session():
            print("[ERROR] No valid session — run 1-Click Login.bat first.")
            sm.close()
            return 1
        dump_dir = hv.debug_dump(sections=ctrl.build_sections()[:1])
        print("Dump complete:", dump_dir)
        try:
            os.startfile(dump_dir)
        except Exception:
            pass
        sm.close()
        return 0

    if args.once:
        ctrl.boot()
        try:
            ctrl.scan_cycle()
        except Exception as exc:
            print("[ERROR] Scan failed: %s" % exc)
        sm.close()
        return 0

    listener = None
    if interactive and not args.no_input:
        listener = threading.Thread(target=_command_listener,
                                    args=(ctrl, sink), daemon=True)
        listener.start()
    try:
        if not args.cli:
            try:
                from src.gui_app import run_gui
                rc = run_gui(ctrl, minimize=args.minimize)
                if rc == "gui_ok":
                    return 0
                print("[WARN] GUI unavailable; falling back to console.")
            except ImportError as exc:
                print("[WARN] GUI import failed (%s); console mode."
                      % exc.__class__.__name__)
        ctrl.run()
    except KeyboardInterrupt:
        pass
    finally:
        ctrl.shutdown()
        sm.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
