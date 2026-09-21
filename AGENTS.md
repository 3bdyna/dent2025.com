# AGENTS.md - Project Rules, Guidelines & Comprehensive System Architecture for Dent2025 Academic Portal

Welcome to **Dent2025 (Medical & Dental Academic Portal)**! This file provides essential guidelines, architectural context, technical standards, deployment rules, and complete workflow instructions for AI agents working on this codebase.

---

## 1. Executive Summary & Core Outlook

**Dent2025** is a specialized, high-performance academic web application designed for university dentistry and medicine students. It organizes course materials, schedules, announcements, GPA calculations, Google Drive folder embeds, interactive study timers, subject links, and comprehensive administration tools across multiple academic categories:

- **Pre-Med** (Year 1 only — Semesters 1 & 2)
- **Medicine** (Years 2–6 — Semesters 1 & 2 each)
- **Dentistry** (Years 2–6 — Semesters 1 & 2 each)

### Modern Workflow Outlook
- **Zero-Friction AI Development**: All frontend components, JavaScript modules, CSS templates, and backend APIs reside on disk as local source files and are **automatically synced to the Azure cloud server (`/var/www/dent2025/`) in 1–2 seconds via `deploy.py` / `deploy_safe.py`** (using SFTP/SCP over Cloudflare Tunnel / SSH).
- **Dynamic Component Loader (`dent2025-loader.php`)**: WordPress pages load components dynamically via simple shortcodes (`[dent_component file="..."]`). AI edits local code, `deploy_safe.py` uploads it to the server, and changes immediately reflect on the live site with automatic timestamp-based cache-busting. **Manual copy-pasting of code into WordPress Astra HTML blocks or Code Snippets is obsolete.**

---

## 2. Complete Codebase Directory Structure

```
my website dent2025/
├── AGENTS.md                                   # Master Agent Guidelines & Architecture Reference (this file)
├── DEPLOYMENT_GUIDE.md                         # Complete Git SafeDeploy documentation
├── README.md                                   # Project Overview & Architecture Guide
├── MAIN_PAGE_DESIGN_SPEC.md                    # Homepage UI/UX specifications & layout guide
├── LICENSE                                     # MIT License
├── .gitignore                                  # Git exclusion rules for secrets, caches & local dumps
├── deploy_config.example.json                  # Template SFTP/SSH configuration
├── dent2025_passwords.example.json             # Template RBAC passkeys
├── deploy_config.json                          # SFTP/SSH credentials (gitignored)
├── dent2025_passwords.json                     # ⭐ RBAC passkey store (gitignored)
├── passwords.txt                               # Server & Cloudflare secrets (gitignored)
├── dent2025-loader.php                         # WordPress Component Loader plugin (shortcode [dent_component])
├── purge_cache.php                             # Standalone cache purge diagnostic script
├── dent2025_api.php                            # PRIMARY WordPress-Integrated Standalone API ($wpdb)
├── announcements_api.php                       # Announcements & Class Tasks Backend API (file-based JSON)
├── schedule_backend.php                        # Timeline Schedule Events API (file-based JSON)
├── history_api.php                             # Study timer log & deployment audit history API
├── history_helpers.php                         # Shared audit-log / snapshot helper used by multiple APIs
├── dent2025_rbac.php                           # ⭐ Shared RBAC permission engine (ALL backends use this)
├── admin_app.js                                # Admin Dashboard standalone client-side logic
├── admin_dashboard.html                        # Standalone Admin Dashboard HTML page
├── dent2025_classes.json                       # Global class timetable groups data
├── schedule_events.json                        # Global timeline schedule events data
├── schedule_events_dentistry_y3_s1.json        # Cohort timeline schedule events data
├── tools/                                      # Local deployment toolchain (NOT deployed to server)
│   ├── _toolkit.py                             # Shared bootstrap: PROJECT_ROOT + tools/ sys.path helper
│   ├── deploy.py                               # Base SFTP/OpenSSH uploader / rollback engine
│   ├── deploy_guard.py                         # Pre-flight validation (syntax, forbidden files, note)
│   ├── deploy_order.py                         # Deployment priority ordering
│   ├── deploy_health.py                        # Post-deploy API health probe
│   ├── deploy_safe.py                          # Full Git-integrated SafeDeploy pipeline CLI
│   ├── sync_cloud_events.py                    # Cloud-first dynamic data sync & smart-merge engine
│   ├── sync_server_backups.py                  # Local sync engine for VPS database & file backups (14d rolling)
│   └── test_system_logic.php                   # Comprehensive offline test suite (42/42 tests)
├── backend/                                    # Standalone PDO & Forwarding Backend Module
│   ├── db_connect.php                          # PDO Database Connection, CORS headers, sendResponse()
│   ├── api_data.php                            # Forwarding compatibility shim to dent2025_api.php
│   ├── api_manage.php                          # Forwarding compatibility shim to dent2025_api.php
│   ├── api_ai_exam.php                         # AI exam generation standalone PDO backend
│   ├── setup_links_db.php                      # One-time DB schema setup for subject_links table
│   ├── bin/                                    # Helper binaries (pdftotext)
│   └── gemini_keys_data/                       # Gemini API key health cache
├── logos/                                      # Specialty logos & social preview assets (deployed to server)
│   ├── dentistry.webp                          # Dentistry specialty logo
│   ├── medicine.webp                           # Medicine specialty logo
│   ├── pre-med.webp                            # Pre-Med specialty logo
│   ├── logo of main page.webp                  # Main Portal Logo asset
│   └── og_share_preview.jpg                    # Standardized Open Graph social sharing banner (1200x630)
├── frontend-html box in wordpress astra/       # Local Source Frontend Components (synced to /frontend_components/)
│   ├── landing_page.html                       # Year/Specialty/Semester grid selection card template
│   ├── chapters_dynamic.html                   # Subject chapters container & Google Drive folder embed layout
│   ├── quiz_app.html                           # Interactive Quiz application (UI + CSS + JS)
│   ├── study_timer_banner_widget.html          # Study Timer & Tracker widget + floating draggable badge (~75 KB)
│   ├── gpa_calculator_elegant.txt              # Saudi 5.0 scale GPA Calculator widget code
│   ├── absence_calculator.html                 # Jazan University Absence & Denial Calculator widget
│   ├── admin_controls_main.html                # Main page lock trigger (🔒) & admin logout button
│   ├── admin_controls.html                     # Main Admin Modal panel (Subject CRUD & Google Drive linker)
│   ├── admin_schedule_lock.html                # Schedule timeline lock trigger & event management modal
│   ├── admin_classes_lock.html                 # Class schedule lock trigger & group management modal
│   ├── calendar_tomorrow_alert.html            # Tomorrow's academic event / exam alert component (~10 KB)
│   ├── dent_pin_modal.js                       # Universal dark-mode 4-digit PIN keypad modal (~25 KB)
│   ├── schedule_markup.html                    # Academic calendar timeline container template & stats cards
│   ├── schedule_script.js                      # Academic calendar timeline & A4 export engine (~120 KB)
│   ├── fonts/                                  # Self-hosted web fonts (Outfit & Noto Kufi Arabic WOFF2)
│   └── dashboard.js                            # Core Student Dashboard JS engine (~111 KB)
├── announcements_data/                         # AUTO-CREATED at runtime by announcements_api.php (gitignored)
├── dent2025_study_data/                        # AUTO-CREATED at runtime by dent2025_api.php (gitignored)
├── dent2025_analytics_data/                    # AUTO-CREATED at runtime for visitor & event metrics (gitignored)
├── quizzes_data/                               # AUTO-CREATED at runtime by api_ai_exam.php (gitignored)
├── history_data/                               # Runtime audit/deployment history (local + server, gitignored)
└── server_backups_dent2025_daily/              # ⭐ Local mirror of VPS nightly database & dynamic file backups (14d rolling, gitignored)
```

