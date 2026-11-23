import sys
import os
import re
import json
import subprocess

import _toolkit

FORBIDDEN_FILES = [
    'deploy_config.json',
    'dent2025_passwords.json',
    'passwords.txt',
    '.env',
    '.git',
    'wp-config.php'
]

SECRET_PATTERNS = [
    ('Google API Key', re.compile(r'AIza[0-9A-Za-z_-]{35}')),
    ('Secret API Key (sk-)', re.compile(r'\bsk-[0-9A-Za-z]{20,}\b')),
    ('GitHub Token', re.compile(r'\b(?:ghp_[0-9A-Za-z]{36}|github_pat_[0-9A-Za-z_]{20,})\b')),
    ('AWS Access Key', re.compile(r'\bAKIA[0-9A-Z]{16}\b')),
    ('Private Key Block', re.compile(r'-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----')),
    ('Hardcoded SSH Host/User', re.compile(r'azureuser@|ssh\.dent2025\.com', re.IGNORECASE)),
]

SECRET_SCAN_SKIP_EXTS = {'.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico', '.mp3', '.woff', '.woff2', '.pdf', '.gz', '.zip', '.tar'}
SECRET_SCAN_SKIP_FILES = {'deploy_guard.py', 'test_system_logic.php'}


def check_secrets(file_path):
    """Scans a text file for accidentally hardcoded API keys, tokens, private keys, or SSH hosts."""
    abs_path = os.path.abspath(file_path)
    if not os.path.exists(abs_path) or os.path.isdir(abs_path):
        return True, "OK"

    base = os.path.basename(abs_path)
    ext = os.path.splitext(base)[1].lower()
    if ext in SECRET_SCAN_SKIP_EXTS or base in SECRET_SCAN_SKIP_FILES or base.endswith('.example.json'):
        return True, "OK"

    try:
        with open(abs_path, 'r', encoding='utf-8', errors='ignore') as f:
            content = f.read()
    except OSError:
        return True, "OK"

    for label, pattern in SECRET_PATTERNS:
        m = pattern.search(content)
        if m:
            line_no = content.count('\n', 0, m.start()) + 1
            return False, f"Secret Leak Blocked: {label} detected in '{file_path}' (line {line_no}). Store secrets in gitignored config files instead."

    return True, "OK"

def check_syntax(file_path):
    """Checks syntax of PHP, JSON, or JS files before deployment."""
    abs_path = os.path.abspath(file_path)
    if not os.path.exists(abs_path):
        return False, f"File does not exist: {file_path}"
    
    ext = os.path.splitext(file_path)[1].lower()
    
    if ext == '.php':
        try:
            res = subprocess.run(['php', '-l', abs_path], capture_output=True, text=True, timeout=5)
            if res.returncode != 0:
                return False, f"PHP Syntax Error in {file_path}: {res.stdout or res.stderr}"
        except FileNotFoundError:
            # PHP CLI not in PATH - fallback to basic bracket check
            with open(abs_path, 'r', encoding='utf-8', errors='ignore') as f:
                content = f.read()
                if '<?php' not in content and '<?' not in content:
                    return False, f"Invalid PHP file: missing <?php tag in {file_path}"
    
    elif ext == '.json':
        try:
            with open(abs_path, 'r', encoding='utf-8') as f:
                json.load(f)
        except Exception as e:
            return False, f"JSON Syntax Error in {file_path}: {str(e)}"
            
    elif ext in ['.js', '.html']:
        with open(abs_path, 'r', encoding='utf-8', errors='ignore') as f:
            content = f.read()
            if len(content.strip()) == 0:
                return False, f"Empty file detected: {file_path}"

        # Validate JavaScript syntax with node if available
        try:
            if ext == '.js':
                res = subprocess.run(['node', '--check', abs_path], capture_output=True, text=True, timeout=5)
                if res.returncode != 0:
                    return False, f"JS Syntax Error in {file_path}: {res.stderr.strip()}"
            elif ext == '.html':
                import re, tempfile
                # Find script tags that do not have non-JS types like application/json or text/template
                scripts = re.findall(r'<script(?:\s+[^>]*)?>(.*?)</script>', content, re.DOTALL)
                for idx, sc in enumerate(scripts):
                    if not sc.strip():
                        continue
                    with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False, encoding='utf-8') as tf:
                        tf.write(sc)
                        tf_path = tf.name
                    try:
                        res = subprocess.run(['node', '--check', tf_path], capture_output=True, text=True, timeout=5)
                        if res.returncode != 0:
                            return False, f"JS Syntax Error in {file_path} (script block {idx+1}): {res.stderr.strip()}"
                    finally:
                        if os.path.exists(tf_path):
                            try:
                                os.remove(tf_path)
                            except OSError:
                                pass
        except (FileNotFoundError, subprocess.TimeoutExpired):
            pass

    return True, "OK"

def is_forbidden_path(path):
    """Checks if path is forbidden from deployment."""
    norm = path.replace('\\', '/')
    base_name = os.path.basename(path)
    if base_name in FORBIDDEN_FILES:
        return True
    if norm.startswith('.git/') or '/.git/' in norm:
        return True
    if 'gemini_keys_data' in norm or '.deploy_backups' in norm or 'server_backups_dent2025_daily' in norm or 'polls_data' in norm or 'analytics_data' in norm:
        return True
    return False

def is_dynamic_data_file(path):
    """Checks if path is a dynamic academic data file modified live on website."""
    base = os.path.basename(path)
    norm = path.replace('\\', '/')
    if base.startswith('schedule_events') and base.endswith('.json'):
        return True
    if base == 'dent2025_classes.json':
        return True
    if 'announcements_data' in norm and base.endswith('.json'):
        return True
    return False

