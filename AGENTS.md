# AGENTS.md - Project Rules, Guidelines & Comprehensive System Architecture for Dent2025 Academic Portal

Welcome to **Dent2025 (Medical & Dental Academic Portal)**! This file provides essential guidelines, architectural context, technical standards, deployment rules, and complete workflow instructions for AI agents working on this codebase.

---

## 1. Executive Summary & Core Outlook

**Dent2025** is a specialized, high-performance academic web application designed for university dentistry and medicine students. It organizes course materials, schedules, announcements, GPA calculations, Google Drive folder embeds, interactive study timers, subject links, and comprehensive administration tools across multiple academic categories:

- **Pre-Med** (Year 1 only — Semesters 1 & 2)
- **Medicine** (Years 2–6 — Semesters 1 & 2 each)
- **Dentistry** (Years 2–6 — Semesters 1 & 2 each)

### Modern Workflow Outlook
- **Zero-Friction AI Development**: All frontend components, JavaScript modules, CSS templates, and backend APIs reside on disk as local source files and are **automatically synced to the FTP server in 1–2 seconds via `deploy.py`**.
- **Dynamic Component Loader (`dent2025-loader.php`)**: WordPress pages load components dynamically via simple shortcodes (`[dent_component file="..."]`). AI edits local code, `deploy.py` uploads it to FTP, and changes immediately reflect on the live site with automatic timestamp-based cache-busting. **Manual copy-pasting of code into WordPress Astra HTML blocks or Code Snippets is obsolete.**

---

## 2. Complete Codebase Directory Structure

```
my website dent2025/
├── AGENTS.md                                   # Master Agent Guidelines & Architecture Reference (this file)
├── DEPLOYMENT_GUIDE.md                         # Complete FTP deployment documentation
├── deploy_config.json                          # FTP credentials & server host configuration
├── dent2025-loader.php                         # WordPress Component Loader plugin (shortcode [dent_component])
├── purge_cache.php                             # Standalone cache purge diagnostic script
├── logo of main page.webp                      # Main Portal Logo asset
├── dent2025_api.php                            # PRIMARY WordPress-Integrated Standalone API ($wpdb)
├── announcements_api.php                       # Announcements & Class Tasks Backend API (file-based JSON)
├── schedule_backend.php                        # Timeline Schedule Events API (file-based JSON)
├── history_api.php                             # Study timer log & deployment audit history API
├── auto_relink.php                             # Google Drive folder-ID batch linker tool (HTML UI)
├── history_helpers.php                         # Shared audit-log / snapshot helper used by multiple APIs
├── dent2025_rbac.php                           # ⭐ Shared RBAC permission engine (ALL backends use this)
├── dent2025_passwords.json                     # ⭐ RBAC passkey store (masters + per-context leaders, ~28 entries)
├── admin_app.js                                # Admin Dashboard standalone client-side logic
├── admin_dashboard.html                        # Standalone Admin Dashboard HTML page
├── deploy_dashboard.html                       # SafeDeploy visual dashboard
├── schedule_events.json                        # Global timeline schedule events data
├── gas_backup_script.gs                        # Google Apps Script backup helper (GSheet/Drive)
├── bg_remover.py                               # Local background-removal helper (NOT deployed)
├── tools/                                      # Local deployment toolchain (NOT deployed to server)
│   ├── _toolkit.py                             # Shared bootstrap: PROJECT_ROOT + tools/ sys.path helper
│   ├── deploy.py                               # Base FTP uploader / rollback engine
│   ├── deploy_guard.py                         # Pre-flight validation (syntax, forbidden files, note)
│   ├── deploy_order.py                         # Deployment priority ordering
│   ├── deploy_health.py                        # Post-deploy API health probe
│   └── deploy_safe.py                          # Full Git-integrated SafeDeploy pipeline CLI
├── backend/                                    # Standalone PDO Backend Module (RBAC-auth via dent2025_rbac.php)
│   ├── db_connect.php                          # PDO Database Connection, CORS headers, sendResponse()
│   ├── api_data.php                            # Public data retrieval API (subjects + links)
│   ├── api_manage.php                          # Admin management API (subjects, links, Google Drive)
│   ├── api_ai_exam.php                         # AI exam generation backend (used by quiz_app.html)
│   ├── setup_links_db.php                      # One-time DB schema setup for subject_links table
│   ├── bin/                                    # Helper binaries (e.g. pdftotext)
│   └── gemini_keys_data/                       # Gemini API key health cache
├── logos/                                      # Specialty logos (deployed to server)
│   ├── dentistry.webp                          # Dentistry specialty logo
│   ├── medicine.webp                           # Medicine specialty logo
│   └── pre-med.webp                            # Pre-Med specialty logo
├── frontend-html box in wordpress astra/       # Local Source Frontend Components (FTP synced to /frontend_components/)
│   ├── landing_page.html                       # Year/Specialty/Semester grid selection card template
│   ├── chapters_dynamic.html                   # Subject chapters container & Google Drive folder embed layout
│   ├── quiz_app.html                           # Interactive Quiz application (UI + CSS + JS)
│   ├── study_timer_banner_widget.html          # Study Timer & Tracker widget + sitewide floating draggable badge
│   ├── gpa_calculator_elegant.txt              # Saudi 5.0 scale GPA Calculator widget code
│   ├── admin_controls_main.html                # Main page lock trigger (🔒) & admin logout button
│   ├── admin_controls.html                     # Main Admin Modal panel (Subject CRUD & Google Drive linker)
│   ├── admin_schedule_lock.html                # Schedule timeline lock trigger & event management modal
│   ├── admin_classes_lock.html                 # Class schedule lock trigger & group management modal
│   ├── schedule_markup.html                    # Academic calendar timeline container template & stats cards
│   ├── schedule_script.js                      # Academic calendar timeline engine (~30 KB)
│   └── dashboard.js                            # Core Student Dashboard JS engine (~71 KB)
├── txt stuff to save/                          # Backup text & query references (NOT deployed)
│   ├── current semester subjects.txt           # Current semester subject list
│   ├── dates.txt                               # Date references
│   ├── exam ai shit.txt                        # Exam-related AI notes
│   ├── all subjects for all years.txt          # Full subject list reference
│   ├── passwords.txt                           # Local password scratchpad
│   └── website additional css.txt              # Extra CSS notes
├── announcements_data/                         # AUTO-CREATED at runtime by announcements_api.php
│   ├── announcements_{spec}_{year}_{sem}.json  # Per-class announcement content
│   └── announcements_backup.json               # Undo snapshot taken before write operations
├── history_data/                               # Runtime audit/deployment history (local + server)
├── .deploy_backups/                            # Snapshot folders + ZIPs + snapshot_meta.json
└── .agents/                                    # Agent tooling scratch (NOT deployed)
```

