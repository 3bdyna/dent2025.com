# MASTER PROMPT — Build "Blackboard Auto-Sync Bot (Local Edition)" From Scratch

Copy everything below this line and give it to the new AI agent.

---

## ROLE & MISSION

You are an expert Python automation engineer. Build me a complete, production-ready Windows desktop program called **"Dent2025 Blackboard Auto-Sync Bot (Local Edition)"** from zero.

**What it does:** Runs 24/7 on my local Windows PC, monitors my university's **Jazan University Blackboard Ultra** LMS for newly uploaded lecture/lab files across 9 dentistry subjects, downloads them, classifies them with **Google Gemini AI**, shows each new file to me as an interactive review card in the **console**, and uploads approved files directly into the correct subject's **Google Drive folders** via a Google Apps Script webhook.

**HARD CONSTRAINTS:**
- 100% LOCAL — runs only on my Windows PC. **NO Azure VM, NO SSH, NO systemd, NO Telegram bot, NO cloud deployment, NO paramiko/scp.**
- Language: Python 3.11+. Browser automation: Playwright (sync API).
- Windows-first: UTF-8 console output (`sys.stdout.reconfigure(encoding="utf-8")`), double-click `.bat` launchers.
- Simple architecture: ~6 small modules + config + launchers. No frameworks, no Docker.
- Include unit tests for pure logic (filename sanitization, hash dedup, subject resolution, state DB).

---

## TARGET CONTEXT

- University LMS: **Jazan University Blackboard Ultra** → `https://lms.jazanu.edu.sa`
- Academic context: **Dentistry, Year 3, Semester 1** (context id `dentistry_3_1`)
- 9 subjects. On Blackboard most courses have TWO containers: Theory section (`_01_`) and Practical/Lab section (`_02_`). Both map to ONE unified portal subject; practical files get a `[Practical]` prefix in their filename.

---

## CREDENTIALS & ENDPOINTS (put in `config/.env`)

```ini
# config/.env  (never commit; provide config/.env.example with empty values)
BB_USERNAME="<YOUR_STUDENT_EMAIL>"
BB_PASSWORD="<MY_PASSWORD_HERE>"
GEMINI_API_KEY="<GEMINI_API_KEY>"          # optional; if empty use heuristic fallback classifier
GAS_WEBHOOK_URL="https://script.google.com/macros/s/AKfycbx2SURHTFLUlLMXj1bgBJW5-SRoDX7q2ukHfdaqry8SzNtVHbvxYAwYeWGzcjQLmj_X/exec"
DEFAULT_INTERVAL_SECONDS=900               # 15 minutes
AUTO_SYNC_ENABLED=true
```

### Google Apps Script upload webhook (the ONLY way files reach Drive)
- Endpoint: the `GAS_WEBHOOK_URL` above (it follows 302 redirects; use `urllib.request` with JSON POST).
- Request body (JSON):
```json
{
  "action": "upload_file",
  "folderId": "<target_drive_folder_id>",
  "filename": "<standardized_filename.pdf>",
  "fileContent": "<base64_of_file_bytes>",
  "mimeType": "application/pdf"
}
```
- Response: JSON like `{"success": true, "fileId": "...", "fileUrl": "..."}` or `{"success": false, "message": "..."}`.
- **Hard cap: 45 MB per file** (GAS rejects big payloads). Reject larger files early with a clear message instead of exhausting memory.
- MIME map needed: pdf/pptx/ppt/docx/doc/zip/png/jpg/jpeg; fallback `application/octet-stream`.

### Key Blackboard URLs
- Login page: `https://lms.jazanu.edu.sa/?new_loc=%2Fultra%2Finstitution-page`
- Activity Stream: `https://lms.jazanu.edu.sa/ultra/stream`
- Course outline: `https://lms.jazanu.edu.sa/ultra/courses/{course_id}/outline`
- Login form selectors: `#user_id`, `#password`, `#entry-login`; 2FA screen: `#totp-verification-input` or `input[name='secondaryAuthToken']`, submit via `#totp-submit-button`.

