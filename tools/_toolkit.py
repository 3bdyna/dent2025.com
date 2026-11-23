"""Shared bootstrap for the Dent2025 deploy toolchain.

All deploy_*.py scripts now live in the tools/ subfolder. This module exposes a
single PROJECT_ROOT (the parent of tools/) and ensures the tools/ directory is on
sys.path so the tool scripts can import each other as siblings regardless of the
working directory they are launched from.
"""
import json
import os
import sys

TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(TOOLS_DIR)

if TOOLS_DIR not in sys.path:
    sys.path.insert(0, TOOLS_DIR)


def add_tools_to_path():
    """Idempotent helper: make sure tools/ is importable (for imports done lazily)."""
    if TOOLS_DIR not in sys.path:
        sys.path.insert(0, TOOLS_DIR)
    return TOOLS_DIR


def project_root():
    return PROJECT_ROOT


def load_deploy_config():
    """Loads gitignored deploy_config.json from the project root if present."""
    config_path = os.path.join(PROJECT_ROOT, 'deploy_config.json')
    if not os.path.exists(config_path):
        return {}
    try:
        with open(config_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
            return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def get_ssh_target(config=None):
    """Returns (ssh_user, ssh_host) from deploy_config.json or environment variables."""
    cfg = config if isinstance(config, dict) else load_deploy_config()
    ssh_user = cfg.get('user') or cfg.get('username') or os.environ.get('DENT2025_SSH_USER', '')
    ssh_host = cfg.get('ssh_host') or cfg.get('host') or os.environ.get('DENT2025_SSH_HOST', '')
    if not ssh_user or not ssh_host:
        raise RuntimeError(
            "Missing SSH credentials: configure 'user' and 'host' in deploy_config.json "
            "(or set DENT2025_SSH_USER and DENT2025_SSH_HOST)."
        )
    return ssh_user, ssh_host
