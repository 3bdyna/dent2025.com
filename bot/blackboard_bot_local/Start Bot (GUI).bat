@echo off
title Dent2025 Blackboard Sync Bot
cd /d "%~dp0"
if exist "%LOCALAPPDATA%\Programs\Python\Python311\pythonw.exe" (
    start "" "%LOCALAPPDATA%\Programs\Python\Python311\pythonw.exe" "src\main.py"
) else (
    start "" pythonw "src\main.py"
)
exit