---

## SUBJECT MAPPING - copy this file EXACTLY to `config/subjects_mapping.json`

The JSON below is the authoritative, verified mapping (9 subjects -> Blackboard course containers + Google Drive folder IDs). Copy it byte-for-byte; do NOT retype, reformat, or "fix" any ID:

```json
{
  "context": "dentistry_3_1",
  "specialty": "dentistry",
  "year": 3,
  "semester": 1,
  "subjects": [
    {
      "id": 173,
      "name_en": "Oral and Maxillofacial Radiology",
      "name_ar": "أشعة الفم والوجه والفكين",
      "chapters_folder_id": "1indj-bso-Lr-2RJSDsKF6Z-eHiIq24qw",
      "materials_folder_id": "1K5Mc9DxwbfIWO3tSAPiB0dZ9bMpLggB2",
      "blackboard_sections": [
        {
          "type": "theory",
          "course_id": "_288167_1",
          "course_code": "DIG311_57_01_13_20271",
          "keywords": ["أشعة الفم", "DIG311", "Radiology", "Maxillofacial"]
        },
        {
          "type": "practical",
          "course_id": "_288168_1",
          "course_code": "DIG311_57_02_14_20271",
          "keywords": ["أشعة الفم", "DIG311", "Radiology", "Maxillofacial"]
        }
      ]
    },
    {
      "id": 174,
      "name_en": "Oral Diagnosis",
      "name_ar": "تشخيص الفم",
      "chapters_folder_id": "1gEowIsnIvvHaSEPX2sd9dYt13zxz5XS8",
      "materials_folder_id": "1j9x--uJYk1GnBuxVJ6p4te-pu5yzQjOY",
      "blackboard_sections": [
        {
          "type": "theory",
          "course_id": "_288171_1",
          "course_code": "DIG313-2_57_01_30_20271",
          "keywords": ["تشخيص الفم", "DIG313", "Diagnosis", "Oral Diagnosis"]
        },
        {
          "type": "practical",
          "course_id": "_288172_1",
          "course_code": "DIG313-2_57_02_31_20271",
          "keywords": ["تشخيص الفم", "DIG313", "Diagnosis", "Oral Diagnosis"]
        }
      ]
    },
    {
      "id": 175,
      "name_en": "Pre-clinical Restorative Dentistry",
      "name_ar": "إصلاح الأسنان ما قبل السريري",
      "chapters_folder_id": "13vl33Xp4M9o73agfSqpcTgVMYPa6jzeo",
      "materials_folder_id": "19Z7dOCUBzgTQvvEz0vqtcqePTgZ3mpis",
      "blackboard_sections": [
        {
          "type": "theory",
          "course_id": "_288175_1",
          "course_code": "OPT321_57_01_15_20271",
          "keywords": ["اصحاح الأسنان", "إصلاح الأسنان", "OPT321", "Restorative", "Operative"]
        },
        {
          "type": "practical",
          "course_id": "_288176_1",
          "course_code": "OPT321_57_02_16_20271",
          "keywords": ["اصحاح الأسنان", "إصلاح الأسنان", "OPT321", "Restorative", "Operative"]
        }
      ]
    },
    {
      "id": 176,
      "name_en": "Advanced Dental Biomaterials",
      "name_ar": "مواد طب الأسنان الحيوية المتقدمة",
      "chapters_folder_id": "1qYQsGSHkbO9bQss6Zl8pOxafQwGq71AZ",
      "materials_folder_id": "1JV83PZVegTO8kkaKKQd_fdw94cmfyc-8",
      "blackboard_sections": [
        {
          "type": "theory",
          "course_id": "_288181_1",
          "course_code": "PRO322_57_01_27_20271",
          "keywords": ["مواد طب الأسنان", "البيولوجية", "الحيوية", "PRO322", "Biomaterials", "Dental Biomaterials"]
        },
        {
          "type": "practical",
          "course_id": "_288182_1",
          "course_code": "PRO322_57_02_28_20271",
          "keywords": ["مواد طب الأسنان", "البيولوجية", "الحيوية", "PRO322", "Biomaterials", "Dental Biomaterials"]
        }
      ]
    },
    {
      "id": 177,
      "name_en": "Dental Public Health",
      "name_ar": "الصحة العامة للأسنان",
      "chapters_folder_id": "1SXUc3P8zHyEK7nmGDKsO-dgHx2JSTGof",
      "materials_folder_id": "1PvNnQksV9aqfcVemvzOx8e8B_VDnzKms",
      "blackboard_sections": [
        {
          "type": "theory",
          "course_id": "_288185_1",
          "course_code": "DPH331_57_01_29_20271",
          "keywords": ["الصحة العامة للأسنان", "DPH331", "Public Health", "Dental Public Health"]
        }
      ]
    },
    {
      "id": 178,
      "name_en": "Pre-clinical Prosthodontics",
      "name_ar": "الاستعاضة ما قبل السريرية",
      "chapters_folder_id": "1mFSU0pCsNOyZfzYb6IRBpAEeD5KFKBqk",
      "materials_folder_id": "1iADK6B-UOkvNtj3eWNr9mcHTrt_TAiBq",
      "blackboard_sections": [
        {
          "type": "theory",
          "course_id": "_288187_1",
          "course_code": "PRO341_57_01_18_20271",
          "keywords": ["الاستعاضة المتحركة", "الاستعاضة ما قبل السريرية", "PRO341", "Prosthodontics"]
        },
        {
          "type": "practical",
          "course_id": "_288188_1",
          "course_code": "PRO341_57_02_19_20271",
          "keywords": ["الاستعاضة المتحركة", "الاستعاضة ما قبل السريرية", "PRO341", "Prosthodontics"]
        }
      ]
    },
    {
      "id": 179,
      "name_en": "General Pathology",
      "name_ar": "علم الأمراض العام",
      "chapters_folder_id": "1f99eehH28R6yQVl0Owq1J-fHr7q6Gh6z",
      "materials_folder_id": "1bWpMK-QfpaBSnZ8qqrOqsH0u2g91uvH0",
      "blackboard_sections": [
        {
          "type": "theory",
          "course_id": "_288193_1",
          "course_code": "DMS351_57_01_22_20271",
          "keywords": ["علم الأمراض العام", "الأمراض العام", "DMS351", "Pathology", "General Pathology"]
        },
        {
          "type": "practical",
          "course_id": "_288194_1",
          "course_code": "DMS351_57_02_23_20271",
          "keywords": ["علم الأمراض العام", "الأمراض العام", "DMS351", "Pathology", "General Pathology"]
        }
      ]
    },
    {
      "id": 180,
      "name_en": "Oral Microbiology and Immunology",
      "name_ar": "علم الأحياء الدقيقة والمناعة الفموي",
      "chapters_folder_id": "1xU0r6nJ8paDgswsv_6GQdxElXKbOYGa6",
      "materials_folder_id": "1-ZoViZPd7MWaupbb4ph1kfRGK1GZDAlW",
      "blackboard_sections": [
        {
          "type": "theory",
          "course_id": "_288197_1",
          "course_code": "DMS352_57_01_24_20271",
          "keywords": ["الأحياء الدقيقة", "المناعة الفموي", "DMS352", "352 MED", "352MED", "Microbiology", "Immunology", "Oral Microbiology"]
        },
        {
          "type": "practical",
          "course_id": "_288198_1",
          "course_code": "DMS352_57_02_25_20271",
          "keywords": ["الأحياء الدقيقة", "المناعة الفموي", "DMS352", "352 MED", "352MED", "Microbiology", "Immunology", "Oral Microbiology"]
        }
      ]
    },
    {
      "id": 181,
      "name_en": "Pharmacology",
      "name_ar": "علم الأدوية",
      "chapters_folder_id": "1_prdhezOKDR6YS1orB3GhsaE7ED9dJeQ",
      "materials_folder_id": "1a6CyFQWh3UTIxuAERZymY35ZZ38FjJOA",
      "blackboard_sections": [
        {
          "type": "theory",
          "course_id": "_288203_1",
          "course_code": "DMS353_57_01_21_20271",
          "keywords": ["علم الأدوية", "الأدوية", "DMS353", "Pharmacology", "PHAR311", "PHAR 311"]
        }
      ]
    }
  ]
}
```

