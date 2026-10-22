@echo off
title GridPlay Local Server
cd /d "%~dp0"

echo ======================================================
echo           Starting GridPlay Local Edition
echo ======================================================

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not found in your PATH!
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

echo Starting backend and local server on http://localhost:3350/ ...
start "" http://localhost:3350/v3/
node server-local.js

pause
