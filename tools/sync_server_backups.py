"""
tools/sync_server_backups.py
Dent2025 Academic Portal - Local Server Backup Synchronizer

Syncs automated nightly server backups (/var/backups/dent2025_daily/) from
the Azure VPS to your local Windows PC (server_backups_dent2025_daily/).
Enforces a 14-day rolling retention policy locally, matching the server.

Usage:
  python tools/sync_server_backups.py
"""

import sys
import os
import json
import time
import socket
import subprocess
import urllib.request
from datetime import datetime

# Windows console encoding fix
if hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

import _toolkit
_toolkit.add_tools_to_path()
import deploy_health
PROJECT_ROOT = _toolkit.PROJECT_ROOT

LOCAL_BACKUP_DIR = os.path.join(PROJECT_ROOT, "server_backups_dent2025_daily")
REMOTE_BACKUP_DIR = "/var/backups/dent2025_daily"
SSH_USER = "azureuser"
SSH_HOST = "ssh.dent2025.com"
RETENTION_DAYS = 14

def log(msg):
    """Outputs to console and writes to persistent local sync.log."""
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    formatted = f"[{ts}] {msg}"
    print(formatted, flush=True)
    try:
        ensure_local_dir()
        log_path = os.path.join(LOCAL_BACKUP_DIR, "sync.log")
        with open(log_path, "a", encoding="utf-8") as f:
            f.write(formatted + "\n")
    except Exception:
        pass

def ensure_local_dir():
    os.makedirs(LOCAL_BACKUP_DIR, exist_ok=True)

WIN32_FLAGS = subprocess.CREATE_NO_WINDOW if sys.platform == 'win32' else 0

def list_remote_backups():
    """Queries VPS via SSH for list of available backup archives."""
    cmd = [
        'ssh', '-n', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10',
        f'{SSH_USER}@{SSH_HOST}',
        f'ls -1 {REMOTE_BACKUP_DIR}/*.gz 2>/dev/null'
    ]
    try:
        res = subprocess.run(cmd, stdin=subprocess.DEVNULL, capture_output=True, text=True, errors='ignore', timeout=15, creationflags=WIN32_FLAGS)
        if res.returncode != 0:
            return []
        lines = [line.strip() for line in res.stdout.splitlines() if line.strip().endswith('.gz')]
        return lines
    except Exception as e:
        print(f"[SYNC BACKUPS] Warning: Failed to query remote backups ({e})")
        return []

def download_file(remote_path, local_path):
    """Downloads a single file via SCP."""
    scp_cmd = [
        'scp', '-O', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10',
        f'{SSH_USER}@{SSH_HOST}:{remote_path}',
        local_path
    ]
    res = subprocess.run(scp_cmd, stdin=subprocess.DEVNULL, capture_output=True, text=True, errors='ignore', timeout=60, creationflags=WIN32_FLAGS)
    return res.returncode == 0

def prune_old_local_backups():
    """Removes local backup files older than RETENTION_DAYS (14 days)."""
    if not os.path.exists(LOCAL_BACKUP_DIR):
        return 0
    now = time.time()
    cutoff_seconds = RETENTION_DAYS * 86400
    pruned_count = 0
    
    for fname in os.listdir(LOCAL_BACKUP_DIR):
        fpath = os.path.join(LOCAL_BACKUP_DIR, fname)
        if not os.path.isfile(fpath):
            continue
        # Check file age
        mtime = os.path.getmtime(fpath)
        if (now - mtime) > cutoff_seconds:
            try:
                os.remove(fpath)
                log(f"[RETENTION] Pruned old local backup (>14d): {fname}")
                pruned_count += 1
            except Exception as e:
                log(f"[RETENTION] Failed to prune {fname}: {e}")
    return pruned_count

