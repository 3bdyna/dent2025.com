import sys
import os
import io
import time
import json
import tarfile
import subprocess
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

def create_deployment_tar(file_paths, root_dir, custom_src_dir=None):
    """Packages files into an in-memory gzipped tar archive with accurate destination paths."""
    buf = io.BytesIO()
    processed_files = []
    base_src = custom_src_dir or root_dir

    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for input_path in file_paths:
            if custom_src_dir:
                abs_path = os.path.abspath(os.path.join(custom_src_dir, input_path))
                rel_path = input_path.replace('\\', '/')
            else:
                abs_path = os.path.abspath(input_path)
                if not os.path.exists(abs_path):
                    print(f"Warning: Local file not found: {abs_path}")
                    continue
                try:
                    rel_path = os.path.relpath(abs_path, root_dir).replace('\\', '/')
                except ValueError:
                    rel_path = os.path.basename(abs_path)

            if not os.path.exists(abs_path):
                print(f"Warning: File does not exist: {abs_path}")
                continue

            dir_name, file_name = get_remote_destination(rel_path)
            target_rel = f"{dir_name}/{file_name}" if (dir_name and dir_name != '.') else file_name

            with open(abs_path, 'rb') as f:
                content = f.read()

            ti = tarfile.TarInfo(name=target_rel)
            ti.size = len(content)
            ti.mtime = os.path.getmtime(abs_path)
            ti.mode = 0o664
            tar.addfile(ti, io.BytesIO(content))
            processed_files.append((rel_path, target_rel))

    return buf.getvalue(), processed_files

def purge_remote_cache(config=None):
    """Purges remote LiteSpeed cache and transients via SSH CLI or fallback HTTP."""
    ssh_host = 'ssh.dent2025.com'
    ssh_user = 'azureuser'
    
    # Fast path: invoke purge_cache.php directly via SSH CLI on localhost
    try:
        cmd = ['ssh', '-o', 'BatchMode=yes', f"{ssh_user}@{ssh_host}", "php -f /var/www/dent2025/purge_cache.php"]
        res = subprocess.run(cmd, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=10)
        if res.returncode == 0 and res.stdout:
            for line in res.stdout.splitlines():
                if line.strip():
                    print(f"[CACHE PURGE] {line.strip()}", flush=True)
            return
    except Exception:
        pass

    # Fallback path: HTTP request with auth token
    token = config.get('health_passkey', '') if isinstance(config, dict) else ''
    if not token:
        token = os.environ.get('DENT2025_PURGE_KEY', '')
    if token:
        import urllib.request, urllib.parse
        try:
            url = f"https://dent2025.com/purge_cache.php?token={urllib.parse.quote(token)}"
            req = urllib.request.Request(url, headers={'User-Agent': 'Dent2025-Deploy/2.0'})
            with urllib.request.urlopen(req, timeout=10) as resp:
                resp_text = resp.read().decode('utf-8', errors='ignore').strip()
                print(f"[CACHE PURGE] {resp_text}", flush=True)
        except Exception as e:
            print(f"[CACHE PURGE] Notice: {e}", flush=True)

def stream_deploy_via_ssh(file_paths, config=None, custom_src_dir=None):
    """Ultra-fast deployment engine: streams an in-memory tar over a single SSH connection in ~1.8s."""
    root_dir = PROJECT_ROOT
    ssh_host = config.get('ssh_host', 'ssh.dent2025.com') if isinstance(config, dict) else 'ssh.dent2025.com'
    ssh_user = config.get('user', 'azureuser') if isinstance(config, dict) else 'azureuser'
    remote_base = (config.get('remote_dir') if isinstance(config, dict) else None) or '/var/www/dent2025'

    tar_bytes, processed = create_deployment_tar(file_paths, root_dir, custom_src_dir=custom_src_dir)
    if not processed:
        print("No valid files to deploy.")
        return False

    sz_kb = len(tar_bytes) / 1024
    print(f"Streaming {len(processed)} file(s) ({sz_kb:.1f} KB payload) via high-speed SSH stream...", flush=True)
    for rel, dest in processed:
        print(f"  - {rel} -> {dest}")

    t0 = time.time()
    remote_cmd = (
        f"tar -xzf - -C '{remote_base}' && "
        f"php -f '{remote_base}/purge_cache.php'"
    )
    cmd = ['ssh', '-o', 'BatchMode=yes', f"{ssh_user}@{ssh_host}", remote_cmd]

    res = subprocess.run(cmd, input=tar_bytes, capture_output=True, timeout=45)
    elapsed = time.time() - t0

    if res.returncode != 0:
        err = res.stderr.decode('utf-8', errors='ignore')
        raise RuntimeError(f"SSH Streaming deployment failed (code {res.returncode}): {err}")

    out = res.stdout.decode('utf-8', errors='ignore').strip()
    if out:
        for line in out.splitlines():
            if line.strip():
                print(f"  [SERVER] {line.strip()}", flush=True)

    print(f"High-speed deployment finished cleanly in {elapsed:.2f}s.", flush=True)
    return True

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

    host = config.get('host', 'ssh.dent2025.com')
    user = config.get('user', 'azureuser')
    password = config.get('password')
    ssh_key = config.get('ssh_key')

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    
    if ssh_key and os.path.exists(ssh_key):
        ssh.connect(host, username=user, key_filename=ssh_key, timeout=4)
    else:
        ssh.connect(host, username=user, password=password, timeout=4)
        
    sftp = ssh.open_sftp()
    sftp.ssh_client = ssh
    return sftp, config