---

## REQUIRED FILE STRUCTURE

```
blackboard_bot_local/
├── Start Bot.bat                  # python src\main.py  (title + cd /d "%~dp0")
├── Scan Once.bat                  # python src\main.py --once
├── 1-Click Login.bat              # python login_local.py  (opens real Chrome for login+2FA)
├── Open Blackboard.bat            # opens https://lms.jazanu.edu.sa/ultra/institution-page in Chrome
├── Run Tests.bat                  # python -m unittest discover tests
├── login_local.py                 # visible-Chrome persistent login helper (see LOGIN FLOW)
├── README.md                      # setup + usage guide
├── config/
│   ├── .env                       # real credentials (gitignored)
│   ├── .env.example               # template with empty values
│   └── subjects_mapping.json      # exact mapping from above
├── src/
│   ├── main.py                    # controller: scheduler loop + console UI + review flow
│   ├── bb_harvester.py            # Playwright scraper + downloader
│   ├── ai_classifier.py           # Gemini classification + heuristic fallback
│   ├── gdrive_uploader.py         # GAS webhook uploader
│   └── state_manager.py           # SQLite dedup/history/pending reviews
├── state/
│   ├── bot_state.sqlite           # created automatically
│   └── chrome_profile/            # persistent Chrome profile for login_local.py
├── temp_downloads/                # sandbox for downloads/ZIP extraction (auto-cleaned)
│   └── pending_reviews/           # copies of files awaiting user decision
└── tests/
    ├── test_state_manager.py
    ├── test_ai_classifier.py
    ├── test_bb_harvester.py       # sanitization, session detection, safe zip extraction
    └── test_main_controller.py    # review approve/reject flows with mocked uploader
```

