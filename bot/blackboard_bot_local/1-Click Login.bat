@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Dent2025 1-Click Login
python login_local.py
echo.
pause
