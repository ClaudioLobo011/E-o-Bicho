@echo off
setlocal
cd /d "%~dp0"

set "NODE_EXE="
for /f "delims=" %%i in ('where node 2^>nul') do (
  set "NODE_EXE=%%i"
  goto :node_found
)

echo Node.js nao encontrado. Instale o Node.js e tente novamente.
pause
exit /b 1

:node_found
set "AGENT_PORT=17305"
set "AGENT_PID="
for /f "tokens=5" %%a in ('netstat -ano ^| findstr /R /C:":%AGENT_PORT% .*LISTENING"') do (
  set "AGENT_PID=%%a"
)
if defined AGENT_PID (
  echo Agente ja esta rodando na porta %AGENT_PORT% (PID %AGENT_PID%).
  exit /b 0
)

if /i "%1"=="--hidden" (
  for %%F in ("agent.log" "agent.err") do (
    if exist "%~dp0%%~F" (
      powershell -NoProfile -Command "Rename-Item -Path '%~dp0%%~F' -NewName ('%%~nF-' + (Get-Date -Format yyyyMMdd-HHmmss) + '%%~xF')"
    )
  )
  powershell -NoProfile -WindowStyle Hidden -Command "Start-Process -WindowStyle Hidden -FilePath '%NODE_EXE%' -ArgumentList @('--unhandled-rejections=strict','%~dp0agent.js') -WorkingDirectory '%~dp0' -RedirectStandardOutput '%~dp0agent.log' -RedirectStandardError '%~dp0agent.err'"
  exit /b 0
)

"%NODE_EXE%" --unhandled-rejections=strict "%~dp0agent.js"
