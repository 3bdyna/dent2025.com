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
                print(f"[RETENTION] Pruned old local backup (>14d): {fname}")
                pruned_count += 1
            except Exception as e:
                print(f"[RETENTION] Failed to prune {fname}: {e}")
    return pruned_count

def sync_backups():
    """Performs full sync of server backups to local machine."""
    ensure_local_dir()
    print("=== DENT2025 LOCAL SERVER BACKUP SYNC ===")
    print(f"Target Local Folder: {LOCAL_BACKUP_DIR}")
    print(f"Retention Policy   : {RETENTION_DAYS} days rolling window\n")
    
    print("[1/3] Checking available backups on Azure VPS...", flush=True)
    remote_files = list_remote_backups()
    if not remote_files:
        print("[NOTICE] No backup archives found on server or server unreachable.")
        prune_old_local_backups()
        return

    print(f"Found {len(remote_files)} remote archive(s). Checking local cache...", flush=True)
    downloaded = 0
    for rpath in remote_files:
        fname = os.path.basename(rpath)
        lpath = os.path.join(LOCAL_BACKUP_DIR, fname)
        if os.path.exists(lpath) and os.path.getsize(lpath) > 0:
            continue  # Already downloaded
        
        print(f"  ⬇ Downloading: {fname}...", end="", flush=True)
        t_start = time.time()
        ok = download_file(rpath, lpath)
        if ok and os.path.exists(lpath) and os.path.getsize(lpath) > 0:
            sz_kb = os.path.getsize(lpath) / 1024
            print(f" Done ({sz_kb:.1f} KB in {time.time() - t_start:.1f}s)")
            downloaded += 1
        else:
            print(" FAILED")

    print(f"\n[2/3] Local synchronization complete. {downloaded} new archive(s) downloaded.")
    
    # Prune old local backups
    print("\n[3/3] Enforcing 14-day retention policy...", flush=True)
    pruned = prune_old_local_backups()
    if pruned == 0:
        print("All existing backups are within the 14-day retention window.")

    # Show summary
    local_files = [f for f in os.listdir(LOCAL_BACKUP_DIR) if os.path.isfile(os.path.join(LOCAL_BACKUP_DIR, f))]
    total_sz_mb = sum(os.path.getsize(os.path.join(LOCAL_BACKUP_DIR, f)) for f in local_files) / (1024 * 1024)
    print(f"\n=== BACKUP STATUS: {len(local_files)} files stored locally ({total_sz_mb:.2f} MB total) ===")
    for f in sorted(local_files, reverse=True)[:6]:
        sz_kb = os.path.getsize(os.path.join(LOCAL_BACKUP_DIR, f)) / 1024
        print(f"  - {f} ({sz_kb:.1f} KB)")
    if len(local_files) > 6:
        print(f"  ... and {len(local_files) - 6} more file(s)")

if __name__ == '__main__':
    sync_backups()
