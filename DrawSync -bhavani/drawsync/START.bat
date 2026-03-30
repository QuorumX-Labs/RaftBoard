@echo off
title DrawSync Server
echo.
echo  ==============================
echo    DrawSync - Starting up...
echo  ==============================
echo.

cd /d "%~dp0backend"

echo  Installing packages (first time only)...
call npm install

echo.
echo  Starting DrawSync server...
echo.
echo  Open your browser and go to:
echo  http://localhost:4000
echo.
echo  Share this link with teammates on same WiFi:
echo  http://%COMPUTERNAME%:4000
echo.
echo  Press Ctrl+C to stop the server
echo.

node server.js
pause
