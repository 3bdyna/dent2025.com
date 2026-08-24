# DEPLOYMENT_GUIDE.md - Dent2025 Git-Integrated SafeDeploy Guide

This guide documents the automated safety, Git version control, GitHub cloud sync, fast FTP deployment, and health monitoring pipeline for the **Dent2025 Academic Portal** (`public_html` root environment).

---

## 1. AI SafeDeploy Architecture (`tools/deploy_safe.py`)

All updates, bug fixes, and backend/frontend deployments are executed using `tools/deploy_safe.py`. The entire deploy toolchain lives in the `tools/` subfolder (not deployed to the server).

```bash
python tools/deploy_safe.py --note "Detailed description of what changed" "path/to/file1.ext" "path/to/file2.ext"
```

### Safety Features Included:
1. **Pre-flight Guard Validation (`tools/deploy_guard.py`)**:
   - Runs syntax verification (`php -l`, JSON validation, JS/HTML parser).
   - Enforces a mandatory `--note` argument explaining what changed.
   - Prevents accidental tracking or upload of secret files (`deploy_config.json`, `dent2025_passwords.json`, `.env`, API keys).
2. **Prioritized Execution Sequence (`tools/deploy_order.py`)**:
   - Orders updates by dependency tier (DB Schemas $\rightarrow$ APIs $\rightarrow$ Loaders $\rightarrow$ Frontend UI).
3. **Git Version Control & GitHub Sync**:
   - Automatically stages changed files.
   - Creates a clean, semantic Git commit tagged with your change note.
   - Automatically pushes to your private GitHub repository (`origin/main`).
4. **Fast 1-Second FTP Upload & LiteSpeed Cache Purge**:
   - Uploads modified files directly to `public_html/` on the live server.
   - Triggers the LiteSpeed remote cache purge endpoint with passkey so changes reflect instantly for all users.
5. **Post-flight Health Inspection (`tools/deploy_health.py`)**:
   - Probes live server APIs (`dent2025_api.php`, `announcements_api.php`, `schedule_backend.php`, `history_api.php`, `backend/api_data.php`, `backend/api_manage.php`, `backend/api_ai_exam.php`).
   - If an issue is detected, flags diagnostic cause and provides immediate 1-command rollback.

---

## 2. CLI Command Reference

### Recommended Usage:

1. **Deploy Files with Git Commit & GitHub Push:**
   ```bash
   python tools/deploy_safe.py --note "Add study countdown timer" "frontend-html box in wordpress astra/dashboard.js"
   ```

2. **Dry Run (Validate syntax and sequence without uploading or committing):**
   ```bash
   python tools/deploy_safe.py --dry-run --note "Validate API changes" "dent2025_api.php"
   ```

3. **Check Repository & Live System Status:**
   ```bash
   python tools/deploy_safe.py --status
   ```
   (or double-click **`Snapshot Manager.bat`**)

4. **1-Command Rollback (Reverts last commit and redeploys to live server):**
   ```bash
   python tools/deploy_safe.py --rollback
   ```
   Or roll back to a specific Git commit:
   ```bash
   python tools/deploy_safe.py --rollback <commit_hash>
   ```

5. **Run Standalone Health Probe:**
   ```bash
   python tools/deploy_safe.py --health-check
   ```

---

## 3. GitHub Remote Setup (One-Time)

To connect this local repository to your private GitHub repository:

1. Create a new private repository on GitHub (e.g. `https://github.com/<your-user>/dent2025`).
2. Run in terminal:
   ```bash
   git remote add origin https://github.com/<your-user>/dent2025.git
   git push -u origin main
   ```
3. Windows Credential Manager will prompt for GitHub login once in your browser.
4. From then on, every `deploy_safe.py` call will automatically push updates to GitHub!