> **NOTE**: The old `dev/` directory was **removed** (snapshot `snap_20260805_210759_remove_legacy_dev_path_delete_`). All backend files now live at the **project root**, and `dev/backend/*` → `backend/*`. Deploy routing in `tools/deploy.py` reflects this (root-relative → same dir on server).

---

## 3. Automated Component Loader System & Cloud Deployment Workflow

### A. The Component Loader Plugin (`dent2025-loader.php`)
Installed on the live WordPress site at `wp-content/plugins/dent2025-loader/dent2025-loader.php`.
- **Shortcode**: `[dent_component file="filename.ext"]`
- **Security**: Strictly sanitizes input via `basename()` and regex whitelist `preg_replace('/[^a-zA-Z0-9_.-]/', '', $file)` to completely prevent directory traversal attacks (`../`).
- **File Location**: Reads components from `ABSPATH . 'frontend_components/' . $safe_file`.
- **Automatic Cache-Busting**: Appends dynamic `?v={filemtime}` query strings to JavaScript (`.js`), CSS (`.css`), and embedded `<script src="...">` / `<link href="...">` tags inside HTML blocks. When `deploy_safe.py` uploads a new file, the modified timestamp updates instantly, forcing every browser and LiteSpeed Cache to download fresh code without stale cache glitches.
- **WordPress `wpautop` Protection**: Collapses internal whitespace inside `<style>` and `<script>` blocks and runs a high-priority `the_content` filter (priority 999) to strip `<p>` and `<br>` tags wrapped around CSS/JS, preventing raw code text walls from appearing on screen.
- **Sitewide Study Timer Injection**: Injects `study_timer_banner_widget.html` into `wp_footer` on all non-welcome pages so the floating draggable timer badge follows students seamlessly across the entire website.
- **Self-Hosted Local Fonts Inlining & Preloading**: Strips external `fonts.googleapis.com` / `fonts.gstatic.com` requests to eliminate render-blocking LCP latency. Preloads `notokufiarabic-arabic.woff2` and `outfit-latin.woff2`, and inlines `/frontend_components/fonts/fonts.css`.
- **Automated Social Open Graph & Twitter Cards**: Injects standardized, cache-busted social preview metadata pointing to `/logos/og_share_preview.jpg` (1200x630) for pristine previews when links are shared on WhatsApp, Telegram, or Twitter.
- **Critical Script Deferral**: Defers Astra theme's `frontend.min.js` and delays Google Site Kit's `gtag.js` by 1000ms until after first render.
- **Daily Cache Cron Sync**: Registers a daily WordPress cron schedule `dent2025_daily_noon` (at 12:00 PM AST / 09:00 UTC) that triggers `action=cron_sync` against `backend/api_ai_exam.php` to keep AI exam question caches warm.
- **Cache Purging**: Listens for `?purge=1` or `?nocache=1` query parameters with an authorized admin token to execute `do_action('litespeed_purge_all')` and clear WordPress transients.

