#!/usr/bin/env python3
"""Analyze a DENT2025 drive-scan JSON and turn it into an organized, actionable report.

Reads: premed-scan.json   (as produced by tools/drive_tree_scanner.gs)
Writes:
  drive_report.txt        - human-readable summary (largest files, rich folders, clutter)
  drive_cleaned.json      - cleaned tree (top-level categories with their files+sizes)
  drive_by_folder.csv     - every file grouped by folder, easy to open in Excel

Usage:  python tools/analyze_drive_scan.py [input.json] [--out PREFIX]
"""
import argparse
import csv
import json
import os
import sys

CLUTTER_KEYWORDS = ("recycle", "old", "backup", "copy of", "copy_", "temp", "tmp", "~$", "راجع", "قديم", "نسخة")
IMPORTANT_EXT = (".pdf", ".ppt", ".pptx", ".doc", ".docx", ".txt", ".png", ".jpg", ".jpeg", ".mp4", ".mkv", ".zip", ".rar")
VIDEO_EXT = (".mp4", ".mkv", ".mov", ".wmv", ".avi")
MEGA = 1024 * 1024


def human(n):
    for u in ("B", "KB", "MB", "GB", "TB"):
        if n < 1024:
            return f"{n:.1f} {u}"
        n /= 1024
    return f"{n:.1f} PB"


def top_folder(path, level):
    if level is None:
        return (path.split("/")[0] if "/" in path else path).strip()
    parts = [p.strip() for p in path.split("/")]
    return parts[0] if parts else ""


