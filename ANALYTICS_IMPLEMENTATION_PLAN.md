# Dent2025 — Analytics System Implementation Plan

> **Goal**: First-party, file-based analytics for the Dent2025 portal covering engagement, study behavior, funnel, retention, and identity hygiene — WITHOUT depending on the optional study PIN.
>
> **Identity model**: Anonymous device ID (`localStorage` + 1-year cookie) + soft fingerprint (FP) merging. No login, no PII.
>
> **Admin superpower**: Toggle visibility of **new / unknown / incognito** users from trends, or render them as a **separate series** instead of merged totals.

---

## 1. Data Points Covered (maps to requested "numbers")

| # | Metric | Source |
|---|---|---|
| 1 | Specialty × Year × Semester heatmap (which context gets the most use) | ctx on every event |
| 4 | Real study time: total hours, avg session, 24h pattern, weekly pattern, monthly trend | timer events |
| 6 | Deep funnel: visit → context select → open subject → open material → pass quiz | typed events |
| 7 | Retention/streaks/cohorts: D1/D7 return, weekly cohorts, streak days | `profiles.json` + daily-active sets |
| 8 | Return engagement: "dead clicks" (% of visits opening ZERO subjects), abandon rate | session event counts |
| 9 | Hourly/daily/weekly/monthly patterns (not just hours) | rollups |

Security: identity filter applies to **all** of the above (`include_established`, `include_new`, `include_anon`, or "show anonymous separately").

---

## 2. Architecture & New Files

### Identity classifications (assigned at write time)
- **`established`**: has anon_id + fingerprint is consistent + profile age ≥ `established_days` AND sessions ≥ 2.
- **`new`**: has anon_id but profile is young (below thresholds).
- **`anon`** (unknown / incognito / cookie-blocked): **no anon_id** — only a fingerprint / session id exists. This bucket is what the admin can hide or isolate.

### Event shape (one JSON object per event)
```json
{
  "ts": 1780000000000,
  "id": "3f9c…a2",            // anon device id, or null
  "sid": "…",                  // session id (per tab)
  "fp": "a1b2c3",              // soft fingerprint hash
  "ident": "established|new|anon",
  "type": "page_view|context_select|subject_open|materials_open|quiz_start|quiz_finish|timer_start|timer_pause|timer_finish|schedule_view|visit",
  "ctx": {"specialty":"dentistry","year":2,"semester":1},
  "subject": "Anatomy",         // optional
  "value": 1500,                // optional (e.g. timer seconds, quiz score %)
  "path": "/المقررات-والاختبارات"
}
```

### Storage layout — new `dent2025_analytics_data/` (auto-created at runtime)
```
dent2025_analytics_data/
├── config.json                 # retention, thresholds, rate-limits, merge rules, filter defaults
├── profiles.json               # { anon_id: {first_seen,last_seen,sessions,days_active,fps[],id_history[],merged_id?} }
├── ghost.json                  # fp → coalescing map for anon-only users (incognito merge)
├── raw/raw_YYYY-MM-DD.json     # daily raw event shards (retention: 30 days)
├── dau/dau_YYYY-MM-DD.json     # distinct {ids, fps} per day (for retention/cohorts; retention: 365 days)
├── rollups/
│   ├── hourly_YYYY-MM.json     # per-hour aggregates (retention: 31 days)
│   ├── daily.json              # per-day aggregates (retention: 365 days)
│   ├── weekly.json             # per-week aggregates (retention: 90 weeks)
│   └── monthly.json            # per-month aggregates (retention: permanent)
└── snapshots/                  # pre-write backups (analogous to announcements_backup.json)
```