> **NOTE**: The old `dev/` directory was **removed** (snapshot `snap_20260805_210759_remove_legacy_dev_path_delete_`). All backend files now live at the **project root**, and `dev/backend/*` → `backend/*`. Deploy routing in `tools/deploy.py` reflects this (root-relative → same dir on server).

---

## 3. Automated Component Loader System & FTP Workflow

### A. The Component Loader Plugin (`dent2025-loader.php`)
Installed on the live WordPress site at `wp-content/plugins/dent2025-loader/dent2025-loader.php`.
- **Shortcode**: `[dent_component file="filename.ext"]`
- **Security**: Strictly sanitizes input via `basename()` and regex whitelist `preg_replace('/[^a-zA-Z0-9_.-]/', '', $file)` to completely prevent directory traversal attacks (`../`).
- **File Location**: Reads components from `ABSPATH . 'frontend_components/' . $safe_file`.
- **Automatic Cache-Busting**: Appends dynamic `?v={filemtime}` query strings to JavaScript (`.js`), CSS (`.css`), and embedded `<script src="...">` / `<link href="...">` tags inside HTML blocks. When `deploy.py` uploads a new file, the modified timestamp updates instantly, forcing every browser and LiteSpeed Cache to download fresh code without stale cache glitches.
- **WordPress `wpautop` Protection**: Collapses internal whitespace inside `<style>` and `<script>` blocks and runs a high-priority `the_content` filter (priority 999) to strip `<p>` and `<br>` tags wrapped around CSS/JS, preventing raw code text walls from appearing on screen.
- **Sitewide Study Timer Injection**: Injects `study_timer_banner_widget.html` into `wp_footer` on all non-welcome pages so the floating draggable timer badge follows students seamlessly across the entire website.
- **Cache Purging**: Listens for `?purge=1` or `?nocache=1` query parameters to execute `do_action('litespeed_purge_all')` and clear WordPress transients.

