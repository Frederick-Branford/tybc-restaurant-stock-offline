@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\Start-TomYum-LocalAI.ps1"
if errorlevel 1 pause