### Rollup bucket contents (per time slice)
```json
{
  "2026-08-09": {
    "totals": {"all": 950, "established": 400, "new": 150, "anon": 400},
    "events": {"page_view": 300, "subject_open": 120, "timer_finish": 45},
    "ctx": {"dentistry_1_1": {"all": 200, "anon": 60}, "medicine_3_1": {…}},
    "subjects": {"Anatomy": {"opens": 80, "materials": 30, "quizzes": 12, "timer_s": 5400}},
    "timer": {"sessions": 45, "seconds": 54000},
    "quiz": {"attempts": 80, "passed": 40, "wrong_answers": 12},
    "funnel": {"visit": 200, "context_select": 150, "subject_open": 100, "materials_open": 70, "quiz_finish": 30}
  }
}
```

**Key design decisions**
- **Rollup-on-read**: `track` only appends to raw (fast, lock-free enough with `LOCK_EX`). Admin queries fold missing raw → aggregate incrementally using a stored cursor (`config.json → last_rolled_up_ts`). Keeps track-time cheap.
- **Identity is stored at write time** (`ident` field). Changing `new_window_days` affects future events only. A `action=reclassify` admin endpoint (stretch) re-folds raw with new settings.
- **Anonymous merge (ghost)**: events with no `anon_id` coalesce under a `ghost_<fp>` key. Conservative rules to avoid false merges — see §4.
- **ID/fingerprint auto-merge**: if a browser returns with a *new* anon_id but a matching FP previously seen on an *old* anon_id with recent last_seen (< `merge_window_days`) and no active conflicting session → old profile absorbs the new id (`id_history` + `merged_id`). Admin toggle `allow_fp_merge` (default ON).

---

## 3. API — `analytics_api.php` (new root-level file, deployed to web root)

Follows `schedule_backend.php` skeleton: standalone PHP, no `wp-load`, `require dent2025_rbac.php`, `LSCACHE_NO_CACHE`, JSON headers.

### Public endpoints (no auth, throttled)
- `POST ?action=track` — body = `{id, sid, fp, ident?, events:[…]}` (batched ≤ 50). Validates: user-agent presence, type whitelist, string lengths, ctx values (`specialty ∈ {dentistry, medicine, pre-med}`, `year 0–6`, `semester 1|2`), `value` as number. Rate-limit: per-IP simple counter (e.g. 120 events/min → 429). Appends to today's raw shard. Returns `{success:true}`.
- `GET ?action=health` — returns data dir size, latest event ts, raw file count (no sensitive data).

### Admin endpoints (RBAC: `manage_passwords` master only)
All accept `password=…` and **identity filter params**:
- `incl_est=1|0` (default 1)
- `incl_new=1|0` (default 1)
- `incl_anon=1|0` (default 1)
- `anon_separate=1|0` (default 0) → anonymous rendered as its own series
- Date range `from`/`to`, `period=hour|day|week|month` (for trends)

1. `action=overview` — cards: visits today, active (est/new/anon) 24h/7d/30d, total study hours, quiz attempts, anon %. Filter-aware.
2. `action=trend` — time-series from hourly→daily→weekly→monthly rollups. Returns series `{all:[…], established:[…], new:[…], anon:[…]}` so the frontend can draw merged OR separate lines.
3. `action=ctx_heatmap` — specialty×year×sem grid. Filter-aware.
4. `action=subjects` — per-subject: opens, material clicks, quiz attempts, study seconds, **abandon rate** (opened subject but opened 0 materials in that session).
5. `action=timer_patterns` — 24h curve, weekday (interactive map) curve, monthly trend, avg session len, total hours.
6. `action=funnel` — 5 steps + drop-off %. Filter-aware.
7. `action=retention` — D1/D7 return %, streak distribution (max consecutive days), weekly cohort table (cohort = profiles with `first_seen` in that week; % still active each subsequent week).
8. `action=identity` — established/new/anon breakdown + %; merge counts; estimated anonymous devices from `ghost.json`.
9. `action=raw` — paginated raw events (admin only, default newest 200).
10. `action=config` GET (admin) / POST (admin key-only changes) — retention, thresholds, rate limits, merge rules, default filter state.
11. `action=rollup_now` — force incremental rollup (used by admins after long downtime).

