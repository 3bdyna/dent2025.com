# AGENTS.md — Dent2025 Academic Portal

Medical & Dental academic portal (**Pre-Med Y1**, **Medicine Y2–6**, **Dentistry Y2–6**) running WordPress + standalone PHP APIs on Azure Ubuntu (`Nginx + PHP 8.3-FPM + MariaDB` behind Cloudflare Tunnel). Local source files sync to `/var/www/dent2025/` via Git-integrated SafeDeploy (`tools/deploy_safe.py`) and load dynamically via `dent2025-loader.php` shortcodes (`[dent_component file="..."]`, `[dent_poll]`).

> **Reference Docs (read on demand only):**
> - Full directory tree, loader injections, API endpoints, DB schema, client storage, & backup/DR runbook → `docs/ARCHITECTURE.md`
> - Complete `--dent-*` CSS token registry → `docs/DESIGN_TOKENS.md`

---

## 1. Deployment & Cloud Data (MANDATORY)
- Every live update **MUST** go through `python tools/deploy_safe.py --note "<msg>" <files...>` (never raw SSH/SCP overwrites).
- Live Azure is Source of Truth for `schedule_events*.json`, `announcements_data/*.json`, and `dent2025_classes.json` — pull first (`sync_cloud_events.py --pull`) before editing.
- **Full deploy/rollback/sync/cache-purge/weekly-meme runbook:** Load the on-demand `safedeploy-and-sync` skill (`.agents/skills/safedeploy-and-sync/SKILL.md`).
- **Smart testing:** SafeDeploy Stage 1 runs `php -l` / `node --check` on touched files (enough for quick UI edits); run `php tools/test_system_logic.php` before major backend/RBAC/loader changes.

---

## 3. Strictly Forbidden Commands & Secrets
- **Never run:** `rm -rf <dir>`, `Remove-Item -Recurse -Force <dir>`, `del /f /s /q` on non-scratch dirs, `git clean -fdx`, `git reset --hard` (unless user gives an explicit rollback hash), `git push --force` / `--force-with-lease` to `main`, raw SSH bulk `rm`, or raw SQL `DROP`/`TRUNCATE`.
- **Never commit secrets or runtime state:** `deploy_config.json`, `dent2025_passwords.json`, `passwords.txt`, `wp-config.php`, `backend/gemini_keys_data/`, `docs/google_apps_scripts/`, `*_data/`, `server_backups_dent2025_daily/`.

---

## 4. Critical Architecture Invariants (DO NOT BREAK)
- **Critical WordPress Page Slugs (NEVER change slugs or titles in WordPress):**
  - Page `622` → `wolcome` (`landing page` — `dashboard.js` redirect target)
  - Page `22` → static front (`الصفحة الرئيسية`)
  - Page `940` → `المقررات-والاختبارات` (Courses & Quizzes)
  - Page `942` → `التقويم-الدراسي` (Schedule timeline)
  - Page `943` → `جدول-الدراسي` (Weekly timetable)
- **Shared RBAC Auth (`dent2025_rbac.php` + `dent2025_passwords.json`):** ALL backends (`dent2025_api.php`, `announcements_api.php`, `schedule_backend.php`, `history_api.php`, `polls_api.php`, `backend/api_ai_exam.php`) share this RBAC engine + Cloudflare-aware IP brute-force lockout (`CF-Connecting-IP`, 5-fail lockout). Always use `window.dentPromptPin()` (`dent_pin_modal.js`) instead of browser `prompt()`.
- **Multi-Specialty Switch (`DENT_MULTI_SPECIALTY_MODE`):** Persisted in WordPress options via `dent2025_api.php` (`?action=portal_settings` / `?action=save_portal_settings`). **Never** edit `dashboard.js` to toggle modes—use the Admin Dashboard UI or API.
- **Storage Prefix:** All `localStorage`/`sessionStorage` keys must use the `dent2025_` prefix (root key: `dent2025_selection`).

---

## 5. Strict UI & Design System Rules
- **Muted dark mode only:** Deep dark surfaces (`#121212` page, `#1e1e1e` cards, `#27272a` zinc accents). Strictly **NO** loud saturated colors, neon accents, or flashy gradients.
- **Minimal emojis:** Use clean SVG vector icons; no decorative UI emojis (except functional triggers like `🔒`).
- **Squarish borders only (NO pill/capsule shapes):** Strictly **FORBIDDEN** to use `border-radius: 999px` or `20px+` on badges, tags, tabs, or chips. Always use `border-radius: 8px` to `10px`.
- **RTL first & self-hosted fonts:** `'Outfit'`, `'Noto Kufi Arabic'`, `sans-serif` via `fonts/fonts.css` (never re-add external Google Fonts links).
- **Mandatory Design Tokens:** Consume `var(--dent-*)` tokens from `frontend-html box in wordpress astra/fonts/fonts.css` (full token list in `docs/DESIGN_TOKENS.md`) instead of hardcoding hex/rgba colors.
