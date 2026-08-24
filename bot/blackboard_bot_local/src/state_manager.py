"""SQLite persistence for the Dent2025 Blackboard Sync Bot.

Two tables:
  processed_items  - dedup + audit log of every stream/outline item seen
  pending_reviews  - downloaded files awaiting the user's decision

Thread discipline: WAL journal, busy_timeout 5000ms, all writes serialized
through an internal RLock. calculate_file_hash streams in 64KB chunks.
"""
import hashlib
import os
import sqlite3
import threading

_SCHEMA = """
CREATE TABLE IF NOT EXISTS processed_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id TEXT UNIQUE,
    course_name TEXT,
    course_code TEXT,
    section_type TEXT,
    title TEXT,
    notification_text TEXT,
    file_name TEXT,
    file_hash TEXT,
    subject_id INTEGER,
    category TEXT,
    destination_folder_id TEXT,
    drive_file_id TEXT,
    drive_view_url TEXT,
    status TEXT,
    reasoning TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_processed_file_hash ON processed_items(file_hash);
CREATE INDEX IF NOT EXISTS idx_processed_item_id ON processed_items(item_id);
CREATE INDEX IF NOT EXISTS idx_processed_status ON processed_items(status);

CREATE TABLE IF NOT EXISTS pending_reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id TEXT,
    file_hash TEXT,
    local_filepath TEXT,
    file_size_bytes INTEGER,
    course_name TEXT,
    section_type TEXT,
    title TEXT,
    notification_text TEXT,
    suggested_subject_id INTEGER,
    current_subject_id INTEGER,
    suggested_category TEXT,
    current_category TEXT,
    original_filename TEXT,
    suggested_filename TEXT,
    current_filename TEXT,
    ai_reasoning TEXT,
    status TEXT DEFAULT 'pending',
    destination_folder_id TEXT,
    drive_file_id TEXT,
    drive_view_url TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_pending_file_hash ON pending_reviews(file_hash);
CREATE INDEX IF NOT EXISTS idx_pending_status ON pending_reviews(status);
"""

_PROCESSED_COLS = (
    "item_id", "course_name", "course_code", "section_type", "title",
    "notification_text", "file_name", "file_hash", "subject_id", "category",
    "destination_folder_id", "drive_file_id", "drive_view_url", "status",
    "reasoning",
)

_PENDING_COLS = (
    "item_id", "file_hash", "local_filepath", "file_size_bytes",
    "course_name", "section_type", "title", "notification_text",
    "suggested_subject_id", "current_subject_id", "suggested_category",
    "current_category", "original_filename", "suggested_filename",
    "current_filename", "ai_reasoning", "status", "destination_folder_id",
    "drive_file_id", "drive_view_url",
)


def _escape_like(value):
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def calculate_file_hash(filepath, chunk_size=65536):
    """Streamed MD5 of a file, 64KB chunks, hex digest."""
    md5 = hashlib.md5()
    with open(filepath, "rb") as fh:
        while True:
            chunk = fh.read(chunk_size)
            if not chunk:
                break
            md5.update(chunk)
    return md5.hexdigest()