All admin endpoints use `dent2025_check_rbac_permission($password, 'manage_passwords')` (master-only, per RBAC master override). Audit via `dent2025_record_audit_event` where `history_helpers.php` is present.

---

## 4. Tracker — `analytics_tracker.js` (new frontend component → `frontend_components/`)

Small (~3–4 KB), fully non-blocking, defensive (never throws / never blocks UI).

- **Singleton guard**: `if (window.dentAnalyticsLoaded) return; … true;`
- **Init**:
  - `dent2025_anon_id` — read or create UUID (localStorage **and** 1-year cookie, same value). Cookie keeps identity even if localStorage is cleared.
  - `dent2025_sid` — per-tab session id (sessionStorage).
  - `dent2025_fp` — stable hash of `(screen.width, screen.height, colorDepth, timezoneOffset, language, platform, hardwareConcurrency, deviceMemory, UA "brand/version" trimmed)`. Stable for the device/week, not machine-identifying.
- **Auto context**: reads `dent2025_selection` from localStorage; if present, attaches `ctx` to every queued event.
- **Auto page_view**: fires on DOMContentLoaded with `path`.
- **Beacon lifecycle**:
  - In-memory queue; flush every 30s **or** when queue ≥ 25 **or** on `visibilitychange→hidden`, `pagehide`, `beforeunload` (via `navigator.sendBeacon`), fallback `fetch(...,{keepalive:true})`.
  - **Offline buffer**: if `navigator.onLine` is false or a flush fails, persist queue to `localStorage['dent2025_analytics_buffer']` (cap ~500 events) and flush on `online` event + next tick.
- **Public API**: `window.dentAnalytics = { track(type, {subject, value, ctx, path}) }`.

### Instrumentation points (existing files — minimal, additive edits only)
| File | Events |
|---|---|
| `dashboard.js` | `context_select` (on selection validate/restore, line ~88), `subject_open` (subject card click), `materials_open` (subject-links / Drive embed click) |
| `quiz_app.html` | `quiz_start`, `quiz_finish` (value = % score, meta: attempts/wrong/pass), `quiz_wrong` (bucketed, max 1 per 5s to avoid noise) |
| `study_timer_banner_widget.html` | `timer_start`, `timer_pause`, `timer_finish` (value = seconds, subject), `timer_reset` |
| `schedule_script.js` | `schedule_view` (on timeline render) |
| `landing_page.html` | none directly — `context_select` fires from `dashboard.js` on next page when selection restores (funnel step still counts) |

---

## 5. Loader Integration (`dent2025-loader.php` — edit)

Add `analytics_tracker.js` to the existing `wp_footer` hook (all pages, INCLUDING `wolcome`, unlike the timer) so tracking works even on the selection page. Insert alongside the timer block.

---

## 6. Admin Analytics Dashboard

New standalone page (mirrors existing `admin_dashboard.html` pattern):
- `analytics_dashboard.html` — root-level, deployed to web root; links from `admin_dashboard.html`.
- `analytics_dashboard.js` — root-level, deployed to web root.

**Auth**: passkey prompt → verified against `analytics_api.php?action=overview` (master passkey). Session held in `sessionStorage['dent2025_analytics_admin']`.

**UI (RTL, dark, `#121212/#1e1e1e/#27272a`, `#60a5fa` accent, SVG icons, NO emojis, glassmorphism)**:

1. **Identity filter bar** (top, persistent, saved to `localStorage['dent2025_analytics_filters']`):
   - Toggle chips: **الكل (all)** / **مُعرّف (established)** / **جديد (new)** / **مجهول (anonymous/incognito)**.
   - Checkbox: **عرض المجهولين كسلسلة منفصلة** (anonymous as dashed secondary series).
   - Checkbox: **إخفاء الجديد** (hide new users entirely).
   - Selector: **نافذة المستخدم الجديد** (7/14/30 days) → sent per-request (affects thresholds; stored-ident is authoritative).