### B. Deployment Automation Script (`tools/deploy.py` & `tools/deploy_safe.py`)
Run from terminal to sync any file to the live Azure server (`/var/www/dent2025/`) in ~1–2 seconds via SFTP (with OpenSSH SCP fallback via `azureuser@ssh.dent2025.com`):

```bash
# Deploy a single frontend component with SafeDeploy:
python tools/deploy_safe.py --note "Update quiz styling" "frontend-html box in wordpress astra/quiz_app.html"

# Deploy backend APIs or loader plugin:
python tools/deploy_safe.py --note "Fix API transient cache" "dent2025_api.php" "dent2025-loader.php"

# Deploy multiple files at once:
python tools/deploy_safe.py --note "Enhance dashboard navigation" "frontend-html box in wordpress astra/dashboard.js" "frontend-html box in wordpress astra/chapters_dynamic.html"
```

> **⚠️ MANDATORY — GIT COMMIT & PURGE ON EVERY DEPLOYMENT**: Every AI/agent update that touches website files **MUST** use the Git-integrated SafeDeploy pipeline.
>
> ### Modern Git SafeDeploy Workflow:
> 1. **Deploy with Git Commit**: Run `python tools/deploy_safe.py --note "what changed" <file1> [file2...]`
>    - **Stage 0**: Smart-merges dynamic runtime data (`schedule_events*.json`, `announcements_data/`) against Azure cloud state to prevent data loss (`sync_cloud_events.py`).
>    - **Stage 1**: Validates PHP/JS/JSON syntax and ensures no secrets or forbidden files are staged (`deploy_guard.py`).
>    - **Stage 2**: Automatically stages files, creates a semantic Git commit (`git commit -m "[SafeDeploy] ..."`), and pushes to GitHub (`origin/main`).
>    - **Stage 3**: Uploads modified files to `/var/www/dent2025/` in ~1–2 seconds via SFTP/SCP and triggers a LiteSpeed cache purge (`purge_remote_cache`).
>    - **Stage 4**: Executes post-deployment health probes against live endpoints (`deploy_health.py`).
> 2. **Instant Rollback**: If an update causes an issue, simply run:
>    - `python tools/deploy_safe.py --rollback` (reverts `HEAD`, redeploys the clean state to server, and purges cache automatically).
> 3. **Dry Run**: `python tools/deploy_safe.py --dry-run --note "test" <file1>...`
> 4. **Check Status**: `python tools/deploy_safe.py --status` (shows Git branch, recent commits, uncommitted diffs, and live API health).

### C. GitHub Repository & SSH Configuration
- **Repository URL (SSH)**: `git@github.com:3bdyna/dent2025.com.git`
- **Web Link**: `https://github.com/3bdyna/dent2025.com`
- **Default Branch**: `main`
- **SSH Key Location**: `~/.ssh/id_ed25519`
- **Protected Secrets**: `deploy_config.json`, `dent2025_passwords.json`, `passwords.txt`, and runtime JSON storage directories are strictly excluded via `.gitignore` and must never be committed.

#### Server Routing Rules in `deploy.py`:
- Files in `frontend-html box in wordpress astra/` → Auto-routed to `/var/www/dent2025/frontend_components/` (subfolders preserved, e.g. `fonts/fonts.css` → `/var/www/dent2025/frontend_components/fonts/fonts.css`)
- `dent2025-loader.php` → Auto-routed to `/var/www/dent2025/wp-content/plugins/dent2025-loader/`
- Backend files (`backend/*`) → Auto-routed to `/var/www/dent2025/backend/`
- Root-level backend files (`dent2025_api.php`, `schedule_backend.php`, etc.) → Auto-routed to `/var/www/dent2025/` (web root)

### D. ⭐ Cloud-First Source of Truth for Dynamic Data (Zero Cloud Data Loss)
> **CRITICAL RULE**: The live cloud (Azure `/var/www/dent2025/`) is the **absolute Source of Truth** for all dynamic runtime data:
> - Academic calendar events (`schedule_events.json`, `schedule_events_*.json`)
> - Class announcements (`announcements_data/*.json`)
> - Timetable classes (`dent2025_classes.json`)
>
> **NEVER blindly overwrite or delete cloud data from local files or Git.**
>
> #### The Mandatory 3-Step Protocol when User asks to Add/Edit Events in Chat:
> 1. **Pull fresh cloud state**: Run `python tools/sync_cloud_events.py --pull` before modifying any local event file.
> 2. **Apply requested change**: Add or edit the target event in the freshly synced local file.
> 3. **Smart-Merge Deploy**: Run `python tools/deploy_safe.py --note "description" <file>` (Stage 0 will auto-merge and preserve all cloud events) or `python tools/sync_cloud_events.py --merge-and-deploy <file>`.
>
> #### Built-In Guardrails:
> - **Pre-flight Guardrail (`deploy_guard.py`)**: Automatically queries Azure via SSH. If the local file is missing any event present in the cloud, deployment is **immediately blocked**.
> - **Auto-Merge in SafeDeploy (`deploy_safe.py`)**: Stage 0 automatically pulls the cloud and merges any local additions without deleting any existing cloud events.
> - **Zero Deletion Guarantee**: Cloud events are never deleted unless explicit `--allow-delete` flag is passed after creating a server-side backup snapshot.

### E. 🛡️ Multi-Tier Safeguards & Destructive Command Policy (Zero Codebase Loss Guarantee)
> **CORE DIRECTIVE**: AI agents must adhere to strict defense-in-depth safeguards. High-velocity rapid development must proceed without friction, but catastrophic destructive operations are mechanically and procedurally forbidden.

