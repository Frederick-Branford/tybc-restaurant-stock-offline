@echo off
rem TOM YUM BANG C - Offline Edition prerequisite check (read-only).
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Test-TomYum-OfflinePrerequisites.ps1" %*
exit /b %ERRORLEVEL%
