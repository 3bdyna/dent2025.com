"""Blackboard Ultra harvester — Playwright scraping + resilient downloader.

Design rules:
  - Every decision-heavy routine is a PURE function (testable, no browser):
    session evaluation, sanitization, magic-byte detection, Zip-Slip-safe
    extraction, item-id derivation, djb2 hashing, Content-Disposition parsing.
  - Playwright is imported LAZILY inside the browser wrappers so unit tests
    never launch a browser and run on a bare Python install.
  - Network patience: every wait is bounded; failures log and continue.

Session file: storage_state.json at project root (atomic export lives in
login_local.py / ensure_authenticated_session; see D4).
"""
import io
import json
import os
import re
import time
import zipfile
from urllib.parse import unquote, urlparse

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STORAGE_STATE_PATH = os.path.join(PROJECT_ROOT, "storage_state.json")

BASE_URL = "https://lms.jazanu.edu.sa"
LOGIN_URL = BASE_URL + "/?new_loc=%2Fultra%2Finstitution-page"
STREAM_URL = BASE_URL + "/ultra/stream"
INSTITUTION_URL = BASE_URL + "/ultra/institution-page"

NAV_TIMEOUT_S = 20
NETWORKIDLE_TIMEOUT_S = 6
DOWNLOAD_TIMEOUT_S = 60
HYDRATION_WAIT_S = 5

MAX_DOWNLOAD_BYTES = 200 * 1024 * 1024      # bandwidth pre-check cap
MAX_ZIP_UNCOMPRESSED = 500 * 1024 * 1024    # zip-bomb safety cap

USER_AGENT = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")

FILE_EXT_RE = re.compile(r"\.(pdf|pptx|ppt|docx|doc|zip)(?:$|[?#])", re.I)
FILE_TOKEN_RE = re.compile(
    r"(bbcswebdav|dt-content|xid-|pid-|/file/|content/download|/attachments/|/download|xythos)", re.I)
CONTENT_ID_RE = re.compile(
    r"(?:xid-|pid-|dt-content-rid-|/file/)([A-Za-z0-9_-]+)", re.I)

LOUD_LOGIN_MARKERS = {
    "#user_id", "user_id", "#password", "#entry-login", "entry-login",
    "login sso", "تسجيل الدخول الموحد",
}


class SessionExpiredError(Exception):
    """Download returned an HTML login page instead of a file."""


class DownloadSkipped(Exception):
    """File intentionally skipped (too large etc.). detail in .args[0]."""


# ====================================================================
# PURE FUNCTIONS (unit-tested without any browser)
# ====================================================================

def sanitize_filename(name):
    """Replace [\\/*?:"<>|] with '_', drop non-printable/control chars
    (mis-decoded Content-Disposition bytes), collapse whitespace, safe
    fallback."""
    cleaned = re.sub(r'[\\/*?:"<>|]+', "_", name or "")
    cleaned = "".join(ch for ch in cleaned if ch.isprintable())
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" .")
    return cleaned or ""


def looks_like_html(head_bytes):
    """Tag-based HTML-disguise check (NOT substring 'login' matching)."""
    head = (head_bytes or b"")[:512].lstrip().lower()
    return head.startswith(b"<!doctype") or head.startswith(b"<html")


def detect_real_extension(filepath):
    """Magic-byte extension repair. Returns corrected ext ('.pdf', '.pptx',
    '.docx', '.xlsx', '.zip') or None when nothing changes."""
    with open(filepath, "rb") as fh:
        head = fh.read(512)
    if head.startswith(b"%PDF"):
        return ".pdf"
    if head.startswith(b"PK\x03\x04"):
        try:
            with zipfile.ZipFile(filepath) as zf:
                names = zf.namelist()
        except Exception:
            return None
        joined = "/" + "/".join(names)
        if "/ppt/" in joined or any(n.startswith("ppt/") for n in names):
            return ".pptx"
        if "/word/" in joined or any(n.startswith("word/") for n in names):
            return ".docx"
        if "/xl/" in joined or any(n.startswith("xl/") for n in names):
            return ".xlsx"
        return ".zip"
    return None


def djb2_hash(text):
    """Deterministic djb2 -> base36. Identity that survives DOM reorders."""
    h = 5381
    for byte in (text or "").encode("utf-8"):
        h = ((h * 33) + byte) & 0xFFFFFFFF
    chars = "0123456789abcdefghijklmnopqrstuvwxyz"
    out = ""
    while h:
        h, r = divmod(h, 36)
        out = chars[r] + out
    return out or "0"


def derive_item_id_from_url(url):
    m = CONTENT_ID_RE.search(url or "")
    return "cid_%s" % m.group(1) if m else None


