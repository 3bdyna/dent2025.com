import sqlite3
import sys

if sys.stdout and hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

c = sqlite3.connect(r"state\bot_state.sqlite")
print("processed_items:",
      c.execute("SELECT status, COUNT(*) FROM processed_items "
                "GROUP BY status").fetchall())
rows = c.execute("SELECT id, current_filename, current_category, "
                 "course_name, section_type FROM pending_reviews "
                 "WHERE status='pending' ORDER BY id").fetchall()
print("PENDING QUEUED:", len(rows))
for r in rows:
    print(" #%s [%s/%s] %s | %s" % (r[0], r[2], r[3], r[4], r[1]))
up = c.execute("SELECT file_name FROM processed_items "
               "WHERE status='uploaded' ORDER BY id DESC LIMIT 10").fetchall()
print("UPLOADED:", [u[0] for u in up])
c.close()