---

## MODULE SPECIFICATIONS

### 1) `state_manager.py` — SQLite persistence
Path: `state/bot_state.sqlite`. Two tables:

**`processed_items`** (dedup + audit log): `id PK`, `item_id TEXT UNIQUE`, `course_name`, `course_code`, `section_type`, `title`, `notification_text`, `file_name`, `file_hash` (MD5, indexed), `subject_id`, `category`, `destination_folder_id`, `drive_file_id`, `drive_view_url`, `status` (`uploaded|ignored|no_files|processed`), `reasoning`, `created_at`.
Methods: `record_processed_item()` (INSERT OR REPLACE), `is_stream_item_processed(base_item_id)` (true if item_id equals base OR starts with `base + "_"` AND status IN uploaded/ignored), `is_file_hash_processed(hash)` (status=uploaded only), `count_processed_items(status=None)`, `get_recent_uploads(limit)`.

**`pending_reviews`** (files awaiting my decision): `id PK`, `item_id`, `file_hash` (indexed), `local_filepath`, `file_size_bytes`, `course_name`, `section_type`, `title`, `notification_text`, `suggested_subject_id`, `current_subject_id`, `suggested_category`, `current_category`, `original_filename`, `suggested_filename`, `current_filename`, `ai_reasoning`, `status DEFAULT 'pending'` (`uploaded|rejected|error`), `destination_folder_id`, `drive_file_id`, `drive_view_url`, timestamps.
Methods: `create_pending_review()`, `get_pending_review(id)`, `get_all_pending_reviews()` (status=pending, ORDER BY id), `update_pending_review(id, dict)`, `mark_review_completed(id, status, drive_file_id="", drive_view_url="")`, `is_file_in_pending_review(hash)` (status=pending only).

Also: `calculate_file_hash(path)` → MD5 streamed in 64KB chunks.

### 2) `bb_harvester.py` — Playwright scraper + downloader
Session file: `storage_state.json` (project root).

