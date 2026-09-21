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
import time
import subprocess
from datetime import datetime

# Windows console encoding fix
if hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

import _toolkit
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

def list_remote_backups():
    """Queries VPS via SSH for list of available backup archives."""
    cmd = [
        'ssh', '-n', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10',
        f'{SSH_USER}@{SSH_HOST}',
        f'ls -1 {REMOTE_BACKUP_DIR}/*.gz 2>/dev/null'
    ]
    try:
        res = subprocess.run(cmd, stdin=subprocess.DEVNULL, capture_output=True, text=True, errors='ignore', timeout=15)
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
    res = subprocess.run(scp_cmd, stdin=subprocess.DEVNULL, capture_output=True, text=True, errors='ignore', timeout=60)
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

def sync_backups():
    """Performs full sync of server backups to local machine."""
    ensure_local_dir()
    log("=== DENT2025 LOCAL SERVER BACKUP SYNC ===")
    log(f"Target Local Folder: {LOCAL_BACKUP_DIR}")
    log(f"Retention Policy   : {RETENTION_DAYS} days rolling window")
    
    log("[1/3] Checking available backups on Azure VPS...")
    remote_files = list_remote_backups()
    if not remote_files:
        log("[NOTICE] No backup archives found on server or server unreachable.")
        prune_old_local_backups()
        return

    log(f"Found {len(remote_files)} remote archive(s). Checking local cache...")
    downloaded = 0
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

    log(f"[2/3] Local synchronization complete. {downloaded} new archive(s) downloaded.")
    
    # Prune old local backups
    log("[3/3] Enforcing 14-day retention policy...")
    pruned = prune_old_local_backups()
    if pruned == 0:
        log("All existing backups are within the 14-day retention window.")

    # Show summary
    local_files = [f for f in os.listdir(LOCAL_BACKUP_DIR) if os.path.isfile(os.path.join(LOCAL_BACKUP_DIR, f)) and f != "sync.log"]
    total_sz_mb = sum(os.path.getsize(os.path.join(LOCAL_BACKUP_DIR, f)) for f in local_files) / (1024 * 1024)
    log(f"=== BACKUP STATUS: {len(local_files)} archives stored locally ({total_sz_mb:.2f} MB total) ===")
    for f in sorted(local_files, reverse=True)[:6]:
        sz_kb = os.path.getsize(os.path.join(LOCAL_BACKUP_DIR, f)) / 1024
        log(f"  - {f} ({sz_kb:.1f} KB)")
    if len(local_files) > 6:
        log(f"  ... and {len(local_files) - 6} more file(s)")

if __name__ == '__main__':
    sync_backups()