### B. Deployment Automation Script (`tools/deploy.py`)
Run from terminal to sync any file to the live FTP server in ~1 second:

```bash
# Deploy a single frontend component:
python tools/deploy.py "frontend-html box in wordpress astra/quiz_app.html"

# Deploy backend APIs or loader plugin:
python tools/deploy.py "dent2025_api.php" "dent2025-loader.php"

# Deploy multiple files at once:
python tools/deploy.py "frontend-html box in wordpress astra/dashboard.js" "frontend-html box in wordpress astra/chapters_dynamic.html"
```

> **⚠️ MANDATORY — GIT COMMIT & PURGE ON EVERY DEPLOYMENT**: Every AI/agent update that touches website files **MUST** use the Git-integrated SafeDeploy pipeline.
>
> ### Modern Git SafeDeploy Workflow:
> 1. **Deploy with Git Commit**: Run `python tools/deploy_safe.py --note "what changed" <file1> [file2...]`
>    - **Stage 1**: Validates PHP/JS/JSON syntax and ensures no secrets or forbidden files are staged (`deploy_guard.py`).
>    - **Stage 2**: Automatically stages files, creates a semantic Git commit (`git commit -m "[SafeDeploy] ..."`), and pushes to GitHub (`origin/main`).
>    - **Stage 3**: Uploads the modified files to live FTP in ~1 second and triggers a LiteSpeed cache purge (`purge_remote_cache`).
>    - **Stage 4**: Executes post-deployment health probes to verify live APIs (`deploy_health.py`).
> 2. **Instant Rollback**: If an update causes an issue, simply run:
>    - `python tools/deploy_safe.py --rollback` (reverts `HEAD`, redeploys the clean state to FTP, and purges cache automatically).
> 3. **Dry Run**: `python tools/deploy_safe.py --dry-run --note "test" <file1>...`
> 4. **Check Status**: `python tools/deploy_safe.py --status` (shows Git branch, recent commits, uncommitted diffs, and API health).

### C. GitHub Repository & SSH Configuration
- **Repository URL (SSH)**: `git@github.com:3bdyna/dent2025.git`
- **Web Link**: `https://github.com/3bdyna/dent2025`
- **Default Branch**: `main`
- **SSH Key Location**: `~/.ssh/id_ed25519`
- **Protected Secrets**: `deploy_config.json`, `dent2025_passwords.json`, `txt stuff to save/passwords.txt`, and runtime JSON storage directories are strictly excluded via `.gitignore` and must never be committed.

#### FTP Routing Rules in `deploy.py`:
- Files in `frontend-html box in wordpress astra/` → Auto-routed to `public_html/frontend_components/` (any subfolder inside is preserved, e.g. `frontend-html box in wordpress astra/fonts/fonts.css` → `frontend_components/fonts/fonts.css`)
- `dent2025-loader.php` → Auto-routed to `public_html/wp-content/plugins/dent2025-loader/`
- Backend files (`backend/*`) → Auto-routed to `public_html/backend/`
- Root-level backend files (`dent2025_api.php`, `schedule_backend.php`, etc.) → Auto-routed to `public_html/` (web root)

---

## 4. Frontend Component Page-by-Page Mapping Matrix

Below is the definitive reference mapping all 5 WordPress pages to their target components and shortcodes:

| WordPress Page Name | Page Slug | Required Shortcodes / Markup inside WordPress Block | Auto-Loaded Internal Scripts |
|---|---|---|---|
| **1. `landing page`** | `wolcome` | `[dent_component file="landing_page.html"]` | None |
| **2. `الصفحة الرئيسية — Front Page`** | *(static front)* | `[dent_component file="study_timer_banner_widget.html"]`<br>`[dent_component file="gpa_calculator_elegant.txt"]`<br>`[dent_component file="admin_controls_main.html"]` | `admin_controls_main.html` embeds `<script src="/frontend_components/dashboard.js"></script>` |
| **3. `التقويم الأكاديمي`** | `التقويم-الأكاديمي` | `[dent_component file="schedule_markup.html"]`<br>`[dent_component file="schedule_script.js"]`<br>`[dent_component file="admin_schedule_lock.html"]` | None |
| **4. `المقررات والختبارات`** | `المقررات-والاختبارات` | `[dent_component file="chapters_dynamic.html"]`<br>`[dent_component file="quiz_app.html"]`<br>`[dent_component file="admin_controls.html"]` | `chapters_dynamic.html` embeds `<script src="/frontend_components/dashboard.js"></script>` |
| **5. `جدول المحاضرات`** | `جدول-المحاضرات` | `[dent_component file="admin_classes_lock.html"]`<br>`<div id="dent-classes-target"></div>` | `admin_classes_lock.html` embeds `<script src="/frontend_components/dashboard.js"></script>` |

