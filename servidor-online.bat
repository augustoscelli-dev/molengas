@echo off
cd /d "%~dp0servidor"
if not exist node_modules (
  echo Instalando dependencias do servidor (so na primeira vez)...
  call npm install --no-fund --no-audit
)
node servidor.mjs
pause
