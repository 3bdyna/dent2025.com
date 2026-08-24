@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Dent2025 Scan Once
python "src\main.py" --once --no-input
echo.
pause
