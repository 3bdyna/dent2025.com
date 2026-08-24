# Dent2025 — Medical & Dental Academic Portal

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-WordPress%20%7C%20PHP%20%7C%20Vanilla%20JS-success)](#)
[![Deployment](https://img.shields.io/badge/Deploy-Fast%20FTP%20%2B%20Git%20SafeDeploy-orange)](#)

**Dent2025** is a specialized, high-performance academic web platform designed for university dental and medical students. It centralizes course materials, dynamic schedules, GPA calculations, Google Drive folder embeds, interactive study timers, and role-based administration tools.

---

## 🌟 Key Features

- **Academic Tracks & Context Routing**: Full curriculum organization for **Pre-Med** (Year 1) and **Medicine & Dentistry** (Years 2–6, Semesters 1 & 2).
- **Dynamic Component Loader (`dent2025-loader.php`)**: Modular frontend component loading into WordPress pages with automatic cache-busting and `wpautop` protection.
- **Interactive Academic Schedule & Timetables**: Visual Gregorian/Hijri timeline, exam countdown cards, and interactive class timetable engines.
- **Student Study Timer & Tracker**: Sitewide draggable floating study timer with offline persistence and PIN-based cloud sync.
- **Interactive Quiz Generator**: Custom interactive quiz engine with multi-format test generation.
- **Granular RBAC Administration**: Multi-tier authentication supporting universal master admins and context-scoped class student leaders.
- **SafeDeploy Pipeline**: Automated deployment toolchain featuring syntax guards, Git version control, 1-second FTP live sync, and post-flight health probes.

---

## 🏗️ Architecture Overview

```
dent2025/
├── dent2025-loader.php                         # WordPress dynamic component loader plugin
├── dent2025_api.php                            # Primary WordPress-integrated backend API
├── dent2025_rbac.php                           # Shared RBAC permission engine
├── backend/                                    # Standalone PDO backend services
│   ├── api_data.php                            # Public subject & link data retrieval API
│   ├── api_manage.php                          # Administrative management API
│   ├── api_ai_exam.php                         # AI exam generation backend
│   └── db_connect.php                          # Safe dynamic PDO MySQL connection
├── frontend-html box in wordpress astra/       # Local frontend components & scripts
│   ├── landing_page.html                       # Year & specialty selection grid
│   ├── chapters_dynamic.html                   # Subject chapters & Google Drive embed container
│   ├── quiz_app.html                           # Interactive quiz application
│   ├── study_timer_banner_widget.html          # Study timer & tracker widget
│   ├── dashboard.js                            # Core student dashboard engine
│   └── schedule_script.js                      # Academic calendar engine
└── tools/                                      # Deployment and automation toolchain
    ├── deploy_safe.py                          # Full Git-integrated SafeDeploy pipeline CLI
    ├── deploy_guard.py                         # Pre-flight syntax and security validation
    ├── deploy_order.py                         # Priority ordering for deployments
    └── deploy_health.py                        # Live endpoint health probes
```

---

## 🚀 Getting Started & Local Setup

### 1. Requirements
- **PHP 8.0+** with `pdo_mysql`, `curl`, and `json` extensions.
- **WordPress 6.0+** (if using WordPress loader integration).
- **Python 3.9+** (for deployment and build tools).

### 2. Configuration
Copy the example configuration files and configure your credentials:

```bash
cp deploy_config.example.json deploy_config.json
cp dent2025_passwords.example.json dent2025_passwords.json
```

- In `deploy_config.json`, configure your FTP host, user credentials, and remote web root.
- In `dent2025_passwords.json`, define your master and leader passkeys and permission scopes.

### 3. Deploying Changes
Use the automated SafeDeploy pipeline to deploy changes to your live server:

```bash
# Validate, commit, push to GitHub, upload to FTP, and purge cache in one step:
python tools/deploy_safe.py --note "Your update description" path/to/file.ext

# Instant rollback to previous clean state:
python tools/deploy_safe.py --rollback
```

---

## 🛡️ Security & Privacy

- All sensitive files (`deploy_config.json`, `dent2025_passwords.json`, `.env`, API keys) and runtime dynamic databases are strictly excluded from version control via `.gitignore`.
- Role-Based Access Control (RBAC) verifies permissions on every modification request.
- All database queries use prepared statements (`$wpdb->prepare()` / PDO prepared statements) to prevent SQL injection.

---

## 📄 License

This project is licensed under the **MIT License** - see the [LICENSE](LICENSE) file for details.