**`is_session_authenticated(page)` (static):** returns False if URL contains `new_loc=`, `/webapps/login`, `auth-saml`, or is bare domain root; also False if `#user_id/#password/#entry-login` or SSO link text ('Login SSO', 'تسجيل الدخول الموحد') present in DOM; True only when path starts `/ultra/` or `/webapps/blackboard/`.

**`ensure_authenticated_session(force=False)`:**
1. If storage_state exists → open headless Chromium with it, goto stream URL, wait networkidle + 3s, check authenticated → done if OK.
2. Otherwise automated headless login: goto login URL → fill `#user_id`/`#password` → click `#entry-login` → wait 5s → screenshot `2fa_challenge.png` → if TOTP input visible → **ask me for the 6-digit code IN THE CONSOLE via `input()`** (optionally open the screenshot with `os.startfile`) → fill code → click submit → wait → verify landing → save `context.storage_state(path=...)`.
3. All failures print guidance: *"Run 1-Click Login.bat"*.

**Harvesting (`harvest_all_new_content()`):** two sources merged with a `seen_item_ids` set:
1. **Activity Stream** (`/ultra/stream`): abort heavy assets route `**/*.{png,jpg,...,woff2,mp4}`; expand grouped course entries (click `a[href*="courseContentGroupEntry"], .stream-group-header, [data-group-id]`, close panel after each); extract entries via JS evaluating nodes `.stream-entry, .element-details, .stream-item, div[role=listitem], bb-activity-stream-item, [data-item-id]`; for each node capture `full_text`, `course_context` (from `.course-title, .stream-item-context, ...`), `title`, all links (`el.href || data-url || data-href`); keep only file links matching extensions `.pdf,.pptx,.ppt,.docx,.doc,.zip,bbcswebdav,dt-content,xid-,pid-,file/,content/download`; stable item_id from `xid-/pid-/dt-content-rid-/file/` regex match else `stream_{idx}_{fIdx}`.
2. **Course Outlines**: loop every `blackboard_sections[].course_id` of every subject; goto `/ultra/courses/{cid}/outline`; click ALL `button[aria-expanded="false"]` to expand folders; extract nodes `.element-details, bb-course-outline-node, [role=treeitem], .content-item`; item_id priority: node id → data-content-id → xid regex (`outline_f_<id>`) → **djb2 hash of `title|firstHref`** base36 (so page reorder never changes identity); ALSO collect standalone page-wide `<a>` file links not already captured (`link_<xid>` ids). Tag each item with `course_context=name_en` and `section_type` from the mapping section.

**`download_file_from_url(url)`:**
1. Fast path: `requests.get` streaming with cookies parsed from storage_state.json + browser UA + Referer stream URL. Guard: if response is `text/html` AND final url contains login/auth → session expired → notify + abort. Parse filename from `Content-Disposition` (support RFC 5987 `filename*=UTF-8''`). Save to `temp_downloads/`. Validate first 512 bytes: reject HTML-disguised files; fix extension by magic bytes (`PK\x03\x04` → inspect ZIP namelist: `ppt/`=pptx, `word/`=docx else zip; `%PDF`=pdf). If `.zip` → extract safely (Zip-Slip protection: resolve member path must stay under target dir) into `temp_downloads/<stem>/` and return that dir.
2. Fallback: Playwright headless with storage_state, `page.expect_download(timeout=60000)`.
Sanitize filenames: replace `[\\/*?:"<>|]` with `_`, collapse whitespace, fallback name `download_<epoch>.pdf`.
After processing each downloaded path in main, DELETE it (temp cleanup).

### 3) `ai_classifier.py` — Gemini + heuristics
Load `subjects_mapping.json`. Text extraction from PDF/PPTX/DOCX (first ~5 pages/samples; try pypdf/python-pptx/python-docx if available — degrade gracefully to filename-only).

**Subject resolution `_resolve_subject(text)` — tiered, order matters:**
1. Base course-code regex match (e.g. `\bDIG311\b`, from `course_code.split("_")[0]`)
2. Full Blackboard course_id substring (e.g. `_288167_1`)
3. Exact English or Arabic full name
4. Keywords list per section
Arabic normalization BEFORE comparing: strip tatweel `\u0640`, unify alef `[إأآ]→ا`, `ة→ه`, `ى→ي`, strip diacritics `\u064B-\u065F\u0670`, lowercase.

