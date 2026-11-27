# Dent2025 — Architecture, Modules, APIs & Operations Reference

*(Moved out of root `AGENTS.md` to stay well under Antigravity's 24 KB per-file rule cap. Read on demand when working on backend APIs, loader hooks, DB schema, client storage, or disaster recovery.)*

## 1. Codebase Directory Structure

```
my website dent2025/
├── AGENTS.md                                   # Lean core rules (auto-loaded)
├── docs/                                       # Specs & reference docs
│   ├── ARCHITECTURE.md                         # This file
│   ├── DESIGN_TOKENS.md                        # Complete --dent-* CSS token registry
│   ├── DEPLOYMENT_GUIDE.md                     # Git SafeDeploy documentation
│   ├── MAIN_PAGE_DESIGN_SPEC.md                # Homepage UI/UX specifications
│   └── google_apps_scripts/                    # Active GAS backups (gitignored)
├── dent2025-loader.php                         # WordPress Component Loader plugin ([dent_component], [dent_poll])
├── purge_cache.php                             # Standalone LiteSpeed cache purge diagnostic
├── dent2025_api.php                            # PRIMARY WordPress-integrated API ($wpdb)
├── announcements_api.php                       # Announcements & Class Tasks API (JSON)
├── schedule_backend.php                        # Timeline Schedule Events API (JSON)
├── analytics_api.php                           # First-party dwell-time & telemetry API (JSON)
├── polls_api.php                               # Inline student polls API (JSON)
├── history_api.php                             # Study timer log & deployment audit API
├── history_helpers.php                         # Shared audit-log / snapshot helper
├── dent2025_rbac.php                           # Shared RBAC permission engine & rate-limiting
├── admin_app.js / admin_dashboard.html         # Standalone Admin Dashboard
├── dent2025_classes.json                       # Global class timetable groups
├── schedule_events.json / schedule_events_*.json
├── tools/                                      # Local deployment toolchain (NOT deployed)
│   ├── _toolkit.py, deploy.py, deploy_guard.py, deploy_order.py, deploy_health.py, deploy_safe.py
│   ├── export_quiz_pdfs.js                     # Headless Chrome A4 PDF quiz booklets
│   ├── sync_cloud_events.py                    # Cloud-first dynamic data smart-merge
│   ├── sync_server_backups.py                  # 14d rolling local mirror of VPS backups
│   └── test_system_logic.php                   # Offline test suite (100 tests across 12 modules)
├── backend/                                    # Standalone PDO Backend (db_connect.php, api_ai_exam.php, bin/pdftotext)
├── logos/                                      # Specialty logos (*-sm.webp 2x retina), OG banner, icons
├── frontend-html box in wordpress astra/       # Synced to /frontend_components/
│   ├── landing_page.html, chapters_dynamic.html, quiz_app.html, poll_widget.html, vsv_chart.html
│   ├── study_timer_banner_widget.html (~36 KB), study_timer.js (~44 KB)
│   ├── analytics_tracker.js (~7 KB), kinetic_grid.html (~48 KB), dent_click.mp3
│   ├── gpa_calculator_elegant.txt, absence_calculator.html, weekly_meme.html, weekly_meme.webp
│   ├── admin_controls_main.html, admin_controls.html, admin_schedule_lock.html, admin_classes_lock.html
│   ├── calendar_tomorrow_alert.html (~10 KB), dent_pin_modal.js (~35 KB)
│   ├── schedule_markup.html, schedule_script.js (~156 KB), dashboard.js (~130 KB)
│   └── fonts/ (Outfit & Noto Kufi Arabic WOFF2 + fonts.css)
└── [gitignored runtime dirs]: announcements_data/, polls_data/, analytics_data/, dent2025_study_data/, quizzes_data/, quiz_jobs/, history_data/, server_backups_dent2025_daily/
```

## 2. WordPress Component Loader (`dent2025-loader.php`)
Installed at `wp-content/plugins/dent2025-loader/dent2025-loader.php`.
- **Shortcodes:** `[dent_component file="filename.ext"]` (reads `ABSPATH . 'frontend_components/' . $safe_file` with `basename()` + regex sanitization) and `[dent_poll]` (`poll_widget.html`).
- **Auto Cache-Busting:** Appends `?v={filemtime}` to `.js`, `.css`, embedded `<script>`/`<link>` tags, `weekly_meme.webp`, and lazy-loaded `study_timer.js` / `dent_pin_modal.js`.
- **`wpautop` Protection & LCP Priority:** Strips `<p>`/`<br>` inside `<style>`/`<script>` (priority 999); marks below-LCP homepage images (`wp-image-553`, `wp-image-942`) `fetchpriority="low" loading="lazy"`; preloads homepage hero LCP (`semester-e1783891637311.webp`, `fetchpriority="high"`).
- **SSR Tomorrow Alert:** `dent2025_prerender_tomorrow_alert` pre-renders `calendar_tomorrow_alert.html` for default cohort (`Asia/Riyadh`) for zero CLS.
- **`wp_footer` Injections:** Kinetic Grid (p:5; `<style id="dent-kinetic-grid-style">` split to `wp_head` p:999), Study Timer banner (p:20, non-welcome pages; `study_timer.js` lazy-loaded unless active session), Analytics tracker (p:30, `defer fetchpriority="low"`).
- **`wp_head` Injections:** Speculation Rules API (4 core URLs), hover/touch prefetcher (`#dent-instant-nav`), early logo swap (`#dent-instant-logo`), inline `window.DENT_MULTI_SPECIALTY_MODE` (`#dent-portal-config`), compact header CLS CSS (`#dent-compact-header-css`), inlined Astra `main.min.css`, Drive preconnect on subpages, emoji neutralization, self-hosted `fonts.css` (no external Google Fonts), Open Graph/Twitter cards (`/logos/og_share_preview.jpg`).
- **URL Rewrites & Cron:** `/quiz/<id>`, `/q/<id>`, `/?quiz=<id>`, `/?q=<id>` → `/المقررات-والاختبارات/?quiz_id=<id>`. Daily noon AST cron (`dent2025_daily_noon`) warms `backend/api_ai_exam.php?action=cron_sync`.

## 3. Page-by-Page Mapping Matrix
| WordPress Page | Slug | Shortcodes | Auto-Loaded Scripts |
|---|---|---|---|
| `landing page` (622) | `wolcome` | `[dent_component file="landing_page.html"]` | None |
| `الصفحة الرئيسية` (22) | *(front)* | `study_timer_banner_widget.html`, `gpa_calculator_elegant.txt`, `absence_calculator.html`, `admin_controls_main.html`, `weekly_meme.html` (opt: `calendar_tomorrow_alert.html`, `[dent_poll]`) | `study_timer.js`, `dent_pin_modal.js`, `dashboard.js`, footer `kinetic_grid.html` + `analytics_tracker.js` |
| `التقويم الدراسي` (942) | `التقويم-الدراسي` | `schedule_markup.html`, `schedule_script.js`, `admin_schedule_lock.html` | `dent_pin_modal.js`, footer study timer |
| `المقررات والاختبارات` (940) | `المقررات-والاختبارات` | `chapters_dynamic.html`, `quiz_app.html`, `admin_controls.html` | `dashboard.js`, `dent_pin_modal.js`, footer study timer |
| `الجدول الدراسي` (943) | `جدول-الدراسي` | `admin_classes_lock.html`, `<div id="dent-classes-target"></div>` | `dent_pin_modal.js`, `dashboard.js`, footer study timer |

## 4. Backend APIs & RBAC
- **Shared RBAC (`dent2025_rbac.php` + `dent2025_passwords.json`):** `dent2025_check_rbac_permission($pass, $permission, $specialty, $year, $semester)`. Contexts use `{specialty}_{year}_{semester}` (Pre-Med normalized to `year=1`). Permissions: `add_subject`, `delete_subject`, `edit_core_subject`, `edit_basic_subject`, `global_events`, `semester_events`, `global_announcements`, `semester_announcements`, `timetable`, `manage_passwords`. Lockout state in `dent2025_study_data/auth_rate_limits.json` (`flock`, 5 failures → 300s exponential backoff, IP via `CF-Connecting-IP`).
- **`dent2025_api.php`:** Bootstraps `wp-load.php`, uses `$wpdb->prepare()`, 12h transient cache (`dent2025_data_{spec}_{year}_{sem}`), manages `dent2025_classes.json`, study PIN sync (`dent2025_study_data/study_records.json`), portal settings (`portal_settings` / `save_portal_settings`), and primary GAS webhook (`https://script.google.com/macros/s/AKfycbyGOFQWRmkBmJJ9ItdpzhzY5CgbEPjjI6joodT0GT_Sq--f287fcomqUBqRw-MxaKie/exec`).
- **Standalone JSON APIs (no `wp-load.php`):**
  - `announcements_api.php` → `announcements_data/announcements_{spec}_{year}_{sem}.json`
  - `schedule_backend.php` → `schedule_events.json` + `schedule_events_{schedule_id}.json`
  - `history_api.php` → audit logs + MySQL snapshot restore (`subjects`, `subject_links`)
  - `analytics_api.php` → `POST ?action=track` (max 60m dwell), `GET ?action=range|report_range|report` → `analytics_data/sessions_YYYY-MM-DD.json` + `cloudflare_history.json`
  - `polls_api.php` → `get_active_poll`, `get_all_polls`, `vote`, `save_poll`, `delete_poll`, `set_poll_status` → `polls_data/polls.json`
- **Standalone PDO AI Exam (`backend/api_ai_exam.php`):** Uses `backend/db_connect.php`, `pdftotext`, Gemini API cache (`quizzes_data/`), shared RBAC.

## 5. Database Schema
- **`subjects`:** `id` (PK), `specialty` (`dentistry`|`medicine`|`pre-med`), `year` (1–6; 1 for pre-med), `semester` (`1`|`2`), `name`, `doctor`, `hours`, `marks`, `chapters_folder_id`, `materials_folder_id`, `created_at`.
- **`subject_links`:** `id` (PK), `subject_id` (FK → `subjects.id` CASCADE), `url` (1000), `title` (255), `type` (`youtube`|`drive`|`telegram`|`link`), `created_at`.

## 6. Frontend Key Engines & Client Storage
- **`dashboard.js` (~130 KB):** `API_BASE_URL = '/dent2025_api.php'`, native Google Drive Fast Files Engine (`dentFetchFolderFiles`, `window._dentInFlightFolderFetches`, fallback `window.dentIframeQueue`), Path Changer pill bar, `dentLoadPortalMode()`.
- **`study_timer.js` (~44 KB) & `study_timer_banner_widget.html` (~36 KB):** Singleton guard (`window.dentTimerScriptLoaded`), Arabic 12h clock + Gregorian/Hijri date pill, cross-tab `storage` sync (`isRestoringSession`), PIN sync.
- **`dent_pin_modal.js` (~35 KB):** Singleton (`window.DentPinModal`), `window.dentPromptPin({ title, subtitle, context, onSuccess })`, audio (`dent_click.mp3`) + haptic feedback.
- **`schedule_script.js` (~156 KB):** `schedule_id = ${specialty}_y${year}_s${semester}` (fallback `dentistry_y3_s1`), direct 860px 2x A4 canvas PDF/PNG export + Web Share API, BiDi Arabic/English shaping, UmAlQura Hijri labels.
- **`localStorage` keys:** `dent2025_selection`, `dent2025_selected_group`, `dent2025_gpa_{spec}_y{year}_s{semester}`, `dent2025_simple_gpa`, `dent2025_timer_pin`, `dent2025_timer_logs`, `dent2025_timer_active_session`, `dent2025_timer_badge_pos`.
- **`sessionStorage` keys:** `dent2025_admin_pass`, `dent2025_schedule_admin_pass`, `dent2025_dashboard_data_{spec}_{year}_{sem}`, `dent2025_schedule_{scheduleId}`, `dent2025_redirect_after`, `dent2025_permissions`, `dent2025_multi_specialty_mode`.

## 7. Hosting, Backups & Disaster Recovery
- **GitHub:** `git@github.com:3bdyna/dent2025.com.git` (`main`, key `~/.ssh/id_ed25519`).
- **VPS Stack:** Ubuntu 24.04 LTS, Nginx, PHP 8.3-FPM, MariaDB behind Cloudflare Tunnel (`FS_METHOD = 'direct'`, web root `/var/www/dent2025/` owned by `www-data:www-data`).
- **`safe-rm`:** Active on VPS (`/etc/safe-rm.conf` protects `/`, `/var/www`, `/var/www/dent2025`, `/etc`, `/home`).
- **Nightly VPS Backups (03:30 UTC / 06:30 AM AST):** `/usr/local/bin/dent2025_backup.sh` creates `db_wordpress_*.sql.gz` + `data_*.tar.gz` in `/var/backups/dent2025_daily/` (14d retention), uploads to Google Drive (`My Drive > dent2025 backups/website server backups/`, 15d retention via `gas_content_backup_engine`), and updates `history_data/backup_status.json`.
- **Local PC Mirror (`server_backups_dent2025_daily/`):** Windows Task Scheduler `Dent2025 Daily Backup Sync` runs `pythonw.exe tools/sync_server_backups.py` daily at 07:00 AM AST (14d rolling).
- **Azure Disk Snapshot:** Resource Group `BB-BOT-PL-RG` (`snapshot-baseline-safe-rm-20260921`).
- **Restore from Local Backup:** Extract `tar -xzf data_<TS>.tar.gz`; restore DB via `zcat db_wordpress_<TS>.sql.gz | ssh <user>@<host> "sudo mysql wordpress"`.