#### 1. Strictly Forbidden Commands for AI Agents
- **Local Filesystem**:
  - `rm -rf <dir>`, `Remove-Item -Recurse -Force <dir>`, `del /f /s /q` targeting non-scratch directories.
  - `git clean -fdx` (wipes untracked files without recovery).
  - `git reset --hard` (unless explicitly instructed by the user with a specific commit hash for intentional rollback).
- **Git Remote**:
  - `git push --force` or `--force-with-lease` to `main` (never rewrite remote history).
- **Remote Server (Azure VPS via SSH)**:
  - Raw SSH bulk directory removal (`rm -rf /var/www/...`, `rm -rf /`).
  - Raw SQL dropping or truncating tables (`DROP DATABASE`, `DROP TABLE`, `TRUNCATE`).
  - Deployments must strictly use `python tools/deploy_safe.py` or `python tools/sync_cloud_events.py` rather than manual ad-hoc SSH overwriting.

#### 2. Server-Side Infrastructure Protections in Place
- **`safe-rm` Active on VPS**: `/usr/local/bin/rm` is symlinked to `safe-rm` with `/etc/safe-rm.conf` actively protecting `/`, `/var/www`, `/var/www/dent2025`, `/etc`, and `/home`. Any attempted recursive wipe is rejected automatically (`safe-rm: Skipping /var/www/dent2025.`).
- **Automated Nightly Server Backups**: `/usr/local/bin/dent2025_backup.sh` runs every night at 03:30 UTC via root crontab, backing up the MySQL `wordpress` database (`db_wordpress_*.sql.gz`) and dynamic JSON files (`data_*.tar.gz`) into `/var/backups/dent2025_daily/` with a rolling 14-day retention.
- **Azure Hypervisor Disk Snapshots**: VM OS disk snapshots in Azure Resource Group `BB-BOT-PL-RG` (baseline: `snapshot-baseline-safe-rm-20260921`) provide 1-click total disaster recovery without relying on server OS integrity.

#### 3. Local Machine Backup Mirror (`server_backups_dent2025_daily/`)
- **Local Mirror Folder**: `server_backups_dent2025_daily/` at the repository root stores an off-server copy of every database dump and dynamic file archive on your local Windows PC.
- **14-Day Rolling Retention**: Matches the server policy—archives older than 14 days are automatically pruned locally during sync.
- **Git Protection**: Fully excluded via `.gitignore` and `deploy_guard.py` to prevent sensitive database dumps from ever being committed or redeployed to the web root.
- **Fully Automated Daily Windows Task (`Dent2025 Daily Backup Sync`)**:
  - Registered in Windows Task Scheduler under task name `Dent2025 Daily Backup Sync`.
  - Runs silently every morning at **07:00 AM AST** (30 minutes after VPS creates the 03:30 UTC backup).
  - Uses `pythonw.exe` (100% background, zero popup windows).
  - Configured with `StartWhenAvailable = true`: If your PC is off or asleep at 07:00 AM, it automatically runs the moment you wake or turn on your computer.
  - Logs every run to `server_backups_dent2025_daily/sync.log`.
- **Manual Sync Options (Optional)**:
  ```bash
  # Standalone backup sync:
  python tools/sync_server_backups.py

  # Or via SafeDeploy flag:
  python tools/deploy_safe.py --sync-backups
  ```
- **Disaster Recovery from Local Backup**:
  If the live database or JSON data is ever accidentally corrupted or deleted:
  1. Pick the desired timestamp from `server_backups_dent2025_daily/`.
  2. Extract dynamic data: `tar -xzf data_<TIMESTAMP>.tar.gz`
  3. Restore database on server: `zcat db_wordpress_<TIMESTAMP>.sql.gz | ssh azureuser@ssh.dent2025.com "sudo mysql wordpress"`

---

## 4. Frontend Component Page-by-Page Mapping Matrix

Below is the definitive reference mapping all 5 WordPress pages to their target components and shortcodes:

| WordPress Page Name | Page Slug | Required Shortcodes / Markup inside WordPress Block | Auto-Loaded Internal Scripts |
|---|---|---|---|
| **1. `landing page`** | `wolcome` | `[dent_component file="landing_page.html"]` | None |
| **2. `الصفحة الرئيسية — Front Page`** | *(static front)* | `[dent_component file="study_timer_banner_widget.html"]`<br>`[dent_component file="gpa_calculator_elegant.txt"]`<br>`[dent_component file="absence_calculator.html"]`<br>`[dent_component file="admin_controls_main.html"]`<br>*(Optional modular: `[dent_component file="calendar_tomorrow_alert.html"]`)* | `admin_controls_main.html` embeds `<script src="/frontend_components/dent_pin_modal.js"></script>` and `<script src="/frontend_components/dashboard.js"></script>` |
| **3. `التقويم الأكاديمي`** | `التقويم-الأكاديمي` | `[dent_component file="schedule_markup.html"]`<br>`[dent_component file="schedule_script.js"]`<br>`[dent_component file="admin_schedule_lock.html"]` | `admin_schedule_lock.html` embeds `<script src="/frontend_components/dent_pin_modal.js"></script>` |
| **4. `المقررات والختبارات`** | `المقررات-والاختبارات` | `[dent_component file="chapters_dynamic.html"]`<br>`[dent_component file="quiz_app.html"]`<br>`[dent_component file="admin_controls.html"]` | `chapters_dynamic.html` embeds `<script src="/frontend_components/dashboard.js"></script>` |
| **5. `جدول المحاضرات`** | `جدول-المحاضرات` | `[dent_component file="admin_classes_lock.html"]`<br>`<div id="dent-classes-target"></div>` | `admin_classes_lock.html` embeds `<script src="/frontend_components/dent_pin_modal.js"></script>` and `<script src="/frontend_components/dashboard.js"></script>` |