---

## 5. Backend Architecture & Shared RBAC Authentication

> **CRITICAL**: Dent2025 uses a **shared RBAC permission engine** (`dent2025_rbac.php` + `dent2025_passwords.json`) across ALL backend layers. There is **no longer** a "different passkey system per backend" — the same master passkeys and the same JSON-based context passkeys are accepted by every backend.

### ⭐ Shared Authentication Core (`dent2025_rbac.php` + `dent2025_passwords.json`)
- **`dent2025_rbac.php`**: Loads `dent2025_passwords.json` and provides `dent2025_check_rbac_permission($pass, $permission, $specialty=null, $year=null, $semester=null)` and `dent2025_get_passkey_info($pass)`.
- **`dent2025_passwords.json`** (~28 entries): Each entry = `{id, label, passkey, allowed_contexts, permissions}`.
- **Universal Master Passkeys** (accepted everywhere, `allowed_contexts: ['*']`):
  Configured in untracked `dent2025_passwords.json` (see `dent2025_passwords.example.json`).
- **Per-Context Leader Passkeys**: JSON entries scoped to `allowed_contexts` strings in `{specialty}_{year}_{semester}` format (e.g. `dentistry_1_1`, `medicine_3_1`, `pre-med_1_1`). These grant limited permissions (`edit_basic_subject`, `semester_events`, `semester_announcements`, `timetable`). There are **no algorithmic context passkeys** — a leader exists only if a JSON entry was explicitly created; check `dent2025_passwords.json` before assuming one exists.
- **Permission names**: `add_subject`, `delete_subject`, `edit_core_subject`, `edit_basic_subject`, `global_events`, `semester_events`, `global_announcements`, `semester_announcements`, `timetable`, `manage_passwords`.

### A. WordPress-Integrated Backend (`dent2025_api.php`)
- Bootstraps WordPress via `require_once dirname(__FILE__) . '/wp-load.php'`.
- Database access via `$wpdb->prepare()`.
- WordPress transient caching for subjects (`dent2025_data_{specialty}_{year}_{semester}`, 12-hour TTL).
- Manages class timetable data via `dent2025_classes.json` (file-based, auto-created at runtime).
- Auth: uses `dent2025_check_rbac_permission()` (master + JSON context passkeys).
- **GAS Webhook URL**: `https://script.google.com/macros/s/AKfycbyGOFQWRmkBmJJ9ItdpzhzY5CgbEPjjI6joodT0GT_Sq--f287fcomqUBqRw-MxaKie/exec` (follows 302 redirects). Also hosts a study-PIN sync subsystem (`study_check_pin`, `study_get_data`, `study_sync_data`, `study_change_pin` → `dent2025_study_data/study_records.json`).

### B. File-Based PHP APIs (`announcements_api.php`, `schedule_backend.php`, `history_api.php`)
- Standalone PHP scripts — **no `wp-load.php` dependency**.
- Local JSON file storage exclusively (no DB access).
- Auth: same shared RBAC engine. `schedule_backend.php` requires `global_events` or `semester_events` permission for writes.
- `history_api.php` also accepts the master passkeys directly for `manage_passkeys` actions.

### C. Standalone PDO Backend (`backend/api_manage.php`, `backend/api_data.php`, `backend/api_ai_exam.php`)
- Uses `backend/db_connect.php` for PDO MySQL connection (no WordPress dependency).
- Database access via `$pdo->prepare()`.
- Auth: **same shared RBAC engine** (`require_once __DIR__ . '/../dent2025_rbac.php'`). There is **no** `$CONTEXT_PASSWORDS` array anymore.
- **GAS Webhook**: `backend/api_manage.php` uses `https://script.google.com/macros/s/AKfycbz908qgvF7CSBgoCzA-YAEofJ6kq5RsmZgZoi21bYtqdF_H4pt8cQbfXpYDi2SEYepOCQ/exec` (curl post).
- `action=add_link` and `action=delete_link` now **enforce** RBAC permission — they are NOT open public endpoints.

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
| `type` | VARCHAR(50) | Auto-detected: `'youtube'`, `'drive'`, or `'link'` |
| `created_at` | TIMESTAMP | Auto-generated |

