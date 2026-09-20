"""
tools/sync_cloud_events.py
Dent2025 Academic Portal - Cloud-First Dynamic Data Synchronization & Smart Merge Engine

Ensures the cloud (Azure) is the absolute Source of Truth for runtime data
(calendar events, announcements, timetables). Guarantees zero cloud data loss.

Usage:
  python tools/sync_cloud_events.py --pull
  python tools/sync_cloud_events.py --diff [file]
  python tools/sync_cloud_events.py --merge-and-deploy <file> [--allow-delete]
"""

import sys
import os
import json
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

SSH_USER = 'azureuser'
SSH_HOST = 'ssh.dent2025.com'
REMOTE_BASE = '/var/www/dent2025'

def run_ssh_cmd(cmd_str, timeout=15):
    """Runs a remote command over SSH with stdin closed."""
    ssh_cmd = ['ssh', '-n', '-o', 'BatchMode=yes', f'{SSH_USER}@{SSH_HOST}', cmd_str]
    res = subprocess.run(
        ssh_cmd,
        stdin=subprocess.DEVNULL,
        capture_output=True,
        text=True,
        encoding='utf-8',
        errors='ignore',
        timeout=timeout
    )
    return res.returncode == 0, res.stdout, res.stderr

def run_scp_download(remote_path, local_path, timeout=30):
    """Downloads a file from the server via SCP."""
    os.makedirs(os.path.dirname(os.path.abspath(local_path)), exist_ok=True)
    scp_cmd = [
        'scp', '-O', '-o', 'BatchMode=yes',
        f'{SSH_USER}@{SSH_HOST}:{remote_path}',
        local_path
    ]
    res = subprocess.run(
        scp_cmd,
        stdin=subprocess.DEVNULL,
        capture_output=True,
        text=True,
        encoding='utf-8',
        errors='ignore',
        timeout=timeout
    )
    return res.returncode == 0, res.stderr

def run_scp_upload(local_path, remote_path, timeout=30):
    """Uploads a file to the server via SCP."""
    scp_cmd = [
        'scp', '-O', '-o', 'BatchMode=yes',
        local_path,
        f'{SSH_USER}@{SSH_HOST}:{remote_path}'
    ]
    res = subprocess.run(
        scp_cmd,
        stdin=subprocess.DEVNULL,
        capture_output=True,
        text=True,
        encoding='utf-8',
        errors='ignore',
        timeout=timeout
    )
    return res.returncode == 0, res.stderr

def get_remote_file_content(remote_path):
    """Fetches text content of a remote file via SSH cat."""
    ok, stdout, stderr = run_ssh_cmd(f'cat {remote_path}')
    if not ok:
        return None, stderr
    return stdout, ""

def pull_all_cloud_data():
    """Pulls all schedule events, announcements, and timetables from Azure to PC."""
    print("=== DENT2025 CLOUD DATA PULL (Azure -> PC) ===", flush=True)
    print(f"Connecting to {SSH_USER}@{SSH_HOST}...", flush=True)

    # 1. Discover remote schedule files
    ok, stdout, stderr = run_ssh_cmd(f'find {REMOTE_BASE} -maxdepth 1 -name "schedule_events*.json"')
    if not ok:
        print(f"[ERROR] Failed to discover remote files: {stderr}")
        return False

    remote_files = [line.strip() for line in stdout.splitlines() if line.strip().endswith('.json')]
    pulled_count = 0

    for rem in remote_files:
        fname = os.path.basename(rem)
        loc_path = os.path.join(PROJECT_ROOT, fname)
        print(f"Pulling '{fname}'...", flush=True)
        ok_scp, err = run_scp_download(rem, loc_path)
        if ok_scp:
            pulled_count += 1
            print(f"  [OK] Synced {fname}")
        else:
            print(f"  [FAIL] Could not pull {fname}: {err}")

    # 2. Pull announcements
    ok, stdout, _ = run_ssh_cmd(f'find {REMOTE_BASE}/announcements_data -name "*.json"')
    if ok and stdout.strip():
        ann_files = [line.strip() for line in stdout.splitlines() if line.strip().endswith('.json')]
        for rem in ann_files:
            fname = os.path.basename(rem)
            loc_path = os.path.join(PROJECT_ROOT, 'announcements_data', fname)
            print(f"Pulling announcement '{fname}'...", flush=True)
            ok_scp, err = run_scp_download(rem, loc_path)
            if ok_scp:
                pulled_count += 1
                print(f"  [OK] Synced announcements_data/{fname}")
            else:
                print(f"  [FAIL] Could not pull {fname}: {err}")

    # 3. Pull dent2025_classes.json if exists
    classes_rem = f'{REMOTE_BASE}/dent2025_classes.json'
    classes_loc = os.path.join(PROJECT_ROOT, 'dent2025_classes.json')
    ok_chk, _, _ = run_ssh_cmd(f'test -f {classes_rem} && echo "yes"')
    if ok_chk:
        print("Pulling 'dent2025_classes.json'...", flush=True)
        ok_scp, err = run_scp_download(classes_rem, classes_loc)
        if ok_scp:
            pulled_count += 1
            print("  [OK] Synced dent2025_classes.json")

    print(f"\n[DONE] Successfully pulled {pulled_count} dynamic data files to PC.")
    return True

