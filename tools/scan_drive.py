#!/usr/bin/env python3
"""
Scan a (public) Google Drive folder and build a full content tree:
every folder name and the file names inside it, saved as JSON + readable text.

Works on folders shared with "Anyone with the link" using only a Drive API key
(no OAuth needed). If you don't have an API key, get one at:
    https://console.cloud.google.com/apis/credentials
enable "Google Drive API", create an API key, and pass it below / via env.

Usage:
    python tools/scan_drive.py --folder-id 1DfsBPuIuLaO7ewsoeqht_Flr0n9gBsK3
    python tools/scan_drive.py --folder-id <ID> --api-key <KEY> --out scan_results
    python tools/scan_drive.py --url https://drive.google.com/drive/folders/1DfsBPuIuLaO7ewsoeqht_Flr0n9gBsK3
"""

import argparse
import json
import os
import re
import sys
import time

from googleapiclient.discovery import build

DEFAULT_FOLDER = "1DfsBPuIuLaO7ewsoeqht_Flr0n9gBsK3"

FOLDER_MIME = "application/vnd.google-apps.folder"


def parse_folder_id(value):
    """Accept a folder ID or a drive.google.com URL and return the folder ID."""
    value = value.strip()
    m = re.search(r"drive\.google\.com/(?:drive/folders|open\?id=|file/d/|folder/d/)([A-Za-z0-9_-]{10,})", value)
    if m:
        return m.group(1)
    if re.fullmatch(r"[A-Za-z0-9_-]{10,}", value):
        return value
    raise SystemExit(f"Could not parse folder ID from: {value!r}")


def get_service(api_key):
    return build("drive", "v3", developerKey=api_key, cache_discovery=False)


def list_children(service, folder_id, page_token=None):
    """Return (files, next_token) for one page of children of folder_id."""
    q = (
        f"'{folder_id}' in parents and trashed = false"
    )
    fields = "nextPageToken, files(id, name, mimeType, size, createdTime, modifiedTime)"
    resp = (
        service.files()
        .list(q=q, pageSize=1000, fields=fields, pageToken=page_token)
        .execute()
    )
    return resp.get("files", []), resp.get("nextPageToken")


def scan(service, folder_id, depth=0, max_depth=None, stats=None, dry=False):
    """
    Recursively walk a folder.
    Returns a node dict: {name, mimeType, children:[...] or files:[...]}.
    `dry` disables the artificial delay used to respect API rate limits.
    """
    if stats is None:
        stats = {"folders": 0, "files": 0, "total_bytes": 0, "deepest": 0}

    files, token = list_children(service, folder_id)
    node = {"name": None, "mimeType": FOLDER_MIME, "children": []}
    node["name"] = "?"  # set by caller (name passed separately)

    # gather all pages
    while token:
        more, token = list_children(service, folder_id, token)
        files.extend(more)

    folders = [f for f in files if f.get("mimeType") == FOLDER_MIME]
    plain = [f for f in files if f.get("mimeType") != FOLDER_MIME]

    stats["folders"] += len(folders)
    stats["files"] += len(plain)
    for p in plain:
        stats["total_bytes"] += int(p.get("size") or 0)
    if depth > stats["deepest"]:
        stats["deepest"] = depth

    for f in folders:
        child = scan(service, f["id"], depth=depth + 1, max_depth=max_depth,
                     stats=stats, dry=dry)
        child["name"] = f["name"]
        node["children"].append(child)
        if not dry:
            time.sleep(0.05)  # gentle pacing to avoid 429s

    for f in plain:
        node["children"].append({
            "name": f["name"],
            "mimeType": f.get("mimeType"),
            "size": f.get("size"),
            "sizeHuman": human_size(int(f.get("size") or 0)),
            "createdTime": f.get("createdTime"),
            "modifiedTime": f.get("modifiedTime"),
            "fileId": f.get("id"),
        })
    return node


def human_size(num):
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if num < 1024:
            return f"{num:.1f} {unit}" if unit != "B" else f"{int(num)} B"
        num /= 1024
    return f"{num:.1f} PB"


