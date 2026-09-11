import sys
import os
import time
import json
import paramiko
import _toolkit

PROJECT_ROOT = _toolkit.PROJECT_ROOT
_toolkit.add_tools_to_path()

def get_remote_destination(rel_path):
    rel_path = rel_path.replace('\\', '/')
    file_name = os.path.basename(rel_path)

    if rel_path == 'dent2025-loader.php':
        dir_name = 'wp-content/plugins/dent2025-loader'
    elif rel_path.startswith('frontend-html box in wordpress astra/') or rel_path.startswith('frontend-html box in wordpress/'):
        base = 'frontend-html box in wordpress astra/' if rel_path.startswith('frontend-html box in wordpress astra/') else 'frontend-html box in wordpress/'
        sub_path = rel_path[len(base):]
        sub_dir = os.path.dirname(sub_path)
        dir_name = 'frontend_components'
        if sub_dir and sub_dir != '.':
            dir_name += '/' + sub_dir.replace('\\', '/')
    else:
        dir_name = os.path.dirname(rel_path)

    return dir_name, file_name

def ensure_remote_dir(sftp, remote_sub_dir):
    parts = [p for p in remote_sub_dir.split('/') if p]
    current = ""
    for part in parts:
        current = current + "/" + part if current else part
        try:
            sftp.stat(current)
        except FileNotFoundError:
            try:
                sftp.mkdir(current)
            except Exception as e:
                print(f"Could not create remote directory {current}: {e}")
                return False
    return True

def get_ftp_connection(config=None):
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
    ssh_key = config.get('ssh_key')

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    
    if ssh_key and os.path.exists(ssh_key):
        ssh.connect(host, username=user, key_filename=ssh_key)
    else:
        ssh.connect(host, username=user, password=password)
        
    sftp = ssh.open_sftp()
    
    # Store ssh on sftp so we can close both later
    sftp.ssh_client = ssh
    
    return sftp, config

def upload_files(file_paths, ftp=None, config=None):
    root_dir = PROJECT_ROOT
    should_close = False
    
    if ftp is None or config is None:
        ftp, config = get_ftp_connection(config)
        should_close = True
        print(f"SFTP connection established to {config.get('host')}.", flush=True)

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

            uploaded = False
            for attempt in range(1, 4):
                try:
                    ftp.chdir(base_remote_dir if base_remote_dir else '/')
                    if dir_name and dir_name != '.':
                        ensure_remote_dir(ftp, dir_name)
                        ftp.chdir(dir_name)

                    remote_target = file_name
                    print(f"Uploading '{rel_path}' -> SFTP '{ftp.getcwd()}/{remote_target}' (attempt {attempt})...", flush=True)
                    ftp.put(abs_path, remote_target)
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
                ftp.close()
                ftp.ssh_client.close()
            except Exception:
                pass
            
            try:
                token = config.get('health_passkey', '') if isinstance(config, dict) else ''
                if not token:
                    token = os.environ.get('DENT2025_PURGE_KEY', '')
                if token:
                    import urllib.request, urllib.parse
                    url = f"https://dent2025.com/purge_cache.php?token={urllib.parse.quote(token)}"
                    req = urllib.request.Request(url, headers={'User-Agent': 'Dent2025-Deploy/2.0'})
                    with urllib.request.urlopen(req, timeout=10) as resp:
                        resp_text = resp.read().decode('utf-8', errors='ignore').strip()
                        print(f"[CACHE PURGE] {resp_text}", flush=True)
            except Exception as e:
                print(f"[CACHE PURGE] Notice: {e}", flush=True)

            print("Deployment finished cleanly.", flush=True)

def restore_from_snapshot(snapshot_dir, rel_paths, ftp=None, config=None):
    root_dir = PROJECT_ROOT
    should_close = False

    if ftp is None or config is None:
        ftp, config = get_ftp_connection(config)
        should_close = True
        print("SFTP connection established for snapshot rollback.", flush=True)

    base_remote_dir = config.get('remote_dir', '/')
    requested = [r.replace('\\', '/') for r in rel_paths]

    restored = 0
    try:
        for rel_path in requested:
            local_src = os.path.join(snapshot_dir, rel_path)
            if not os.path.exists(local_src):
                print(f"  - SKIP (missing in snapshot): {rel_path}")
                continue

            dir_name, file_name = get_remote_destination(rel_path)
            ftp.chdir(base_remote_dir if base_remote_dir else '/')
            if dir_name and dir_name != '.':
                ensure_remote_dir(ftp, dir_name)
                ftp.chdir(dir_name)

            print(f"Restoring '{rel_path}' -> SFTP '{ftp.getcwd()}/{file_name}'...", flush=True)
            ftp.put(local_src, file_name)
            restored += 1
    finally:
        if should_close:
            try:
                ftp.close()
                ftp.ssh_client.close()
            except Exception:
                pass

    print(f"Snapshot rollback finished: {restored}/{len(requested)} files restored.", flush=True)
    return restored

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python deploy.py <file1> [file2 ...]")
        sys.exit(1)

    upload_files(sys.argv[1:])