---

## 5. Backend Architecture & Shared RBAC Authentication

> **CRITICAL**: Dent2025 uses a **shared RBAC permission engine** (`dent2025_rbac.php` + `dent2025_passwords.json`) across ALL backend layers. There is **no longer** a "different passkey system per backend" — the same master passkeys and the same JSON-based context passkeys are accepted by every backend.

### ⭐ Shared Authentication Core (`dent2025_rbac.php` + `dent2025_passwords.json`)
- **`dent2025_rbac.php`**: Loads `dent2025_passwords.json` and provides `dent2025_check_rbac_permission($pass, $permission, $specialty=null, $year=null, $semester=null)` and `dent2025_get_passkey_info($pass)`.
- **`dent2025_passwords.json`** (~28 entries in populated server cohort DB; baseline entries in local dev repository): Each entry = `{id, label, passkey, allowed_contexts, permissions}`. Passkeys can be 4-digit numeric PINs or alphanumeric strings.
- **Universal Master Passkeys** (accepted everywhere, `allowed_contexts: ['*']`):
  Configured in untracked `dent2025_passwords.json` (see `dent2025_passwords.example.json`).
- **Per-Context Leader Passkeys**: JSON entries scoped to `allowed_contexts` strings in `{specialty}_{year}_{semester}` format (e.g. `dentistry_1_1`, `medicine_3_1`, `pre-med_1_1`). These grant limited permissions (`edit_basic_subject`, `semester_events`, `semester_announcements`, `timetable`). There are **no algorithmic context passkeys** — a leader exists only if a JSON entry was explicitly created; check `dent2025_passwords.json` before assuming one exists.
- **Permission names**: `add_subject`, `delete_subject`, `edit_core_subject`, `edit_basic_subject`, `global_events`, `semester_events`, `global_announcements`, `semester_announcements`, `timetable`, `manage_passwords`.
- **Client-Side PIN Keypad UX (`dent_pin_modal.js`)**: All administrative lock triggers (`admin_controls_main.html`, `admin_schedule_lock.html`, `admin_classes_lock.html`, `admin_controls.html`) use `window.dentPromptPin()` to present a responsive dark-mode 4-digit PIN keypad with context pills and haptic/audio feedback, completely replacing browser-native `prompt()`. Successful authentication stores session passkeys in `sessionStorage` (`dent2025_admin_pass`, `dent2025_permissions`).

### A. WordPress-Integrated Backend (`dent2025_api.php`)
- Bootstraps WordPress via `require_once dirname(__FILE__) . '/wp-load.php'`.
- Database access via `$wpdb->prepare()`.
- WordPress transient caching for subjects (`dent2025_data_{specialty}_{year}_{semester}`, 12-hour TTL).
- Manages class timetable data via `dent2025_classes.json` (file-based, auto-created at runtime).
- Auth: uses `dent2025_check_rbac_permission()` (master + JSON context passkeys).
- **GAS Webhook URL**: `https://script.google.com/macros/s/AKfycbyGOFQWRmkBmJJ9ItdpzhzY5CgbEPjjI6joodT0GT_Sq--f287fcomqUBqRw-MxaKie/exec` (follows 302 redirects). Also hosts a study-PIN sync subsystem (`study_check_pin`, `study_get_data`, `study_sync_data`, `study_change_pin` → `dent2025_study_data/study_records.json`).

### B. File-Based PHP APIs (`announcements_api.php`, `schedule_backend.php`, `history_api.php`)
- Standalone PHP scripts — **no `wp-load.php` dependency**.
- `announcements_api.php` and `schedule_backend.php` use local JSON file storage exclusively (no DB access).
- `history_api.php` uses local JSON storage for deployment and timer audit logs, but integrates with MySQL (`$wpdb` or PDO via `backend/db_connect.php`) to capture and restore full database snapshots (`subjects` and `subject_links`) during rollbacks.
- Auth: same shared RBAC engine. `schedule_backend.php` requires `global_events` or `semester_events` permission for writes.
- `history_api.php` also accepts the master passkeys directly for `manage_passkeys` actions.

### C. Standalone PDO & Forwarding Backend (`backend/api_manage.php`, `backend/api_data.php`, `backend/api_ai_exam.php`)
- **Forwarding Compatibility Shims**: As of SafeDeploy commit `262befe`, `backend/api_data.php` and `backend/api_manage.php` are streamlined forwarding compatibility shims that delegate all subject/link queries and mutations directly to the primary WordPress API (`dent2025_api.php` via `$wpdb`), ensuring unified caching and single-point-of-truth validation.
- **Standalone PDO Exam AI Backend (`backend/api_ai_exam.php`)**: Operates independently with `backend/db_connect.php` for high-throughput AI quiz generation, PDF text extraction (`pdftotext`), and Gemini API caching (`quizzes_data/`).
- Auth: **same shared RBAC engine** (`require_once __DIR__ . '/../dent2025_rbac.php'`).
- **Unified GAS Webhook**: `dent2025_api.php` hosts the primary Google Apps Script webhook: `https://script.google.com/macros/s/AKfycbyGOFQWRmkBmJJ9ItdpzhzY5CgbEPjjI6joodT0GT_Sq--f287fcomqUBqRw-MxaKie/exec`.
- `action=add_link` and `action=delete_link` enforce RBAC permissions via the unified backend engine.