def render_tree(node, prefix="", is_last=True, out=sys.stdout, depth=0):
    label = node["name"]
    if node["mimeType"] == FOLDER_MIME:
        nsub = len([c for c in node["children"] if c["mimeType"] == FOLDER_MIME])
        nfiles = len([c for c in node["children"] if c["mimeType"] != FOLDER_MIME])
        suffix = f"  [{nfiles} file(s), {nsub} sub-folder(s)]"
        if depth > 0:
            out.write(f"{prefix}{'└── ' if is_last else '├── '}{label}{suffix}\n")
        else:
            out.write(f"{label}{suffix}\n")
        next_prefix = prefix + ("    " if is_last else "│   ")
        for i, child in enumerate(node["children"]):
            is_l = (i == len(node["children"]) - 1)
            if child["mimeType"] == FOLDER_MIME:
                render_tree(child, next_prefix, is_l, out, depth + 1)
            else:
                out.write(f"{next_prefix}{'└── ' if is_l else '├── '}{child['name']}"
                          f"  ({child['sizeHuman']})\n")
    else:
        out.write(f"{prefix}{label}\n")


def summarize(node, stats, max_folders=40):
    """Print a compact summary of top-level folders + total counts."""
    print(f"\n=== SUMMARY ===")
    print(f"Top-level folders: {len(node['children'])}")
    print(f"Total folders (recursive): {stats['folders']}")
    print(f"Total files (recursive): {stats['files']}")
    print(f"Total data: {human_size(stats['total_bytes'])}")
    print(f"Deepest nesting: {stats['deepest']} levels")
    print(f"\nTop-level items:")
    for c in node["children"][:max_folders]:
        kind = "FOLDER" if c["mimeType"] == FOLDER_MIME else "FILE"
        print(f"  - [{kind}] {c['name']}")
    if len(node["children"]) > max_folders:
        print(f"  ... and {len(node['children']) - max_folders} more")


def main():
    p = argparse.ArgumentParser(description="Scan a public Google Drive folder tree")
    p.add_argument("--folder-id", default=None, help="Drive folder ID or URL")
    p.add_argument("--url", default=None, help="drive.google.com URL")
    p.add_argument("--api-key", default=os.environ.get("GOOGLE_DRIVE_API_KEY", None),
                   help="Google Drive API key (or set GOOGLE_DRIVE_API_KEY)")
    p.add_argument("--out", default=None,
                   help="Output base name/path. Writes <out>.json and <out>.txt (default: scan_results)")
    p.add_argument("--no-delay", action="store_true", help="Disable rate-limit pacing")
    p.add_argument("--root-name", default=None, help="Optional label for the root folder in output")
    args = p.parse_args()

    if not args.api_key:
        print("ERROR: No Google Drive API key provided.", file=sys.stderr)
        print("Pass --api-key <KEY> or set the GOOGLE_DRIVE_API_KEY env var.", file=sys.stderr)
        print("Get a key: https://console.cloud.google.com/apis/credentials", file=sys.stderr)
        sys.exit(1)

    folder_value = args.folder_id or args.url or DEFAULT_FOLDER
    root_id = parse_folder_id(folder_value)

    service = get_service(args.api_key)
    print(f"Scanning folder: {root_id} ...")

    stats = {"folders": 0, "files": 0, "total_bytes": 0, "deepest": 0}
    node = scan(service, root_id, max_depth=None, stats=stats, dry=args.no_delay)
    node["name"] = args.root_name or f"root_{root_id}"

    base = args.out or "scan_results"
    json_path = base + ".json"
    txt_path = base + ".txt"

    with open(json_path, "w", encoding="utf-8") as fh:
        json.dump(node, fh, ensure_ascii=False, indent=2)
    with open(txt_path, "w", encoding="utf-8") as fh:
        render_tree(node, out=fh)

    print(f"\nWrote tree JSON -> {json_path}")
    print(f"Wrote readable tree -> {txt_path}")
    summarize(node, stats)


if __name__ == "__main__":
    main()