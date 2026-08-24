@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Dent2025 Blackboard Sync Bot (Console)
python "src\main.py" --cli
echo.
pause