---

## 6. Database Schema & JSON Storage Systems

### Table: `subjects`
| Column | Type | Notes |
|---|---|---|
| `id` | INT AUTO_INCREMENT | Primary Key |
| `specialty` | VARCHAR | `'dentistry'`, `'medicine'`, or `'pre-med'` |
| `year` | INT | Academic year (0 for pre-med, 1–6 for others) |
| `semester` | INT | `1` or `2` |
| `name` | VARCHAR | Subject name (English) |
| `doctor` | VARCHAR | Instructor name |
| `hours` | INT/VARCHAR | Credit hours |
| `marks` | INT/VARCHAR | Total marks |
| `chapters_folder_id` | VARCHAR | Google Drive folder ID for chapters |
| `materials_folder_id` | VARCHAR | Google Drive folder ID for materials |
| `created_at` | TIMESTAMP | Auto-generated |

### Table: `subject_links`
| Column | Type | Notes |
|---|---|---|
| `id` | INT AUTO_INCREMENT | Primary Key |
| `subject_id` | INT NOT NULL | Foreign Key → `subjects.id` (CASCADE delete) |
| `url` | VARCHAR(1000) | Link URL |
| `title` | VARCHAR(255) | Link display title |
| `type` | VARCHAR(50) | Auto-detected: `'youtube'`, `'drive'`, `'telegram'`, or `'link'` |
| `created_at` | TIMESTAMP | Auto-generated |

### File-Based JSON Storage Inventory
1. **Class Timetable (`dent2025_classes.json`)**: Array of class group schedule objects filtered by specialty, year, semester.
2. **Announcements (`announcements_data/`)**: Per-class JSON files `announcements_{spec}_{year}_{sem}.json` + `announcements_backup.json` snapshot.
3. **Timeline Schedule Events (`schedule_events.json`)**: Global schedule events (`is_global = true`) and per-schedule files (`schedule_events_{schedule_id}.json`).
4. **Study Timer Records (`dent2025_study_data/study_records.json`)**: Per-student PIN + synced study timer logs (managed by `dent2025_api.php`).

---

## 7. Frontend Engineering Standards & Key Modules

### A. Main Dashboard Engine (`dashboard.js` — ~111 KB)
- **API Base URL**: `const API_BASE_URL = '/dent2025_api.php'` (with `const API_BASE = ''` site-root relative).
- **⭐ MULTI-SPECIALTY MASTER SWITCH (`DENT_MULTI_SPECIALTY_MODE`)**:
  - **SERVER-SIDE DYNAMIC SOURCE OF TRUTH**: The multi-specialty mode is persisted in the WordPress database options table (`dent2025_multi_specialty_mode`) via `dent2025_api.php`:
    - **`GET ?action=portal_settings`**: Public endpoint returning `{"success": true, "data": {"multi_specialty_mode": true/false}}`.
    - **`POST ?action=save_portal_settings`**: Admin endpoint to toggle mode; strictly requires `manage_passwords` permission.
    - **Admin Dashboard Integration**: The mode can be toggled with 1 click directly in the Admin Dashboard UI (`admin_dashboard.html` / `admin_app.js`).
  - **Client-Side Bootstrap in `dashboard.js`**:
    - Starts with restricted fallback `let DENT_MULTI_SPECIALTY_MODE = false;` to prevent unauthorized tracks from momentarily flashing if network is slow.
    - Asynchronously calls `dentLoadPortalMode()` on init, which syncs with `?action=portal_settings`.
    - When `true`: Multi-specialty mode is active across Pre-Med, Medicine, and Dentistry. Uninitialized visitors are redirected to `/wolcome/` and the floating Path Changer pill bar is shown.
    - When `false`: Single-track forced mode locks portal to Dentistry Year 3 Semester 1, bypasses the welcome screen, and hides the Path Changer pill bar.
  - **HOW TO TOGGLE BETWEEN MODES**:
    - **NEVER manually edit `dashboard.js` or rewrite code.**
    - Toggle it via the **Admin Dashboard UI** or execute an authorized POST to `?action=save_portal_settings`.
- **Sequential iFrame Queue**: `window.dentIframeQueue` loads Google Drive folder iframes sequentially with 1.0s delays to maintain fast browser performance.
- **Path Changer Pill Bar**: Auto-minimizing pill bar showing current specialty/year/semester; click when expanded resets selection to allow switching tracks. Automatically controlled by `DENT_MULTI_SPECIALTY_MODE`.

### B. Study Timer & Tracker (`study_timer_banner_widget.html` — ~75 KB)
- **Singleton Guard**: `if (window.dentTimerScriptLoaded) return; window.dentTimerScriptLoaded = true;` ensures only one script instance executes, avoiding duplicate `setInterval` loops.
- **Session State Clearing**: `stopTimerEngine()`, `finishTimer()`, and `resetTimer()` cleanly clear `KEY_ACTIVE_SESSION` from `localStorage` without race conditions.
- **Cross-Tab Synchronization**: Uses `window.addEventListener('storage')` with recursion lock (`isRestoringSession`) to sync active timer states across browser tabs.
- **Sitewide Floating Badge**: Draggable badge (`.dent-timer-draggable-badge`) injected into `document.body` follows students across all site pages when active.

