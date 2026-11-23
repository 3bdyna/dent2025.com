<div align="center">

# Dent2025 — Medical & Dental Academic Portal

**A high-performance academic hub for university Pre-Med, Medicine, and Dentistry students — combining AI practice exams, Hijri/Gregorian schedules, study tools, and live dual-mode portal switching.**

[![Live Portal](https://img.shields.io/badge/Live%20Portal-dent2025.com-111827?style=flat-square&logo=googlechrome&logoColor=white)](https://dent2025.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-2563eb?style=flat-square)](LICENSE)
[![Stack](https://img.shields.io/badge/Stack-WordPress%20%7C%20PHP%208.2%20%7C%20Vanilla%20ES6%2B-16a34a?style=flat-square)](#tech-stack)
[![Tests](https://img.shields.io/badge/Tests-100%2F100%20Passing-22c55e?style=flat-square)](#engineering-highlights)

</div>

---

## Dual Portal Display Modes

Dent2025 includes a **live Master Mode Switch** that toggles the entire portal between a single focused batch and a full campus-wide academic hub — instantly from the Admin Dashboard with zero downtime.

| | Focused Cohort Mode | Full Multi-Specialty Mode |
| :--- | :--- | :--- |
| **What It Shows** | **Dentistry — Year 3, Semester 1 only** | **All 3 Specialties, All Years & Both Semesters** |
| **Tracks Available** | Locked to Dentistry Y3 S1 | **Pre-Med** (Y1) · **Medicine** (Y2–Y6) · **Dentistry** (Y2–Y6) |
| **Student Flow** | Direct entry straight to dashboard | Interactive track selector (`/wolcome/`) saved in `localStorage` |
| **Branding** | Dentistry identity by default | Instant pre-paint logo swap per selected specialty |

---

## Key Features

- **Course Hub & Google Drive Integration** — Organized chapter views, embedded Drive folders, and cohort-specific announcements.
- **Interactive Hijri & Gregorian Schedule** — Filterable timeline for exams, assignments, and practicals, a next-day *Tomorrow Alert* banner, class timetables, and printable multi-page **A4 PDF exports**.
- **AI Practice Exams & Quiz Player** — Generates practice questions from lecture PDFs via Google Gemini, with list & focused study modes, clean short share links (`/quiz/<id>`), and A4 booklet export.
- **Student Toolkit** — Sitewide floating **Study Timer** with session history, **Saudi 5.0 GPA Calculator**, **Absence & Denial Calculator** (25% threshold tracker), inline **Student Polls**, and an interactive kinetic grid backdrop.
- **Role-Based Admin Suite** — Standalone dashboard for Master admins and cohort leaders with a touch-friendly 4-digit PIN keypad, first-party visitor analytics, and live backup telemetry.

---

## Engineering Highlights

- **Dynamic Component Loader (`dent2025-loader.php`)** — Mounts modular frontend components via WordPress shortcodes with automatic timestamp cache-busting (`?v={filemtime}`).
- **Mobile Core Web Vitals Focus** — Server-side pre-rendered Tomorrow Alert (zero mobile CLS), Speculation Rules prerendering, inlined base CSS, self-hosted WOFF2 fonts (*Outfit* & *Noto Kufi Arabic*), 2× retina navbar logos, and lazy-loaded widgets.
- **Automated SafeDeploy & Verification** — Git-backed deployment pipeline with pre-flight PHP/JS/JSON syntax checks, cloud-first dynamic data merge, post-deploy health probes, and a **100/100** offline subsystem test suite.

---

## Tech Stack

`WordPress` · `PHP 8.2` · `MySQL` · `Vanilla ES6+` · `Google Gemini API` · `Azure VPS` · `Cloudflare` · `Python SafeDeploy`

---

## License

Open-source under the [MIT License](LICENSE).
