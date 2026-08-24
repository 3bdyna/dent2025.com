"""Zero-dependency .env loader/parser for the Dent2025 Blackboard Sync Bot.

Parses KEY="value" lines, strips matching quotes, ignores comments and blank
lines, coerces known numeric/boolean keys. Also provides an atomic writer that
preserves unknown keys so the GUI settings editor never destroys user config.
"""
import os
import tempfile

DEFAULTS = {
    "BB_USERNAME": "",
    "BB_PASSWORD": "",
    "GEMINI_API_KEY": "",
    "GAS_WEBHOOK_URL": "",
    "DEFAULT_INTERVAL_SECONDS": 900,
    "AUTO_SYNC_ENABLED": True,
}

INT_KEYS = {"DEFAULT_INTERVAL_SECONDS"}
BOOL_KEYS = {"AUTO_SYNC_ENABLED"}

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG_DIR = os.path.join(PROJECT_ROOT, "config")


def _coerce(key, value):
    if key in INT_KEYS:
        try:
            return int(str(value).strip())
        except (TypeError, ValueError):
            return DEFAULTS[key]
    if key in BOOL_KEYS:
        return str(value).strip().lower() in ("1", "true", "yes", "on")
    return value


def parse_env_text(text):
    """Parse .env text into a dict of raw string values (quotes stripped)."""
    env = {}
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        val = val.strip()
        if len(val) >= 2 and val[0] == val[-1] and val[0] in "\"'":
            val = val[1:-1]
        if key:
            env[key] = val
    return env


def load_config(config_dir=None):
    """Load config/.env over defaults; missing file yields defaults only."""
    config_dir = config_dir or CONFIG_DIR
    values = dict(DEFAULTS)
    path = os.path.join(config_dir, ".env")
    if os.path.isfile(path):
        with open(path, "r", encoding="utf-8-sig") as fh:
            raw = parse_env_text(fh.read())
        for key, val in raw.items():
            values[key] = _coerce(key, val)
    for key in INT_KEYS:
        values[key] = _coerce(key, values[key])
    for key in BOOL_KEYS:
        values[key] = _coerce(key, values[key])
    return values


def save_config(updates, config_dir=None):
    """Atomically merge `updates` into config/.env, preserving unknown keys.

    Returns the path written.
    """
    config_dir = config_dir or CONFIG_DIR
    os.makedirs(config_dir, exist_ok=True)
    path = os.path.join(config_dir, ".env")

    existing_lines = []
    existing_keys = set()
    if os.path.isfile(path):
        with open(path, "r", encoding="utf-8-sig") as fh:
            existing_lines = fh.read().splitlines()

    out_lines = []
    seen = set()
    for line in existing_lines:
        stripped = line.strip()
        key_part = stripped.partition("=")[0].strip() if "=" in stripped else ""
        if key_part and key_part in updates:
            out_lines.append('%s="%s"' % (key_part, str(updates[key_part]).replace('"', "'")))
            seen.add(key_part)
        else:
            if key_part:
                existing_keys.add(key_part)
            out_lines.append(line)

    for key, val in updates.items():
        if key not in seen and key not in existing_keys:
            out_lines.append('%s="%s"' % (key, str(val).replace('"', "'")))
            seen.add(key)

    fd, tmp_path = tempfile.mkstemp(dir=config_dir, prefix=".env.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write("\n".join(out_lines).rstrip("\n") + "\n")
        os.replace(tmp_path, path)
    finally:
        if os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                pass
    return path