### C. Universal 4-Digit PIN Modal Keypad (`dent_pin_modal.js` — ~25 KB)
- **Singleton Guard**: `if (window.DentPinModal) return;`
- **Modern Keypad UX**: Replaces unsightly browser-native `prompt()` dialogs with a sleek dark-mode keypad styled with Dent2025 dark zinc aesthetics.
- **Universal API**: Invoked via `window.dentPromptPin({ title, subtitle, context, onSuccess })`.
- **Embedded In**: All administrative triggers (`admin_controls_main.html`, `admin_schedule_lock.html`, `admin_classes_lock.html`, and `admin_controls.html`).

### D. Academic Calendar & Timetable Engine (`schedule_script.js` — ~120 KB)
- **API Base URL**: `apiUrl: window.location.origin + '/schedule_backend.php'`.
- **Schedule ID Derivation**: `${specialty}_y${year}_s${semester}`. Falls back cleanly to primary portal cohort `dentistry_y3_s1`.
- **Direct A4 Canvas & PDF/PNG Export**: Renders a dedicated 860px A4 canvas layout with 2.0x rasterization speed. Directly exports to PDF and PNG with native mobile sharing sheet (`navigator.share` / Web Share API), completely bypassing clumsy browser print dialogs.
- **Arabic/English BiDi Text Shaping**: Formats and sanitizes mixed-direction strings to prevent flipped text or reversed Arabic numbers on canvas exports.
- **Granular Event Badging & Print Styles**: Dedicated styling for `quiz`, `assessment`, `research`, `homework`, `exam`, `midterm`, `final`, `deadline`, `holiday`, `payment`, `start`, and custom labels.
- **Hijri Integration**: Gregorian timeline with dynamic Hijri month labels and auto-derivation via `Intl.DateTimeFormat('en-u-ca-islamic-umalqura')`.

---

## 8. Client Storage Inventory

All keys are strictly prefixed with `dent2025_`:

### `localStorage` (Persistent):
| Key | Purpose |
|---|---|
| `dent2025_selection` | **CRITICAL ROOT KEY** — JSON `{specialty, year, semester}`. Controls routing. |
| `dent2025_selected_group` | Saved student class group (e.g., `"المجموعة A"`) |
| `dent2025_gpa_{spec}_y{year}_s{semester}` | GPA calculator saved state per selected context (primary key) |
| `dent2025_simple_gpa` | Fallback GPA saved state (`prevHours`, `prevGpa`, grades) when no selection exists |
| `dent2025_timer_pin` | Saved 4-digit PIN for study timer sync |
| `dent2025_timer_logs` | Offline study timer session logs |
| `dent2025_timer_active_session` | Active timer state snapshot (`running`, `startTime`, `accumulatedSeconds`) |
| `dent2025_timer_badge_pos` | Floating timer badge position (`top`, `left`) |

### `sessionStorage` (Per-Tab):
| Key | Purpose |
|---|---|
| `dent2025_admin_pass` | Admin authentication passkey |
| `dent2025_schedule_admin_pass` | Passkey for schedule admin modal (`admin_schedule_lock.html`) |
| `dent2025_dashboard_data_{spec}_{year}_{sem}` | Cached dashboard API response |
| `dent2025_schedule_{scheduleId}` | Cached schedule events |
| `dent2025_redirect_after` | Destination URL to return to after welcome selection |
| `dent2025_permissions` | RBAC permission object returned by `check_auth` at admin login |
| `dent2025_multi_specialty_mode` | Cached multi-specialty mode boolean returned from `portal_settings` |

---

## 9. Critical WordPress Page Slugs & Protection Rules

> **⚠️ CRITICAL — DO NOT CHANGE THESE PAGE SLUGS OR TITLES IN WORDPRESS!**
> Changing a page's title in WordPress can auto-change its slug, breaking all frontend routing and causing site-wide 404 errors.

| Page ID | Required Slug | Title | Purpose |
|---|---|---|---|
| **622** | `wolcome` | landing page | Selection screen (`dashboard.js` line 268 redirect target) |
| **22** | *(static front)* | الصفحة الرئيسية | Main homepage (Settings > Reading) |
| **2** | `المقررات-والاختبارات` | المقررات والختبارات | Courses & Quizzes page |
| **118** | `التقويم-الأكاديمي` | التقويم الأكاديمي | Schedule timeline page |
| **172** | `جدول-المحاضرات` | جدول المحاضرات | Weekly timetable page |

---

## 10. Cache Management & Troubleshooting

### LiteSpeed Cache (LSCache) Rules:
- Server uses **LiteSpeed Cache**. Dynamic API endpoints send `define('LSCACHE_NO_CACHE', true)` and `Cache-Control: no-cache` headers.
- **Cache Purge Diagnostic Script**: Access `https://dent2025.com/purge_cache.php?token=<admin_passkey>` or append `?purge=1&token=<admin_passkey>` to any page URL to trigger `do_action('litespeed_purge_all')` and clear transients immediately (requires a valid admin passkey token).
- **First Rule of Troubleshooting**: If a code fix is deployed to the server but the live site still shows old behavior, **purge LiteSpeed cache first** before altering any code!

---

## 11. Design System, Aesthetic Guidelines & UI Rules

