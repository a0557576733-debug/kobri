@echo off
chcp 65001 >nul
cd /d "%~dp0"

if not exist node_modules (
  echo Installing dependencies...
  call npm install
)

echo Preparing .env ...
node scripts\ensure-env.js

echo Starting finance-calc-server...
echo.
echo Admin panel: http://127.0.0.1:5055/admin
echo.
node server.js
pause
