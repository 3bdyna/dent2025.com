"""GAS webhook uploader — the ONLY path files take to Google Drive.

Specs enforced here:
  - 45 MB hard cap checked BEFORE reading bytes (memory safety, HTTP 413)
  - base64 JSON POST via urllib (stdlib; follows GAS 302 redirects)
  - MIME map: pdf/pptx/ppt/docx/doc/zip/png/jpg/jpeg -> octet-stream fallback
  - Response normalized to ALWAYS a dict with "success"; failures carry both
    "error" and "message".
"""
import base64
import json
import mimetypes
import os
import urllib.error
import urllib.request

MAX_UPLOAD_BYTES = 45 * 1024 * 1024  # GAS rejects big payloads
UPLOAD_TIMEOUT_S = 120
PING_TIMEOUT_S = 20

MIME_MAP = {
    ".pdf": "application/pdf",
    ".pptx": "application/vnd.openxmlformats-officedocument."
             "presentationml.presentation",
    ".ppt": "application/vnd.ms-powerpoint",
    ".docx": "application/vnd.openxmlformats-officedocument."
             "wordprocessingml.document",
    ".doc": "application/msword",
    ".zip": "application/zip",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
}


def resolve_mime(filename):
    ext = os.path.splitext(filename or "")[1].lower()
    if ext in MIME_MAP:
        return MIME_MAP[ext]
    guessed = mimetypes.guess_type(filename or "")[0]
    return guessed or "application/octet-stream"


def _normalize_response(parsed=None, success=False, error="", message=""):
    out = {"success": bool(success), "fileId": "", "fileUrl": "",
           "error": str(error or ""), "message": str(message or "")}
    if isinstance(parsed, dict):
        out["success"] = bool(parsed.get("success", success))
        out["fileId"] = str(parsed.get("fileId", "") or "")
        url = parsed.get("fileUrl") or parsed.get("webViewLink") \
            or parsed.get("url") or ""
        out["fileUrl"] = str(url)
        out["error"] = str(parsed.get("error", "") or "")
        out["message"] = str(parsed.get("message", "") or "")
    return out


def upload_file(filepath, folder_id, filename, webhook_url,
                timeout=UPLOAD_TIMEOUT_S):
    """Upload one file. Returns normalized dict; NEVER raises for expected
    failure modes (size cap, network error, bad payload)."""
    try:
        if not filepath or not os.path.isfile(filepath):
            return _normalize_response(error="file_not_found",
                                       message="File does not exist: %r"
                                               % filepath)
        size = os.path.getsize(filepath)
        if size > MAX_UPLOAD_BYTES:
            return _normalize_response(
                error="too_large",
                message="File is %.1f MB; hard cap is %d MB (GAS limit)."
                        % (size / (1024 * 1024),
                           MAX_UPLOAD_BYTES // (1024 * 1024)))
        if not folder_id:
            return _normalize_response(error="no_folder",
                                       message="No destination Drive folder.")
        if not webhook_url:
            return _normalize_response(error="no_webhook",
                                       message="GAS_WEBHOOK_URL is not configured.")

        with open(filepath, "rb") as fh:
            b64 = base64.b64encode(fh.read()).decode("ascii")

        payload = {
            "action": "upload_file",
            "folderId": folder_id,
            "filename": filename,
            "fileContent": b64,
            "mimeType": resolve_mime(filename),
        }
        req = urllib.request.Request(
            webhook_url,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        # urllib follows the GAS 302 to script.googleusercontent.com by default.
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(body)
        except ValueError:
            return _normalize_response(
                error="bad_json",
                message="Webhook returned non-JSON: %.200s" % body)
        return _normalize_response(parsed)

    except urllib.error.HTTPError as exc:
        detail = ""
        try:
            detail = exc.read(200).decode("utf-8", errors="replace")
        except Exception:
            pass
        return _normalize_response(
            error="http_%d" % exc.code,
            message="Webhook HTTP %d %s" % (exc.code, detail))
    except Exception as exc:
        return _normalize_response(error=exc.__class__.__name__,
                                   message=str(exc)[:300])


def ping_webhook(webhook_url, timeout=PING_TIMEOUT_S):
    """Lightweight reachability probe.

    ANY HTTP 200 JSON reply counts as reachable even if the script answers
    success:false 'unknown action' — we are testing connectivity, not the
    upload action. Returns (reachable, detail).
    """
    if not webhook_url:
        return False, "GAS_WEBHOOK_URL is empty."
    req = urllib.request.Request(
        webhook_url,
        data=json.dumps({"action": "ping"}).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read(400).decode("utf-8", errors="replace")
        try:
            json.loads(body)
            is_json = True
        except ValueError:
            is_json = False
        if resp.status == 200 and is_json:
            return True, "HTTP 200 + JSON — webhook alive."
        return resp.status == 200, "HTTP %d: %.120s" % (resp.status, body)
    except urllib.error.HTTPError as exc:
        return False, "HTTP %d" % exc.code
    except Exception as exc:
        return False, "%s: %s" % (exc.__class__.__name__, exc)


class GDriveUploader:
    """Thin OO wrapper so the controller can hold one instance."""

    def __init__(self, webhook_url):
        self.webhook_url = webhook_url

    def upload_file(self, filepath, folder_id, filename):
        return upload_file(filepath, folder_id, filename, self.webhook_url)

    def ping(self):
        return ping_webhook(self.webhook_url)
