# Dent2025 — Medical & Dental Academic Portal

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-WordPress%20%7C%20PHP%208.2%20%7C%20Vanilla%20ES6%2B-success)](#)
[![Cloud Infrastructure](https://img.shields.io/badge/Cloud-Azure%20VPS%20%7C%20Cloudflare%20Tunnel-blueviolet)](#)
[![Deployment Pipeline](https://img.shields.io/badge/Deploy-Git%20SafeDeploy%20%2B%20SFTP%20Sync-orange)](#)
[![Test Suite](https://img.shields.io/badge/Tests-48%2F48%20Passing-brightgreen)](#)

**[Dent2025](https://dent2025.com)** is a high-performance academic web portal tailored specifically for university medical and dental students. The platform centralizes academic tracks, course materials, dynamic Google Drive embeds, automated Hijri/Gregorian timelines, interactive A4 calendar export, class timetables, AI-driven practice exams, a sitewide floating study timer, academic calculators, and granular role-based administration.

---

## 🌟 Key Features

### 🎓 Academic Tracks & Context Routing
- **Comprehensive Cohort Coverage**: Pre-Med (Year 1, Semesters 1 & 2), Medicine (Years 2–6, Semesters 1 & 2), and Dentistry (Years 2–6, Semesters 1 & 2).
- **Context Preservation**: Client-side track switching with cohort state saved in `localStorage`.

### 🧩 Dynamic Component Loader (`dent2025-loader.php`)
- **Zero-Friction Shortcode Loading**: WordPress pages load local frontend components dynamically using `[dent_component file="..."]`.
- **Automatic Cache-Busting**: Appends dynamic `?v={filemtime}` query strings to JavaScript and CSS assets, ensuring instant cache invalidation upon deployment.
- **WordPress `wpautop` Clean-up**: Strips disruptive `<p>` and `<br>` tags wrapped around styles and scripts to preserve clean markup.
- **Sitewide Timer Injection**: Automatically injects the floating study timer into `wp_footer` across all active academic subpages.
- **Font & Asset Optimization**: Inlines self-hosted WOFF2 fonts (*Outfit* & *Noto Kufi Arabic*) to eliminate render-blocking external Google Fonts requests.

### 📅 Interactive Academic Schedule & Timetables
- **Dual Calendar Integration**: Full Gregorian and Hijri calendar support with automated date calculations.
- **Filterable Event Feeds**: Instant filtering across Exams, Assignments, Practical Sessions, Lectures, and Holidays.
- **Tomorrow Alert Widget**: Highlights upcoming exams and academic events due the next day.
- **High-Fidelity A4 Export Engine**: Printable multi-page PDF/table export configured for Saudi academic schedules with cohort/group selection.
- **Per-Event Privacy & Display Controls**: Admin toggles to show/hide specific entries with client-side state preservation.

### ⏱️ Sitewide Study Timer & Tracking Widget
- **Floating Draggable Badge**: Compact, non-intrusive floating study timer that persists seamlessly across navigation.
- **Session Logging & Audit History**: Records focused study sessions locally and syncs logs through the history backend (`history_api.php`).

### 🧮 Built-In Academic Calculators
- **Saudi 5.0 GPA Calculator**: Supports cumulative and semester GPA projections, custom credit hour weighting, and grade scales.
- **Jazan University Absence & Denial Calculator**: Calculates attendance percentages against contact hours, alerting students before reaching the 25% denial threshold.

### 🤖 AI Exam & Quiz Practice Engine (`backend/api_ai_exam.php`)
- **PDF-to-Exam Pipeline**: Extracts lecture materials (`pdftotext`) and generates structured practice questions via Google Gemini API.
- **Question Cache & Cron Sync**: Caches generated questions and runs scheduled syncs to maintain responsive load times.

### 🔐 Unified Role-Based Access Control (RBAC)
- **Shared Authentication Layer**: Powered by `dent2025_rbac.php` and `dent2025_passwords.json`.
- **Tiered Permissions**: Supports universal master administrators alongside context-scoped cohort leaders (e.g., `dentistry_3_1`).
- **Touch-Friendly PIN Keypad**: Universal 4-digit numeric PIN modal (`dent_pin_modal.js`) for quick on-page admin authentication.
- **Standalone Admin Dashboard (`admin_dashboard.html`)**: Web-based administration panel to manage subjects, events, and announcements without entering the WordPress admin.

---

## 🏗️ Architecture & Codebase Structure

```
my website dent2025/
├── dent2025-loader.php                         # WordPress Component Loader plugin ([dent_component])
├── dent2025_api.php                            # Primary WordPress-integrated backend API ($wpdb)
├── dent2025_rbac.php                           # Shared RBAC authentication & authorization engine
├── announcements_api.php                       # File-based JSON announcements & tasks API
├── schedule_backend.php                        # File-based JSON schedule events API
├── history_api.php                             # Study timer audit & session log API
├── history_helpers.php                         # Reusable snapshot & audit logging utilities
├── admin_dashboard.html                        # Standalone admin dashboard interface
├── admin_app.js                                # Standalone admin dashboard client logic
├── backend/                                    # Standalone PDO Backend Module
│   ├── db_connect.php                          # PDO MySQL connection & CORS response helper
│   ├── api_ai_exam.php                         # Gemini AI exam generation backend
│   └── bin/                                    # CLI helper utilities (pdftotext)
├── frontend-html box in wordpress astra/       # Local source frontend components
│   ├── landing_page.html                       # Academic track & semester selection grid
│   ├── chapters_dynamic.html                   # Dynamic course view & Google Drive container
│   ├── quiz_app.html                           # Interactive quiz & practice exam application
│   ├── study_timer_banner_widget.html          # Sitewide floating study timer & tracker
│   ├── gpa_calculator_elegant.txt              # Saudi 5.0 scale GPA calculator widget
│   ├── absence_calculator.html                 # Jazan University Absence & Denial calculator
│   ├── calendar_tomorrow_alert.html            # Next-day academic alert component
│   ├── schedule_markup.html                    # Academic calendar timeline container & stats
│   ├── schedule_script.js                      # Calendar timeline engine & A4 PDF export
│   ├── dent_pin_modal.js                       # Universal 4-digit PIN keypad modal
│   ├── dashboard.js                            # Core student dashboard engine
│   └── fonts/                                  # Self-hosted WOFF2 fonts (Outfit & Noto Kufi)
├── tools/                                      # SafeDeploy pipeline & sync toolchain
│   ├── deploy_safe.py                          # Full Git-integrated SafeDeploy CLI runner
│   ├── deploy.py                               # Core SFTP & OpenSSH upload engine
│   ├── deploy_guard.py                         # Pre-flight syntax validation & secret checker
│   ├── deploy_health.py                        # Post-deployment live endpoint health probes
│   ├── deploy_order.py                         # File deployment dependency ordering
│   ├── sync_cloud_events.py                    # Cloud-first dynamic data sync & smart-merge
│   ├── sync_server_backups.py                  # Local sync engine for VPS database & file backups
│   └── test_system_logic.php                   # Offline test suite (42/42 tests)
├── logos/                                      # High-resolution logos & OpenGraph banners
└── docs/                                       # Project documentation
    ├── DEPLOYMENT_GUIDE.md                     # Detailed SafeDeploy & server configuration guide
    └── MAIN_PAGE_DESIGN_SPEC.md                # Homepage UX/UI layout specifications
```

---

## 🚀 SafeDeploy Pipeline & DevOps

Dent2025 utilizes a specialized **SafeDeploy** pipeline that automates testing, version control, cloud synchronization, and cache clearing in a single command.

```
Local Code Edit ──► Stage 0: Cloud Sync ──► Stage 1: Pre-Flight Guard ──► Stage 2: Git Commit & Push ──► Stage 3: SFTP Upload & Purge ──► Stage 4: Health Probe
```

### SafeDeploy Workflow
1. **Stage 0 (Cloud Sync & Smart Merge)**: Verifies dynamic runtime data (`schedule_events*.json`, `announcements_data/`) against the live Azure server via `sync_cloud_events.py` to prevent overwriting student modifications.
2. **Stage 1 (Pre-Flight Guard)**: Runs `deploy_guard.py` to validate PHP/JS/JSON syntax and block sensitive credentials or forbidden files from being deployed.
3. **Stage 2 (Git Commit & Push)**: Creates a standardized semantic commit (`[SafeDeploy] ...`) and pushes changes to GitHub (`origin/main`).
4. **Stage 3 (SFTP Upload & Purge)**: Uploads files to `/var/www/dent2025/` in 1–2 seconds via SFTP (with OpenSSH fallback) and triggers a remote LiteSpeed Cache purge.
5. **Stage 4 (Health Probes)**: Executes automated probes via `deploy_health.py` against live API endpoints to verify server integrity.

### Common Deployment Commands

```bash
# Deploy single or multiple files with SafeDeploy:
python tools/deploy_safe.py --note "Refine calendar table layout" "frontend-html box in wordpress astra/schedule_script.js"

# Dry run (verify syntax, staging, and routing without uploading):
python tools/deploy_safe.py --dry-run --note "Test dry run" "dent2025_api.php"

# Instant one-command rollback (reverts Git HEAD and redeploys clean state):
python tools/deploy_safe.py --rollback

# Inspect repository status, uncommitted diffs, and server health:
python tools/deploy_safe.py --status
```

---

## 🛡️ Cloud-First Source of Truth & Backup Safety

- **Dynamic Data Preservation**: The live cloud (`/var/www/dent2025/`) acts as the absolute Source of Truth for timeline events, announcements, and timetable files. Guardrails prevent manual deletion without creating a server snapshot.
- **Server-Side Protection (`safe-rm`)**: The Azure VPS runs `safe-rm` to mechanically prevent catastrophic recursive file deletion across core system and web root paths.
- **Automated Nightly Server Backups**: VPS cron runs nightly at 03:30 UTC, creating compressed MySQL dumps (`db_wordpress_*.sql.gz`) and file archives (`data_*.tar.gz`) stored in `/var/backups/dent2025_daily/` with a rolling 14-day retention.
- **Local Mirroring via Windows Task Scheduler**: An automated background task runs daily at 07:00 AM AST (`sync_server_backups.py`), maintaining an off-server copy in `server_backups_dent2025_daily/`.

---

## 🧪 Testing & Validation

The offline test suite validates RBAC rules, response contracts, CORS headers, and component integrity without requiring live database access:

```bash
# Run comprehensive offline test suite (48 tests):
php tools/test_system_logic.php
```

---

## 💻 Local Setup & Development

### 1. Prerequisites
- **PHP 8.2+** with `pdo_mysql`, `curl`, and `json` extensions enabled.
- **Python 3.9+** with `paramiko` installed for deployment automation (`pip install paramiko`).
- **Git** with SSH key authentication configured.

### 2. Configuration Setup
Create local configuration files from the provided templates (both files are gitignored for security):

```bash
cp deploy_config.example.json deploy_config.json
cp dent2025_passwords.example.json dent2025_passwords.json
```

- In `deploy_config.json`, configure your SFTP/SSH host, port, credentials, and remote web root (`/var/www/dent2025/`).
- In `dent2025_passwords.json`, configure administrative passkeys and role permissions.

---

## 📄 License

This project is open-source and licensed under the [MIT License](LICENSE).