def is_clutter(name):
    nl = name.lower()
    return any(k in nl for k in CLUTTER_KEYWORDS)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("input", nargs="?", default="premed-scan.json")
    ap.add_argument("--out", default="drive")
    args = ap.parse_args()

    with open(args.input, "r", encoding="utf-8") as fh:
        data = json.load(fh)

    items = data.get("items", [])
    # Each row: [path, level, name, type, size_bytes, size_human, modified, fileId, url]
    files = []
    folders = []
    for r in items:
        if not isinstance(r, list) or len(r) < 9:
            continue
        path, level, name, typ = r[0], r[1], r[2], r[3]
        size = r[4]
        size = int(size) if str(size).isdigit() else 0
        rec = {"path": path, "level": level, "name": name, "type": typ,
               "size": size, "modified": r[6], "file_id": r[7], "url": r[8]}
        (files if typ == "FILE" else folders).append(rec)

    out_txt = args.out + "_report.txt"
    out_json = args.out + "_cleaned.json"
    out_csv = args.out + "_by_folder.csv"
    buf = []
    w = buf.append

    total_bytes = sum(f["size"] for f in files)
    w("=" * 70)
    w(f"DRIVE SCAN REPORT  -  root: {data.get('rootName')}")
    w("=" * 70)
    w(f"Folders : {len(folders)}")
    w(f"Files   : {len(files)}")
    w(f"Total   : {human(total_bytes)}  ({total_bytes:,} bytes)")
    w(f"Deepest : {data.get('counters', {}).get('deepest')} levels")

    # ---------- 1) Largest files ----------
    w("\n" + "=" * 70)
    w("TOP 50 LARGEST FILES  (biggest time-sinks / likely-important)")
    w("=" * 70)
    for f in sorted(files, key=lambda x: x["size"], reverse=True)[:50]:
        w(f"{human(f['size']):>10}  {f['path']}")

    # ---------- 2) Clutter ----------
    clutter = [f for f in files if is_clutter(f["path"])]
    w("\n" + "=" * 70)
    w(f"CLUTTER / OLD / BACKUP FILES: {len(clutter)}  (candidates to ignore)")
    w("=" * 70)
    for f in sorted(clutter, key=lambda x: x["size"], reverse=True)[:25]:
        w(f"{human(f['size']):>10}  {f['path']}")

    # ---------- 3) Top-level categories ----------
    from collections import defaultdict
    by_top = defaultdict(lambda: {"files": 0, "bytes": 0, "folders": 0, "sub": set()})
    for f in files:
        t = top_folder(f["path"], f["level"])
        by_top[t]["files"] += 1
        by_top[t]["bytes"] += f["size"]
    for fld in folders:
        t = top_folder(fld["path"], fld["level"])
        by_top[t]["folders"] += 1

    w("\n" + "=" * 70)
    w("TOP-LEVEL CATEGORIES  (summed, sorted by size)")
    w("=" * 70)
    for t, s in sorted(by_top.items(), key=lambda kv: kv[1]["bytes"], reverse=True):
        w(f"{human(s['bytes']):>10}  {s['files']:>4} files  {s['folders']:>3} folders  |  {t}")

    # ---------- 4) Largest video files (per subject / folder) ----------
    videos = [f for f in files if f["name"].lower().endswith(VIDEO_EXT)]
    w("\n" + "=" * 70)
    w(f"VIDEO FILES: {len(videos)}  (top 30 by size)")
    w("=" * 70)
    for f in sorted(videos, key=lambda x: x["size"], reverse=True)[:30]:
        w(f"{human(f['size']):>10}  {f['path']}")

    # ---------- 5) Most content-rich folders (by total bytes inside) ----------
    folder_bytes = defaultdict(int)
    folder_files = defaultdict(int)
    for f in files:
        parent = "/".join(f["path"].split("/")[:-1])
        folder_bytes[parent] += f["size"]
        folder_files[parent] += 1
    w("\n" + "=" * 70)
    w("MOST CONTENT-RICH FOLDERS  (by size of files directly inside)")
    w("=" * 70)
    for parent, b in sorted(folder_bytes.items(), key=lambda kv: kv[1], reverse=True)[:40]:
        w(f"{human(b):>10}  {folder_files[parent]:>4} files  |  {parent}")

    # ---------- 6) Write cleaned JSON (category tree) ----------
    cleaned = {"rootName": data.get("rootName"), "rootId": data.get("rootId"),
               "generated": "drive analysis", "categories": []}
    for t, s in sorted(by_top.items(), key=lambda kv: kv[1]["bytes"], reverse=True):
        cleaned["categories"].append({
            "name": t,
            "files": s["files"],
            "folders": s["folders"],
            "bytes": s["bytes"],
            "sizeHuman": human(s["bytes"]),
        })
    with open(out_json, "w", encoding="utf-8") as fh:
        json.dump(cleaned, fh, ensure_ascii=False, indent=2)

    # ---------- 7) by-folder CSV ----------
    with open(out_csv, "w", encoding="utf-8-sig", newline="") as fh:
        cw = csv.writer(fh)
        cw.writerow(["Folder", "Type", "Name", "Size (bytes)", "Size (human)", "Modified", "File ID", "URL"])
        for f in sorted(files, key=lambda x: (x["path"], x["name"])):
            cw.writerow([f["path"].rsplit("/", 1)[0] if "/" in f["path"] else "",
                         f["type"], f["name"], f["size"], human(f["size"]),
                         f["modified"], f["file_id"], f["url"]])

    w("\n" + "=" * 70)
    w(f"WROTE: {out_txt}, {out_json}, {out_csv}")
    w("=" * 70)

    with open(out_txt, "w", encoding="utf-8") as fh:
        fh.write("\n".join(buf))

    # Print a compact summary to console (safe ascii)
    print(f"OK. Folders={len(folders)} Files={len(files)} Total={human(total_bytes)}")
    print(f"Top-level categories:")
    for t, s in sorted(by_top.items(), key=lambda kv: kv[1]["bytes"], reverse=True)[:15]:
        print(f"  {human(s['bytes']):>10}  {s['files']:>4} files  |  {t}")
    print(f"\nReport -> {out_txt}")


if __name__ == "__main__":
    main()