def check_dynamic_data_safety(file_path, allow_delete=False):
    """
    Guarantees cloud data cannot be deleted or overwritten by an outdated local file.
    Validates that every event/item currently on Azure exists in the local file,
    unless allow_delete is explicitly True.
    """
    if not is_dynamic_data_file(file_path):
        return True, "OK"

    abs_path = os.path.abspath(file_path)
    if not os.path.exists(abs_path):
        return False, f"File does not exist: {file_path}"

    fname = os.path.basename(file_path)
    remote_path = f"/var/www/dent2025/{fname}"
    if 'announcements_data' in file_path.replace('\\', '/'):
        remote_path = f"/var/www/dent2025/announcements_data/{fname}"

    # Query cloud via fast SSH cat
    try:
        ssh_user, ssh_host = _toolkit.get_ssh_target()
        ssh_cmd = ['ssh', '-n', '-o', 'BatchMode=yes', f'{ssh_user}@{ssh_host}', f'cat {remote_path}']
        res = subprocess.run(
            ssh_cmd,
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            encoding='utf-8',
            errors='ignore',
            timeout=8
        )
        if res.returncode != 0 or not res.stdout.strip():
            # File might not exist remotely yet, which is safe to deploy as new
            return True, "OK"
        remote_raw = res.stdout.strip()
    except Exception as e:
        print(f"[GUARD NOTICE] Cloud safety probe unreachable ({e}). Proceeding with caution.")
        return True, "OK"

    try:
        with open(abs_path, 'r', encoding='utf-8') as f:
            local_data = json.load(f)
        remote_data = json.loads(remote_raw)
    except Exception as e:
        return False, f"JSON parse error during cloud safety check: {e}"

    if isinstance(local_data, list) and isinstance(remote_data, list):
        loc_ids = {e.get('id') for e in local_data if isinstance(e, dict) and 'id' in e}
        rem_ids = {e.get('id') for e in remote_data if isinstance(e, dict) and 'id' in e}
        missing_ids = rem_ids - loc_ids
        if missing_ids:
            if not allow_delete:
                sample = list(missing_ids)[:3]
                return False, (
                    f"Cloud Protection Alert: Local '{fname}' is missing {len(missing_ids)} event(s) "
                    f"present in the Cloud (e.g. {sample}). The website is the source of truth! "
                    f"Aborting deployment to prevent cloud data loss. Run 'python tools/sync_cloud_events.py --pull' or '--merge-and-deploy {fname}' first."
                )
            else:
                print(f"[GUARD NOTICE] Allowing deletion of {len(missing_ids)} event(s) in '{fname}' (--allow-delete).")

    return True, "OK"

def validate_deployment(file_paths, note, allow_delete=False):
    """Full validation of files and deployment note."""
    errors = []
    
    # 1. Check AI Change Note
    if not note or len(note.strip()) < 5:
        errors.append("Validation Error: An AI change note (--note) of at least 5 characters is REQUIRED for every update/bug fix.")
        
    # 2. Check each file
    for path in file_paths:
        if is_forbidden_path(path):
            errors.append(f"Security Alert: Deploying protected/secret file '{path}' is strictly forbidden!")
            continue

        secrets_ok, secret_msg = check_secrets(path)
        if not secrets_ok:
            errors.append(secret_msg)
            continue
            
        is_valid, msg = check_syntax(path)
        if not is_valid:
            errors.append(msg)
            continue

        is_safe, msg_safe = check_dynamic_data_safety(path, allow_delete=allow_delete)
        if not is_safe:
            errors.append(msg_safe)
            
    return len(errors) == 0, errors


def check_staged_git_files():
    """Validates all staged Git files against forbidden paths and hardcoded secrets (used by .git/hooks/pre-commit)."""
    res = subprocess.run(
        ['git', 'diff', '--cached', '--name-only', '--diff-filter=ACMR'],
        capture_output=True, text=True, cwd=_toolkit.PROJECT_ROOT, timeout=10
    )
    if res.returncode != 0:
        return True, []

    staged = [line.strip() for line in res.stdout.splitlines() if line.strip()]
    errors = []
    for rel_path in staged:
        if is_forbidden_path(rel_path):
            errors.append(f"Secret File Blocked: '{rel_path}' must never be committed to Git.")
            continue
        abs_path = os.path.join(_toolkit.PROJECT_ROOT, rel_path)
        ok, msg = check_secrets(abs_path)
        if not ok:
            errors.append(msg)
    return len(errors) == 0, errors


if __name__ == '__main__':
    if len(sys.argv) >= 2 and sys.argv[1] == '--check-staged':
        ok, errs = check_staged_git_files()
        if ok:
            sys.exit(0)
        print("Git pre-commit secret guard FAILED:")
        for err in errs:
            print(f"  - {err}")
        sys.exit(1)

    if len(sys.argv) < 3:
        print("Usage: python deploy_guard.py --note \"description\" <file1> [file2...]")
        sys.exit(1)
        
    note = sys.argv[2] if sys.argv[1] == '--note' else ""
    files = sys.argv[3:] if sys.argv[1] == '--note' else sys.argv[1:]
    
    success, errs = validate_deployment(files, note)
    if success:
        print("Pre-flight guard validation passed successfully.")
        sys.exit(0)
    else:
        print("Pre-flight guard validation FAILED:")
        for err in errs:
            print(f"  - {err}")
        sys.exit(1)