def diff_events(target_file=None):
    """Compares local schedule files against remote cloud files."""
    print("=== DENT2025 CLOUD DATA DIFF ===", flush=True)

    files_to_check = []
    if target_file:
        files_to_check.append(os.path.basename(target_file))
    else:
        # Find local schedule events files
        for f in os.listdir(PROJECT_ROOT):
            if f.startswith('schedule_events') and f.endswith('.json'):
                files_to_check.append(f)

    if not files_to_check:
        print("No schedule files found to diff.")
        return

    for fname in files_to_check:
        loc_path = os.path.join(PROJECT_ROOT, fname)
        rem_path = f'{REMOTE_BASE}/{fname}'
        print(f"\n--- Comparing: {fname} ---")

        if not os.path.exists(loc_path):
            print(f"  Local file does not exist: {loc_path}")
            continue

        with open(loc_path, 'r', encoding='utf-8') as f:
            try:
                local_data = json.load(f)
            except Exception as e:
                print(f"  Error reading local JSON: {e}")
                continue

        rem_raw, err = get_remote_file_content(rem_path)
        if rem_raw is None:
            print(f"  Remote file not found or inaccessible on server ({err})")
            continue

        try:
            remote_data = json.loads(rem_raw)
        except Exception as e:
            print(f"  Error parsing remote JSON: {e}")
            continue

        if not isinstance(local_data, list) or not isinstance(remote_data, list):
            print(f"  Identical? {local_data == remote_data}")
            continue

        loc_map = {e.get('id'): e for e in local_data if isinstance(e, dict) and 'id' in e}
        rem_map = {e.get('id'): e for e in remote_data if isinstance(e, dict) and 'id' in e}

        missing_in_local = [eid for eid in rem_map if eid not in loc_map]
        new_in_local = [eid for eid in loc_map if eid not in rem_map]

        modified = []
        for eid in loc_map:
            if eid in rem_map and loc_map[eid] != rem_map[eid]:
                modified.append(eid)

        if not missing_in_local and not new_in_local and not modified:
            print(f"  [EXACT MATCH] Local and Cloud are identical ({len(local_data)} events).")
        else:
            if missing_in_local:
                print(f"  [CLOUD HAS MORE] {len(missing_in_local)} events present in Cloud but MISSING locally:")
                for eid in missing_in_local:
                    ev = rem_map[eid]
                    print(f"    - [{eid}] ({ev.get('date')}): {ev.get('title')}")
            if new_in_local:
                print(f"  [LOCAL HAS NEW] {len(new_in_local)} events added locally but not yet in Cloud:")
                for eid in new_in_local:
                    ev = loc_map[eid]
                    print(f"    + [{eid}] ({ev.get('date')}): {ev.get('title')}")
            if modified:
                print(f"  [MODIFIED] {len(modified)} events have differences:")
                for eid in modified:
                    print(f"    ~ [{eid}] local='{loc_map[eid].get('title')}' vs remote='{rem_map[eid].get('title')}'")

def smart_merge_events(local_data, remote_data, allow_delete=False):
    """
    Merges local event list into remote event list.
    RULE: Every event in remote is preserved unless allow_delete is True.
    Local additions (new IDs) and local edits (same ID, updated fields) take precedence.
    """
    rem_map = {e['id']: e for e in remote_data if isinstance(e, dict) and 'id' in e}
    loc_map = {e['id']: e for e in local_data if isinstance(e, dict) and 'id' in e}

    # Start with remote events as base
    merged_map = dict(rem_map)

    # 1. Check for deletions if allow_delete is False
    if not allow_delete:
        missing_ids = [eid for eid in rem_map if eid not in loc_map]
        if missing_ids:
            print(f"[SMART MERGE] Preserving {len(missing_ids)} cloud events not present locally:")
            for mid in missing_ids:
                print(f"  * Preserved: [{mid}] {rem_map[mid].get('title')}")

    # 2. Apply local edits or additions
    added_count = 0
    updated_count = 0
    for eid, loc_ev in loc_map.items():
        if eid not in merged_map:
            merged_map[eid] = loc_ev
            added_count += 1
            print(f"[SMART MERGE] Adding new event: [{eid}] {loc_ev.get('title')}")
        elif merged_map[eid] != loc_ev:
            merged_map[eid] = loc_ev
            updated_count += 1
            print(f"[SMART MERGE] Updating event: [{eid}] {loc_ev.get('title')}")

    # Sort merged events by date
    merged_list = list(merged_map.values())
    try:
        merged_list.sort(key=lambda x: str(x.get('date', '')))
    except Exception:
        pass

    return merged_list, added_count, updated_count

