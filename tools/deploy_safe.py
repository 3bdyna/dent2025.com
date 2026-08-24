import sys
import os
import json
import time
import subprocess
import urllib.request
import urllib.parse
from datetime import datetime

# Ensure UTF-8 console output encoding on Windows
if hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

import _toolkit
_toolkit.add_tools_to_path()

import deploy_guard
import deploy_order
import deploy_health
import deploy

PROJECT_ROOT = _toolkit.PROJECT_ROOT

def purge_remote_cache(config=None):
    """Triggers LiteSpeed remote cache purge via purge_cache.php with passkey."""
    token = ""
    if config and isinstance(config, dict):
        token = config.get('health_passkey', '')
    if not token:
        token = os.environ.get('DENT2025_PURGE_KEY', '')
    if not token:
        return
    url = f"https://dent2025.com/purge_cache.php?token={urllib.parse.quote(token)}"
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Dent2025-SafeDeploy/2.0'})
        with urllib.request.urlopen(req, timeout=10) as resp:
            resp_text = resp.read().decode('utf-8', errors='ignore').strip()
            print(f"[CACHE PURGE] {resp_text}", flush=True)
    except Exception as e:
        print(f"[CACHE PURGE] Notice: {e}", flush=True)

def run_git_cmd(cmd, check=False):
    """Executes a git command in the project root."""
    try:
        res = subprocess.run(
            cmd,
            cwd=PROJECT_ROOT,
            capture_output=True,
            text=True,
            encoding='utf-8',
            errors='ignore'
        )
        if check and res.returncode != 0:
            raise RuntimeError(f"Git command failed: {' '.join(cmd)}\n{res.stderr.strip()}")
        return res.returncode == 0, res.stdout.strip(), res.stderr.strip()
    except Exception as e:
        return False, "", str(e)

def get_current_branch():
    ok, stdout, _ = run_git_cmd(['git', 'rev-parse', '--abbrev-ref', 'HEAD'])
    return stdout if ok and stdout else 'main'

def stage_and_commit_git(files, note):
    """Stages specified files and creates a git commit."""
    # 1. Stage the files
    for f in files:
        rel = os.path.relpath(f, PROJECT_ROOT).replace('\\', '/')
        run_git_cmd(['git', 'add', rel])
        
    # Check if there are staged changes
    ok, stdout, _ = run_git_cmd(['git', 'diff', '--cached', '--name-only'])
    if not stdout.strip():
        print("[GIT] Working tree clean for target files (no diff detected).")
        ok_hash, commit_hash, _ = run_git_cmd(['git', 'rev-parse', '--short', 'HEAD'])
        return ok_hash and commit_hash != "", commit_hash or "HEAD"

    # 2. Commit
    commit_msg = f"[SafeDeploy] {note}"
    ok, stdout, stderr = run_git_cmd(['git', 'commit', '-m', commit_msg])
    if not ok:
        print(f"[GIT ERROR] Commit failed: {stderr or stdout}")
        return False, ""
    
    ok_hash, commit_hash, _ = run_git_cmd(['git', 'rev-parse', '--short', 'HEAD'])
    print(f"[GIT COMMIT] Created commit {commit_hash}: {note}")
    return True, commit_hash

def push_to_github():
    """Pushes the current branch to origin if remote exists."""
    ok, remotes, _ = run_git_cmd(['git', 'remote'])
    if not ok or not remotes.strip():
        print("[GIT] Remote 'origin' not configured yet. (Commit stored locally)")
        print("      To connect GitHub: git remote add origin <repo-url> && git push -u origin main")
        return False

    branch = get_current_branch()
    print(f"[GIT PUSH] Pushing to GitHub (origin/{branch})...", flush=True)
    ok, stdout, stderr = run_git_cmd(['git', 'push', 'origin', branch])
    if ok:
        print("[GIT PUSH] Synced cleanly to GitHub repository.")
        return True
    else:
        print(f"[GIT WARNING] Could not push to GitHub: {stderr or stdout}")
        print("             (Live FTP deploy will proceed normally)")
        return False

