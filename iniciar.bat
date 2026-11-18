@echo off
chcp 65001 >nul
cd /d "%~dp0"
set LUMINA_OPEN=1
set "NODE="
where node >nul 2>&1 && set "NODE=node"
if not defined NODE if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
if not defined NODE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE (
  echo Node.js 22 ou superior nao foi encontrado.
  echo Instale em https://nodejs.org e execute este arquivo novamente.
  pause
  exit /b 1
)
echo Abrindo Lúmina Ops em http://localhost:4173
"%NODE%" server\index.js
if errorlevel 1 pause