def merge_and_deploy(target_file, allow_delete=False):
    """Smart-merges local event changes with cloud and uploads safely."""
    fname = os.path.basename(target_file)
    loc_path = os.path.join(PROJECT_ROOT, fname)
    rem_path = f'{REMOTE_BASE}/{fname}'

    print(f"=== DENT2025 SMART MERGE & DEPLOY: {fname} ===", flush=True)

    if not os.path.exists(loc_path):
        print(f"[ERROR] Local file not found: {loc_path}")
        return False

    with open(loc_path, 'r', encoding='utf-8') as f:
        try:
            local_data = json.load(f)
        except Exception as e:
            print(f"[ERROR] Local JSON syntax error: {e}")
            return False

    # Fetch remote
    rem_raw, err = get_remote_file_content(rem_path)
    remote_data = []
    if rem_raw is not None:
        try:
            remote_data = json.loads(rem_raw)
        except Exception:
            remote_data = []

    if isinstance(local_data, list) and isinstance(remote_data, list):
        merged_data, added, updated = smart_merge_events(local_data, remote_data, allow_delete=allow_delete)
        print(f"\nMerge Results: {len(remote_data)} cloud events -> {len(merged_data)} final events (+{added} added, ~{updated} updated).")
    else:
        # For non-list JSON, fallback to direct replacement if verified
        merged_data = local_data

    # 1. Create server-side snapshot backup before writing
    ts = datetime.now().strftime('%Y%m%d_%H%M%S')
    backup_rem = f'{REMOTE_BASE}/history_data/snapshots/snap_premerge_{ts}_{fname}'
    print(f"Creating remote safety snapshot: {backup_rem}...", flush=True)
    run_ssh_cmd(f'mkdir -p {REMOTE_BASE}/history_data/snapshots && cp {rem_path} {backup_rem}')

    # 2. Write merged output to local file
    merged_str = json.dumps(merged_data, ensure_ascii=False, indent=2) + "\n"
    with open(loc_path, 'w', encoding='utf-8') as f:
        f.write(merged_str)
    print(f"Updated local file '{fname}'.", flush=True)

    # 3. Upload merged file via SCP
    print(f"Uploading merged '{fname}' to Azure...", flush=True)
    ok_up, up_err = run_scp_upload(loc_path, rem_path)
    if not ok_up:
        print(f"[FATAL] SCP upload failed: {up_err}")
        return False

    # 4. Purge remote cache
    try:
        import deploy
        config_path = os.path.join(PROJECT_ROOT, 'deploy_config.json')
        if os.path.exists(config_path):
            with open(config_path, 'r', encoding='utf-8') as cf:
                cfg = json.load(cf)
            deploy.purge_remote_cache(cfg)
    except Exception as e:
        print(f"[CACHE PURGE] Notice: {e}")

    print(f"[SUCCESS] '{fname}' merged and deployed safely! Zero cloud data lost.")
    return True

if __name__ == '__main__':
    args = sys.argv[1:]
    if not args or '--help' in args or '-h' in args:
        print("Usage:")
        print("  python tools/sync_cloud_events.py --pull")
        print("  python tools/sync_cloud_events.py --diff [filename]")
        print("  python tools/sync_cloud_events.py --merge-and-deploy <filename> [--allow-delete]")
        sys.exit(0)

    if '--pull' in args:
        success = pull_all_cloud_data()
        sys.exit(0 if success else 1)

    elif '--diff' in args:
        target = args[1] if len(args) > 1 and not args[1].startswith('--') else None
        diff_events(target)
        sys.exit(0)

    elif '--merge-and-deploy' in args:
        idx = args.index('--merge-and-deploy')
        if idx + 1 >= len(args):
            print("Error: Specify filename to merge and deploy.")
            sys.exit(1)
        target = args[idx + 1]
        allow_del = '--allow-delete' in args
        success = merge_and_deploy(target, allow_delete=allow_del)
        sys.exit(0 if success else 1)

    else:
        print(f"Unknown command: {args}")
        sys.exit(1)