### File-Based JSON Storage Inventory
1. **Class Timetable (`dent2025_classes.json`)**: Array of class group schedule objects filtered by specialty, year, semester.
2. **Announcements (`announcements_data/`)**: Per-class JSON files `announcements_{spec}_{year}_{sem}.json` + `announcements_backup.json` snapshot.
3. **Timeline Schedule Events (`schedule_events.json`)**: Global schedule events (`is_global = true`) and per-schedule files (`schedule_events_{schedule_id}.json`).
4. **Study Timer Records (`dent2025_study_data/study_records.json`)**: Per-student PIN + synced study timer logs (managed by `dent2025_api.php`).

---

## 7. Frontend Engineering Standards & Key Modules

### A. Main Dashboard Engine (`dashboard.js` — ~71 KB)
- **API Base URL**: `const API_BASE_URL = API_BASE + '/dent2025_api.php'`.
- **Immediate Selection Guard**: Immediately hides document and redirects to `/wolcome/` if `localStorage.getItem('dent2025_selection')` is invalid or missing. (Note: `wolcome` is an intentional hardcoded slug).
- **Sequential iFrame Queue**: `window.dentIframeQueue` loads Google Drive folder iframes sequentially with 1.0s delays to maintain fast browser performance.
- **Path Changer Pill Bar**: Auto-minimizing pill bar showing current specialty/year/semester; double-click resets selection.

### B. Study Timer & Tracker (`study_timer_banner_widget.html` — ~64 KB)
- **Singleton Guard**: `if (window.dentTimerScriptLoaded) return; window.dentTimerScriptLoaded = true;` ensures only one script instance executes, avoiding duplicate `setInterval` loops.
- **Session State Clearing**: `stopTimerEngine()`, `finishTimer()`, and `resetTimer()` cleanly clear `KEY_ACTIVE_SESSION` from `localStorage` without race conditions.
- **Cross-Tab Synchronization**: Uses `window.addEventListener('storage')` with recursion lock (`isRestoringSession`) to sync active timer states across browser tabs.
- **Sitewide Floating Badge**: Draggable badge (`.dent-timer-draggable-badge`) injected into `document.body` follows students across all site pages when active.

### C. Schedule Timetable Engine (`schedule_script.js` — ~30 KB)
- **API Base URL**: `apiUrl: window.location.origin + '/schedule_backend.php'` (site-root-relative; the `/dev/` prefix path is obsolete).
- **Schedule ID Derivation**: `${specialty}_y${year}_s${semester}`.
- **Features**: Gregorian timeline with Hijri month labels, exam countdown cards, semester progress stats. The admin add/edit modal auto-derives the Hijri date from the Gregorian start date via `Intl.DateTimeFormat('en-u-ca-islamic-umalqura')`.

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

---

## 9. Critical WordPress Page Slugs & Protection Rules

> **⚠️ CRITICAL — DO NOT CHANGE THESE PAGE SLUGS OR TITLES IN WORDPRESS!**
> Changing a page's title in WordPress can auto-change its slug, breaking all frontend routing and causing site-wide 404 errors.

| Page ID | Required Slug | Title | Purpose |
|---|---|---|---|
| **622** | `wolcome` | landing page | Selection screen (`dashboard.js` line 52 redirect target) |
| **22** | *(static front)* | الصفحة الرئيسية | Main homepage (Settings > Reading) |
| **2** | `المقررات-والاختبارات` | المقررات والختبارات | Courses & Quizzes page |
| **118** | `التقويم-الأكاديمي` | التقويم الأكاديمي | Schedule timeline page |
| **172** | `جدول-المحاضرات` | جدول المحاضرات | Weekly timetable page |

---

## 10. Cache Management & Troubleshooting

### LiteSpeed Cache (LSCache) Rules:
- Server uses **LiteSpeed Cache**. Dynamic API endpoints send `define('LSCACHE_NO_CACHE', true)` and `Cache-Control: no-cache` headers.
- **Cache Purge Diagnostic Script**: Access `https://dent2025.com/purge_cache.php` or append `?purge=1` to any page URL to trigger `do_action('litespeed_purge_all')` and clear transients immediately.
- **First Rule of Troubleshooting**: If a code fix is deployed via FTP but the live site still shows old behavior, **purge LiteSpeed cache first** before altering any code!

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
