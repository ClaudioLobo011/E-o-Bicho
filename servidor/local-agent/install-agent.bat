@echo off
setlocal
cd /d "%~dp0"

if not exist "%~dp0pdv-local-agent.exe" (
  call "%~dp0build-agent.bat"
  if errorlevel 1 exit /b 1
)

set TASK_NAME=EoBicho PDV Local Agent
set RUN_KEY=HKCU\Software\Microsoft\Windows\CurrentVersion\Run
set RUN_VALUE=EoBichoPDVLocalAgent
set "RUN_USER=%USERNAME%"
schtasks /Create /F /SC ONLOGON /RL LIMITED /DELAY 0000:10 /IT /RU "%RUN_USER%" /TN "%TASK_NAME%" /TR "\"%~dp0start-agent.bat\" --hidden" >nul 2>&1
reg add "%RUN_KEY%" /v "%RUN_VALUE%" /t REG_SZ /d "\"%~dp0start-agent.bat\" --hidden" /f >nul 2>&1

echo Agente instalado. Iniciando agora...
call "%~dp0start-agent.bat" --hidden
exit /b 0