def rollback_git(target_ref=None):
    """Rolls back the last commit or specified ref and redeploys reverted files."""
    print("=== DENT2025 GIT ROLLBACK PIPELINE ===", flush=True)
    
    # 1. Determine target commit
    if not target_ref:
        target_ref = "HEAD"

    print(f"Reverting commit {target_ref}...", flush=True)
    ok, stdout, stderr = run_git_cmd(['git', 'revert', '--no-edit', target_ref])
    if not ok:
        print(f"GIT REVERT FAILED: {stderr or stdout}")
        print("Please resolve any working tree conflict before rolling back.")
        return False

    # Get list of files modified in this revert commit
    ok, changed_files_raw, _ = run_git_cmd(['git', 'diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'])
    changed_files = [line.strip() for line in changed_files_raw.splitlines() if line.strip()]
    
    if not changed_files:
        print("No files were altered in rollback.")
        return True

    print(f"Redeploying {len(changed_files)} reverted files to live server:")
    for f in changed_files:
        print(f"  - {f}")

    # Upload to FTP
    shared_ftp = None
    cfg = None
    try:
        shared_ftp, cfg = deploy.get_ftp_connection()
        deploy.upload_files(changed_files, ftp=shared_ftp, config=cfg)
        purge_remote_cache(cfg)
        print("FTP Rollback upload completed successfully.")
    except Exception as e:
        print(f"FTP Rollback upload failed: {e}")
        return False
    finally:
        if shared_ftp is not None:
            try:
                shared_ftp.quit()
            except Exception:
                pass

    # Push revert to GitHub if remote exists
    push_to_github()

    # Health check
    probe = deploy_health.run_health_probe()
    if probe['healthy']:
        print("ROLLBACK COMPLETED & VERIFIED: All endpoints healthy.")
        return True
    else:
        print("WARNING: Health probe flagged issues after rollback.")
        return False

def show_status():
    """Displays current repository branch, recent commit history, and system health."""
    print("\n=== DENT2025 DEPLOYMENT & GIT STATUS ===")
    branch = get_current_branch()
    print(f"Current Branch : {branch}")
    
    ok, remotes, _ = run_git_cmd(['git', 'remote', '-v'])
    if ok and remotes:
        print(f"GitHub Remote  :\n{remotes}")
    else:
        print("GitHub Remote  : None (Local only)")

    print("\nRecent Commits:")
    ok, logs, _ = run_git_cmd(['git', 'log', '--oneline', '-n', '8'])
    if ok and logs:
        print(logs)
    else:
        print("No commits found.")

    print("\nWorking Directory Changes:")
    ok, status, _ = run_git_cmd(['git', 'status', '-s'])
    if ok and status:
        print(status)
    else:
        print("Working tree clean (no uncommitted changes).")

    print("\nLive System Health Probe:")
    deploy_health.run_health_probe()
    print("-" * 50)