class StateManager:
    def __init__(self, db_path):
        db_dir = os.path.dirname(os.path.abspath(db_path))
        if db_dir:
            os.makedirs(db_dir, exist_ok=True)
        self.db_path = db_path
        self._lock = threading.RLock()
        self._conn = sqlite3.connect(db_path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA busy_timeout=5000")
        self._conn.executescript(_SCHEMA)
        self._conn.commit()

    def close(self):
        with self._lock:
            self._conn.close()

    # ---------------- processed_items ----------------

    def record_processed_item(self, data):
        """INSERT OR REPLACE a full audit row. Missing keys default to ''."""
        row = {k: data.get(k, "") for k in _PROCESSED_COLS}
        with self._lock:
            self._conn.execute(
                "INSERT OR REPLACE INTO processed_items (%s) VALUES (%s)"
                % (", ".join(_PROCESSED_COLS), ", ".join(["?"] * len(_PROCESSED_COLS))),
                tuple(row[k] for k in _PROCESSED_COLS),
            )
            self._conn.commit()

    def is_stream_item_processed(self, base_item_id):
        """True if item_id == base OR starts with base+'_' and status in
        (uploaded, ignored). 'no_files'/'processed' do NOT count."""
        with self._lock:
            cur = self._conn.execute(
                "SELECT 1 FROM processed_items "
                "WHERE status IN ('uploaded','ignored') "
                "AND (item_id = ? OR (item_id LIKE ? ESCAPE '\\' AND item_id != ?)) "
                "LIMIT 1",
                (base_item_id, _escape_like(base_item_id) + "\\_%", base_item_id),
            )
            return cur.fetchone() is not None

    def is_file_hash_processed(self, file_hash):
        """True only when the exact bytes were already uploaded."""
        with self._lock:
            cur = self._conn.execute(
                "SELECT 1 FROM processed_items "
                "WHERE file_hash = ? AND status = 'uploaded' LIMIT 1",
                (file_hash,),
            )
            return cur.fetchone() is not None

    def count_processed_items(self, status=None):
        with self._lock:
            if status:
                cur = self._conn.execute(
                    "SELECT COUNT(*) FROM processed_items WHERE status = ?", (status,)
                )
            else:
                cur = self._conn.execute("SELECT COUNT(*) FROM processed_items")
            return cur.fetchone()[0]

    def get_recent_uploads(self, limit=20):
        with self._lock:
            cur = self._conn.execute(
                "SELECT * FROM processed_items WHERE status = 'uploaded' "
                "ORDER BY id DESC LIMIT ?",
                (int(limit),),
            )
            return [dict(r) for r in cur.fetchall()]

    def get_history(self, limit=200):
        """Full audit trail across ALL statuses (uploaded, ignored,
        no_files, …) newest first."""
        with self._lock:
            cur = self._conn.execute(
                "SELECT * FROM processed_items ORDER BY id DESC LIMIT ?",
                (int(limit),),
            )
            return [dict(r) for r in cur.fetchall()]

    # ---------------- pending_reviews ----------------

    def create_pending_review(self, data):
        row = {k: data.get(k) for k in _PENDING_COLS}
        row["status"] = data.get("status", "pending")
        with self._lock:
            cur = self._conn.execute(
                "INSERT INTO pending_reviews (%s) VALUES (%s)"
                % (", ".join(_PENDING_COLS), ", ".join(["?"] * len(_PENDING_COLS))),
                tuple(row[k] for k in _PENDING_COLS),
            )
            self._conn.commit()
            return cur.lastrowid

    def get_pending_review(self, review_id):
        with self._lock:
            cur = self._conn.execute(
                "SELECT * FROM pending_reviews WHERE id = ?", (review_id,)
            )
            row = cur.fetchone()
            return dict(row) if row else None

    def get_all_pending_reviews(self):
        with self._lock:
            cur = self._conn.execute(
                "SELECT * FROM pending_reviews WHERE status = 'pending' ORDER BY id"
            )
            return [dict(r) for r in cur.fetchall()]

    def update_pending_review(self, review_id, updates):
        if not updates:
            return
        cols = [c for c in updates if c in _PENDING_COLS]
        if not cols:
            return
        sets = ", ".join("%s = ?" % c for c in cols)
        with self._lock:
            self._conn.execute(
                "UPDATE pending_reviews SET %s, updated_at = CURRENT_TIMESTAMP "
                "WHERE id = ?" % sets,
                tuple(updates[c] for c in cols) + (review_id,),
            )
            self._conn.commit()

    def mark_review_completed(self, review_id, status,
                              drive_file_id="", drive_view_url=""):
        with self._lock:
            self._conn.execute(
                "UPDATE pending_reviews SET status = ?, drive_file_id = ?, "
                "drive_view_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                (status, drive_file_id, drive_view_url, review_id),
            )
            self._conn.commit()

    def is_file_in_pending_review(self, file_hash):
        with self._lock:
            cur = self._conn.execute(
                "SELECT 1 FROM pending_reviews "
                "WHERE file_hash = ? AND status = 'pending' LIMIT 1",
                (file_hash,),
            )
            return cur.fetchone() is not None