def upload_files(file_paths, ftp=None, config=None):
    """Primary upload function: uses single-connection SSH streaming with SFTP/SCP fallback."""
    root_dir = PROJECT_ROOT
    if config is None:
        config_path = os.path.join(root_dir, 'deploy_config.json')
        if os.path.exists(config_path):
            with open(config_path, 'r', encoding='utf-8') as f:
                config = json.load(f)
        else:
            config = {}

    # Fast Path: Single-connection high-speed SSH Tar stream (~1.8s)
    try:
        if stream_deploy_via_ssh(file_paths, config):
            return
    except Exception as stream_err:
        print(f"[STREAM FALLBACK] SSH streaming notice ({stream_err}), using fallback transfer...", flush=True)

    # Fallback Path: Paramiko SFTP
    should_close = False
    if ftp is None:
        try:
            ftp, config = get_ftp_connection(config)
            should_close = True
            print(f"SFTP connection established to {config.get('host')}.", flush=True)
        except Exception as conn_err:
            print(f"Direct SFTP unavailable ({conn_err}), using OpenSSH fallback...", flush=True)
            _upload_via_openssh_legacy(file_paths, config)
            return

    base_remote_dir = config.get('remote_dir', '/var/www/dent2025')

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

            for attempt in range(1, 4):
                try:
                    ftp.chdir(base_remote_dir if base_remote_dir else '/')
                    if dir_name and dir_name != '.':
                        ensure_remote_dir(ftp, dir_name)
                        ftp.chdir(dir_name)

                    remote_target = file_name
                    print(f"Uploading '{rel_path}' -> SFTP '{ftp.getcwd()}/{remote_target}'...", flush=True)
                    ftp.put(abs_path, remote_target)
                    print(f"Successfully uploaded: {rel_path}", flush=True)
                    break
                except Exception as e:
                    if attempt < 3:
                        time.sleep(1.0)
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
            purge_remote_cache(config)

def _upload_via_openssh_legacy(file_paths, config):
    """Legacy OpenSSH per-file fallback if tar streaming and Paramiko are both unavailable."""
    root_dir = PROJECT_ROOT
    ssh_host = 'ssh.dent2025.com'
    base_remote_dir = config.get('remote_dir', '/var/www/dent2025')

    for input_path in file_paths:
        abs_path = os.path.abspath(input_path)
        if not os.path.exists(abs_path):
            continue
        try:
            rel_path = os.path.relpath(abs_path, root_dir).replace('\\', '/')
        except ValueError:
            rel_path = os.path.basename(abs_path)

        dir_name, file_name = get_remote_destination(rel_path)
        target_dir = f"{base_remote_dir}/{dir_name}" if (dir_name and dir_name != '.') else base_remote_dir

        subprocess.run(['ssh', '-o', 'BatchMode=yes', f"azureuser@{ssh_host}", f"mkdir -p '{target_dir}'"],
                       stdin=subprocess.DEVNULL, capture_output=True, timeout=15)
        remote_dest = f"azureuser@{ssh_host}:{target_dir}/{file_name}"
        res = subprocess.run(['scp', '-O', '-o', 'BatchMode=yes', abs_path, remote_dest],
                             stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=60)
        if res.returncode != 0:
            raise RuntimeError(f"SCP failed: {res.stderr}")
        print(f"Successfully uploaded: {rel_path}", flush=True)

    purge_remote_cache(config)

def restore_from_snapshot(snapshot_dir, rel_paths, ftp=None, config=None):
    """Restores snapshot files to the server using high-speed streaming."""
    if config is None:
        root_dir = PROJECT_ROOT
        config_path = os.path.join(root_dir, 'deploy_config.json')
        if os.path.exists(config_path):
            with open(config_path, 'r', encoding='utf-8') as f:
                config = json.load(f)
        else:
            config = {}

    requested = [r.replace('\\', '/') for r in rel_paths]
    print(f"Restoring {len(requested)} files from snapshot {os.path.basename(snapshot_dir)}...", flush=True)

    try:
        stream_deploy_via_ssh(requested, config, custom_src_dir=snapshot_dir)
        return len(requested)
    except Exception as e:
        print(f"High-speed snapshot rollback encountered notice ({e}), falling back to SFTP...", flush=True)

    # SFTP rollback fallback
    should_close = False
    if ftp is None:
        ftp, config = get_ftp_connection(config)
        should_close = True

    base_remote_dir = config.get('remote_dir', '/var/www/dent2025')
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

            ftp.put(local_src, file_name)
            restored += 1
    finally:
        if should_close:
            try:
                ftp.close()
                ftp.ssh_client.close()
            except Exception:
                pass
            purge_remote_cache(config)

    print(f"Snapshot rollback finished: {restored}/{len(requested)} files restored.", flush=True)
    return restored

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python deploy.py <file1> [file2 ...]")
        sys.exit(1)

    upload_files(sys.argv[1:])
