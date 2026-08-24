# Dent2025 Blackboard Auto-Sync Bot (Local Edition)

A 100% local Windows desktop bot that runs 24/7 on your PC, watches your
**Jazan University Blackboard Ultra** for newly uploaded lecture/lab files
across the 9 dentistry subjects (Year 3, Semester 1), downloads them, classifies
them with **Google Gemini** (offline heuristic fallback included), shows each
new file as a review card in a fast **desktop GUI**, and — on your approval —
uploads it straight into the right subject's Google Drive folder.

No cloud VM. No Telegram. No server. Everything stays on this machine.

---

## 1. Install (once)

```bat
:: from this folder
pip install playwright requests pywebview
pip install pypdf python-pptx python-docx        :: optional: better AI reading
pip install pystray Pillow winotify              :: optional: tray icon + toasts
playwright install chromium
copy config\.env.example config\.env             :: then edit with Notepad
```

Fill `config/.env`:

```ini
BB_USERNAME="<YOUR_STUDENT_EMAIL>"
BB_PASSWORD="your password"
GEMINI_API_KEY="..."                 ; optional but recommended
GAS_WEBHOOK_URL="https://script.google.com/macros/s/....../exec"
DEFAULT_INTERVAL_SECONDS=900         ; 15 minutes
AUTO_SYNC_ENABLED=true
```

## 2. First run (smoke procedure)

1. Double-click **`1-Click Login.bat`** → a real Chrome window opens → sign in
   and type the SMS 2FA code yourself. Wait for `[SUCCESS]`.
2. Double-click **`Scan Once.bat`** → performs ONE scan, queues files, no
   prompts (`--no-input`). Nothing uploads yet.
3. Double-click **`Start Bot (GUI).bat`** → the GUI opens:
   - The **First-Run Doctor** card should show green rows.
   - Leftover pending files appear as cards — approve/rename/ignore them.
   - Click **Scan Now**, watch the log, approve a few cards manually.
4. Only now trust it 24/7: leave the window running (or enable *Run at Windows
   startup* + auto-approve in Settings).

## 3. Daily use

| Action | How |
|---|---|
| Open the bot | `Start Bot (GUI).bat` |
| Force an immediate scan | **Scan Now** button |
| Pause / resume automation | **Pause / Resume** button |
| Change scan interval | Settings → interval seconds (min 60) |
| Session expired? | Red banner appears → **Run 1-Click Login** (or the .bat) |
| Console fallback | `Start Bot (CLI).bat` — commands: `Enter`=scan, `a`=pause, `i <min>`=interval, `st`=status, `q`=quit |

### Review card buttons
**Approve** = upload to chapters/materials folder by category ·
**Subject dropdown** = reassign subject · **Chapter/Material** toggle ·
**Rename** = inline edit (extension auto-added) · **Preview** = open the actual
file before deciding · **Folder** = open temp folder ·
**Ignore** = discard forever (remembered by hash) · **Later** = decide next cycle.
Top of queue: **Approve All (AI)** and **Ignore Noise** batch actions.

## 4. When the session expires

The GUI shows a red banner; the CLI prints a loud banner. Just run
**`1-Click Login.bat`** (or the banner button). Your old session file is never
destroyed unless a new login fully succeeds.

## 5. Where things live

```
state/bot_state.sqlite     dedup + audit + pending review database
temp_downloads/pending_reviews/   copies of files awaiting your decision
storage_state.json         Blackboard login session (gitignored)
bot.log                    rotating log (2 MB x 3)
gui/index.html             the whole GUI (edit freely)
config/subjects_mapping.json      9 subjects -> BB courses -> Drive folders
```

## 6. Safety features baked in

- **Double dedup**: item-ID + MD5 of bytes — edited announcements never cause
  duplicate uploads.
- **45 MB hard cap** enforced before memory is used (GAS webhook limit).
- Magic-byte verification fixes wrong extensions (`pptx/docx/xlsx/pdf`) and
  rejects HTML login pages disguised as downloads.
- Zip extraction is traversal-safe (Zip-Slip guarded).
- Single-instance guard — launching twice cannot corrupt the database.
- Atomic writes for both the session file and `.env`.

## 7. Tests

```bat
Run Tests.bat
:: or: python -m unittest discover -s tests -v
```

~120 assertions across state manager, Arabic classifier, harvester guards,
uploader mocks, controller flows, and GUI bridge. All offline; no browser or
network needed.

## 8. Troubleshooting

| Symptom | Fix |
|---|---|
| Doctor row "chromium" red | `playwright install chromium` (button exists in GUI) |
| Webhook ping fails | Check `GAS_WEBHOOK_URL`; Apps Script must be deployed "Anyone" |
| Arabic looks garbled in CLI | Launchers set UTF-8; use the provided .bat files |
| GUI won't open | `pip install pywebview`; WebView2 runtime updates via Windows Update |
| Files stuck pending forever | They are waiting for you — open the queue, decide them |
