"""Shared bootstrap for the Dent2025 deploy toolchain.

All deploy_*.py scripts now live in the tools/ subfolder. This module exposes a
single PROJECT_ROOT (the parent of tools/) and ensures the tools/ directory is on
sys.path so the tool scripts can import each other as siblings regardless of the
working directory they are launched from.
"""
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