**Gemini call (if GEMINI_API_KEY set):** POST `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=KEY`, temperature 0.1, `responseMimeType: application/json`. Prompt = expert dental curriculum assistant; rules:
- category ∈ {chapter, material, ignore}
  - chapter = official lectures + practical lab demos → chapters folder (practical gets `[Practical] ` filename prefix)
  - material = reference books/lab manuals/summaries/revision Qs/syllabi → materials folder
  - ignore = admin noise (rosters, grades, seat numbers, blank templates, zoom links, greetings)
- standardized_filename: practical → `[Practical] Lab 03 - Title.ext`; theory → `Lecture 03 - Title.ext`; keep original ext
Return strict JSON `{category, is_worth_uploading, standardized_filename, clean_title, reasoning}` (+ inject matched subject_id/name/section_type). Strip ``` fences if present. Any failure → heuristic fallback.

**Heuristic fallback (no API/offline):** ignore if title matches admin noise regexes (grade|roster|attendance|درجات|كشوف|seat|zoom|template); material if matches (book|manual|guide|summary|revision|syllabus|مراجع|كتاب|ملخص); else chapter. Build filename from cleaned title + `[Practical] ` prefix when section=practical.

### 4) `gdrive_uploader.py`
Exactly as specified in the GAS webhook section above (45MB cap, base64, mime map, JSON response normalization; always return dict with `success`, and on failure both `error` and `message`).

### 5) `login_local.py` — 1-click human login (THE session refresher)
Purpose: because Microsoft SSO blocks bots, login happens in a VISIBLE Chrome on my PC where I type the 2FA SMS code myself.
Flow:
1. `playwright.chromium.launch_persistent_context(user_data_dir="state/chrome_profile", headless=False, executable_path=r"C:\Program Files\Google\Chrome\Application\chrome.exe" if exists else channel="chrome", args=["--start-maximized","--disable-blink-features=AutomationControlled"])`.
2. Pre-load cookies from existing `storage_state.json` via `context.add_cookies(...)`.
3. Goto institution page, dismiss cookie consent (`#agree_button`), check already-authenticated (URL has `/ultra/` + nav element present) → if yes export storage_state instantly ("INSTANT MATCH").
4. Else: click SSO button (`a:has-text('Login SSO')` / `'تسجيل الدخول الموحد'`), fill MS email `input#i0116` → submit `#idSIButton9`, fill password `input#i0118` → submit, then poll up to 4 min while printing: *"👉 Enter your 2FA SMS code in the Chrome window"*. Auto-click "Stay signed in?" (`input#idSIButton9` on KMSI page).
5. On success: `context.storage_state(path="storage_state.json")` → print success → close. NO cloud sync anywhere.

### 6) `main.py` — controller + console UX
`BotController(interval=900, auto_enabled=True, auto_approve=False, interactive=True)` wires StateManager + AIClassifier + GDriveUploader + Harvester + ConsoleUI.

**ConsoleUI class:** `send_message(text)` prints stripped-HTML text; `notify_session_lost()` prints loud banner "SESSION EXPIRED — run 1-Click Login.bat"; `notify_session_restored()`; `request_2fa_otp(screenshot_path, timeout)` opens screenshot with `os.startfile` and reads `input()`; owns `input_lock` (threading.Lock) shared with command listener so prompts never interleave.