def evaluate_session(url, dom_markers=()):
    """PURE session verdict from URL + lowercase DOM marker tokens.

    False when: auth-ish URLs (new_loc=, /webapps/login, auth-saml), bare
    domain root, or any loud login marker present. True ONLY on /ultra/ or
    /webapps/blackboard/ paths.
    """
    url_l = (url or "").lower()
    parsed = urlparse(url_l)
    path = parsed.path or "/"
    if any(tok in url_l for tok in ("new_loc=", "/webapps/login", "auth-saml")):
        return False
    if path in ("/", ""):
        return False
    for marker in dom_markers:
        token = str(marker).lower().strip()
        if token and token in LOUD_LOGIN_MARKERS:
            return False
    return path.startswith("/ultra/") or path.startswith("/webapps/blackboard/")


def cookies_from_storage_state(path=STORAGE_STATE_PATH):
    """storage_state.json -> dict{name: value} for requests + UA header."""
    with open(path, "r", encoding="utf-8") as fh:
        state = json.load(fh)
    jar = {}
    for c in state.get("cookies", []):
        jar[c.get("name", "")] = c.get("value", "")
    return {k: v for k, v in jar.items() if k}


def content_disposition_filename(header_value):
    """Parse Content-Disposition; RFC 5987 filename*=UTF-8'' wins.
    NOTE: RFC 5987 is PERCENT-encoded — any base64 attempt would silently
    'decode' the %XX hex into garbage bytes, so none is used here."""
    if not header_value:
        return ""
    star = re.search(r"filename\*\s*=\s*([^']*)''([^;]+)",
                     header_value, flags=re.I)
    if star:
        charset = star.group(1).strip("'\" ") or "utf-8"
        try:
            return unquote(star.group(2).strip(),
                           encoding=charset, errors="replace")
        except Exception:
            pass
    plain = re.search(r'filename\s*=\s*"([^"]+)"', header_value, flags=re.I)
    if plain:
        return unquote(plain.group(1))
    plain = re.search(r"filename\s*=\s*([^;]+)", header_value, flags=re.I)
    if plain:
        return unquote(plain.group(1).strip())
    return ""


def is_file_link(url):
    u = url or ""
    return bool(FILE_EXT_RE.search(u) or FILE_TOKEN_RE.search(u))


def safe_extract_zip(zip_path, target_dir):
    """Zip-Slip-hardened extraction. Returns list of extracted FILE paths.

    Guards:
      - realpath(member dest) must start with realpath(target)+os.sep
      - absolute paths / drive letters / '..' members skipped AND logged
      - cumulative uncompressed size capped (zip-bomb safety)
    """
    extracted = []
    total_uncompressed = 0
    real_target = os.path.realpath(target_dir)
    prefix = real_target + os.sep
    os.makedirs(real_target, exist_ok=True)
    skipped = []
    with zipfile.ZipFile(zip_path) as zf:
        members = list(zf.infolist())
        for info in members:
            name = info.filename
            if info.is_dir():
                continue
            if name.startswith(("/", "\\")) or re.match(r"^[A-Za-z]:", name):
                skipped.append(name)
                continue
            normalized = name.replace("\\", "/").lstrip("/")
            if ".." in normalized.split("/"):
                skipped.append(name)
                continue
            dest = os.path.realpath(os.path.join(real_target,
                                                 *normalized.split("/")))
            if not dest.startswith(prefix):
                skipped.append(name)
                continue
            total_uncompressed += info.file_size
            if total_uncompressed > MAX_ZIP_UNCOMPRESSED:
                raise ValueError("Zip uncompressed size exceeds safety cap.")
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            with zf.open(info) as src, open(dest, "wb") as out:
                while True:
                    chunk = src.read(65536)
                    if not chunk:
                        break
                    out.write(chunk)
            extracted.append(dest)
    if skipped:
        print("[harvester] Zip-Slip guard skipped %d malicious member(s): %s"
              % (len(skipped), skipped[:3]))
    return extracted


# ====================================================================
# BROWSER WRAPPERS (Playwright lazy-imported; guarded timeouts)
# ====================================================================

_HEAVY_ASSETS_ROUTE = "**/*.{png,jpg,jpeg,gif,svg,woff,woff2,ttf,eot,mp4,webm}"


def _sync_playwright():
    from playwright.sync_api import sync_playwright  # lazy import
    return sync_playwright()


def collect_dom_markers(page):
    """Gather lowercase tokens proving a login page is showing."""
    markers = []
    try:
        for sel in ("#user_id", "#password", "#entry-login"):
            if page.locator(sel).count() > 0:
                markers.append(sel)
    except Exception:
        pass
    try:
        text = page.inner_text("body")[:4000].lower()
        if "login sso" in text:
            markers.append("login sso")
        if "تسجيل الدخول الموحد" in text:
            markers.append("تسجيل الدخول الموحد")
    except Exception:
        pass
    return markers


