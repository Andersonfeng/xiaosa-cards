@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo   Starts the Xiaosa Club server on http://localhost:3000
echo   Press Ctrl+C to stop.
echo.
node server/index.js
pause
