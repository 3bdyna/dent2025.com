import sys
import os
import json
import subprocess

FORBIDDEN_FILES = [
    'deploy_config.json',
    'dent2025_passwords.json',
    'passwords.txt',
    '.env',
    '.git',
    'wp-config.php'
]

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

    return True, "OK"

def is_forbidden_path(path):
    """Checks if path is forbidden from deployment."""
    norm = path.replace('\\', '/')
    base_name = os.path.basename(path)
    if base_name in FORBIDDEN_FILES:
        return True
    if norm.startswith('.git/') or '/.git/' in norm:
        return True
    if 'gemini_keys_data' in norm or '.deploy_backups' in norm:
        return True
    return False

def validate_deployment(file_paths, note):
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
            
        is_valid, msg = check_syntax(path)
        if not is_valid:
            errors.append(msg)
            
    return len(errors) == 0, errors

if __name__ == '__main__':
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
