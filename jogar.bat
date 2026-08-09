@echo off
cd /d "%~dp0"
start "MOLENGAS - servidor (pode minimizar, nao feche)" /min python -m http.server 8766
timeout /t 2 /nobreak >nul
start "" http://localhost:8766/index.html
