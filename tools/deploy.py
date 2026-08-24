import sys
import os
import time
import json
import ftplib
import _toolkit

PROJECT_ROOT = _toolkit.PROJECT_ROOT
_toolkit.add_tools_to_path()

def get_remote_destination(rel_path):
    """Route a root-relative file path to its correct remote directory.

    Returns (dir_name, file_name). Used by both normal deployment and
    snapshot rollback so routing is always consistent.
    """
    rel_path = rel_path.replace('\\', '/')
    file_name = os.path.basename(rel_path)

    if rel_path == 'dent2025-loader.php':
        dir_name = 'wp-content/plugins/dent2025-loader'
    elif rel_path.startswith('frontend-html box in wordpress astra/') or rel_path.startswith('frontend-html box in wordpress/'):
        # Preserve any subdirectory under the frontend base (e.g. fonts/)
        base = 'frontend-html box in wordpress astra/' if rel_path.startswith('frontend-html box in wordpress astra/') else 'frontend-html box in wordpress/'
        sub_path = rel_path[len(base):]
        sub_dir = os.path.dirname(sub_path)
        dir_name = 'frontend_components'
        if sub_dir and sub_dir != '.':
            dir_name += '/' + sub_dir.replace('\\', '/')
    else:
        dir_name = os.path.dirname(rel_path)

    return dir_name, file_name

def ensure_remote_dir(ftp, remote_sub_dir):
    parts = [p for p in remote_sub_dir.split('/') if p]
    for part in parts:
        try:
            ftp.cwd(part)
        except ftplib.error_perm:
            try:
                ftp.mkd(part)
                ftp.cwd(part)
            except Exception as e:
                print(f"Could not create or enter remote directory {part}: {e}")
                return False
    return True

def get_ftp_connection(config=None):
    """Establish and return an authenticated FTP connection and config dict."""
    if config is None:
        root_dir = PROJECT_ROOT
        config_path = os.path.join(root_dir, 'deploy_config.json')
        if not os.path.exists(config_path):
            raise RuntimeError(f"Config file not found at {config_path}")
        with open(config_path, 'r', encoding='utf-8') as f:
            config = json.load(f)

    host = config.get('host')
    user = config.get('user')
    password = config.get('password')
    ftp = ftplib.FTP(host)
    ftp.login(user, password)
    return ftp, config

def upload_files(file_paths, ftp=None, config=None):
    root_dir = PROJECT_ROOT
    should_close = False
    
    if ftp is None or config is None:
        ftp, config = get_ftp_connection(config)
        should_close = True
        print(f"FTP connection established to {config.get('host')}.", flush=True)

    base_remote_dir = config.get('remote_dir', '/')

    try:
        for input_path in file_paths:
            abs_path = os.path.abspath(input_path)
            if not os.path.exists(abs_path):
                print(f"Error: Local file does not exist: {abs_path}")
                continue

            try:
                rel_path = os.path.relpath(abs_path, root_dir).replace('\\', '/')
            except ValueError:
                rel_path = os.path.basename(abs_path)

            dir_name, file_name = get_remote_destination(rel_path)

            # Upload with up to 3 retries on transient connection drop
            uploaded = False
            for attempt in range(1, 4):
                try:
                    ftp.cwd(base_remote_dir if base_remote_dir else '/')
                    if dir_name and dir_name != '.':
                        ensure_remote_dir(ftp, dir_name)

                    print(f"Uploading '{rel_path}' -> FTP '{ftp.pwd()}/{file_name}' (attempt {attempt})...", flush=True)
                    with open(abs_path, 'rb') as fp:
                        ftp.storbinary(f"STOR {file_name}", fp)
                    uploaded = True
                    print(f"Successfully uploaded: {rel_path}", flush=True)
                    break
                except Exception as e:
                    if attempt < 3:
                        print(f"[RETRY] Upload failed ({e}), reconnecting and retrying in 1.5s...", flush=True)
                        time.sleep(1.5)
                        try:
                            ftp, _ = get_ftp_connection(config)
                        except Exception:
                            pass
                    else:
                        raise e
    finally:
        if should_close:
            try:
                ftp.quit()
            except Exception:
                pass
            print("Deployment finished cleanly.", flush=True)

def restore_from_snapshot(snapshot_dir, rel_paths, ftp=None, config=None):
    """Upload files back from a snapshot directory to their correct remote location.

    Uses each file's root-relative path (as stored in the snapshot) directly for
    routing, so rollback targets the correct server directories regardless of the
    snapshot's own location under .deploy_backups/.
    """
    root_dir = PROJECT_ROOT
    should_close = False

    if ftp is None or config is None:
        ftp, config = get_ftp_connection(config)
        should_close = True
        print("FTP connection established for snapshot rollback.", flush=True)

    base_remote_dir = config.get('remote_dir', '/')

    requested = [r.replace('\\', '/') for r in rel_paths]
    available = set()
    for root, _, files in os.walk(snapshot_dir):
        for name in files:
            full = os.path.join(root, name)
            rel = os.path.relpath(full, snapshot_dir).replace('\\', '/')
            available.add(rel)

    restored = 0
    try:
        for rel_path in requested:
            local_src = os.path.join(snapshot_dir, rel_path)
            if not os.path.exists(local_src):
                print(f"  - SKIP (missing in snapshot): {rel_path}")
                continue

            dir_name, file_name = get_remote_destination(rel_path)
            ftp.cwd(base_remote_dir if base_remote_dir else '/')
            if dir_name and dir_name != '.':
                ensure_remote_dir(ftp, dir_name)

            print(f"Restoring '{rel_path}' -> FTP '{ftp.pwd()}/{file_name}'...", flush=True)
            with open(local_src, 'rb') as fp:
                ftp.storbinary(f"STOR {file_name}", fp)
            restored += 1
    finally:
        if should_close:
            try:
                ftp.quit()
            except Exception:
                pass

    print(f"Snapshot rollback finished: {restored}/{len(requested)} files restored.", flush=True)
    return restored

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python deploy.py <file1> [file2 ...]")
        sys.exit(1)

    upload_files(sys.argv[1:])
