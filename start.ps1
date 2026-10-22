# GridPlay Local Server Launcher
$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "          Starting GridPlay Local Edition             " -ForegroundColor Green
Write-Host "======================================================" -ForegroundColor Cyan

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "[ERROR] Node.js is not found in your PATH!" -ForegroundColor Red
    Write-Host "Please install Node.js from https://nodejs.org/" -ForegroundColor Yellow
    pause
    exit 1
}

Start-Process "http://localhost:3350/v3/"
node server-local.js
