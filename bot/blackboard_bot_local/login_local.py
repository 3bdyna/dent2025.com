"""1-Click Login — visible-Chrome session refresher (Door B).

Microsoft SSO + SMS 2FA are handled by YOU, in a real Chrome window. This
script waits, detects success, and exports storage_state.json atomically.
The bot's headless harvester reuses that session file afterwards.

Hard-Won Rule 1: storage_state.json is NEVER overwritten except after a
verified authenticated landing (write .tmp -> verify -> os.replace).
"""
import json
import os
import sys
import time

if sys.stdout and hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)
STORAGE_STATE = os.path.join(PROJECT_ROOT, "storage_state.json")
CHROME_PROFILE = os.path.join(PROJECT_ROOT, "state", "chrome_profile")

INSTITUTION_URL = "https://lms.jazanu.edu.sa/ultra/institution-page"
CHROME_PATHS = (
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
)
SSO_SELECTORS = ("a:has-text('Login SSO')",
                 "a:has-text('تسجيل الدخول الموحد')")


def _launch_options():
    kwargs = {"user_data_dir": CHROME_PROFILE, "headless": False,
              "args": ["--start-maximized",
                       "--disable-blink-features=AutomationControlled"]}
    for path in CHROME_PATHS:
        if os.path.isfile(path):
            kwargs["executable_path"] = path
            break
    else:
        kwargs["channel"] = "chrome"
    return kwargs


def _pre_load_cookies(context):
    if not os.path.isfile(STORAGE_STATE):
        return
    try:
        with open(STORAGE_STATE, "r", encoding="utf-8") as fh:
            state = json.load(fh)
        cookies = state.get("cookies", [])
        if cookies:
            context.add_cookies(cookies)
    except Exception as exc:
        print("[WARN] Could not pre-load old cookies: %s" % exc)


def _is_authenticated(page):
    try:
        from src.bb_harvester import evaluate_session, collect_dom_markers
        return evaluate_session(page.url, collect_dom_markers(page))
    except Exception:
        url = (page.url or "").lower()
        if "lms.jazanu.edu.sa" in url:
            if ("/ultra/" in url or "/webapps/blackboard/" in url) and "new_loc=" not in url and "login" not in url:
                try:
                    if page.locator("#user_id, #password, #entry-login").count() == 0:
                        return True
                except Exception:
                    return True
        return False


def _atomic_export(context):
    tmp = STORAGE_STATE + ".tmp"
    context.storage_state(path=tmp)
    with open(tmp, "r", encoding="utf-8") as fh:
        json.load(fh)  # integrity check before replacing the good session
    os.replace(tmp, STORAGE_STATE)


def _username_from_env():
    try:
        from src.config_loader import load_config
        return load_config().get("BB_USERNAME", "")
    except Exception:
        return ""


def _password_from_env():
    try:
        from src.config_loader import load_config
        return load_config().get("BB_PASSWORD", "")
    except Exception:
        return ""


def main():
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("[ERROR] Playwright is not installed.")
        print("        Run: pip install playwright && playwright install chromium")
        return 1

    print("=" * 62)
    print(" Dent2025 Blackboard Sync Bot - 1-Click Login")
    print(" A real Chrome window will open.")
    print(" If asked: type your password & SMS 2FA code in the Chrome window.")
    print("=" * 62)

    with sync_playwright() as pw:
        opts = _launch_options()
        try:
            context = pw.chromium.launch_persistent_context(**opts)
        except Exception:
            opts.pop("channel", None)
            opts.pop("executable_path", None)
            context = pw.chromium.launch_persistent_context(**opts)

        _pre_load_cookies(context)
        page = context.pages[0] if context.pages else context.new_page()

        try:
            page.goto(INSTITUTION_URL, timeout=45000)
        except Exception as exc:
            print("[WARN] Navigation hiccup (%s); continuing." % exc)

        try:
            agree = page.locator("#agree_button")
            if agree.count():
                agree.first.click(timeout=3000)
                print("[OK] Cookie banner dismissed.")
        except Exception:
            pass

        # INSTANT MATCH: existing cookies may already be valid
        page.wait_for_timeout(2500)
        if _is_authenticated(page):
            _atomic_export(context)
            print("[INSTANT MATCH] Session was already active!")
            print("[OK] Exported -> storage_state.json")
            context.close()
            return 0

        print("[..] Checking login state...")

        # Click SSO if visible
        for sel in SSO_SELECTORS:
            try:
                btn = page.locator(sel).first
                if btn.is_visible(timeout=2000):
                    btn.click()
                    print("[OK] Clicked SSO Login button.")
                    break
            except Exception:
                continue

        # Auto-fill email if on Microsoft login
        email = _username_from_env()
        try:
            email_input = page.locator("input#i0116").first
            if email_input.is_visible(timeout=3000):
                if email:
                    email_input.fill(email)
                    page.click("#idSIButton9", timeout=3000)
                    print(f"[OK] Entered email: {email}")
                    page.wait_for_timeout(1500)
        except Exception:
            pass

        # Auto-fill password if configured
        cfg_pw = _password_from_env()
        if cfg_pw:
            try:
                pw_input = page.locator("input#i0118").first
                if pw_input.is_visible(timeout=3000):
                    pw_input.fill(cfg_pw)
                    page.click("#idSIButton9", timeout=3000)
                    print("[OK] Entered password from .env")
            except Exception:
                pass

        print("-" * 62)
        print(">> Please complete your login / SMS 2FA inside the Chrome window.")
        print(">> (The script will automatically detect success and save your session)")
        print("-" * 62)

        deadline = time.time() + 300
        reminder = 0
        while time.time() < deadline:
            for p in list(context.pages):
                try:
                    # Auto-click "Stay signed in?" (KMSI) if prompted
                    kmsi = p.locator("input#idSIButton9")
                    if kmsi.count():
                        body_text = p.content()[:3000].lower()
                        if "stay" in body_text or "ابق" in body_text or "sign in" in body_text:
                            kmsi.first.click(timeout=2000)
                            print("[OK] 'Stay signed in?' accepted.")
                except Exception:
                    pass

                # Check if authenticated
                if _is_authenticated(p):
                    _atomic_export(context)
                    print()
                    print("=" * 62)
                    print(" [SUCCESS] Logged in successfully!")
                    print(" [OK] Session saved to -> storage_state.json")
                    print("=" * 62)
                    time.sleep(2)
                    context.close()
                    return 0

            if time.time() - reminder > 15:
                print(">> Waiting for you in Chrome... (completing 2FA)")
                reminder = time.time()

            time.sleep(1)

        print("[ERROR] Timed out waiting for login. Run 1-Click Login.bat again.")
        context.close()
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