def run_safe_deployment(files, note, dry_run=False):
    t_start = time.time()
    print("=== DENT2025 GIT + SAFEDEPLOY PIPELINE ===", flush=True)
    print(f"AI Note      : {note}")
    print(f"Target Files : {files}")

    # Stage 1: Pre-flight Guard Check
    t1 = time.time()
    print("\n[Stage 1/4] Pre-flight Guard & Syntax Validation...", flush=True)
    is_valid, errors = deploy_guard.validate_deployment(files, note)
    if not is_valid:
        print("DEPLOYMENT ABORTED due to pre-flight guard errors:")
        for err in errors:
            print(f"  - {err}")
        sys.exit(1)
    print(f"Guard check PASSED ({time.time() - t1:.2f}s).")

    # Stage 2: Priority Ordering
    ordered_files = deploy_order.sort_files_by_priority(files)

    if dry_run:
        print("\n[DRY RUN] Target files validated in execution order:")
        for f in ordered_files:
            print(f"  - {f}")
        print(f"--- DRY RUN COMPLETED cleanly ({time.time() - t_start:.2f}s). No changes written. ---")
        return

    # Stage 3: Git Commit & Push
    t2 = time.time()
    print("\n[Stage 2/4] Git Version Control & Cloud Sync...", flush=True)
    commit_ok, commit_ref = stage_and_commit_git(ordered_files, note)
    if not commit_ok:
        print("[ERROR] Git versioning failed. Aborting deployment for safety.")
        sys.exit(1)
    push_to_github()
    print(f"Git stage completed ({time.time() - t2:.2f}s).")

    # Stage 4: FTP Live Sync & Remote Cache Purge
    t3 = time.time()
    print("\n[Stage 3/4] Live FTP Upload & LiteSpeed Cache Purge...", flush=True)
    shared_ftp = None
    cfg = None
    try:
        shared_ftp, cfg = deploy.get_ftp_connection()
        deploy.upload_files(ordered_files, ftp=shared_ftp, config=cfg)
        print(f"FTP upload completed in {time.time() - t3:.2f}s.")
        purge_remote_cache(cfg)
    except Exception as upload_err:
        print(f"FTP Upload encountered an error: {str(upload_err)}")
        sys.exit(1)
    finally:
        if shared_ftp is not None:
            try:
                shared_ftp.quit()
            except Exception:
                pass

    # Stage 5: Concurrent Health Probe
    t4 = time.time()
    print("\n[Stage 4/4] System Health Probe...", flush=True)
    probe_result = deploy_health.run_health_probe()
    print(f"Health probe finished in {time.time() - t4:.2f}s.")

    if probe_result['healthy']:
        print("Post-flight health probe PASSED cleanly (All live endpoints healthy).")
    else:
        print("\n[WARNING] Health probe detected endpoint errors:")
        for diag in probe_result.get('diagnostics', []):
            if diag.get('status') == 'FAIL':
                print(f"  - [{diag.get('endpoint')}] Cause: {diag.get('cause')}")
        print(f"\nTo rollback this commit automatically, run: python tools/deploy_safe.py --rollback")

    total_time = time.time() - t_start
    print(f"\n=== SAFE DEPLOYMENT FINISHED IN {total_time:.2f}s ===")

if __name__ == '__main__':
    args = sys.argv[1:]
    
    if not args or '--help' in args:
        print("Dent2025 Git-Integrated SafeDeploy CLI")
        print("Usage:")
        print("  python tools/deploy_safe.py --note \"AI note description\" <file1> [file2...]")
        print("  python tools/deploy_safe.py --dry-run --note \"description\" <file1> [file2...]")
        print("  python tools/deploy_safe.py --rollback [commit_hash]")
        print("  python tools/deploy_safe.py --status")
        print("  python tools/deploy_safe.py --health-check")
        sys.exit(0)

    if '--status' in args or '--log' in args:
        show_status()
        sys.exit(0)

    if '--health-check' in args:
        res = deploy_health.run_health_probe()
        sys.exit(0 if res['healthy'] else 1)

    if '--rollback' in args:
        idx = args.index('--rollback')
        target = args[idx + 1] if idx + 1 < len(args) else None
        success = rollback_git(target)
        sys.exit(0 if success else 1)

    # Legacy flags gracefully ignored for seamless compatibility
    if '--no-snapshot' in args:
        args.remove('--no-snapshot')
    if '--wait-gdrive' in args:
        args.remove('--wait-gdrive')
    if '--list-snapshots' in args:
        show_status()
        sys.exit(0)

    dry_run = '--dry-run' in args
    if dry_run:
        args.remove('--dry-run')

    note = ""
    if '--note' in args:
        idx = args.index('--note')
        if idx + 1 < len(args):
            note = args[idx + 1]
            args.pop(idx) # remove --note
            args.pop(idx) # remove note text

    files = args
    if not files:
        print("Error: No files specified for deployment.")
        sys.exit(1)

    run_safe_deployment(files, note, dry_run=dry_run)