**Sync cycle (every interval, skippable):**
1. Harvest items. For each unprocessed item: filter date-like first lines out of full_text; derive title/body; resolve course name (fallback: AI subject resolution); derive section_type from item or regex (`lab|practical|عملي|معمل` or `_02_|(02)|sec(tion)? 02|group 02` → practical).
2. Items without file links → record status=no_files.
3. Download each file link; skip if MD5 already uploaded OR already pending; classify with AI; copy file to `temp_downloads/pending_reviews/<hash8>_<name>`; create pending_review row.
4. Then per new pending review:
   - `--yes` mode: auto-approve immediately using AI decision.
   - default: show REVIEW CARD in console:
     ```
     ══════ NEW FILE FOR REVIEW #12 ══════
       Course / Title / Subject / Category / Filename / Size / AI reasoning
       [Enter]=Upload | s=subject | c=category toggle | r=rename | i=ignore | l=later | o=open folder
     ```
     - `s`: numbered subject picker from mapping → update current_subject_id
     - `c`: toggle chapter↔material
     - `r`: type new filename
     - `i`: mark rejected + processed_items(status=ignored) + delete local copy
     - `l`: leave pending (will be asked again next cycle; hash guard prevents duplicates meanwhile)
     - `o`: `os.startfile(parent folder)`
     - Enter: UPLOAD → choose chapters vs materials folder by category → gdrive_uploader.upload_file → on success: mark uploaded, record processed_items with drive id/url, delete local copy, print ✅ with Drive link. On failure: print error, keep pending for retry.
5. At startup AND end of cycles, process ALL still-pending reviews (interactive or auto).

**Background command listener thread** (daemon, shares input_lock):
`Enter/scan`=immediate manual scan · `a`=toggle auto/pause · `i <min>`=set interval (min 60s) · `st`=print status block (mode, interval, last scan, total uploads, pending count, session file health) · `q`=clean exit. Use `threading.Event.wait(timeout=interval)` for sleep so commands wake it instantly. Manual-scan lock prevents overlapping scans.

**CLI flags:** `--once` (single scan + exit), `--interval N`, `--manual` (start paused), `--yes` (auto-approve everything), `--no-input` (never block on prompts; files stay pending).

**Startup banner:** service name, context (Dent Y3 S1, 9 subjects), mode, interval. On boot, resume leftover pending reviews first.

---

## LAUNCHERS (.bat, chcp 65001, `cd /d "%~dp0"`)
- `Start Bot.bat` → `python "src\main.py"` (banner explains console commands; pause at exit)
- `Scan Once.bat` → `python "src\main.py" --once`
- `1-Click Login.bat` → `python login_local.py` (instructions: enter SMS code in Chrome)
- `Open Blackboard.bat` → start Chrome to institution page
- `Run Tests.bat` → `python -m unittest discover -s tests -v`

## HARD-WON RULES (from the previous generation of this bot — respect them)
1. NEVER delete/overwrite `storage_state.json` except after a verified successful login.
2. ALWAYS check MD5 dedup before uploading — professors edit announcements, causing duplicate posts.
3. Stable item identity matters more than anything: prefer content-derived xid/pid/djb2 over positional indexes.
4. Guard against HTML-login pages disguised as downloads (check bytes, not just status 200).
5. Fix wrong file extensions via magic bytes before renaming/uploading.
6. ZIP extraction MUST be traversal-safe (Zip-Slip).
7. Never block the whole loop waiting on network >30–60s timeouts; always wrap Playwright waits in try/except and continue.
8. All Arabic text handling needs the normalization routine — raw string equality fails.
9. Console must never deadlock: one shared lock around every `input()`.
10. Keep `temp_downloads` clean — delete transient downloads after each cycle; keep only `pending_reviews/` copies until decided.

## DELIVERABLES CHECKLIST
- [ ] All modules above, complete and runnable, no TODOs/placeholders (except BB_PASSWORD/GEMINI_API_KEY values which I fill in .env)
- [ ] `config/.env.example` + gitignore for `.env`, `storage_state.json`, `state/`, `temp_downloads/`
- [ ] Unit tests passing (`Run Tests.bat`): sanitizer, zip-slip guard, session detection mocks, hash dedup, subject resolution tiers (incl. Arabic normalization), review approve/reject with mocked uploader
- [ ] README.md: install steps (`pip install playwright requests pypdf python-pptx python-docx` + `playwright install chromium`), daily usage, what to do when session expires
- [ ] First-run smoke instructions: how to test with `Scan Once.bat` safely before enabling 24/7 loop
