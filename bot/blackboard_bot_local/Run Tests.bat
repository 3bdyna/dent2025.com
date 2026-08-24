@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Dent2025 Bot - Unit Tests
python -m unittest discover -s tests -v
echo.
pause
