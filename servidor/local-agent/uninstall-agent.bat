@echo off
setlocal

set TASK_NAME=EoBicho PDV Local Agent
set RUN_KEY=HKCU\Software\Microsoft\Windows\CurrentVersion\Run
set RUN_VALUE=EoBichoPDVLocalAgent
schtasks /Delete /F /TN "%TASK_NAME%" >nul 2>&1
reg delete "%RUN_KEY%" /v "%RUN_VALUE%" /f >nul 2>&1

set "AGENT_PORT=17305"
for /f "tokens=1,2,3,4,5" %%a in ('netstat -ano ^| findstr /I ":%AGENT_PORT%"') do (
  if /I "%%d"=="LISTENING" (
    taskkill /PID %%e /T /F >nul 2>&1
  )
)

if /i "%1"=="--clean" (
  del /q "%~dp0agent.log" "%~dp0agent.err" >nul 2>&1
)

echo Agente removido.
pause