class BbHarvester:
    def __init__(self, sink=None, storage_state_path=STORAGE_STATE_PATH):
        self.sink = sink
        self.storage_state_path = storage_state_path

    def emit(self, etype, **kw):
        if self.sink:
            evt = {"type": etype}
            evt.update(kw)
            self.sink.emit(evt)

    # ---------------- session ----------------

    def has_storage_state(self):
        return os.path.isfile(self.storage_state_path)

    def ensure_authenticated_session(self, force=False):
        """Return True when a usable session exists. NEVER declares expiry
        on transient errors (timeouts/DNS blips) — only on definitive
        login-page evidence."""
        try:
            if not force and self.has_storage_state():
                if self._probe_existing_session():
                    return True
                # one retry: single probe failures are usually network noise
                time.sleep(2)
                if self._probe_existing_session():
                    self.emit("log", level="warn",
                              msg="Session probe flaky, OK on retry.")
                    return True
            if self._attempt_headless_login():
                return True
        except Exception as exc:
            self.emit("log", level="warn",
                      msg="Session recovery error (%s); assuming existing "
                          "session is still valid." % exc.__class__.__name__)
            return bool(self.has_storage_state())
        self.emit("session_lost",
                  msg="Blackboard reports not signed in — run "
                      "1-Click Login.bat.")
        return False

    def _probe_existing_session(self):
        try:
            with _sync_playwright() as pw:
                browser = pw.chromium.launch(headless=True)
                context = browser.new_context(storage_state=self.storage_state_path,
                                              user_agent=USER_AGENT)
                page = context.new_page()
                page.goto(STREAM_URL, timeout=NAV_TIMEOUT_S * 1000)
                try:
                    page.wait_for_load_state("domcontentloaded",
                                             timeout=5000)
                except Exception:
                    pass
                page.wait_for_timeout(1000)
                ok = evaluate_session(page.url, collect_dom_markers(page))
                context.close()
                browser.close()
                if ok:
                    self.emit("log", level="ok", msg="Session probe: ACTIVE.")
                else:
                    self.emit("log", level="warn", msg="Session probe: EXPIRED.")
                return ok
        except FileNotFoundError:
            return False
        except Exception as exc:
            self.emit("log", level="warn",
                      msg="Probe error (%s); treating session as lost."
                          % exc.__class__.__name__)
            return False

    def _attempt_headless_login(self):
        """Automated headless login incl. console/GUI OTP prompt."""
        with _sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            context = browser.new_context(user_agent=USER_AGENT)
            page = context.new_page()
            try:
                page.goto(LOGIN_URL, timeout=NAV_TIMEOUT_S * 1000)
                page.fill("#user_id", self._cred("BB_USERNAME"), timeout=10000)
                page.fill("#password", self._cred("BB_PASSWORD"), timeout=10000)
                page.click("#entry-login", timeout=10000)
                page.wait_for_timeout(5000)
                otp_selectors = ("#totp-verification-input",
                                 "input[name='secondaryAuthToken']")
                need_otp = False
                for sel in otp_selectors:
                    try:
                        if page.locator(sel).first.is_visible(timeout=3000):
                            need_otp = True
                            break
                    except Exception:
                        continue
                if need_otp:
                    shot = os.path.join(PROJECT_ROOT, "2fa_challenge.png")
                    try:
                        page.screenshot(path=shot)
                    except Exception:
                        shot = ""
                    code = self._request_otp(shot)
                    if not code:
                        raise RuntimeError("no OTP supplied")
                    filled = False
                    for sel in otp_selectors:
                        try:
                            page.fill(sel, code, timeout=5000)
                            filled = True
                            break
                        except Exception:
                            continue
                    submit_sel = ("#totp-submit-button" if
                                  page.locator("#totp-submit-button").count()
                                  else "button[type='submit']")
                    try:
                        page.click(submit_sel, timeout=5000)
                    except Exception:
                        page.keyboard.press("Enter")
                    page.wait_for_timeout(6000)
                ok = evaluate_session(page.url, collect_dom_markers(page))
                if not ok:
                    browser.close()
                    return False
                tmp_path = self.storage_state_path + ".tmp"
                context.storage_state(path=tmp_path)
                os.replace(tmp_path, self.storage_state_path)
                self.emit("session_restored", msg="Headless login OK.")
                browser.close()
                return True
            finally:
                try:
                    browser.close()
                except Exception:
                    pass

    def _request_otp(self, screenshot_path):
        cb = getattr(self.sink, "request_2fa_otp", None) if self.sink else None
        return cb(screenshot_path, timeout=180) if cb else None

    @staticmethod
    def _cred(key):
        from src.config_loader import load_config
        return load_config().get(key, "")

    # ---------------- harvesting ----------------

    _STREAM_ENTRY_JS = """
    () => {
      const sel = '.stream-entry, .element-details, .stream-item, '
                + 'div[role=listitem], bb-activity-stream-item, [data-item-id]';
      const nodes = Array.from(document.querySelectorAll(sel));
      return nodes.map(el => {
        const allLinks = Array.from(el.querySelectorAll('a'));
        const courseA = allLinks.find(a =>
          /\\/ultra\\/courses\\//.test(a.href || ''));
        return {
          id: el.getAttribute('data-item-id') || el.id || '',
          fullText: (el.innerText || '').slice(0, 4000),
          courseContext: (courseA ? courseA.innerText : '')
                       || ((el.querySelector('.course-title') || {})
                            .innerText || ''),
          courseHref: courseA ? courseA.href : '',
          title: ((el.querySelector('h1,h2,h3,h4,.item-title,[role=heading]')
                   || {}).innerText || ''),
          links: allLinks.map(a =>
            a.href || a.getAttribute('data-url')
            || a.getAttribute('data-href') || '').filter(Boolean)
        };
      });
    }"""

    _OUTLINE_NODE_JS = """
    () => {
      const sel = '.element-details, bb-course-outline-node, '
                + '[role=treeitem], .content-item';
      const nodes = Array.from(document.querySelectorAll(sel));
      return nodes.map(el => ({
        id: el.getAttribute('data-content-id') || el.id || '',
        fullText: (el.innerText || '').slice(0, 4000),
        courseContext: '',
        title: ((el.querySelector('h1,h2,h3,h4,[role=heading],span[title]')
                 || {}).innerText || el.getAttribute('title') || ''),
        links: Array.from(el.querySelectorAll('a')).map(a =>
          a.href || a.getAttribute('data-url')
          || a.getAttribute('data-href') || '').filter(Boolean)
      }));
    }"""

    def debug_dump(self, sections=None):
        """One-shot diagnostic: save screenshot + full HTML + every <a> link
        for the stream page and sample course pages, so extraction selectors
        can be written against REALITY instead of guesses."""
        sections = sections or [
            {"subject_name_en": "Oral and Maxillofacial Radiology",
             "type": "theory", "course_id": "_288167_1"}]
        stamp = time.strftime("%Y%m%d_%H%M%S")
        dump_dir = os.path.join(PROJECT_ROOT, "debug_dumps", stamp)
        os.makedirs(dump_dir, exist_ok=True)

        cid = sections[0].get("course_id", "")
        targets = [("stream", STREAM_URL),
                   ("outline_%s" % cid,
                    "%s/ultra/courses/%s/outline" % (BASE_URL, cid)),
                   ("announcements_%s" % cid,
                    "%s/ultra/courses/%s/announcements" % (BASE_URL, cid)),
                   ("overview_%s" % cid,
                    "%s/ultra/courses/%s/cl/overview" % (BASE_URL, cid))]

        _ANCHORS_JS = """
        () => Array.from(document.querySelectorAll('a')).map(a => ({
            text: (a.innerText || a.getAttribute('aria-label')
                   || a.title || '').trim().slice(0, 120),
            href: a.href || a.getAttribute('data-url')
                  || a.getAttribute('data-href') || ''
        })).filter(x => x.text || x.href)
        """

        with _sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            context = browser.new_context(
                storage_state=self.storage_state_path, user_agent=USER_AGENT)

            def block_heavy(route):
                try:
                    route.abort()
                except Exception:
                    pass

            context.route(_HEAVY_ASSETS_ROUTE, block_heavy)
            page = context.new_page()
            for name, url in targets:
                try:
                    self.emit("log", level="info",
                              msg="[Dump] %s -> %s" % (name, url))
                    page.goto(url, timeout=NAV_TIMEOUT_S * 1000)
                    try:
                        page.wait_for_load_state("domcontentloaded",
                                                 timeout=8000)
                    except Exception:
                        pass
                    page.wait_for_timeout(2500)
                    # trigger lazy loading: progressive scroll down
                    try:
                        page.evaluate(
                            "async () => { await new Promise(res => {"
                            "let y=0; const t=setInterval(()=>{"
                            "window.scrollBy(0,1500); y+=1500;"
                            "if(y>12000){clearInterval(t);res();}},120);}); }")
                    except Exception:
                        pass
                    if name.startswith("outline"):
                        try:
                            self._expand_outline_tree(page)
                        except Exception:
                            pass
                    if name == "stream":
                        try:
                            self._expand_groups(page)
                        except Exception:
                            pass
                    page.wait_for_timeout(1500)

                    html_path = os.path.join(dump_dir, "%s.html" % name)
                    with open(html_path, "w", encoding="utf-8") as fh:
                        fh.write(page.content())
                    try:
                        page.screenshot(
                            path=os.path.join(dump_dir, "%s.png" % name),
                            full_page=True)
                    except Exception:
                        pass
                    anchors = page.evaluate(_ANCHORS_JS) or []
                    with open(os.path.join(dump_dir, "%s_anchors.json" % name),
                              "w", encoding="utf-8") as fh:
                        json.dump(anchors, fh, ensure_ascii=False, indent=1)
                    file_like = [a for a in anchors if is_file_link(a["href"])]
                    self.emit("log", level="ok",
                              msg="[Dump] %s: %d anchor(s), %d file-like"
                                  % (name, len(anchors), len(file_like)))
                except Exception as exc:
                    self.emit("log", level="error",
                              msg="[Dump] %s FAILED: %s: %s"
                                  % (name, exc.__class__.__name__, exc))
            context.close()
            browser.close()
        self.emit("log", level="ok",
                  msg="[Dump] Saved to %s" % dump_dir)
        return dump_dir

    def harvest_all_new_content(self, sections):
        """sections: flat list of {subject_name_en, type, course_id} dicts.
        Merges Activity Stream + Course Outlines via seen-set."""
        items, seen = [], set()

        def push(item):
            iid = item["item_id"]
            if iid and iid not in seen:
                seen.add(iid)
                items.append(item)

        with _sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            context = browser.new_context(storage_state=self.storage_state_path,
                                          user_agent=USER_AGENT)

            def block_heavy(route):
                try:
                    route.abort()
                except Exception:
                    pass

            context.route(_HEAVY_ASSETS_ROUTE, block_heavy)
            page = context.new_page()

            self.emit("log", level="info", msg="[Harvester] Checking Activity Stream...")
            try:
                self._harvest_stream(page, push)
                self.emit("log", level="ok", msg="[Harvester] Activity Stream checked.")
            except Exception as exc:
                self.emit("log", level="warn",
                          msg="Stream harvest failed (%s: %s); continuing."
                              % (exc.__class__.__name__, exc))
            
            total_sec = len(sections)
            self.emit("log", level="info", msg=f"[Harvester] Scanning Course Outlines ({total_sec} sections)...")
            for idx, sec in enumerate(sections):
                name = sec.get("subject_name_en") or sec.get("course_id")
                stype = sec.get("type", "theory")
                self.emit("log", level="info",
                          msg=f"[{idx+1}/{total_sec}] Checking: {name} ({stype})...")
                try:
                    self._harvest_outline(page, sec, push)
                except Exception as exc:
                    self.emit("log", level="warn",
                              msg=f"Outline {sec.get('course_id')} warning: {exc.__class__.__name__} ({exc}); continuing.")
            context.close()
            browser.close()
        self.emit("log", level="ok",
                  msg="Harvest complete: %d candidate item(s) found." % len(items))
        return items

    def _goto(self, page, url):
        page.goto(url, timeout=NAV_TIMEOUT_S * 1000)
        try:
            page.wait_for_load_state("domcontentloaded", timeout=6000)
        except Exception:
            pass
        page.wait_for_timeout(400)

    def _expand_groups(self, page):
        selectors = ('a[href*="courseContentGroupEntry"]',
                     ".stream-group-header", "[data-group-id]")
        for sel in selectors:
            try:
                handles = page.locator(sel)
                count = min(handles.count(), 25)
                for i in range(count):
                    try:
                        handles.nth(i).click(timeout=2500)
                        page.wait_for_timeout(500)
                        close = page.locator(
                            'button[aria-label="Close"], button.close, '
                            '[data-analytics-id*="close"]').first
                        if close.count():
                            close.click(timeout=1200)
                        page.wait_for_timeout(250)
                    except Exception:
                        continue
            except Exception:
                continue

    def _wait_for_content(self, page, selector_group, timeout_ms=12000):
        """Wait until Angular actually renders matching nodes (the stream and
        outlines hydrate via XHR AFTER domcontentloaded)."""
        try:
            page.wait_for_selector(selector_group, timeout=timeout_ms,
                                   state="attached")
            return True
        except Exception:
            return False

    def _harvest_stream(self, page, push):
        if not evaluate_session(page.url, collect_dom_markers(page)):
            self._goto(page, STREAM_URL)
        if not evaluate_session(page.url, collect_dom_markers(page)):
            # one retry — first render can be slow; don't cry wolf
            self._goto(page, STREAM_URL)
            self._wait_for_content(page, ".stream-item, .element-details",
                                   timeout_ms=8000)
        if not evaluate_session(page.url, collect_dom_markers(page)):
            raise SessionExpiredError("stream redirected to login")
        self._expand_groups(page)
        self._wait_for_content(page, ".stream-item, .element-details")
        rows = page.evaluate(self._STREAM_ENTRY_JS) or []
        file_links_seen = sum(1 for r in rows
                              for l in r.get("links", []) if is_file_link(l))
        self.emit("log", level="info",
                  msg="[Harvester] Stream raw: %d node(s), %d file link(s)"
                      % (len(rows), file_links_seen))
        for idx, row in enumerate(rows):
            links = [lnk for lnk in row.get("links", []) if is_file_link(lnk)]
            full_text = row.get("fullText", "")
            first_link = links[0] if links else ""
            cid = derive_item_id_from_url(first_link)
            if cid:
                item_id = cid
            elif row.get("id"):
                item_id = "stream_dom_%s" % row["id"]
            elif links:
                item_id = "stream_%s_%d" % (
                    djb2_hash("%s|%s" % (row.get("title", ""), first_link)),
                    0)
            else:
                item_id = "stream_pos_%d" % idx  # last-resort positional
            # course context from the sibling outline link
            # (text like "أشعة الفم والوجه والفكين_DIG311_57_01_13_20271")
            course_context = (row.get("courseContext") or "").strip()
            m_course = re.search(r"/ultra/courses/(_\d+_1)",
                                 row.get("courseHref") or "")
            # title fallback: stream entries label files "Added: <name>"
            title = (row.get("title") or "").strip()
            if not title:
                m_added = re.search(r"Added:\s*(.+)",
                                    full_text.splitlines()[0]
                                    if full_text else "")
                if not m_added:
                    for line in full_text.splitlines():
                        if "Added:" in line:
                            m_added = re.search(r"Added:\s*(.+)", line)
                            break
                if m_added:
                    title = m_added.group(1).strip()[:120]
            push({
                "item_id": item_id,
                "source": "stream",
                "title": title,
                "full_text": full_text,
                "course_context": course_context,
                "course_id": m_course.group(1) if m_course else "",
                "section_type": None,
                "links": links,
            })

    def _expand_outline_tree(self, page):
        for _ in range(15):
            collapsed = page.locator('button[aria-expanded="false"]')
            try:
                count = collapsed.count()
            except Exception:
                break
            clicked = 0
            for i in range(min(count, 15)):
                try:
                    collapsed.nth(i).click(timeout=1500)
                    clicked += 1
                    page.wait_for_timeout(100)
                except Exception:
                    continue
            if clicked == 0:
                break

    def _harvest_course_api_contents(self, course_id, section, push):
        """Ultra REST API crawler: recursively fetch folders and attachments."""
        import requests
        cookies = cookies_from_storage_state(self.storage_state_path) \
            if self.has_storage_state() else {}
        headers = {"User-Agent": USER_AGENT}

        def _fetch_children(parent_id, depth=0):
            if depth > 4:
                return
            url = f"{BASE_URL}/learn/api/public/v1/courses/{course_id}/contents/{parent_id}/children?limit=200"
            try:
                r = requests.get(url, cookies=cookies, headers=headers, timeout=12)
                if r.status_code != 200:
                    return
                for it in r.json().get("results", []):
                    _process_item(it, depth + 1)
            except Exception:
                pass

        def _process_item(it, depth=0):
            cid_item = it.get("id")
            if not cid_item:
                return
            title = it.get("title", "")
            ctype = (it.get("contentHandler") or {}).get("id", "")

            # Check for attachments
            att_url = f"{BASE_URL}/learn/api/public/v1/courses/{course_id}/contents/{cid_item}/attachments"
            try:
                ar = requests.get(att_url, cookies=cookies, headers=headers, timeout=10)
                if ar.status_code == 200:
                    for att in ar.json().get("results", []):
                        att_id = att.get("id")
                        fname = att.get("fileName") or title
                        dl_url = f"{BASE_URL}/learn/api/public/v1/courses/{course_id}/contents/{cid_item}/attachments/{att_id}/download"
                        push({
                            "item_id": f"content_{course_id}_{att_id}",
                            "source": "outline",
                            "title": title or fname,
                            "full_text": f"{title} {fname}",
                            "course_context": section.get("subject_name_en", ""),
                            "course_id": course_id,
                            "section_type": section.get("type"),
                            "links": [dl_url],
                        })
            except Exception:
                pass

            # Recurse for container nodes
            if any(k in ctype for k in ("folder", "lesson", "module", "document", "group")):
                _fetch_children(cid_item, depth)

        top_url = f"{BASE_URL}/learn/api/public/v1/courses/{course_id}/contents?limit=200"
        try:
            r = requests.get(top_url, cookies=cookies, headers=headers, timeout=12)
            if r.status_code == 200:
                for it in r.json().get("results", []):
                    _process_item(it, 0)
        except Exception:
            pass

    def _harvest_outline(self, page, section, push):
        course_id = section.get("course_id", "")
        # Fast & complete REST API traversal of course structure and attachments
        self._harvest_course_api_contents(course_id, section, push)

        url = "%s/ultra/courses/%s/outline" % (BASE_URL, course_id)
        self._goto(page, url)
        # Ultra renders outline content only after folder expansion; if our
        # selectors still miss after a short window, bail out FAST instead of
        # grinding through aria-buttons for half a minute (the Activity
        # Stream is the authoritative source for newly-added files anyway).
        ok = self._wait_for_content(
            page,
            ".element-details, bb-course-outline-node, [role=treeitem], "
            ".content-item", timeout_ms=4000)
        if not ok:
            self.emit("log", level="info",
                      msg="[Harvester] Outline %s: no known content nodes "
                          "rendered; skipping section." % course_id)
            return
        self._expand_outline_tree(page)
        page.wait_for_timeout(400)
        rows = page.evaluate(self._OUTLINE_NODE_JS) or []
        captured = set()
        for row in rows:
            links = [lnk for lnk in row.get("links", []) if is_file_link(lnk)]
            if not links:
                continue
            first_link = links[0]
            key = first_link
            if key in captured:
                continue
            captured.add(key)
            node_id = row.get("id") or ""
            cid = derive_item_id_from_url(first_link)
            if node_id:
                item_id = "outline_f_%s" % node_id
            elif cid:
                item_id = cid
            else:
                item_id = "outline_f_%s" % djb2_hash(
                    "%s|%s|%s" % (course_id, row.get("title", ""),
                                  first_link))
            push({
                "item_id": item_id,
                "source": "outline",
                "title": row.get("title", ""),
                "full_text": row.get("fullText", ""),
                "course_context": section.get("subject_name_en", ""),
                "course_id": course_id,
                "section_type": section.get("type"),
                "links": links,
            })
        # page-wide standalone anchors not already captured by nodes
        try:
            all_links = page.evaluate(
                "() => Array.from(document.querySelectorAll('a'))"
                ".map(a => a.href || '').filter(Boolean)") or []
        except Exception:
            all_links = []
        for lnk in all_links:
            if not is_file_link(lnk) or lnk in captured:
                continue
            captured.add(lnk)
            cid = derive_item_id_from_url(lnk)
            item_id = cid or "link_%s" % djb2_hash("%s|%s" % (course_id, lnk))
            push({
                "item_id": item_id,
                "source": "outline",
                "title": "",
                "full_text": "",
                "course_context": section.get("subject_name_en", ""),
                "course_id": course_id,
                "section_type": section.get("type"),
                "links": [lnk],
            })

    # ---------------- downloading ----------------

    def download_file_from_url(self, url, dest_dir, referer=STREAM_URL):
        """Fast-path requests download with full validation pipeline.
        Returns dict {kind, path(s), md5, filename}. Raises SessionExpiredError
        on genuine login redirects and DownloadSkipped for viewer links the
        browser engine also refuses."""
        result = self._download_via_requests(url, dest_dir, referer)
        if result is None:
            raise SessionExpiredError("download redirected to login")
        if result.get("_viewer_html"):
            try:
                return self._download_via_playwright(url, dest_dir,
                                                     timeout_s=25)
            except Exception as exc:
                raise DownloadSkipped(
                    "Viewer-style link, browser download failed: %s"
                    % exc.__class__.__name__)
        status_code = result.pop("_status", 200)
        if status_code in (401, 403):
            path = result.get("path")
            if path and os.path.isfile(path):
                os.remove(path)
            return self._download_via_playwright(url, dest_dir)
        return self._finalize_download(result, dest_dir)

    def _download_via_requests(self, url, dest_dir, referer, depth=0):
        import requests  # lazy
        cookies = cookies_from_storage_state(self.storage_state_path) \
            if self.has_storage_state() else {}
        headers = {"User-Agent": USER_AGENT, "Referer": referer}
        size_checked = 0
        with requests.get(url, cookies=cookies, headers=headers,
                          stream=True, timeout=45,
                          allow_redirects=True) as resp:
            clen = resp.headers.get("Content-Length")
            if clen and clen.isdigit() and int(clen) > MAX_DOWNLOAD_BYTES:
                raise DownloadSkipped(
                    "Content-Length %s exceeds %d MB pre-check cap."
                    % (clen, MAX_DOWNLOAD_BYTES // (1024 * 1024)))
            final_url = resp.url
            if any(tok in final_url.lower() for tok in
                   ("new_loc=", "/webapps/login", "auth-saml")):
                return None
            os.makedirs(dest_dir, exist_ok=True)
            tmp_path = os.path.join(dest_dir, "dl_%d.part" % int(time.time()))
            md5_hash = __import__("hashlib").md5()
            head_buf = io.BytesIO()
            with open(tmp_path, "wb") as out:
                for chunk in resp.iter_content(chunk_size=65536):
                    if not chunk:
                        continue
                    if head_buf.tell() < 512:
                        head_buf.write(chunk[:512 - head_buf.tell()])
                    md5_hash.update(chunk)
                    out.write(chunk)
                    size_checked += len(chunk)
                    if size_checked > MAX_DOWNLOAD_BYTES:
                        out.close()
                        os.remove(tmp_path)
                        raise DownloadSkipped(
                            "Stream exceeded %d MB mid-download."
                            % (MAX_DOWNLOAD_BYTES // (1024 * 1024)))
            head = head_buf.getvalue()
            if looks_like_html(head):
                try:
                    os.remove(tmp_path)
                except OSError:
                    pass
                url_l = final_url.lower()
                login_url = any(t in url_l for t in
                                ("new_loc=", "/webapps/login", "auth-saml"))
                login_dom = (b"entry-login" in head or b"user_id" in head)
                if login_url or login_dom:
                    return None  # genuine logout redirect
                # Viewer/interstitial page (e.g. /ultra//file/_x_1 links).
                # The real attachment URL is almost always embedded in the
                # page — find it and fetch THAT (one recursion deep).
                try:
                    with open(tmp_path, "r", encoding="utf-8",
                              errors="replace") as fh:
                        html = fh.read(400_000)
                except OSError:
                    html = ""
                m = re.search(
                    r"(?:https?://[^\s\"'<>]+)?/(?:bbcswebdav/|ultra/)"
                    r"[^\"'\s<>]*?(?:xid-[\w-]+|/file/_[0-9]+_1)"
                    r"[^\"'\s<>]*",
                    html)
                if m and depth < 1:
                    inner = m.group(0).replace("&amp;", "&")
                    if inner.startswith("/"):
                        inner = BASE_URL + inner
                    self.emit("log", level="info",
                              msg="[Harvester] Viewer page exposed direct "
                                  "URL: …%s" % inner[-60:])
                    return self._download_via_requests(inner, dest_dir,
                                                       referer, depth + 1)
                return {"_viewer_html": True}
            cd = resp.headers.get("Content-Disposition", "")
            fname = content_disposition_filename(cd) \
                or os.path.basename(urlparse(final_url).path) \
                or "download.pdf"
            fname = sanitize_filename(fname)
            # replacement chars mean the header was undecodable — do not
            # trust it; fall back to a legal URL-derived name
            if "\ufffd" in fname:
                fname = ""
            if not fname.lower().endswith(
                    (".pdf", ".pptx", ".ppt", ".docx", ".doc", ".zip")):
                fname += ".pdf"
            fixed_ext = detect_real_extension(tmp_path)
            if fixed_ext:
                stem = os.path.splitext(fname)[0]
                fname = stem + fixed_ext
            final_path = os.path.join(dest_dir, fname)
            try:
                os.replace(tmp_path, final_path)
            except OSError:
                # mojibake/illegal name from a mis-decoded header — fall
                # back to a guaranteed-legal name built from the URL id.
                url_id = derive_item_id_from_url(url) or "bbfile"
                fname = sanitize_filename("bbfile_%s_%d%s" % (
                    url_id.strip("_"), int(time.time()),
                    os.path.splitext(fname)[1] or ".bin"))
                final_path = os.path.join(dest_dir, fname)
                os.replace(tmp_path, final_path)
            return {"_status": resp.status_code, "kind": "file",
                    "path": final_path, "md5": md5_hash.hexdigest(),
                    "filename": fname}

    def _download_via_playwright(self, url, dest_dir,
                                 timeout_s=DOWNLOAD_TIMEOUT_S):
        """Browser-engine download. Strategy:
        1) plain navigation may trigger a forced download (401/403 links)
        2) otherwise the URL is an Ultra viewer SPA: wait for it to render,
           then click ITS OWN Download control and catch the download."""
        with _sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            context = browser.new_context(storage_state=self.storage_state_path,
                                          user_agent=USER_AGENT,
                                          accept_downloads=True)
            page = context.new_page()
            download = None
            try:
                # --- attempt 1: navigation-triggered download ---
                try:
                    self._goto(page, STREAM_URL)
                    with page.expect_download(
                            timeout=min(timeout_s, 12) * 1000) as dl_info:
                        try:
                            page.goto(url, timeout=NAV_TIMEOUT_S * 1000)
                        except Exception:
                            pass  # download interrupts navigation; expected
                    download = dl_info.value
                except Exception:
                    download = None

                # --- attempt 2: viewer SPA -> click its Download button ---
                if download is None:
                    page.goto(url, timeout=NAV_TIMEOUT_S * 1000)
                    try:
                        page.wait_for_load_state("domcontentloaded",
                                                 timeout=8000)
                    except Exception:
                        pass
                    page.wait_for_timeout(2500)
                    candidates = (
                        '[aria-label*="ownload" i]',
                        'a[title*="ownload" i]',
                        'button[title*="ownload" i]',
                        '[data-analytics-id*="download" i]',
                        'button:has-text("Download")',
                        'a:has-text("Download")',
                    )
                    for sel in candidates:
                        try:
                            loc = page.locator(sel).first
                            if loc.count() == 0 \
                                    or not loc.is_visible(timeout=1500):
                                continue
                            with page.expect_download(
                                    timeout=20000) as dl_info:
                                loc.click(timeout=5000)
                            download = dl_info.value
                            break
                        except Exception:
                            continue
                if download is None:
                    raise TimeoutError(
                        "viewer rendered no download event")
                os.makedirs(dest_dir, exist_ok=True)
                suggested = sanitize_filename(download.suggested_filename) \
                    or "download_%d.pdf" % int(time.time())
                target = os.path.join(dest_dir, suggested)
                download.save_as(target)
            finally:
                context.close()
                browser.close()
        fixed_ext = detect_real_extension(target)
        if fixed_ext:
            renamed = os.path.splitext(target)[0] + fixed_ext
            os.replace(target, renamed)
            target = renamed
        from src.state_manager import calculate_file_hash
        return {"kind": "file", "path": target,
                "md5": calculate_file_hash(target),
                "filename": os.path.basename(target)}

    def _finalize_download(self, result, dest_dir):
        path = result["path"]
        ext = os.path.splitext(path)[1].lower()
        if ext == ".zip":
            inner_dir = os.path.join(dest_dir,
                                     os.path.splitext(result["filename"])[0])
            inner_files = safe_extract_zip(path, inner_dir)
            try:
                os.remove(path)
            except OSError:
                pass
            result["kind"] = "dir"
            result["paths"] = inner_files
            result.pop("path", None)
        return result