> **CRITICAL DESIGN PHILOSOPHY**: Dent2025 follows a **premium, sleek, dark-mode aesthetic** tailored for medical and dental university students. The UI must feel state-of-the-art, clean, and professional.

### Strict Aesthetic Rules & User Preferences:

1. 🚫 **NO "Popping" or Loud Saturated Colors**:
   - **STRICTLY FORBIDDEN**: Loud saturated primary colors, bright neon accents, or aggressive flashy gradients.
   - **REQUIRED**: Curated, muted dark-mode palettes. Use deep dark surfaces (`#121212` canvas background, `#1e1e1e` card background, `#27272a` zinc accents) with high-contrast readable slate/white typography (`#f8fafc` / `#e2e8f0`).
   - Accents must be soft and restrained (e.g. soft muted blue `#60a5fa`, subtle green active indicators `rgba(34, 197, 94, 0.5)`).

2. 🚫 **NO Excessive Emojis**:
   - **STRICTLY FORBIDDEN**: Cluttering UI buttons, titles, cards, or headings with random decorative emojis.
   - **REQUIRED**: Use clean SVG vector icons or modern typography. Emojis should only be used when strictly necessary or explicitly requested for functional triggers (e.g. secret `🔒` admin lock).

3. 🎨 **Typography & Styling Standards**:
   - **Font Family**: `'Outfit'`, `'Noto Kufi Arabic'`, `sans-serif`.
   - **Glassmorphism & Micro-animations**: Use subtle backdrop blurs (`backdrop-filter: blur(12px)`), rounded corners (`border-radius: 12px` to `18px`), and smooth micro-interactions (`transition: all 0.25s ease`).
   - **RTL Layout First**: Design all UI components with native Right-to-Left (RTL) Arabic text alignment and clean English technical/medical labels.

---

## 12. Hosting Infrastructure & Server Architecture (Azure + Cloudflare Tunnel)

### A. Hosting Architecture & Cost Optimization (As of Sept 13, 2026)
The website and Telegram Blackboard scraper bot run on an Azure Virtual Machine (`bb-bot-vm`) in **Poland Central** (`polandcentral`) with **24/7 continuous uptime** and **zero Azure Public IP costs**.

**Current Architecture (Cloudflare Tunnel + 24/7 Azure VM)**
- **Operating System & Stack**: Nginx, PHP 8.3-FPM, MariaDB running on Ubuntu 24.04 LTS.
- **VM Specs**: `Standard_B2ts_v2` (2 vCPUs, 1GB RAM, 32GB Standard SSD).
- **DNS & CDN**: **Cloudflare** (`brady.ns.cloudflare.com`, `jasmine.ns.cloudflare.com`). Zone ID: `932a3c299ea8a7a5e0d27488ffa5f60e`.
- **Cloudflare Tunnel (`dent2025-tunnel`)**:
  - Tunnel ID: `9f371b67-9d95-40f4-b2b9-7fd0496d4019`
  - Runs as an active systemd service on the VM (`cloudflared`) connecting outbound to Cloudflare's edge.
  - Ingress routes: `dent2025.com` and `www.dent2025.com` ➔ `https://localhost:443` (No TLS Verify).
- **Zero Public IP / Security**:
  - The previous Azure Static Public IP (`74.248.34.9`) was **permanently deleted** to eliminate the \$3.60/month (\$0.12/day) Azure fee.
  - The VM has **no open inbound public IP ports**. All web traffic arrives through the encrypted Cloudflare Tunnel.
- **24/7 Continuous Operation**:
  - Automated shutdown and startup Logic Apps (`bb-bot-auto-stop` and `bb-bot-auto-start`) have been **Disabled**.
  - The server runs non-stop 24 hours a day, 7 days a week.
- **Financial & Runway Status**:
  - Net Daily Burn: **~$0.350 / day** (~**$10.50 / month**).
  - Student Credit: Covers ~244 days (runway to **mid-May 2027**), easily surpassing the official **April 2, 2027** Azure for Students expiration date by +43 days with \$0 out-of-pocket.
- **Deployment & Server Management**:
  - Server commands and diagnostics can be executed directly via Azure CLI (`az vm run-command invoke`) or Cloudflare Zero Trust.
  - Shared credentials and Cloudflare API tokens are securely persisted in untracked `passwords.txt` (gitignored).

### B. Essential Server Paths & Local Configurations
- **VM Name**: `bb-bot-vm` (Resource Group: `bb-bot-pl-rg`)
- **VM Private IP**: `10.0.0.4` (Internal VNet)
- **Web Root**: `/var/www/dent2025/`
- **Nginx Config**: `/etc/nginx/sites-available/dent2025`
- **Database Name**: `wordpress`
- **Database User**: `wpuser` (password: `wp_dent2025_sec!`)
- **Gitignored Secrets**: `passwords.txt`, `deploy_config.json`, `dent2025_passwords.json`

### C. Important System Changes
1. **File Ownership**: The WordPress files in `/var/www/dent2025/` are owned by `www-data:www-data`. The `azureuser` is part of the `www-data` group.
2. **FS_METHOD**: The `wp-config.php` has `define('FS_METHOD', 'direct');` forced to bypass FTP permission prompts when installing plugins.
3. **Upload Limits**: `php.ini` and `nginx.conf` are configured to allow 2GB file uploads to facilitate large site imports.
4. **Cloudflare Tunnel Routing**: Traffic to `dent2025.com` is proxied via Cloudflare edge ➔ Cloudflare Tunnel ➔ local Nginx port 443 with TLS.