2. **Overview cards** — visits today, active 24h/7d, study hours, quiz attempts, anon share.
3. **Context heatmap** — specialty rows × year×sem columns.
4. **Trends** — period toggle (hourly/daily/weekly/monthly); lines/all + stacked identity areas; anonymous as separate dashed line when toggle on.
5. **Timer patterns** — 24h curve, weekday curve, monthly bars.
6. **Funnel** — 5-step horizontal bars with drop-off %.
7. **Subjects** — ranking table + abandon bars.
8. **Retention** — D1/D7 cards, streak histogram, weekly cohort table.
9. **Identity panel** — est/new/anon counts, ghost/merge stats, "reveal raw anonymous" toggle.
10. **Raw events table** — paginated, filter by type/ctx/ident.

Charts: hand-rolled `<canvas>` / CSS bars (matches existing self-contained approach, zero dependencies).

---

## 7. Build Order (execution contract)

| Phase | Deliverable | Files changed/created | Acceptance |
|---|---|---|---|
| **P1** | Backend | `analytics_api.php` (new), `analytics_config.json` seed via code | `track` appends raw; admin actions return valid JSON with ident filter params; rollups fold correctly |
| **P2** | Tracker | `analytics_tracker.js` (new), loader footer edit | Sitewide singleton; beacon flushes; offline buffer works; anon id + cookie set on first visit |
| **P3** | Instrumentation | `dashboard.js`, `quiz_app.html`, `study_timer_banner_widget.html`, `schedule_script.js` | Events in raw when actions performed; no console errors; no regressions in portals |
| **P4** | Admin dashboard | `analytics_dashboard.html` (new), `analytics_dashboard.js` (new) | All 10 views render; identity filters + separate-anon toggle work on every view |
| **P5** | Deploy + config | via SafeDeploy | Data flows; purge; health check; QA checklist passes |

### Deployment (mandatory per AGENTS.md, EVERY deploy)
1. `python tools/deploy_safe.py --note "<desc>" <files…>`
2. Cache purge: `Invoke-WebRequest -Uri "https://dent2025.com/purge_cache.php" -UseBasicParsing`

Deploy batches: P1 (`analytics_api.php`), P2 (`analytics_tracker.js`, `dent2025-loader.php`), P3 (4 frontend files), P4 (2 root files). Snapshot retention = 12, auto-pruned.

### QA checklist (final)
- [ ] First visit sets `dent2025_anon_id` + cookie; second visit reuses it
- [ ] Incognito window: events tagged `anon`, no id, `ghost_<fp>` coalescing
- [ ] `action=track` rate-limits + validates bad input
- [ ] Rollups correct for a 24h old shard (cross-check `action=raw` vs `action=overview`)
- [ ] Admin: hide `anon` → all totals drop by anon share; `anon_separate=1` → dashed line appears
- [ ] Funnel shows drop-off; cohort table computes D1/D7
- [ ] No console errors on all 5 WordPress pages + admin dashboard
- [ ] Offline timer session still reports (buffer flush on reconnect)

---

## 8. Risks / Notes
- **Static classification**: `ident` stored at write time; new-window setting is forward-looking. Mitigation: `reclassify` endpoint (stretch).
- **File growth**: raw auto-pruned at retention; incremental rollup prevents bloat. Health endpoint exposes sizes.
- **False anon**: ad-block/privacy browsers may block the cookie; FP still groups them. Uniqueness numbers for `anon` are estimates ("estimated unique devices").
- **Concurrency**: `LOCK_EX` on all writes (matches RBAC pattern); rollups run only on read to avoid track-time race storms.
- **No PIN dependency**: PIN (if a student opts in later) can be attached to an existing profile as an alias — pure additive, never a requirement.