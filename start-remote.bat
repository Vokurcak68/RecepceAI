@echo off
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -NoExit -File "%~dp0start-remote.ps1"
