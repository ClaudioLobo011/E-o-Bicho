@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

set "AGENT_EXE=%~dp0pdv-local-agent.exe"
set "BUILD_SCRIPT=%~dp0build-agent.bat"
set "AGENT_PORT=17305"

if not exist "%AGENT_EXE%" (
  if exist "%BUILD_SCRIPT%" (
    call "%BUILD_SCRIPT%"
    if errorlevel 1 exit /b 1
  ) else (
    echo Agente nao encontrado. Execute build-agent.bat para compilar.
    pause
    exit /b 1
  )
)

set "AGENT_PID="
for /f "tokens=1,2,3,4,5" %%a in ('netstat -ano ^| findstr /I ":%AGENT_PORT%"') do (
  if /I "%%d"=="LISTENING" (
    set "AGENT_PID=%%e"
  )
)
if defined AGENT_PID (
  echo Agente ja esta rodando na porta %AGENT_PORT% - PID %AGENT_PID%.
  exit /b 0
)

if /i "%1"=="--hidden" (
  set "STAMP="
  for /f %%T in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"') do (
    set "STAMP=%%T"
  )
  for %%F in ("agent.log" "agent.err") do (
    if exist "%~dp0%%~F" (
      if defined STAMP (
        ren "%~dp0%%~F" "%%~nF-!STAMP!%%~xF"
      ) else (
        ren "%~dp0%%~F" "%%~nF-old%%~xF"
      )
    )
  )
  powershell -NoProfile -WindowStyle Hidden -Command "Start-Process -WindowStyle Hidden -FilePath '%AGENT_EXE%' -ArgumentList '--config','%~dp0agent-config.json' -WorkingDirectory '%~dp0' -RedirectStandardOutput '%~dp0agent.log' -RedirectStandardError '%~dp0agent.err'"
  exit /b 0
)

"%AGENT_EXE%" --config "%~dp0agent-config.json"