def report_sync_telemetry(status, archive_count, total_bytes, downloaded_now, pruned_now, latest_file):
    """Best-effort telemetry ping to Dent2025 Admin Dashboard."""
    passkey = deploy_health._load_health_passkey()
    if not passkey:
        return
    payload = json.dumps({
        "action": "report_backup_ping",
        "password": passkey,
        "system": "local_pc_sync",
        "status": status,
        "archive_count": archive_count,
        "total_bytes": total_bytes,
        "downloaded_now": downloaded_now,
        "pruned_now": pruned_now,
        "retention_days": RETENTION_DAYS,
        "latest_file": latest_file,
        "host": socket.gethostname()
    }).encode("utf-8")
    req = urllib.request.Request(
        "https://dent2025.com/history_api.php",
        data=payload,
        headers={"Content-Type": "application/json", "User-Agent": "Dent2025-BackupSync/1.0"},
        method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            if resp.status == 200:
                log("[TELEMETRY] Sync status reported to Admin Dashboard.")
    except Exception as e:
        log(f"[TELEMETRY] Notice: could not report status ({e})")

def sync_backups():
    """Performs full sync of server backups to local machine."""
    ensure_local_dir()
    log("=== DENT2025 LOCAL SERVER BACKUP SYNC ===")
    log(f"Target Local Folder: {LOCAL_BACKUP_DIR}")
    log(f"Retention Policy   : {RETENTION_DAYS} days rolling window")
    
    log("[1/3] Checking available backups on Azure VPS...")
    remote_files = list_remote_backups()
    downloaded = 0
    sync_status = "ok"

    if not remote_files:
        log("[NOTICE] No backup archives found on server or server unreachable.")
        sync_status = "server_unreachable"
        pruned = prune_old_local_backups()
    else:
        log(f"Found {len(remote_files)} remote archive(s). Checking local cache...")
        for rpath in remote_files:
            fname = os.path.basename(rpath)
            lpath = os.path.join(LOCAL_BACKUP_DIR, fname)
            if os.path.exists(lpath) and os.path.getsize(lpath) > 0:
                continue  # Already downloaded
            
            log(f"  ⬇ Downloading: {fname}...")
            t_start = time.time()
            ok = download_file(rpath, lpath)
            if ok and os.path.exists(lpath) and os.path.getsize(lpath) > 0:
                sz_kb = os.path.getsize(lpath) / 1024
                log(f"    Done ({sz_kb:.1f} KB in {time.time() - t_start:.1f}s)")
                downloaded += 1
            else:
                log(f"    FAILED to download {fname}")
                sync_status = "partial_error"

        log(f"[2/3] Local synchronization complete. {downloaded} new archive(s) downloaded.")
        
        # Prune old local backups
        log("[3/3] Enforcing 14-day retention policy...")
        pruned = prune_old_local_backups()
        if pruned == 0:
            log("All existing backups are within the 14-day retention window.")

    # Show summary
    local_files = [f for f in os.listdir(LOCAL_BACKUP_DIR) if os.path.isfile(os.path.join(LOCAL_BACKUP_DIR, f)) and f != "sync.log"]
    total_sz_bytes = sum(os.path.getsize(os.path.join(LOCAL_BACKUP_DIR, f)) for f in local_files)
    total_sz_mb = total_sz_bytes / (1024 * 1024)
    sorted_files = sorted(local_files, reverse=True)
    log(f"=== BACKUP STATUS: {len(local_files)} archives stored locally ({total_sz_mb:.2f} MB total) ===")
    for f in sorted_files[:6]:
        sz_kb = os.path.getsize(os.path.join(LOCAL_BACKUP_DIR, f)) / 1024
        log(f"  - {f} ({sz_kb:.1f} KB)")
    if len(local_files) > 6:
        log(f"  ... and {len(local_files) - 6} more file(s)")

    report_sync_telemetry(
        sync_status,
        len(local_files),
        total_sz_bytes,
        downloaded,
        pruned,
        sorted_files[0] if sorted_files else ""
    )

if __name__ == '__main__':
    sync_backups()
