@echo off
chcp 65001 >nul
title MOLENGAS - Online pela Internet
setlocal

REM ============================================================
REM  MOLENGAS - jogar online com amigos PELA INTERNET (1 clique)
REM  Sobe o servidor no seu PC e cria um link publico via
REM  Cloudflare Tunnel. Voce manda o link pros amigos e pronto.
REM ============================================================

cd /d "%~dp0servidor"
if not exist node_modules (
  echo Instalando as dependencias do servidor ^(so na 1a vez^)...
  call npm install --no-fund --no-audit
)

echo.
echo Subindo o servidor do MOLENGAS na porta 8877...
start "MOLENGAS servidor" cmd /c "node servidor.mjs & pause"

cd /d "%~dp0"
if not exist cloudflared.exe (
  echo Baixando o tunel Cloudflare ^(so na 1a vez, ~30 MB^)...
  powershell -Command "try { Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile 'cloudflared.exe' } catch { Write-Host 'Falha ao baixar. Veja docs/jogar-pela-internet.md'; exit 1 }"
)
if not exist cloudflared.exe (
  echo.
  echo Nao consegui baixar o cloudflared. Confira sua internet ou
  echo baixe manualmente ^(veja docs/jogar-pela-internet.md^).
  pause
  exit /b 1
)

echo.
echo ================================================================
echo  Daqui a pouco vai aparecer uma linha com um link tipo:
echo      https://alguma-coisa.trycloudflare.com
echo.
echo  1^) ABRA esse link no SEU navegador
echo  2^) No jogo, clique em  "JOGAR ONLINE"
echo  3^) Clique em  "copiar"  e MANDE o link pros seus amigos
echo.
echo  Deixe ESTA janela e a do servidor abertas enquanto jogam.
echo  Pra encerrar, e so fechar as duas janelas.
echo ================================================================
echo.

cloudflared.exe tunnel --url http://localhost:8877
pause
