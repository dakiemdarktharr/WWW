@echo off
setlocal
cd /d "%~dp0"
if not exist node_modules\tsx (
  echo Install dependencies first: npm ci
  pause
  exit /b 1
)
if not exist dist\index.html (
  call npm exec --yes --package=node@24.22.1 -- node node_modules/vite/bin/vite.js build
  if errorlevel 1 exit /b 1
)
echo Opening RELAY at http://127.0.0.1:4317
call npm exec --yes --package=node@24.22.1 -- node --import tsx server/index.ts
if errorlevel 1 pause
